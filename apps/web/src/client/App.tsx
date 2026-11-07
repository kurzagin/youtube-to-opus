import React, { useState, useRef } from 'react';
import { 
  Search, 
  Download, 
  Play, 
  Clipboard, 
  Loader2, 
  AlertCircle,
  DownloadCloud,
  Trash2,
  CheckCircle2
} from 'lucide-react';
import { 
  Button, 
  BracketCard, 
  CornerFrame, 
  Badge, 
  Dot, 
  TechLabel, 
  Logo 
} from '@krpkg/ui';
import type { VideoMetadata, VideoItemState } from '@youtube-to-opus/shared';

export const App: React.FC = () => {
  const [urlsInput, setUrlsInput] = useState('');
  const [bitrate, setBitrate] = useState('best');
  const [embedMetadata, setEmbedMetadata] = useState(true);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<VideoItemState[]>([]);
  const [status, setStatus] = useState<{
    title: string;
    desc: string;
    isError?: boolean;
    showSpinner?: boolean;
  } | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrlsInput((prev) => {
          const trimmedPrev = prev.trim();
          if (!trimmedPrev) return text.trim();
          return `${trimmedPrev}\n${text.trim()}`;
        });
      }
    } catch {
      // Ignore clipboard read rejection
    }
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawLines = urlsInput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (rawLines.length === 0) return;

    // Deduplicate while preserving order
    const uniqueUrls = Array.from(new Set(rawLines));

    const initialStates: VideoItemState[] = uniqueUrls.map((url) => ({
      url,
      loading: true,
      metadata: null,
      error: null
    }));

    setItems(initialStates);
    setLoading(true);
    setStreamUrl(null);
    setActivePreviewId(null);
    if (audioRef.current) {
      audioRef.current.pause();
    }

    setStatus({
      title: 'BATCH ANALYSIS IN PROGRESS',
      desc: `Inspecting audio manifests for ${uniqueUrls.length} URL${uniqueUrls.length > 1 ? 's' : ''}...`,
      showSpinner: true
    });

    let successCount = 0;
    let failCount = 0;

    await Promise.all(
      uniqueUrls.map(async (rawUrl, index) => {
        try {
          const res = await fetch(`/api/info?url=${encodeURIComponent(rawUrl)}`);
          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || 'Failed to inspect stream audio');
          }

          successCount++;
          setItems((prev) =>
            prev.map((item, idx) =>
              idx === index
                ? { ...item, loading: false, metadata: data as VideoMetadata, error: null }
                : item
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
                    error: err.message || 'Unknown error occurred.'
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
        desc: `Successfully analyzed ${successCount} stream${successCount > 1 ? 's' : ''}. Ready for high-fidelity Opus extraction.`,
        isError: false,
        showSpinner: false
      });
    } else if (successCount > 0) {
      setStatus({
        title: 'ANALYSIS PARTIALLY COMPLETED',
        desc: `${successCount} streams ready, ${failCount} failed inspection.`,
        isError: true,
        showSpinner: false
      });
    } else {
      setStatus({
        title: 'ALL ANALYSES FAILED',
        desc: 'Could not extract metadata for the provided URLs.',
        isError: true,
        showSpinner: false
      });
    }
  };

  const downloadVideo = (meta: VideoMetadata, delayMs = 0) => {
    setTimeout(() => {
      const pageUrl = meta.webpageUrl;
      const filename = `${meta.title}.opus`;
      const downloadUrl = `/api/convert?url=${encodeURIComponent(pageUrl)}&bitrate=${encodeURIComponent(
        bitrate
      )}&download=true&filename=${encodeURIComponent(filename)}`;

      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }, delayMs);
  };

  const handleDownloadSingle = (meta: VideoMetadata) => {
    downloadVideo(meta);
    setStatus({
      title: 'STREAM CONVERSION TRIGGERED',
      desc: `Realtime ffmpeg transcode active for "${meta.title}". Saving directly to storage.`,
      isError: false,
      showSpinner: false
    });
  };

  const handleDownloadAll = () => {
    const readyItems = items.filter((item) => item.metadata !== null);
    if (readyItems.length === 0) return;

    readyItems.forEach((item, index) => {
      if (item.metadata) {
        // Space out downloads by 600ms to allow browser to register multiple downloads cleanly
        downloadVideo(item.metadata, index * 600);
      }
    });

    setStatus({
      title: 'BATCH DOWNLOAD TRIGGERED',
      desc: `Piping ${readyItems.length} Opus audio stream${readyItems.length > 1 ? 's' : ''} to browser storage.`,
      isError: false,
      showSpinner: false
    });
  };

  const handleStreamPreview = (meta: VideoMetadata) => {
    const pageUrl = meta.webpageUrl;
    const previewUrl = `/api/convert?url=${encodeURIComponent(pageUrl)}&bitrate=${encodeURIComponent(
      bitrate
    )}&download=false`;

    setActivePreviewId(meta.id);
    setStreamUrl(previewUrl);
    setStatus({
      title: 'PLAYBACK ACTIVE',
      desc: `Previewing "${meta.title}" Opus audio stream piped through ffmpeg.`,
      isError: false,
      showSpinner: false
    });

    setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.play().catch(console.error);
      }
    }, 50);
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const readyCount = items.filter((item) => item.metadata !== null).length;

  return (
    <div className="app-wrapper kz-dot-grid">
      {/* Top Nav */}
      <header className="top-nav">
        <div className="nav-brand">
          <Logo size={22} color="var(--kz-accent)" />
          <span className="nav-title">YOUTUBE-TO-OPUS</span>
        </div>
        <div className="nav-status">
          <TechLabel label="OPUS VBR PIPELINE" jp="高音質" coord="48kHz // DIRECT" />
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        <div className="page-header">
          <div className="header-meta">
            <Dot color="accent" pulse />
            <TechLabel label="AUDIO STREAM INGESTION" jp="抽出処理" coord="01 // AUDIO" />
          </div>
          <h1 className="page-title">
            YouTube <span className="hl">/</span> Opus Audio Extractor
          </h1>
          <p className="page-subtitle">
            Pure pipe-through audio extraction powered by @krpkg/ui design system.
          </p>
        </div>

        {/* Input Card with CornerFrame */}
        <CornerFrame className="kurzagin-card input-card">
          <form onSubmit={handleAnalyze}>
            <div className="input-container multi-input-container">
              <textarea
                value={urlsInput}
                onChange={(e) => setUrlsInput(e.target.value)}
                placeholder="Insert one or multiple YouTube URLs (separated by new line)...&#10;https://www.youtube.com/watch?v=...&#10;https://youtu.be/..."
                required
                rows={4}
                autoComplete="off"
                spellCheck="false"
                className="kurzagin-input kurzagin-textarea"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="btn-paste"
                onClick={handlePaste}
                title="Paste from clipboard"
              >
                <Clipboard size={14} />
                <span>PASTE</span>
              </Button>
            </div>

            <div className="options-grid">
              <div className="option-group">
                <label className="option-label">Audio Bitrate / Compression</label>
                <select
                  value={bitrate}
                  onChange={(e) => setBitrate(e.target.value)}
                  className="kurzagin-select"
                >
                  <option value="best">Best Direct Quality (~160kbps VBR Opus)</option>
                  <option value="192">192 kbps (Audiophile Opus Re-encode)</option>
                  <option value="128">128 kbps (Standard Opus Delivery)</option>
                  <option value="96">96 kbps (Compact Opus)</option>
                  <option value="64">64 kbps (Voice / Lightweight)</option>
                </select>
              </div>

              <div className="option-group">
                <label className="checkbox-container">
                  <input
                    type="checkbox"
                    checked={embedMetadata}
                    onChange={(e) => setEmbedMetadata(e.target.checked)}
                  />
                  <span>EMBED TAGS</span>
                </label>
              </div>
            </div>

            <Button 
              type="submit" 
              variant="primary" 
              size="lg" 
              className="btn-submit" 
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  <span>ANALYZING STREAMS...</span>
                </>
              ) : (
                <>
                  <Search size={16} />
                  <span>ANALYZE STREAM(S)</span>
                </>
              )}
            </Button>
          </form>
        </CornerFrame>

        {/* Audio Player Container */}
        {streamUrl && (
          <BracketCard className="player-box">
            <audio ref={audioRef} controls src={streamUrl} />
          </BracketCard>
        )}

        {/* Status / Alert Notification */}
        {status && (
          <BracketCard className={`status-panel ${status.isError ? 'error' : ''}`}>
            {status.showSpinner && <Dot color="accent" pulse />}
            {status.isError && <AlertCircle size={18} color="var(--kz-red-soft)" />}
            {!status.showSpinner && !status.isError && <CheckCircle2 size={18} color="var(--kz-green-soft)" />}
            <div>
              <div className="status-title">{status.title}</div>
              <div className="status-desc">{status.desc}</div>
            </div>
          </BracketCard>
        )}

        {/* Batch Action Toolbar */}
        {readyCount > 1 && (
          <div className="batch-toolbar">
            <div className="batch-count">
              <Badge variant="accent">{readyCount}</Badge> OF <Badge variant="default">{items.length}</Badge> STREAMS READY
            </div>
            <Button 
              variant="primary" 
              size="md" 
              className="batch-download-btn" 
              onClick={handleDownloadAll}
            >
              <DownloadCloud size={15} />
              <span>DOWNLOAD ALL ({readyCount})</span>
            </Button>
          </div>
        )}

        {/* Video Results List */}
        {items.length > 0 && (
          <div className="results-list">
            {items.map((item, index) => {
              if (item.loading) {
                return (
                  <BracketCard key={index} className="result-card loading-card">
                    <Loader2 className="animate-spin" size={20} color="var(--kz-accent)" />
                    <div className="loading-url">{item.url}</div>
                  </BracketCard>
                );
              }

              if (item.error || !item.metadata) {
                return (
                  <BracketCard key={index} className="result-card error-card">
                    <div className="meta-details">
                      <div className="error-url">{item.url}</div>
                      <div className="error-message">
                        <AlertCircle size={14} color="var(--kz-red-soft)" />
                        <span>{item.error || 'Failed to inspect stream audio'}</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="btn-remove"
                      onClick={() => handleRemoveItem(index)}
                      title="Remove from list"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </BracketCard>
                );
              }

              const meta = item.metadata;
              const isPlaying = activePreviewId === meta.id && streamUrl !== null;

              return (
                <CornerFrame 
                  key={meta.id || index} 
                  className={`result-card ${isPlaying ? 'playing' : ''}`}
                >
                  <div className="thumb-wrapper">
                    <img src={meta.thumbnail} alt={meta.title} className="thumb-img" />
                    <div className="thumb-duration">{meta.durationFormatted}</div>
                  </div>

                  <div className="meta-details">
                    <div>
                      <h2 className="meta-title">{meta.title}</h2>
                      <div className="meta-channel">{meta.channel}</div>

                      <div className="badge-row">
                        <Badge variant="default">{meta.viewCountFormatted}</Badge>
                        <Badge variant="accent">OPUS CODEC READY</Badge>
                      </div>
                    </div>

                    <div className="btn-row">
                      <Button 
                        variant="primary" 
                        size="sm" 
                        onClick={() => handleDownloadSingle(meta)}
                      >
                        <Download size={14} />
                        <span>DOWNLOAD .OPUS</span>
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => handleStreamPreview(meta)}
                      >
                        <Play size={14} />
                        <span>{isPlaying ? 'REPLAY' : 'PLAY PREVIEW'}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="btn-remove"
                        onClick={() => handleRemoveItem(index)}
                        title="Remove from list"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                </CornerFrame>
              );
            })}
          </div>
        )}

        {/* Info Grid */}
        <div className="info-grid">
          <BracketCard className="info-item">
            <TechLabel label="ENCODING" jp="高密度" coord="01" />
            <div className="info-name">High-Density Opus</div>
            <p className="info-desc">
              Pipes original audio manifests straight through libopus without intermediate file caching.
            </p>
          </BracketCard>

          <BracketCard className="info-item">
            <TechLabel label="REALTIME" jp="即時" coord="02" />
            <div className="info-name">Stream Piping</div>
            <p className="info-desc">
              Zero storage bottleneck — child processes pipe straight into the HTTP response stream.
            </p>
          </BracketCard>

          <BracketCard className="info-item">
            <TechLabel label="BATCH" jp="一括" coord="03" />
            <div className="info-name">Multi-Track Extraction</div>
            <p className="info-desc">
              Queue multiple YouTube links separated by newlines and batch extract or preview in parallel.
            </p>
          </BracketCard>
        </div>
      </main>

      {/* Footer */}
      <footer className="site-footer">
        <div className="footer-content">
          <Logo size={16} color="var(--kz-text-2)" />
          <span>Powered by @krpkg/ui Design System</span>
          <span className="hl">·</span>
          <span>TypeScript · Vite · React 19</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
