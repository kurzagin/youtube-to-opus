import { requireNativeModule } from 'expo-modules-core';

export interface NativeVideoMetadata {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: number;
  viewCount: number;
  webpageUrl: string;
}

interface YoutubeExtractorInterface {
  initPython(): Promise<boolean>;
  getVideoInfo(url: string): Promise<string>;
  downloadRawStream(url: string, tempFilePath: string): Promise<boolean>;
  saveToMediaStore(tempFilePath: string, filename: string): Promise<string>;
  getInitialSharedText(): Promise<string | null>;
}

let YoutubeExtractorModule: YoutubeExtractorInterface | null = null;

try {
  YoutubeExtractorModule = requireNativeModule<YoutubeExtractorInterface>('YoutubeExtractor');
} catch {
  // Graceful fallback for mock/web dev
  YoutubeExtractorModule = null;
}

export async function initPython(): Promise<boolean> {
  if (!YoutubeExtractorModule) return false;
  return await YoutubeExtractorModule.initPython();
}

export async function fetchOnDeviceInfo(url: string): Promise<NativeVideoMetadata> {
  if (!YoutubeExtractorModule) {
    throw new Error('Native YoutubeExtractor module is not available.');
  }
  const jsonStr = await YoutubeExtractorModule.getVideoInfo(url);
  return JSON.parse(jsonStr) as NativeVideoMetadata;
}

export async function downloadRawStreamOnDevice(url: string, tempFilePath: string): Promise<boolean> {
  if (!YoutubeExtractorModule) {
    throw new Error('Native YoutubeExtractor module is not available.');
  }
  return await YoutubeExtractorModule.downloadRawStream(url, tempFilePath);
}

export async function saveAudioToMediaStore(tempFilePath: string, filename: string): Promise<string> {
  if (!YoutubeExtractorModule) {
    throw new Error('Native YoutubeExtractor module is not available.');
  }
  return await YoutubeExtractorModule.saveToMediaStore(tempFilePath, filename);
}

export async function getSharedText(): Promise<string | null> {
  if (!YoutubeExtractorModule) return null;
  return await YoutubeExtractorModule.getInitialSharedText();
}
