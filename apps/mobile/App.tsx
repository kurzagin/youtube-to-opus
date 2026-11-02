import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Switch,
  SafeAreaView,
  StatusBar as RNStatusBar,
  Platform,
  Modal,
  TouchableWithoutFeedback
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Paths, File as ExpoFile } from 'expo-file-system';
import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import {
  Search,
  Download,
  AlertCircle,
  Trash2,
  CheckCircle2,
  DownloadCloud,
  ChevronDown,
  Check
} from 'lucide-react-native';
import type { VideoMetadata, VideoItemState } from '@youtube-to-opus/shared';
import {
  initPython,
  fetchOnDeviceInfo,
  downloadRawStreamOnDevice,
  saveAudioToMediaStore,
  getSharedText
} from 'youtube-extractor';

const BITRATES = [
  { label: 'Best Direct Quality (~160kbps VBR Opus)', value: 'best' },
  { label: '192 kbps (Audiophile Opus Re-encode)', value: '192' },
  { label: '128 kbps (Standard Opus Delivery)', value: '128' },
  { label: '96 kbps (Compact Opus)', value: '96' },
  { label: '64 kbps (Voice / Lightweight)', value: '64' }
];

const MONO_FONT = Platform.select({
  ios: 'Courier',
  android: 'monospace',
  default: 'monospace'
});

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatViews(views: number): string {
  if (!views || isNaN(views)) return '0 views';
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M views`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K views`;
  return `${views.toLocaleString()} views`;
}

