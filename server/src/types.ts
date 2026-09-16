export type AudioFormat = 'flac' | 'wav' | 'mp3' | 'm4a';

export interface SongMetadata {
  id: string;
  source: 'local' | 'youtube';
  title: string;
  artist: string;
  album?: string;
  duration: number; // in seconds
  format: AudioFormat;
  bitDepth?: number;
  sampleRate?: number;
  hasCoverArt: boolean;
  coverArtUrl?: string;
  cachedAt: number;
  isSeparated: boolean;
  hasLyrics: boolean;
  instrumentalUrl?: string;
  vocalsUrl?: string;
  originalUrl: string;
  channel?: string;
}

export interface LyricSyllable {
  text: string;
  start: number;
  end: number;
}

export interface LyricWord {
  syllables?: LyricSyllable[];
  text: string;
  start: number;
  end: number;
  probability: number;
  isMarker?: boolean;
}

export interface LyricSegment {
  start: number;
  end: number;
  text: string;
  words: LyricWord[];
}

export interface LyricResult {
  segments: LyricSegment[];
  text: string;
  source?: string;
  language?: string;
  duration?: number;
}

export interface SeparationResult {
  instrumentalUrl: string;
  vocalsUrl: string;
  modelUsed: string;
}

export interface GpuStatus {
  isLocked: boolean;
  currentTask: string | null;
  queueLength: number;
  vramUsedMb?: number;
  vramTotalMb?: number;
}
