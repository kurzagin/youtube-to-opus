import React, { useState, useRef } from 'react';
import { 
  Music, 
  Search, 
  Download, 
  Play, 
  Clipboard, 
  Loader2, 
  AlertCircle 
} from 'lucide-react';
import type { VideoMetadata } from '../shared/types.js';

export const App: React.FC = () => {
  const [url, setUrl] = useState('');
  const [bitrate, setBitrate] = useState('best');
  const [embedMetadata, setEmbedMetadata] = useState(true);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{
    title: string;
    desc: string;
    isError?: boolean;
    showSpinner?: boolean;
  } | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text.trim());
      }
    } catch {
      // Ignore clipboard read rejection
    }
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawUrl = url.trim();
    if (!rawUrl) return;

    setLoading(true);
    setMetadata(null);
    setStreamUrl(null);
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setStatus({
      title: 'ANALYZE IN PROGRESS',
      desc: 'Querying yt-dlp to inspect stream audio manifests...',
      showSpinner: true
    });

    try {
      const res = await fetch(`/api/info?url=${encodeURIComponent(rawUrl)}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to inspect stream audio');
      }

      setMetadata(data as VideoMetadata);
      setStatus(null);
    } catch (err: any) {
      setStatus({
        title: 'ANALYSIS FAILED',
        desc: err.message || 'Unknown error occurred.',
        isError: true,
        showSpinner: false
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!metadata) return;

    const pageUrl = metadata.webpageUrl;
    const filename = `${metadata.title}.opus`;
    const downloadUrl = `/api/convert?url=${encodeURIComponent(pageUrl)}&bitrate=${encodeURIComponent(
      bitrate
    )}&download=true&filename=${encodeURIComponent(filename)}`;

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setStatus({
      title: 'STREAM CONVERSION TRIGGERED',
      desc: 'Realtime ffmpeg transcode active. File will save directly to your storage.',
      isError: false,
      showSpinner: false
    });
  };

  const handleStreamPreview = () => {
    if (!metadata) return;

    const pageUrl = metadata.webpageUrl;
    const previewUrl = `/api/convert?url=${encodeURIComponent(pageUrl)}&bitrate=${encodeURIComponent(
      bitrate
    )}&download=false`;

    setStreamUrl(previewUrl);
    setStatus({
      title: 'PLAYBACK ACTIVE',
      desc: 'Realtime Opus stream piped through ffmpeg into browser audio engine.',
      isError: false,
      showSpinner: false
    });

    setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.play().catch(console.error);
      }
    }, 50);
  };

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
            Direct-pipe yt-dlp & ffmpeg stream without intermediary disk writes.
          </p>
        </div>

        {/* Input Card */}
        <div className="kurzagin-card">
          <div className="corner-tl" />
          <div className="corner-tr" />
          <div className="corner-bl" />
          <div className="corner-br" />

          <form onSubmit={handleAnalyze}>
            <div className="input-container">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste YouTube video or track URL..."
                required
                autoComplete="off"
                spellCheck="false"
                className="kurzagin-input"
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
                  <span>ANALYZING STREAM...</span>
                </>
              ) : (
                <>
                  <Search size={16} />
                  <span>ANALYZE STREAM</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Video Result Card */}
        {metadata && (
          <div className="result-card">
            <div className="thumb-wrapper">
              <img src={metadata.thumbnail} alt={metadata.title} className="thumb-img" />
              <div className="thumb-duration">{metadata.durationFormatted}</div>
            </div>

            <div className="meta-details">
              <div>
                <h2 className="meta-title">{metadata.title}</h2>
                <div className="meta-channel">{metadata.channel}</div>

                <div className="badge-row">
                  <span className="badge-item">{metadata.viewCountFormatted}</span>
                  <span className="badge-item badge-accent">OPUS CODEC READY</span>
                </div>
              </div>

              <div className="btn-row">
                <button className="btn-action-primary" onClick={handleDownload}>
                  <Download size={14} />
                  <span>DOWNLOAD .OPUS</span>
                </button>
                <button className="btn-action-secondary" onClick={handleStreamPreview}>
                  <Play size={14} />
                  <span>PLAY PREVIEW</span>
                </button>
              </div>
            </div>
          </div>
        )}

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
            <div>
              <div className="status-title">{status.title}</div>
              <div className="status-desc">{status.desc}</div>
            </div>
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
            <div className="info-index">03 / COMPATIBILITY</div>
            <div className="info-name">Universal Player</div>
            <p className="info-desc">
              Direct in-browser stream decoding with native HTML5 audio element preview.
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
