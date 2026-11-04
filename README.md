# YouTube to Opus

A high-fidelity on-device audio downloader and transcoder monorepo containing a standalone Android application and a web client to convert YouTube streams into Opus audio (`.opus`).

[![Latest Release](https://img.shields.io/github/v/release/kurzagin/youtube-to-opus?label=Release&color=blue)](https://github.com/kurzagin/youtube-to-opus/releases)

> Download the prebuilt Android APK directly from [GitHub Releases](https://github.com/kurzagin/youtube-to-opus/releases).

---

## Overview

- **Android Mobile App (`apps/mobile`)**: Runs an embedded Python runtime (`yt-dlp`) and native FFmpeg engine on-device to download and transcode audio directly without routing through external servers. Saves directly to the device's public `Music/YouTubeOpus` directory.
- **Web Client (`apps/web`)**: A fullstack TypeScript application (Express + Vite + React) for streaming and downloading Opus audio in the browser.

---

## Requirements

### General
- **[Bun](https://bun.sh/)** (version 1.1+ recommended) or **Node.js** (version 18+)

### For Android Mobile App (`apps/mobile`)
- **Android SDK** with:
  - Build-Tools `35.0.0` or higher (e.g. `36.0.0` / `37.0.0`)
  - Platform SDK `android-34` or `android-35`
  - NDK `27.1.12297006` or higher
- **JDK**: Java Development Kit 17+
- **Python**: Python 3.10 to 3.14 (used by Chaquopy during build)

### For Web App (`apps/web`)
- **yt-dlp**: Required on the host machine ($PATH)
- **ffmpeg**: Required with `libopus` support enabled ($PATH)

---

## Monorepo Structure

```
youtube-to-opus/
├── apps/
│   ├── mobile/                    # React Native / Expo Android application
│   │   ├── assets/                # App icon and splash assets
│   │   ├── modules/
│   │   │   └── youtube-extractor/ # Native Kotlin module (Chaquopy & MediaStore)
│   │   ├── plugins/
│   │   │   └── withChaquopy.ts    # Config plugin for Chaquopy & FFmpegKit
│   │   └── App.tsx                # Mobile application UI
│   └── web/                       # Web application (Express backend + Vite React frontend)
├── packages/
│   └── shared/                    # Shared TypeScript types & interfaces
├── bunfig.toml                    # Package manager configuration
└── package.json                   # Workspaces and root scripts
```

---

## Installation & Setup

### 1. Install Dependencies
```bash
bun install
```

### 2. Mobile App (Android)

#### Run in Development
```bash
bun run mobile
```

#### Prebuild Native Android Project
```bash
bun run mobile:prebuild
```

#### Build Release APK
```bash
bun run build:apk
```
The compiled APK will be output to:
`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`

---

### 3. Web Application

#### Run Development Server (Backend + Frontend)
```bash
bun run dev:web
```
- Frontend: `http://localhost:3000`
- API Server: `http://localhost:3001`

#### Build for Production
```bash
bun run build:web
```

---

## Tech Stack

- **Mobile**: React Native 0.88, Expo SDK 58, Chaquopy 17.2.0 (Python 3.14), FFmpegKit 6.0.4 (`libopus`), TypeScript.
- **Web**: Node.js, Express, Vite, React 19, Lucide Icons, TypeScript.
- **Shared**: Shared TypeScript definitions package.

---

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.
