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
  Check,
  AlertTriangle
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
  { label: '192 kbps (Audiophile Opus)', value: '192' },
  { label: '128 kbps (Standard Opus)', value: '128' },
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

function humanizeError(rawError: string): string {
  const err = (rawError || '').toLowerCase();
  if (err.includes('age') || err.includes('inappropriate') || err.includes('confirm your age')) {
    return 'Age-restricted on YouTube. Please use the YouTube Music track or an unrestricted link.';
  }
  if (err.includes('unavailable') || err.includes('not found') || err.includes('private')) {
    return 'This video is private, removed, or unavailable.';
  }
  if (err.includes('network') || err.includes('connection') || err.includes('timeout')) {
    return 'Connection problem. Please check your internet connection.';
  }
  return 'Could not process video. Please check the URL and try again.';
}

interface ProgressState {
  id: string;
  step: string;
  percent: number;
}

export default function App() {
  const [urlsInput, setUrlsInput] = useState('');
  const [bitrate, setBitrate] = useState('best');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [progressState, setProgressState] = useState<ProgressState | null>(null);
  const [completedDownloads, setCompletedDownloads] = useState<Record<string, string>>({});
  const [items, setItems] = useState<VideoItemState[]>([]);
  const [status, setStatus] = useState<{
    title: string;
    desc: string;
    isError?: boolean;
    showSpinner?: boolean;
  } | null>(null);

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
      title: 'ANALYZING LINKS',
      desc: `Looking up ${uniqueUrls.length} stream${uniqueUrls.length > 1 ? 's' : ''}...`,
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
            webpageUrl: rawMeta.webpageUrl,
            isAgeRestricted: !!rawMeta.isAgeRestricted
          };

          successCount++;
          setItems((prev) =>
            prev.map((item, idx) =>
              idx === index ? { ...item, loading: false, metadata, error: null } : item
            )
          );
        } catch (err: any) {
          failCount++;
          const cleanMessage = humanizeError(err.message || '');
          setItems((prev) =>
            prev.map((item, idx) =>
              idx === index
                ? {
                    ...item,
                    loading: false,
                    metadata: null,
                    error: cleanMessage
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
        title: 'READY TO DOWNLOAD',
        desc: `${successCount} audio stream${successCount > 1 ? 's' : ''} ready to download.`,
        isError: false,
        showSpinner: false
      });
    } else if (successCount > 0) {
      setStatus({
        title: 'SOME LINKS NEED ATTENTION',
        desc: `${successCount} ready, ${failCount} need unrestricted links.`,
        isError: false,
        showSpinner: false
      });
    } else {
      setStatus({
        title: 'COULD NOT LOAD LINKS',
        desc: 'Please verify the links or try unrestricted sources.',
        isError: true,
        showSpinner: false
      });
    }
  };

  const executeLocalDownload = async (meta: VideoMetadata) => {
    if (meta.isAgeRestricted) {
      Alert.alert(
        'Age-Restricted Link',
        'This video has a content warning on YouTube.\n\nPlease search for the song on YouTube Music or an alternate link to download cleanly.',
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      setDownloadingId(meta.id);
      setProgressState({
        id: meta.id,
        step: 'Pulling audio stream...',
        percent: 25
      });
      setStatus({
        title: 'DOWNLOADING AUDIO STREAM',
        desc: `Downloading stream for "${meta.title}"...`,
        showSpinner: true
      });

      const sanitizedTitle = meta.title.replace(/[\\/:*?"<>|]/g, '_');
      const tempRawFile = new ExpoFile(Paths.cache, `temp_${meta.id}.raw`);
      const tempOpusFile = new ExpoFile(Paths.cache, `${sanitizedTitle}.opus`);
      const rawTempPath = tempRawFile.uri.replace(/^file:\/\//, '');
      const opusTempPath = tempOpusFile.uri.replace(/^file:\/\//, '');

      // 1. Download raw stream using local embedded yt-dlp
      await downloadRawStreamOnDevice(meta.webpageUrl, rawTempPath);

      setProgressState({
        id: meta.id,
        step: 'Converting to clean Opus audio...',
        percent: 70
      });
      setStatus({
        title: 'CONVERTING TO OPUS',
        desc: `Transcoding cleanly to Opus (${bitrate === 'best' ? '~160k VBR' : `${bitrate}k`})...`,
        showSpinner: true
      });

      // 2. Transcode cleanly to Opus without extraneous tags
      const bArg = bitrate === 'best' ? '160k' : `${bitrate}k`;
      const ffmpegCmd = `-y -i "${rawTempPath}" -c:a libopus -b:a ${bArg} -vbr on "${opusTempPath}"`;

      const session = await FFmpegKit.execute(ffmpegCmd);
      const returnCode = await session.getReturnCode();

      if (!ReturnCode.isSuccess(returnCode)) {
        throw new Error('Audio conversion failed. Please try again.');
      }

      setProgressState({
        id: meta.id,
        step: 'Saving to Music folder...',
        percent: 90
      });

      // 3. Save directly to Android Public Music Directory via MediaStore
      const finalFileName = `${sanitizedTitle}.opus`;
      await saveAudioToMediaStore(opusTempPath, finalFileName);

      // Save destination to state for non-modal confirmation
      setCompletedDownloads((prev) => ({
        ...prev,
        [meta.id]: `Music/YouTubeOpus/${finalFileName}`
      }));

      setProgressState({
        id: meta.id,
        step: 'Complete',
        percent: 100
      });

      // Clean up temporary files
      try {
        tempRawFile.delete();
        tempOpusFile.delete();
      } catch {}

      setStatus({
        title: 'SAVED TO MUSIC FOLDER',
        desc: `"${meta.title}.opus" is ready in your phone's Music directory.`,
        isError: false,
        showSpinner: false
      });
    } catch (err: any) {
      const friendlyError = humanizeError(err.message || '');
      setStatus({
        title: 'DOWNLOAD INTERRUPTED',
        desc: friendlyError,
        isError: true,
        showSpinner: false
      });
    } finally {
      setDownloadingId(null);
      setTimeout(() => setProgressState(null), 1200);
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

  const downloadReadyItems = items.filter((item) => item.metadata !== null && !item.metadata.isAgeRestricted);
  const readyCount = downloadReadyItems.length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      {/* Top Nav with Kur Cuneiform branding */}
      <View style={styles.topNav}>
        <View style={styles.navBrand}>
          <Text style={styles.cuneiformIcon}>𒆳</Text>
          <View>
            <Text style={styles.brandTitle}>YOUTUBE-TO-OPUS</Text>
            <Text style={styles.brandAuthor}>MADE BY KUR ZAGIN</Text>
          </View>
        </View>
        <View style={styles.navVersion}>
          <Text style={styles.navVersionText}>v1.0.0</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {/* Page Header */}
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>
            YouTube <Text style={styles.hl}>/</Text> Opus Downloader
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
              placeholder={'Paste one or multiple YouTube URLs (one per line)...\nhttps://www.youtube.com/watch?v=...\nhttps://youtu.be/...'}
              placeholderTextColor="#4a4844"
              value={urlsInput}
              onChangeText={setUrlsInput}
              multiline
              numberOfLines={4}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Bitrate Selection */}
          <View style={styles.optionsGrid}>
            <View style={styles.optionGroup}>
              <Text style={styles.optionLabel}>OPUS AUDIO BITRATE</Text>
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

          {/* Action Buttons */}
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
                  <Text style={styles.btnSubmitText}>LOOKING UP LINKS...</Text>
                </View>
              ) : (
                <View style={styles.btnInner}>
                  <Search color="#0a0a0c" size={15} />
                  <Text style={styles.btnSubmitText}>FIND AUDIO</Text>
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

        {/* Status Banner */}
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
              <Text style={styles.hl}>{readyCount}</Text> READY TO DOWNLOAD
            </Text>
            <TouchableOpacity
              style={styles.batchDownloadBtn}
              onPress={async () => {
                for (const item of downloadReadyItems) {
                  if (item.metadata) {
                    await executeLocalDownload(item.metadata);
                  }
                }
              }}
              activeOpacity={0.8}
            >
              <DownloadCloud color="#0a0a0c" size={14} />
              <Text style={styles.batchDownloadText}>DOWNLOAD ALL ({readyCount})</Text>
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
                        <AlertCircle color="#b05050" size={14} />
                        <Text style={styles.errorMsgText}>{item.error || 'Could not load video'}</Text>
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
              const isAgeRestricted = !!meta.isAgeRestricted;
              const savedPath = completedDownloads[meta.id];

              return (
                <View key={meta.id || index} style={[styles.resultCard, isAgeRestricted && styles.ageRestrictedCard]}>
                  {meta.thumbnail ? (
                    <View style={styles.thumbWrapper}>
                      <Image source={{ uri: meta.thumbnail }} style={styles.thumbImg} />
                      {meta.durationFormatted && meta.durationFormatted !== '0:00' ? (
                        <View style={styles.thumbDuration}>
                          <Text style={styles.thumbDurationText}>{meta.durationFormatted}</Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  <View style={styles.metaDetails}>
                    <Text style={styles.metaTitle} numberOfLines={2}>
                      {meta.title}
                    </Text>
                    <Text style={styles.metaChannel}>{meta.channel}</Text>

                    {/* Age Restriction Warning Banner */}
                    {isAgeRestricted ? (
                      <View style={styles.ageWarningBanner}>
                        <AlertTriangle color="#c49368" size={14} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.ageWarningTitle}>Age-Restricted Video</Text>
                          <Text style={styles.ageWarningDesc}>
                            This video has a YouTube content warning. Please use the YouTube Music track or an alternate link to download.
                          </Text>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.badgeRow}>
                        {meta.viewCountFormatted ? (
                          <View style={styles.badgeItem}>
                            <Text style={styles.badgeItemText}>{meta.viewCountFormatted}</Text>
                          </View>
                        ) : null}
                        <View style={[styles.badgeItem, styles.badgeAccent]}>
                          <Text style={styles.badgeAccentText}>CLEAN OPUS AUDIO</Text>
                        </View>
                      </View>
                    )}

                    {/* Download Progress Bar */}
                    {isProcessingThis && progressState && progressState.id === meta.id && (
                      <View style={styles.progressContainer}>
                        <View style={styles.progressTrack}>
                          <View style={[styles.progressFill, { width: `${progressState.percent}%` }]} />
                        </View>
                        <Text style={styles.progressLabel}>
                          {progressState.percent}% · {progressState.step}
                        </Text>
                      </View>
                    )}

                    {/* In-Card Completion Banner (Replaces Native Alert) */}
                    {savedPath && (
                      <View style={styles.completedBanner}>
                        <CheckCircle2 color="#6a9a6a" size={15} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.completedBannerTitle}>DOWNLOAD COMPLETE</Text>
                          <Text style={styles.completedBannerDesc} numberOfLines={1}>
                            Saved to {savedPath}
                          </Text>
                        </View>
                      </View>
                    )}

                    <View style={styles.btnRow}>
                      <TouchableOpacity
                        style={[
                          styles.btnActionPrimary,
                          (isProcessingThis || isAgeRestricted) && styles.btnDisabled,
                          savedPath && styles.btnActionCompleted
                        ]}
                        disabled={isProcessingThis || isAgeRestricted}
                        onPress={() => executeLocalDownload(meta)}
                        activeOpacity={0.8}
                      >
                        {isProcessingThis ? (
                          <ActivityIndicator color="#e2ded6" size="small" />
                        ) : savedPath ? (
                          <Check color="#6a9a6a" size={13} />
                        ) : (
                          <Download color="#e2ded6" size={13} />
                        )}
                        <Text style={[styles.btnActionPrimaryText, savedPath && styles.btnTextCompleted]}>
                          {isAgeRestricted
                            ? 'USE MUSIC / ALTERNATE URL'
                            : isProcessingThis
                            ? 'DOWNLOADING...'
                            : savedPath
                            ? 'DOWNLOAD AGAIN'
                            : 'DOWNLOAD TO STORAGE'}
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

        {/* Feature / Info Section */}
        <View style={styles.infoGrid}>
          <View style={styles.infoItem}>
            <Text style={styles.infoIndex}>01 / FAST & DIRECT</Text>
            <Text style={styles.infoName}>On-Device Audio Extraction</Text>
            <Text style={styles.infoDesc}>
              Downloads audio directly on your device without routing through external servers.
            </Text>
          </View>

          <View style={styles.infoItem}>
            <Text style={styles.infoIndex}>02 / CLEAN OPUS</Text>
            <Text style={styles.infoName}>Pure Audio Encoding</Text>
            <Text style={styles.infoDesc}>
              Converts to pristine Opus audio using hardware-accelerated libopus.
            </Text>
          </View>

          <View style={styles.infoItem}>
            <Text style={styles.infoIndex}>03 / STORAGE</Text>
            <Text style={styles.infoName}>Music Library Integration</Text>
            <Text style={styles.infoDesc}>
              Saves exported .opus files directly to your device's Music folder for immediate playback in your music player.
            </Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.siteFooter}>
          <Text style={styles.footerBrand}>𒆳 KUR · YOUTUBE-TO-OPUS</Text>
          <Text style={styles.footerAuthor}>MADE BY KUR ZAGIN</Text>
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
    height: 52,
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
    gap: 10
  },
  cuneiformIcon: {
    fontSize: 22,
    color: '#c49368',
    lineHeight: 26
  },
  brandTitle: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontWeight: '700',
    color: '#e2ded6',
    letterSpacing: 1
  },
  brandAuthor: {
    fontFamily: MONO_FONT,
    fontSize: 8,
    color: '#c49368',
    letterSpacing: 1.2,
    marginTop: 1
  },
  navVersion: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: '#18181c',
    borderWidth: 1,
    borderColor: '#2a2a30'
  },
  navVersionText: {
    fontFamily: MONO_FONT,
    fontSize: 9,
    color: '#706c66'
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
    marginBottom: 16
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
  ageRestrictedCard: {
    borderColor: '#c49368',
    backgroundColor: 'rgba(196, 147, 104, 0.03)'
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
    gap: 6,
    marginTop: 2
  },
  errorMsgText: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: '#b05050',
    flex: 1,
    lineHeight: 15
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

  /* Age Warning Banner */
  ageWarningBanner: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    backgroundColor: 'rgba(196, 147, 104, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(196, 147, 104, 0.4)',
    marginBottom: 12
  },
  ageWarningTitle: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontWeight: '700',
    color: '#c49368',
    marginBottom: 2
  },
  ageWarningDesc: {
    fontSize: 11,
    color: '#e2ded6',
    lineHeight: 15
  },

  /* Badges */
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

  /* Progress Bar */
  progressContainer: {
    marginBottom: 12
  },
  progressTrack: {
    height: 4,
    backgroundColor: '#1e1e24',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#c49368'
  },
  progressLabel: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    color: '#c49368',
    marginTop: 4
  },

  /* In-Card Completion Banner */
  completedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 9,
    backgroundColor: 'rgba(106, 154, 106, 0.1)',
    borderWidth: 1,
    borderColor: '#6a9a6a',
    marginBottom: 12
  },
  completedBannerTitle: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    fontWeight: '700',
    color: '#6a9a6a'
  },
  completedBannerDesc: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    color: '#b0aca4',
    marginTop: 1
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
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6
  },
  btnActionCompleted: {
    backgroundColor: '#152015',
    borderColor: '#6a9a6a'
  },
  btnActionPrimaryText: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: '#e2ded6',
    letterSpacing: 0.5,
    textTransform: 'uppercase'
  },
  btnTextCompleted: {
    color: '#6a9a6a'
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
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: '#1e1e24',
    alignItems: 'center',
    gap: 4
  },
  footerBrand: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: '#e2ded6',
    letterSpacing: 1
  },
  footerAuthor: {
    fontFamily: MONO_FONT,
    fontSize: 9,
    color: '#c49368',
    letterSpacing: 1.5
  }
});
