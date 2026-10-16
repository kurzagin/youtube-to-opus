export interface VideoMetadata {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: number;
  durationFormatted: string;
  viewCount: number;
  viewCountFormatted: string;
  webpageUrl: string;
}

export interface ConvertOptions {
  url: string;
  bitrate?: 'best' | '192' | '128' | '96' | '64';
  embedMetadata?: boolean;
}
