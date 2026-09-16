import fs from 'fs';
import path from 'path';
import { SongMetadata } from '../types.js';
import { getMetadataPath, CACHE_DIR } from './paths.js';

export function saveMetadata(metadata: SongMetadata): void {
  const metaPath = getMetadataPath(metadata.id);
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
}

export function getMetadata(songId: string): SongMetadata | null {
  const metaPath = getMetadataPath(songId);
  if (fs.existsSync(metaPath)) {
    try {
      return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch (e) {
      return null;
    }
  }
  return null;
}

export function listLibrary(): SongMetadata[] {
  if (!fs.existsSync(CACHE_DIR)) return [];
  const entries = fs.readdirSync(CACHE_DIR, { withFileTypes: true });
  const songs: SongMetadata[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const meta = getMetadata(entry.name);
      if (meta) {
        songs.push(meta);
      }
    }
  }

  return songs.sort((a, b) => b.cachedAt - a.cachedAt);
}

export function deleteSong(songId: string): boolean {
  const songDir = path.join(CACHE_DIR, songId);
  if (fs.existsSync(songDir)) {
    fs.rmSync(songDir, { recursive: true, force: true });
    return true;
  }
  return false;
}