export default function App() {
  const [urlsInput, setUrlsInput] = useState('');
  const [bitrate, setBitrate] = useState('best');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [embedMetadata, setEmbedMetadata] = useState(true);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [items, setItems] = useState<VideoItemState[]>([]);
  const [status, setStatus] = useState<{
    title: string;
    desc: string;
    isError?: boolean;
    showSpinner?: boolean;
  } | null>(null);

  // Initialize embedded python runtime and catch incoming Android share intents
  useEffect(() => {
    initPython().catch(() => {});

    getSharedText().then((shared) => {
      if (shared && shared.trim()) {
        setUrlsInput((prev) => (prev.trim() ? `${prev.trim()}\n${shared.trim()}` : shared.trim()));
      }
    }).catch(() => {});
  }, []);

  const selectedBitrateObj = BITRATES.find((b) => b.value === bitrate) || BITRATES[0];

  const handleAnalyze = async () => {
    const rawLines = urlsInput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (rawLines.length === 0) return;

    const uniqueUrls = Array.from(new Set(rawLines));
    const initialStates: VideoItemState[] = uniqueUrls.map((url) => ({
      url,
      loading: true,
      metadata: null,
      error: null
    }));

    setItems(initialStates);
    setLoading(true);

    setStatus({
      title: 'LOCAL ANALYSIS IN PROGRESS',
      desc: `Extracting manifests on-device with embedded yt-dlp (${uniqueUrls.length} stream${uniqueUrls.length > 1 ? 's' : ''})...`,
      showSpinner: true
    });

    let successCount = 0;
    let failCount = 0;

    await Promise.all(
      uniqueUrls.map(async (rawUrl, index) => {
        try {
          const rawMeta = await fetchOnDeviceInfo(rawUrl);

          const metadata: VideoMetadata = {
            id: rawMeta.id,
            title: rawMeta.title,
            channel: rawMeta.channel,
            thumbnail: rawMeta.thumbnail,
            duration: rawMeta.duration,
            durationFormatted: formatDuration(rawMeta.duration),
            viewCount: rawMeta.viewCount,
            viewCountFormatted: formatViews(rawMeta.viewCount),
            webpageUrl: rawMeta.webpageUrl
          };

          successCount++;
          setItems((prev) =>
            prev.map((item, idx) =>
              idx === index ? { ...item, loading: false, metadata, error: null } : item
            )
          );
        } catch (err: any) {
          failCount++;
          setItems((prev) =>
            prev.map((item, idx) =>
              idx === index
                ? {
                    ...item,
                    loading: false,
                    metadata: null,
                    error: err.message || 'Failed to inspect stream audio with local yt-dlp.'
                  }
                : item
            )
          );
        }
      })
    );

    setLoading(false);

    if (failCount === 0) {
      setStatus({
        title: 'ANALYSIS COMPLETE',
        desc: `Inspected ${successCount} stream${successCount > 1 ? 's' : ''} on-device. Ready for local FFmpeg Opus conversion.`,
        isError: false,
        showSpinner: false
      });
    } else if (successCount > 0) {
      setStatus({
        title: 'ANALYSIS PARTIALLY COMPLETED',
        desc: `${successCount} streams ready, ${failCount} failed.`,
        isError: true,
        showSpinner: false
      });
    } else {
      setStatus({
        title: 'ALL ANALYSES FAILED',
        desc: 'Could not extract metadata from the provided URLs.',
        isError: true,
        showSpinner: false
      });
    }
  };

  const executeLocalExtraction = async (meta: VideoMetadata) => {
    try {
      setDownloadingId(meta.id);
      setStatus({
        title: 'DOWNLOADING STREAM ON-DEVICE',
        desc: `Pulling audio directly from YouTube for "${meta.title}"...`,
        showSpinner: true
      });

      const sanitizedTitle = meta.title.replace(/[\\/:*?"<>|]/g, '_');
      const cacheDir = Paths.cache.uri.replace(/\/+$/, '');
      const rawTempPath = `${cacheDir}/temp_${meta.id}.raw`;
      const opusTempPath = `${cacheDir}/${sanitizedTitle}.opus`;

      // 1. Download raw stream using local embedded yt-dlp
      await downloadRawStreamOnDevice(meta.webpageUrl, rawTempPath);

      setStatus({
        title: 'TRANSCODING VIA EMBEDDED FFMPEG',
        desc: `Encoding Opus stream locally (${bitrate === 'best' ? '~160k VBR' : `${bitrate}k`})...`,
        showSpinner: true
      });

      // 2. Transcode to high-fidelity Opus via embedded ffmpeg-kit
      const bArg = bitrate === 'best' ? '160k' : `${bitrate}k`;
      const tagArgs = embedMetadata
        ? `-metadata title="${meta.title.replace(/"/g, '\\"')}" -metadata artist="${meta.channel.replace(/"/g, '\\"')}"`
        : '';
      const ffmpegCmd = `-y -i "${rawTempPath}" -c:a libopus -b:a ${bArg} -vbr on ${tagArgs} "${opusTempPath}"`;

      const session = await FFmpegKit.execute(ffmpegCmd);
      const returnCode = await session.getReturnCode();

      if (!ReturnCode.isSuccess(returnCode)) {
        throw new Error('Local FFmpeg transcode failed.');
      }

      // 3. Save directly to Android Public Music Directory via Scoped Storage MediaStore
      await saveAudioToMediaStore(opusTempPath, `${sanitizedTitle}.opus`);

      // Clean up temporary files
      try {
        new ExpoFile(rawTempPath).delete();
        new ExpoFile(opusTempPath).delete();
      } catch {}

      setStatus({
        title: 'SAVED TO MUSIC STORAGE',
        desc: `"${meta.title}.opus" saved directly to your device's Music folder.`,
        isError: false,
        showSpinner: false
      });

      Alert.alert(
        'Opus Audio Extracted',
        `File saved directly to your phone's Music directory:\n\n${sanitizedTitle}.opus`,
        [{ text: 'OK' }]
      );
    } catch (err: any) {
      setStatus({
        title: 'EXTRACTION FAILED',
        desc: err.message || 'An error occurred during local extraction.',
        isError: true,
        showSpinner: false
      });
      Alert.alert('Error', err.message || 'Extraction failed');
    } finally {
      setDownloadingId(null);
    }
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const clearAll = () => {
    setUrlsInput('');
    setItems([]);
    setStatus(null);
  };

  const readyCount = items.filter((item) => item.metadata !== null).length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      {/* Top Nav (Clean Kurzagin header without server config) */}
      <View style={styles.topNav}>
        <View style={styles.navBrand}>
          <View style={styles.dot} />
          <Text style={styles.brandTitle}>YOUTUBE-TO-OPUS</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {/* Page Header (Title only) */}
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>
            YouTube <Text style={styles.hl}>/</Text> Opus Audio Extractor
          </Text>
        </View>

        {/* Input Card */}
        <View style={styles.kurzaginCard}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.kurzaginTextarea}
              placeholder={'Insert one or multiple YouTube URLs (separated by new line)...\nhttps://www.youtube.com/watch?v=...\nhttps://youtu.be/...'}
              placeholderTextColor="#4a4844"
              value={urlsInput}
              onChangeText={setUrlsInput}
              multiline
              numberOfLines={4}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Options Grid */}
          <View style={styles.optionsGrid}>
            <View style={styles.optionGroup}>
              <Text style={styles.optionLabel}>AUDIO BITRATE / COMPRESSION</Text>

              {/* Styled Dropdown Trigger */}
              <TouchableOpacity
                style={[styles.kurzaginSelect, isDropdownOpen && styles.kurzaginSelectOpen]}
                onPress={() => setIsDropdownOpen(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.kurzaginSelectText} numberOfLines={1}>
                  {selectedBitrateObj.label}
                </Text>
                <ChevronDown color="#c49368" size={14} />
              </TouchableOpacity>
            </View>

            <View style={styles.checkboxContainer}>
              <Text style={styles.checkboxLabel}>EMBED TAGS / METADATA</Text>
              <Switch
                value={embedMetadata}
                onValueChange={setEmbedMetadata}
                thumbColor={embedMetadata ? '#c49368' : '#706c66'}
                trackColor={{ false: '#1f1f24', true: 'rgba(196, 147, 104, 0.3)' }}
              />
            </View>
          </View>

          {/* Dropdown Modal */}
          <Modal
            visible={isDropdownOpen}
            transparent={true}
            animationType="fade"
            onRequestClose={() => setIsDropdownOpen(false)}
          >
            <TouchableWithoutFeedback onPress={() => setIsDropdownOpen(false)}>
              <View style={styles.modalOverlay}>
                <TouchableWithoutFeedback>
                  <View style={styles.dropdownModalCard}>
                    <View style={[styles.corner, styles.cornerTL]} />
                    <View style={[styles.corner, styles.cornerTR]} />
                    <View style={[styles.corner, styles.cornerBL]} />
                    <View style={[styles.corner, styles.cornerBR]} />

                    <View style={styles.dropdownModalHeader}>
                      <Text style={styles.dropdownModalTitle}>SELECT AUDIO BITRATE</Text>
                      <TouchableOpacity
                        onPress={() => setIsDropdownOpen(false)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Text style={styles.dropdownCloseText}>CLOSE</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.dropdownList}>
                      {BITRATES.map((item) => {
                        const isSelected = item.value === bitrate;
                        return (
                          <TouchableOpacity
                            key={item.value}
                            style={[
                              styles.dropdownItem,
                              isSelected && styles.dropdownItemSelected
                            ]}
                            onPress={() => {
                              setBitrate(item.value);
                              setIsDropdownOpen(false);
                            }}
                            activeOpacity={0.7}
                          >
                            <Text
                              style={[
                                styles.dropdownItemText,
                                isSelected && styles.dropdownItemTextSelected
                              ]}
                            >
                              {item.label}
                            </Text>
                            {isSelected && <Check color="#c49368" size={16} />}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                </TouchableWithoutFeedback>
              </View>
            </TouchableWithoutFeedback>
          </Modal>

          {/* Submit Action Buttons */}
          <View style={styles.btnActionRow}>
            <TouchableOpacity
              style={[
                styles.btnSubmit,
                (!urlsInput.trim() || loading) && styles.btnDisabled
              ]}
              disabled={!urlsInput.trim() || loading}
              onPress={handleAnalyze}
              activeOpacity={0.8}
            >
              {loading ? (
                <View style={styles.btnInner}>
                  <ActivityIndicator color="#0a0a0c" size="small" />
                  <Text style={styles.btnSubmitText}>ANALYZING STREAMS...</Text>
                </View>
              ) : (
                <View style={styles.btnInner}>
                  <Search color="#0a0a0c" size={15} />
                  <Text style={styles.btnSubmitText}>ANALYZE STREAM(S)</Text>
                </View>
              )}
            </TouchableOpacity>

            {items.length > 0 && (
              <TouchableOpacity style={styles.btnClear} onPress={clearAll} activeOpacity={0.7}>
                <Trash2 color="#b05050" size={16} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Status / Alert Notification */}
        {status && (
          <View
            style={[
              styles.statusPanel,
              status.isError ? styles.statusError : null
            ]}
          >
            {status.showSpinner ? (
              <ActivityIndicator color="#c49368" size="small" />
            ) : status.isError ? (
              <AlertCircle color="#b05050" size={18} />
            ) : (
              <CheckCircle2 color="#6a9a6a" size={18} />
            )}
            <View style={styles.statusTextContainer}>
              <Text
                style={[
                  styles.statusTitle,
                  { color: status.isError ? '#b05050' : '#c49368' }
                ]}
              >
                {status.title}
              </Text>
              <Text style={styles.statusDesc}>{status.desc}</Text>
            </View>
          </View>
        )}

        {/* Batch Action Toolbar */}
        {readyCount > 1 && (
          <View style={styles.batchToolbar}>
            <Text style={styles.batchCountText}>
              <Text style={styles.hl}>{readyCount}</Text> OF <Text style={styles.hl}>{items.length}</Text> STREAMS READY
            </Text>
            <TouchableOpacity
              style={styles.batchDownloadBtn}
              onPress={async () => {
                for (const item of items) {
                  if (item.metadata) {
                    await executeLocalExtraction(item.metadata);
                  }
                }
              }}
              activeOpacity={0.8}
            >
              <DownloadCloud color="#0a0a0c" size={14} />
              <Text style={styles.batchDownloadText}>EXTRACT ALL ({readyCount})</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Video Results List */}
        {items.length > 0 && (
          <View style={styles.resultsList}>
            {items.map((item, index) => {
              if (item.loading) {
                return (
                  <View key={index} style={[styles.resultCard, styles.loadingCard]}>
                    <ActivityIndicator color="#c49368" size="small" />
                    <Text style={styles.loadingUrl} numberOfLines={1}>
                      {item.url}
                    </Text>
                  </View>
                );
              }

              if (item.error || !item.metadata) {
                return (
                  <View key={index} style={[styles.resultCard, styles.errorCard]}>
                    <View style={styles.metaDetails}>
                      <Text style={styles.errorUrl} numberOfLines={1}>{item.url}</Text>
                      <View style={styles.errorMsgRow}>
                        <AlertCircle color="#b05050" size={13} />
                        <Text style={styles.errorMsgText}>{item.error || 'Failed to inspect stream audio'}</Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.btnRemove}
                      onPress={() => removeItem(index)}
                      activeOpacity={0.7}
                    >
                      <Trash2 color="#706c66" size={14} />
                    </TouchableOpacity>
                  </View>
                );
              }

              const meta = item.metadata;
              const isProcessingThis = downloadingId === meta.id;

              return (
                <View key={meta.id || index} style={styles.resultCard}>
                  <View style={styles.thumbWrapper}>
                    <Image source={{ uri: meta.thumbnail }} style={styles.thumbImg} />
                    <View style={styles.thumbDuration}>
                      <Text style={styles.thumbDurationText}>{meta.durationFormatted}</Text>
                    </View>
                  </View>

                  <View style={styles.metaDetails}>
                    <Text style={styles.metaTitle} numberOfLines={2}>
                      {meta.title}
                    </Text>
                    <Text style={styles.metaChannel}>{meta.channel}</Text>

                    <View style={styles.badgeRow}>
                      <View style={styles.badgeItem}>
                        <Text style={styles.badgeItemText}>{meta.viewCountFormatted}</Text>
                      </View>
                      <View style={[styles.badgeItem, styles.badgeAccent]}>
                        <Text style={styles.badgeAccentText}>LOCAL LIBOPUS</Text>
                      </View>
                    </View>

                    <View style={styles.btnRow}>
                      <TouchableOpacity
                        style={[styles.btnActionPrimary, isProcessingThis && styles.btnDisabled]}
                        disabled={isProcessingThis}
                        onPress={() => executeLocalExtraction(meta)}
                        activeOpacity={0.8}
                      >
                        {isProcessingThis ? (
                          <ActivityIndicator color="#e2ded6" size="small" />
                        ) : (
                          <Download color="#e2ded6" size={13} />
                        )}
                        <Text style={styles.btnActionPrimaryText}>
                          {isProcessingThis ? 'PROCESSING...' : 'EXTRACT TO STORAGE'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.btnRemove}
                        onPress={() => removeItem(index)}
                        activeOpacity={0.7}
                      >
                        <Trash2 color="#706c66" size={14} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Info Grid */}
        <View style={styles.infoGrid}>
          <View style={styles.infoItem}>
            <Text style={styles.infoIndex}>01 / STANDALONE</Text>
            <Text style={styles.infoName}>Embedded Python & yt-dlp</Text>
            <Text style={styles.infoDesc}>
              Runs an in-app CPython runtime to resolve YouTube audio streams directly without any external server.
            </Text>
          </View>

          <View style={styles.infoItem}>
            <Text style={styles.infoIndex}>02 / ON-DEVICE</Text>
            <Text style={styles.infoName}>Native FFmpeg Transcode</Text>
            <Text style={styles.infoDesc}>
              Transcodes audio directly to high-density Opus format on your phone's processor using libopus.
            </Text>
          </View>

          <View style={styles.infoItem}>
            <Text style={styles.infoIndex}>03 / STORAGE</Text>
            <Text style={styles.infoName}>Android Scoped MediaStore</Text>
            <Text style={styles.infoDesc}>
              Automatically saves exported .opus files to your public Music/YouTubeOpus directory for music players.
            </Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.siteFooter}>
          <Text style={styles.footerText}>
            Standalone On-Device Architecture · React Native · Chaquopy · FFmpegKit
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0a0a0c',
    paddingTop: RNStatusBar.currentHeight || 0
  },
  scrollContainer: {
    padding: 16,
    paddingBottom: 40
  },

  /* Top Nav */
  topNav: {
    height: 48,
    backgroundColor: 'rgba(10, 10, 12, 0.98)',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a30',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16
  },
  navBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#c49368'
  },
  brandTitle: {
    fontFamily: MONO_FONT,
    fontSize: 12,
    fontWeight: '500',
    color: '#e2ded6',
    letterSpacing: 1
  },
  navStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: '#1f1f24',
    borderWidth: 1,
    borderColor: '#2a2a30'
  },
  pulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#6a9a6a'
  },
  statusOnlineText: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    color: '#b0aca4',
    letterSpacing: 0.5
  },

  /* Page Header */
  pageHeader: {
    marginTop: 16,
    marginBottom: 20
  },
  pageTitle: {
    fontFamily: MONO_FONT,
    fontSize: 22,
    fontWeight: '300',
    color: '#e2ded6',
    letterSpacing: -0.5,
    lineHeight: 28
  },
  hl: {
    color: '#c49368',
    fontWeight: '600'
  },

  /* Kurzagin Card */
  kurzaginCard: {
    backgroundColor: '#111114',
    borderWidth: 1,
    borderColor: '#2a2a30',
    padding: 16,
    position: 'relative'
  },
  corner: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderColor: '#c49368',
    opacity: 0.6
  },
  cornerTL: { top: 4, left: 4, borderTopWidth: 1, borderLeftWidth: 1 },
  cornerTR: { top: 4, right: 4, borderTopWidth: 1, borderRightWidth: 1 },
  cornerBL: { bottom: 4, left: 4, borderBottomWidth: 1, borderLeftWidth: 1 },
  cornerBR: { bottom: 4, right: 4, borderBottomWidth: 1, borderRightWidth: 1 },

  inputContainer: {
    marginBottom: 14
  },
  kurzaginTextarea: {
    backgroundColor: '#0a0a0c',
    borderWidth: 1,
    borderColor: '#2a2a30',
    color: '#e2ded6',
    fontFamily: MONO_FONT,
    fontSize: 12,
    padding: 12,
    minHeight: 85,
    textAlignVertical: 'top'
  },

  optionsGrid: {
    marginBottom: 16,
    gap: 12
  },
  optionGroup: {
    gap: 6
  },
  optionLabel: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    color: '#706c66',
    letterSpacing: 1
  },

  kurzaginSelect: {
    backgroundColor: '#0a0a0c',
    borderWidth: 1,
    borderColor: '#2a2a30',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  kurzaginSelectOpen: {
    borderColor: '#c49368'
  },
  kurzaginSelectText: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: '#e2ded6',
    flex: 1,
    marginRight: 8
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 10, 12, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  dropdownModalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#111114',
    borderWidth: 1,
    borderColor: '#2a2a30',
    padding: 18,
    position: 'relative'
  },
  dropdownModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1e1e24',
    paddingBottom: 10,
    marginBottom: 10
  },
  dropdownModalTitle: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontWeight: '700',
    color: '#c49368',
    letterSpacing: 1
  },
  dropdownCloseText: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    color: '#706c66',
    letterSpacing: 1
  },
  dropdownList: {
    gap: 6
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#0a0a0c',
    borderWidth: 1,
    borderColor: '#1e1e24'
  },
  dropdownItemSelected: {
    borderColor: '#c49368',
    backgroundColor: 'rgba(196, 147, 104, 0.08)'
  },
  dropdownItemText: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: '#b0aca4',
    flex: 1
  },
  dropdownItemTextSelected: {
    color: '#c49368',
    fontWeight: '600'
  },

  checkboxContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4
  },
  checkboxLabel: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: '#b0aca4',
    letterSpacing: 0.5
  },

  btnActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4
  },
  btnSubmit: {
    flex: 1,
    backgroundColor: '#c49368',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  btnDisabled: {
    opacity: 0.5
  },
  btnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  btnSubmitText: {
    fontFamily: MONO_FONT,
    fontSize: 12,
    fontWeight: '700',
    color: '#0a0a0c',
    letterSpacing: 1
  },
  btnClear: {
    width: 44,
    backgroundColor: '#18181c',
    borderWidth: 1,
    borderColor: '#2a2a30',
    justifyContent: 'center',
    alignItems: 'center'
  },

  /* Status Banner */
  statusPanel: {
    marginTop: 14,
    backgroundColor: '#111114',
    borderWidth: 1,
    borderColor: '#2a2a30',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  statusError: {
    borderColor: '#b05050',
    backgroundColor: 'rgba(176, 80, 80, 0.08)'
  },
  statusTextContainer: {
    flex: 1
  },
  statusTitle: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5
  },
  statusDesc: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: '#706c66',
    marginTop: 2
  },

  /* Batch Toolbar */
  batchToolbar: {
    marginTop: 16,
    backgroundColor: '#18181c',
    borderWidth: 1,
    borderColor: '#2a2a30',
    padding: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  batchCountText: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: '#b0aca4'
  },
  batchDownloadBtn: {
    backgroundColor: '#c49368',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  batchDownloadText: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontWeight: '700',
    color: '#0a0a0c',
    letterSpacing: 0.5
  },

  /* Results List */
  resultsList: {
    marginTop: 16,
    gap: 14
  },
  resultCard: {
    backgroundColor: '#111114',
    borderWidth: 1,
    borderColor: '#2a2a30',
    padding: 14
  },
  loadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  loadingUrl: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: '#706c66',
    flex: 1
  },
  errorCard: {
    borderColor: '#b05050',
    backgroundColor: 'rgba(176, 80, 80, 0.05)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  errorUrl: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: '#b0aca4',
    marginBottom: 4
  },
  errorMsgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  errorMsgText: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: '#b05050'
  },

  thumbWrapper: {
    width: '100%',
    height: 170,
    position: 'relative',
    backgroundColor: '#0a0a0c',
    borderWidth: 1,
    borderColor: '#1e1e24',
    marginBottom: 12
  },
  thumbImg: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover'
  },
  thumbDuration: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(10, 10, 12, 0.92)',
    borderWidth: 1,
    borderColor: '#2a2a30',
    paddingHorizontal: 6,
    paddingVertical: 2
  },
  thumbDurationText: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    color: '#e2ded6'
  },

  metaDetails: {
    flex: 1
  },
  metaTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#e2ded6',
    lineHeight: 18,
    marginBottom: 4
  },
  metaChannel: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: '#706c66',
    marginBottom: 10
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12
  },
  badgeItem: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: '#18181c',
    borderWidth: 1,
    borderColor: '#1e1e24'
  },
  badgeItemText: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    color: '#b0aca4'
  },
  badgeAccent: {
    backgroundColor: 'rgba(196, 147, 104, 0.12)',
    borderColor: '#c49368'
  },
  badgeAccentText: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    color: '#c49368'
  },

  btnRow: {
    flexDirection: 'row',
    gap: 8
  },
  btnActionPrimary: {
    flex: 1,
    backgroundColor: '#1f1f24',
    borderWidth: 1,
    borderColor: '#2a2a30',
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6
  },
  btnActionPrimaryText: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: '#e2ded6',
    letterSpacing: 0.5,
    textTransform: 'uppercase'
  },
  btnRemove: {
    backgroundColor: '#0a0a0c',
    borderWidth: 1,
    borderColor: '#2a2a30',
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center'
  },

  /* Info Grid */
  infoGrid: {
    marginTop: 32,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: '#1e1e24',
    gap: 12
  },
  infoItem: {
    backgroundColor: '#111114',
    borderWidth: 1,
    borderColor: '#1e1e24',
    padding: 14
  },
  infoIndex: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    color: '#c49368',
    marginBottom: 2
  },
  infoName: {
    fontFamily: MONO_FONT,
    fontSize: 13,
    color: '#e2ded6',
    marginBottom: 4
  },
  infoDesc: {
    fontSize: 11,
    color: '#706c66',
    lineHeight: 16
  },

  /* Footer */
  siteFooter: {
    marginTop: 32,
    paddingVertical: 18,
    borderTopWidth: 1,
    borderTopColor: '#1e1e24',
    alignItems: 'center'
  },
  footerText: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    color: '#4a4844',
    textAlign: 'center'
  }
});
