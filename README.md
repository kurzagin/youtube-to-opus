# YouTube to OPUS Web Client

A modern TypeScript web application to extract and stream high-fidelity **OPUS audio** directly from YouTube URLs using `yt-dlp` and `ffmpeg`.

## Prerequisites

Ensure the following tools and runtimes are installed on your system:

- **Node.js**: v18.0.0 or higher ([nodejs.org](https://nodejs.org/))
- **npm**: v9.0.0 or higher (bundled with Node.js)
- **yt-dlp**: Must be installed and accessible in your system `$PATH`
  - Linux: `sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp` or via package manager (`sudo apt install yt-dlp` / `brew install yt-dlp`)
- **ffmpeg**: Must be installed and accessible in your system `$PATH` with `libopus` support enabled
  - Debian/Ubuntu: `sudo apt update && sudo apt install ffmpeg`
  - macOS: `brew install ffmpeg`
  - Windows: `winget install Gyan.FFmpeg` or `choco install ffmpeg`

## Features

- **TypeScript Fullstack**: End-to-end typed interface with Express backend and Vite client frontend.
- **Direct OPUS Streaming & Download**: Pipes directly through `yt-dlp` and `ffmpeg` without storing intermediate files on disk, conserving space and delivering instant playback.
- **Audio Quality Options**: Select between best direct stream (~160kbps VBR Opus) or target bitrates (192kbps, 128kbps, 96kbps, 64kbps).
- **In-Browser Audio Preview**: Listen to the Opus stream directly in the browser before or alongside downloading.
- **Video Inspection**: Previews thumbnail, title, channel name, views, and duration.
- **Clipboard Paste**: Quick-paste button for URLs.

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Development Mode (Runs Both Server & Client)
Run both backend API and Vite UI simultaneously with one command:

```bash
npm run dev
```

- **Web UI**: http://localhost:3000 (proxies API requests to backend)
- **API Server**: http://localhost:3001

### 3. Production Build & Start
```bash
npm run build
npm start
```
The server will host both the API and client at http://localhost:3001.

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.
