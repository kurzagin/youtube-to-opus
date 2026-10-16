import express, { Request, Response } from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { VideoMetadata } from '../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve static frontend in production if built
const clientDist = path.resolve(__dirname, '../../client');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

// Format seconds into MM:SS or HH:MM:SS
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

// 1. Get video metadata
app.get('/api/info', async (req: Request, res: Response): Promise<void> => {
  const url = req.query.url as string;
  if (!url) {
    res.status(400).json({ error: 'Missing YouTube URL' });
    return;
  }

  try {
    const ytdlp = spawn('yt-dlp', [
      '--dump-single-json',
      '--no-playlist',
      '--no-warnings',
      '--ignore-errors',
      '--extractor-args', 'youtube:player_client=ios,android,web',
      url
    ]);

    let stdoutData = '';
    let stderrData = '';

    ytdlp.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    ytdlp.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    ytdlp.on('close', (code) => {
      if (code !== 0 || !stdoutData.trim()) {
        res.status(400).json({
          error: 'Failed to extract video information. Check URL or video availability.',
          details: stderrData.slice(0, 300)
        });
        return;
      }

      try {
        const json = JSON.parse(stdoutData);
        const metadata: VideoMetadata = {
          id: json.id,
          title: json.title || 'Unknown Title',
          channel: json.uploader || json.channel || 'Unknown Channel',
          thumbnail: json.thumbnail || '',
          duration: json.duration || 0,
          durationFormatted: formatDuration(json.duration),
          viewCount: json.view_count || 0,
          viewCountFormatted: formatViews(json.view_count),
          webpageUrl: json.webpage_url || url
        };
        res.json(metadata);
      } catch (err: any) {
        res.status(500).json({ error: 'Failed to parse metadata JSON', details: err.message });
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Server error retrieving info', details: error.message });
  }
});

// 2. Stream / Download as OPUS audio
app.get('/api/convert', async (req: Request, res: Response): Promise<void> => {
  const url = req.query.url as string;
  const bitrate = (req.query.bitrate as string) || 'best';
  const isDownload = req.query.download === 'true';

  if (!url) {
    res.status(400).json({ error: 'Missing YouTube URL' });
    return;
  }

  // Sanitized safe filename fetch first or derive from query
  let filename = (req.query.filename as string) || 'audio';
  filename = filename.replace(/[/\\?%*:|"<>]/g, '_');
  if (!filename.endsWith('.opus')) {
    filename += '.opus';
  }

  res.setHeader('Content-Type', 'audio/ogg; codecs=opus');
  if (isDownload) {
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  } else {
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
  }

  // Setup yt-dlp to stream best audio into ffmpeg to output high-quality .opus (Ogg container)
  // yt-dlp outputs best audio directly to stdout
  const ytdlpArgs = [
    '-f', 'ba/b',
    '--no-playlist',
    '--no-warnings',
    '--extractor-args', 'youtube:player_client=ios,android,web',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    '-o', '-',
    url
  ];

  // FFmpeg transcodes or copies to Opus audio stream in Ogg container
  const ffmpegArgs = [
    '-i', 'pipe:0',
    '-vn', // No video
  ];

  if (bitrate === 'best') {
    // If Opus already in WebM/Ogg, yt-dlp stream can be encapsulated or re-encoded to clean Ogg Opus
    ffmpegArgs.push('-c:a', 'libopus', '-b:a', '160k', '-vbr', 'on');
  } else {
    ffmpegArgs.push('-c:a', 'libopus', '-b:a', `${bitrate}k`, '-vbr', 'on');
  }

  ffmpegArgs.push('-f', 'ogg', 'pipe:1');

  const ytdlp = spawn('yt-dlp', ytdlpArgs);
  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  // Pipe yt-dlp -> ffmpeg -> HTTP Response
  ytdlp.stdout.pipe(ffmpeg.stdin);
  ffmpeg.stdout.pipe(res);

  let hasError = false;

  ytdlp.stderr.on('data', (data) => {
    // yt-dlp progress/logs
    const msg = data.toString();
    if (msg.includes('ERROR:')) {
      console.error('[yt-dlp error]', msg);
    }
  });

  ffmpeg.stderr.on('data', (data) => {
    // ffmpeg diagnostic info
    const msg = data.toString();
    if (msg.includes('Conversion failed')) {
      console.error('[ffmpeg error]', msg);
    }
  });

  const cleanup = () => {
    try { ytdlp.kill(); } catch {}
    try { ffmpeg.kill(); } catch {}
  };

  req.on('close', () => {
    cleanup();
  });

  ffmpeg.on('error', (err) => {
    cleanup();
    if (!res.headersSent) {
      res.status(500).json({ error: 'FFmpeg encoding error', details: err.message });
    }
  });

  ytdlp.on('error', (err) => {
    cleanup();
    if (!res.headersSent) {
      res.status(500).json({ error: 'yt-dlp extraction error', details: err.message });
    }
  });
});

app.listen(PORT, () => {
  console.log(`YouTube to OPUS backend server running on http://localhost:${PORT}`);
});
