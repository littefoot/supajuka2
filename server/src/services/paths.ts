import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.join(__dirname, '..', '..', 'audio-cache');

export function getSongDir(songId: string): string {
  const dir = path.join(CACHE_DIR, songId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getOriginalPath(songId: string, format: string = 'flac'): string {
  return path.join(getSongDir(songId), `original.${format}`);
}

export function findOriginalAudio(songId: string): string | null {
  const dir = getSongDir(songId);
  for (const ext of ['flac', 'wav', 'mp3', 'm4a']) {
    const candidate = path.join(dir, `original.${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function getInstrumentalPath(songId: string): string {
  const dir = getSongDir(songId);
  const flacPath = path.join(dir, 'instrumental.flac');
  if (fs.existsSync(flacPath)) return flacPath;
  const mp3Path = path.join(dir, 'instrumental.mp3');
  if (fs.existsSync(mp3Path)) return mp3Path;
  return flacPath;
}

export function getVocalsPath(songId: string): string {
  const dir = getSongDir(songId);
  const flacPath = path.join(dir, 'vocals.flac');
  if (fs.existsSync(flacPath)) return flacPath;
  const mp3Path = path.join(dir, 'vocals.mp3');
  if (fs.existsSync(mp3Path)) return mp3Path;
  return flacPath;
}

export function getCoverArtPath(songId: string): string {
  return path.join(getSongDir(songId), 'cover.jpg');
}

export function getMetadataPath(songId: string): string {
  return path.join(getSongDir(songId), 'metadata.json');
}

export function getLyricsPath(songId: string): string {
  return path.join(getSongDir(songId), 'lyrics.json');
}

export function getPlainLyricsPath(songId: string): string {
  return path.join(getSongDir(songId), 'verified_text.txt');
}

export { CACHE_DIR };
