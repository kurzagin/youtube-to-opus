import React, { useState, useRef } from 'react';
import { 
  Music, 
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
import type { VideoMetadata, VideoItemState } from '../shared/types.js';

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
    <div className="app-wrapper">
      {/* Top Nav */}
      <header className="top-nav">
        <div className="nav-brand">
          <span className="dot" />
          <span>YOUTUBE-TO-OPUS</span>
          <span className="jp">オーパス・コンバーター</span>
        </div>
        <div className="nav-status">
          <span className="pulse" />
          <span>ONLINE</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        <div className="page-header">
          <div className="page-sub">OPUS AUDIO EXTRACTION TERMINAL</div>
          <h1 className="page-title">
            YouTube <span className="hl">/</span> Opus Audio Extractor
          </h1>
          <p className="page-desc">
            Direct-pipe yt-dlp & ffmpeg stream without intermediary disk writes. Multi-URL batch enabled.
          </p>
        </div>

        {/* Input Card */}
        <div className="kurzagin-card">
          <div className="corner-tl" />
          <div className="corner-tr" />
          <div className="corner-bl" />
          <div className="corner-br" />

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
              <button
                type="button"
                className="btn-paste"
                onClick={handlePaste}
                title="Paste from clipboard"
              >
                <Clipboard size={14} />
                <span>PASTE</span>
              </button>
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

            <button type="submit" className="btn-submit" disabled={loading}>
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
            </button>
          </form>
        </div>

        {/* Audio Player Container */}
        {streamUrl && (
          <div className="player-box">
            <audio ref={audioRef} controls src={streamUrl} />
          </div>
        )}

        {/* Status / Alert Notification */}
        {status && (
          <div className={`status-panel ${status.isError ? 'error' : ''}`}>
            {status.showSpinner && <Loader2 className="animate-spin" size={18} color="#c49368" />}
            {status.isError && <AlertCircle size={18} color="#b05050" />}
            {!status.showSpinner && !status.isError && <CheckCircle2 size={18} color="#6a9a6a" />}
            <div>
              <div className="status-title">{status.title}</div>
              <div className="status-desc">{status.desc}</div>
            </div>
          </div>
        )}

        {/* Batch Action Toolbar */}
        {readyCount > 1 && (
          <div className="batch-toolbar">
            <div className="batch-count">
              <span className="hl">{readyCount}</span> OF <span className="hl">{items.length}</span> STREAMS READY
            </div>
            <button className="btn-action-primary batch-download-btn" onClick={handleDownloadAll}>
              <DownloadCloud size={15} />
              <span>DOWNLOAD ALL ({readyCount})</span>
            </button>
          </div>
        )}

        {/* Video Results List */}
        {items.length > 0 && (
          <div className="results-list">
            {items.map((item, index) => {
              if (item.loading) {
                return (
                  <div key={index} className="result-card loading-card">
                    <Loader2 className="animate-spin" size={20} color="#c49368" />
                    <div className="loading-url">{item.url}</div>
                  </div>
                );
              }

              if (item.error || !item.metadata) {
                return (
                  <div key={index} className="result-card error-card">
                    <div className="meta-details">
                      <div className="error-url">{item.url}</div>
                      <div className="error-message">
                        <AlertCircle size={14} color="#b05050" />
                        <span>{item.error || 'Failed to inspect stream audio'}</span>
                      </div>
                    </div>
                    <button
                      className="btn-remove"
                      onClick={() => handleRemoveItem(index)}
                      title="Remove from list"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              }

              const meta = item.metadata;
              const isPlaying = activePreviewId === meta.id && streamUrl !== null;

              return (
                <div key={meta.id || index} className={`result-card ${isPlaying ? 'playing' : ''}`}>
                  <div className="thumb-wrapper">
                    <img src={meta.thumbnail} alt={meta.title} className="thumb-img" />
                    <div className="thumb-duration">{meta.durationFormatted}</div>
                  </div>

                  <div className="meta-details">
                    <div>
                      <h2 className="meta-title">{meta.title}</h2>
                      <div className="meta-channel">{meta.channel}</div>

                      <div className="badge-row">
                        <span className="badge-item">{meta.viewCountFormatted}</span>
                        <span className="badge-item badge-accent">OPUS CODEC READY</span>
                      </div>
                    </div>

                    <div className="btn-row">
                      <button className="btn-action-primary" onClick={() => handleDownloadSingle(meta)}>
                        <Download size={14} />
                        <span>DOWNLOAD .OPUS</span>
                      </button>
                      <button className="btn-action-secondary" onClick={() => handleStreamPreview(meta)}>
                        <Play size={14} />
                        <span>{isPlaying ? 'REPLAY' : 'PLAY PREVIEW'}</span>
                      </button>
                      <button
                        className="btn-remove"
                        onClick={() => handleRemoveItem(index)}
                        title="Remove from list"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Info Grid */}
        <div className="info-grid">
          <div className="info-item">
            <div className="info-index">01 / ENCODING</div>
            <div className="info-name">High-Density Opus</div>
            <p className="info-desc">
              Pipes original audio manifests straight through libopus without intermediate file caching.
            </p>
          </div>

          <div className="info-item">
            <div className="info-index">02 / REALTIME</div>
            <div className="info-name">Stream Piping</div>
            <p className="info-desc">
              Zero storage bottleneck — child processes pipe straight into the HTTP response stream.
            </p>
          </div>

          <div className="info-item">
            <div className="info-index">03 / BATCH PIPELINE</div>
            <div className="info-name">Multi-Track Extraction</div>
            <p className="info-desc">
              Queue multiple YouTube links separated by newlines and batch extract or preview in parallel.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="site-footer">
        kurzagin-themed architecture · TypeScript · Vite · React 19
      </footer>
    </div>
  );
};

export default App;
