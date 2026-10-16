import type { VideoMetadata } from '../shared/types.js';

// DOM elements
const convertForm = document.getElementById('convert-form') as HTMLFormElement;
const urlInput = document.getElementById('url-input') as HTMLInputElement;
const pasteBtn = document.getElementById('paste-btn') as HTMLButtonElement;
const qualitySelect = document.getElementById('quality-select') as HTMLSelectElement;
const fetchBtn = document.getElementById('fetch-btn') as HTMLButtonElement;

const videoCard = document.getElementById('video-card') as HTMLDivElement;
const videoThumb = document.getElementById('video-thumb') as HTMLImageElement;
const videoTitle = document.getElementById('video-title') as HTMLElement;
const videoChannel = document.getElementById('video-channel') as HTMLElement;
const videoDuration = document.getElementById('video-duration') as HTMLElement;
const videoViews = document.getElementById('video-views') as HTMLElement;

const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;
const streamBtn = document.getElementById('stream-btn') as HTMLButtonElement;
const audioPlayerContainer = document.getElementById('audio-player-container') as HTMLDivElement;
const audioPreview = document.getElementById('audio-preview') as HTMLAudioElement;

const statusBox = document.getElementById('status-box') as HTMLDivElement;
const statusTitle = document.getElementById('status-title') as HTMLElement;
const statusDesc = document.getElementById('status-desc') as HTMLElement;
const spinner = document.getElementById('spinner') as HTMLElement;

let currentMetadata: VideoMetadata | null = null;

// Helpers
function showStatus(title: string, desc: string, isError = false, loading = true) {
  statusBox.classList.remove('hidden');
  statusBox.classList.toggle('error', isError);
  statusTitle.textContent = title;
  statusDesc.textContent = desc;
  spinner.classList.toggle('hidden', !loading);
}

function hideStatus() {
  statusBox.classList.add('hidden');
}

// Clipboard Paste
pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      urlInput.value = text.trim();
      urlInput.focus();
    }
  } catch {
    urlInput.focus();
  }
});

// Fetch video metadata
convertForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const rawUrl = urlInput.value.trim();
  if (!rawUrl) return;

  fetchBtn.disabled = true;
  videoCard.classList.add('hidden');
  audioPlayerContainer.classList.add('hidden');
  audioPreview.pause();
  showStatus('Fetching Video Details', 'Contacting yt-dlp to inspect stream audio formats...');

  try {
    const res = await fetch(`/api/info?url=${encodeURIComponent(rawUrl)}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to analyze video');
    }

    currentMetadata = data as VideoMetadata;

    // Render video card
    videoTitle.textContent = currentMetadata.title;
    videoChannel.textContent = currentMetadata.channel;
    videoDuration.textContent = currentMetadata.durationFormatted;
    videoViews.textContent = currentMetadata.viewCountFormatted;
    videoThumb.src = currentMetadata.thumbnail;

    hideStatus();
    videoCard.classList.remove('hidden');
  } catch (err: any) {
    showStatus('Error Analyzing Video', err.message, true, false);
  } finally {
    fetchBtn.disabled = false;
  }
});

// Download Opus
downloadBtn.addEventListener('click', () => {
  if (!currentMetadata) return;

  const url = currentMetadata.webpageUrl;
  const bitrate = qualitySelect.value;
  const filename = `${currentMetadata.title}.opus`;

  const downloadUrl = `/api/convert?url=${encodeURIComponent(url)}&bitrate=${encodeURIComponent(bitrate)}&download=true&filename=${encodeURIComponent(filename)}`;

  // Trigger download via anchor
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  showStatus('Opus Download Triggered', 'Your browser will stream and save the converted Opus file.', false, false);
});

// Stream audio preview
streamBtn.addEventListener('click', () => {
  if (!currentMetadata) return;

  const url = currentMetadata.webpageUrl;
  const bitrate = qualitySelect.value;
  const streamUrl = `/api/convert?url=${encodeURIComponent(url)}&bitrate=${encodeURIComponent(bitrate)}&download=false`;

  audioPreview.src = streamUrl;
  audioPlayerContainer.classList.remove('hidden');
  audioPreview.play().catch(console.error);

  showStatus('Streaming OPUS Audio', 'Playing realtime decoded Opus audio in browser player.', false, false);
});
