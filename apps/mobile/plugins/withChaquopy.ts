import fs from 'fs';
import path from 'path';
import {
  withProjectBuildGradle,
  withAppBuildGradle,
  withAndroidManifest,
  withDangerousMod,
  ConfigPlugin
} from '@expo/config-plugins';

const withChaquopyPlugin: ConfigPlugin = (config) => {
  // 1. Root build.gradle: Chaquopy repository and classpath
  config = withProjectBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;

    if (!contents.includes('com.chaquo.python:gradle')) {
      // Ensure mavenCentral / maven repo is in buildscript repositories
      contents = contents.replace(
        /buildscript\s*\{([\s\S]*?)repositories\s*\{/,
        (match) => `${match}\n        maven { url "https://chaquo.com/maven" }`
      );

      // Add Chaquopy gradle plugin to classpath
      contents = contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n        classpath "com.chaquo.python:gradle:17.2.0"`
      );
      cfg.modResults.contents = contents;
    }
    return cfg;
  });

  // 2. App build.gradle: Apply plugin and configure Python
  config = withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;

    if (!contents.includes('com.chaquo.python')) {
      contents = `apply plugin: 'com.chaquo.python'\n` + contents;
    }

    if (!contents.includes('python {')) {
      // Inject ndk and python blocks inside android { ... defaultConfig { ... } }
      contents = contents.replace(
        /defaultConfig\s*\{/,
        `defaultConfig {\n        ndk {\n            abiFilters "arm64-v8a", "armeabi-v7a", "x86_64"\n        }\n        python {\n            version "3.10"\n            pip {\n                install "yt-dlp"\n                install "certifi"\n            }\n        }`
      );
      cfg.modResults.contents = contents;
    }
    return cfg;
  });

  // 3. AndroidManifest.xml: Internet permission & Share Send Intent
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // Ensure permissions
    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }

    const hasInternet = manifest['uses-permission'].some(
      (p: any) => p.$['android:name'] === 'android.permission.INTERNET'
    );
    if (!hasInternet) {
      manifest['uses-permission'].push({
        $: { 'android:name': 'android.permission.INTERNET' }
      });
    }

    // Add SEND intent filter for receiving shared YouTube links
    const application = manifest.application?.[0];
    const mainActivity = application?.activity?.find(
      (act: any) => act.$['android:name'] === '.MainActivity'
    );

    if (mainActivity) {
      if (!mainActivity['intent-filter']) {
        mainActivity['intent-filter'] = [];
      }

      const hasSendFilter = mainActivity['intent-filter'].some((f: any) =>
        f.action?.some((a: any) => a.$['android:name'] === 'android.intent.action.SEND')
      );

      if (!hasSendFilter) {
        mainActivity['intent-filter'].push({
          action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
          category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
          data: [{ $: { 'android:mimeType': 'text/plain' } }]
        });
      }
    }

    return cfg;
  });

  // 4. Create Python runtime worker file inside android/app/src/main/python/
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const pythonDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'python'
      );
      if (!fs.existsSync(pythonDir)) {
        fs.mkdirSync(pythonDir, { recursive: true });
      }

      const pythonWorkerPath = path.join(pythonDir, 'ytdlp_runner.py');
      const pythonCode = `import json
import os
import certifi
import yt_dlp

# Force SSL certificates inside Android sandbox
os.environ['SSL_CERT_FILE'] = certifi.where()

def get_video_info(url):
    ydl_opts = {
        'extract_flat': False,
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'extractor_args': {'youtube': {'player_client': ['ios', 'android', 'web']}}
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        return json.dumps({
            "id": info.get("id"),
            "title": info.get("title") or "Unknown Title",
            "channel": info.get("uploader") or info.get("channel") or "Unknown Channel",
            "thumbnail": info.get("thumbnail") or "",
            "duration": info.get("duration") or 0,
            "viewCount": info.get("view_count") or 0,
            "webpageUrl": info.get("webpage_url") or url
        })

def download_audio_stream(url, output_path):
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': output_path,
        'quiet': True,
        'no_warnings': True,
        'extractor_args': {'youtube': {'player_client': ['ios', 'android', 'web']}}
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])
    return True
`;
      fs.writeFileSync(pythonWorkerPath, pythonCode, 'utf8');
      return cfg;
    }
  ]);

  return config;
};

export default withChaquopyPlugin;
