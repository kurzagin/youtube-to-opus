import { ConfigPlugin, withDangerousMod } from '@expo/config-plugins';
import * as fs from 'fs';
import * as path from 'path';

export const withChaquopy: ConfigPlugin = (config) => {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const androidDir = path.join(projectRoot, 'android');
      const rootBuildGradlePath = path.join(androidDir, 'build.gradle');
      const appBuildGradlePath = path.join(androidDir, 'app', 'build.gradle');

      // 1. Root build.gradle setup
      let rootGradle = fs.readFileSync(rootBuildGradlePath, 'utf8');

      if (!rootGradle.includes('com.chaquo.python:gradle:17.2.0')) {
        rootGradle = rootGradle.replace(
          /dependencies\s*\{/,
          `dependencies {\n        classpath "com.chaquo.python:gradle:17.2.0"`
        );
      }

      if (!rootGradle.includes('https://chaquo.com/maven')) {
        rootGradle = rootGradle.replace(
          /repositories\s*\{/,
          `repositories {\n        maven { url "https://chaquo.com/maven" }`
        );
      }

      // Add compileSdkVersion override for libraries like ffmpeg-kit
      if (!rootGradle.includes('ffmpegKitPackage')) {
        rootGradle += `\nallprojects {
    configurations.all {
        resolutionStrategy {
            force "dev.ffmpegkit-maintained:ffmpeg-kit-audio:6.0.4"
        }
    }
}
subprojects {
    afterEvaluate { project ->
        if (project.hasProperty("android")) {
            if (project.android.hasProperty("compileSdkVersion")) {
                project.android.compileSdkVersion = 35
            }
        }
    }
}
`;
      }

      fs.writeFileSync(rootBuildGradlePath, rootGradle, 'utf8');

      // 2. App build.gradle setup
      let appGradle = fs.readFileSync(appBuildGradlePath, 'utf8');

      if (!appGradle.includes("apply plugin: 'com.chaquo.python'")) {
        appGradle = appGradle.replace(
          /apply plugin: "com\.android\.application"/,
          `apply plugin: "com.android.application"\napply plugin: "com.chaquo.python"`
        );
      }

      if (!appGradle.includes('pip {')) {
        const chaquoConfig = `
    defaultConfig {
        ndk {
            abiFilters "arm64-v8a", "x86_64"
        }
        python {
            version "3.14"
            pip {
                install "yt-dlp>=2025.01.01"
                install "certifi"
            }
        }
    }
`;
        appGradle = appGradle.replace(/defaultConfig\s*\{/, `${chaquoConfig}\n    defaultConfig {`);
      }

      // Add CMake build staging directory on Windows to prevent path length issues
      if (process.platform === 'win32' && !appGradle.includes('buildStagingDirectory')) {
        appGradle = appGradle.replace(
          /cmake\s*\{/,
          `cmake {\n            buildStagingDirectory file("C:/_cxx")`
        );
      }

      fs.writeFileSync(appBuildGradlePath, appGradle, 'utf8');

      // 3. Create Python runner file
      const pythonDir = path.join(androidDir, 'app', 'src', 'main', 'python');
      if (!fs.existsSync(pythonDir)) {
        fs.mkdirSync(pythonDir, { recursive: true });
      }

      const pythonWorkerPath = path.join(pythonDir, 'ytdlp_runner.py');
      const pythonCode = `import json
import os
import re
import urllib.request
import certifi
import yt_dlp

# Force SSL certificates inside Android sandbox
os.environ['SSL_CERT_FILE'] = certifi.where()

DESKTOP_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

COMMON_EXTRACTOR_ARGS = {
    'youtube': {
        'player_client': ['ios', 'android', 'web']
    }
}

def clean_file_path(path_str):
    if not path_str:
        return path_str
    if path_str.startswith('file://'):
        return path_str[7:]
    return path_str

def extract_video_id(url):
    m = re.search(r'(?:v=|\/|embed\/|youtu\.be\/)([0-9A-Za-z_-]{11})', url)
    return m.group(1) if m else "video"

def get_video_info(url):
    try:
        ydl_opts = {
            'extract_flat': False,
            'skip_download': True,
            'quiet': True,
            'no_warnings': True,
            'http_headers': {
                'User-Agent': DESKTOP_USER_AGENT
            },
            'extractor_args': COMMON_EXTRACTOR_ARGS
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                raise ValueError("COULD_NOT_PARSE")
            return json.dumps({
                "id": info.get("id") or extract_video_id(url),
                "title": info.get("title") or "Unknown Title",
                "channel": info.get("uploader") or info.get("channel") or "Unknown Channel",
                "thumbnail": info.get("thumbnail") or "",
                "duration": info.get("duration") or 0,
                "viewCount": info.get("view_count") or 0,
                "webpageUrl": info.get("webpage_url") or url,
                "isAgeRestricted": False
            })
    except Exception as e:
        err = str(e).lower()
        if "confirm your age" in err or "inappropriate" in err or "age" in err:
            vid_id = extract_video_id(url)
            title = "Age-Restricted Video"
            channel = "YouTube Content Warning"
            thumb = f"https://i.ytimg.com/vi/{vid_id}/hqdefault.jpg" if vid_id else ""
            try:
                oembed = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={vid_id}&format=json"
                req = urllib.request.Request(oembed, headers={'User-Agent': DESKTOP_USER_AGENT})
                with urllib.request.urlopen(req, timeout=4) as resp:
                    data = json.loads(resp.read().decode('utf-8'))
                    title = data.get("title") or title
                    channel = data.get("author_name") or channel
            except Exception:
                pass
            return json.dumps({
                "id": vid_id,
                "title": title,
                "channel": channel,
                "thumbnail": thumb,
                "duration": 0,
                "viewCount": 0,
                "webpageUrl": url,
                "isAgeRestricted": True
            })
        elif "unavailable" in err or "private" in err:
            raise ValueError("VIDEO_UNAVAILABLE")
        elif "network" in err or "connection" in err or "timeout" in err:
            raise ValueError("NETWORK_ERROR")
        else:
            raise ValueError("GENERAL_ERROR")

def download_audio_stream(url, output_path):
    output_path = clean_file_path(output_path)
    parent_dir = os.path.dirname(output_path)
    if parent_dir:
        os.makedirs(parent_dir, exist_ok=True)

    try:
        ydl_opts = {
            'format': 'ba/b',
            'outtmpl': output_path,
            'quiet': True,
            'no_warnings': True,
            'http_headers': {
                'User-Agent': DESKTOP_USER_AGENT
            },
            'extractor_args': COMMON_EXTRACTOR_ARGS
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        return True
    except Exception as e:
        err = str(e).lower()
        if "confirm your age" in err or "inappropriate" in err or "age" in err:
            raise ValueError("AGE_RESTRICTED")
        elif "unavailable" in err or "private" in err:
            raise ValueError("VIDEO_UNAVAILABLE")
        elif "network" in err or "connection" in err or "timeout" in err:
            raise ValueError("NETWORK_ERROR")
        else:
            raise ValueError("DOWNLOAD_INTERRUPTED")
`;
      fs.writeFileSync(pythonWorkerPath, pythonCode, 'utf8');

      // 4. Inject Proguard Rules
      const proguardPath = path.join(androidDir, 'app', 'proguard-rules.pro');
      if (fs.existsSync(proguardPath)) {
        let proguard = fs.readFileSync(proguardPath, 'utf8');
        if (!proguard.includes('expo.modules.filesystem')) {
          proguard += `\n
# Keep Expo FileSystem and Core to prevent R8 stripping
-keep class expo.modules.filesystem.** { *; }
-keep interface expo.modules.filesystem.** { *; }
-dontwarn expo.modules.filesystem.**
-keep class expo.modules.core.** { *; }
-dontwarn expo.modules.core.**
`;
          fs.writeFileSync(proguardPath, proguard, 'utf8');
        }
      }

      // 5. Network Timeout
      const wrapperPropsPath = path.join(androidDir, 'gradle', 'wrapper', 'gradle-wrapper.properties');
      if (fs.existsSync(wrapperPropsPath)) {
        let props = fs.readFileSync(wrapperPropsPath, 'utf8');
        if (!props.includes('networkTimeout=')) {
          props += '\nsystemProp.org.gradle.internal.networkTimeout=120000\n';
          fs.writeFileSync(wrapperPropsPath, props, 'utf8');
        }
      }

      return cfg;
    }
  ]);
};

export default withChaquopy;
