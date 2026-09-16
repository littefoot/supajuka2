import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { SongMetadata } from '../types.js';
import { getSongDir, getOriginalPath } from './paths.js';
import { saveMetadata } from './metadata.js';
import { appEvents } from './events.js';

const PYTHON_CMD = process.env.PYTHON_PATH || 'py';

export interface YouTubeSearchResult {
  id: string;
  title: string;
  thumbnail: string;
  duration: number;
  channel: string;
}

export async function searchYouTube(query: string, maxResults = 8): Promise<YouTubeSearchResult[]> {
  return new Promise((resolve, reject) => {
    const args = PYTHON_CMD.includes('python.exe')
      ? ['-m', 'yt_dlp', `ytsearch${maxResults}:${query}`, '--dump-json', '--flat-playlist', '--no-download']
      : ['-3.12', '-m', 'yt_dlp', `ytsearch${maxResults}:${query}`, '--dump-json', '--flat-playlist', '--no-download'];

    const proc = spawn(PYTHON_CMD, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => stdout += d.toString());
    proc.stderr.on('data', (d) => stderr += d.toString());

    proc.on('close', (code) => {
      if (code !== 0 && !stdout) {
        return reject(new Error(`YouTube search failed: ${stderr}`));
      }

      const results: YouTubeSearchResult[] = [];
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          results.push({
            id: item.id,
            title: item.title || 'Untitled',
            thumbnail: item.thumbnails?.[0]?.url || item.thumbnail || '',
            duration: item.duration || 0,
            channel: item.channel || item.uploader || '',
          });
        } catch (e) {}
      }
      resolve(results);
    });
  });
}

export async function extractYouTubeAudio(item: YouTubeSearchResult): Promise<SongMetadata> {
  const songId = `yt_${item.id}`;
  const outPath = getOriginalPath(songId, 'flac');

  if (fs.existsSync(outPath)) {
    const existing = path.join(getSongDir(songId), 'metadata.json');
    if (fs.existsSync(existing)) {
      return JSON.parse(fs.readFileSync(existing, 'utf-8'));
    }
  }

  appEvents.emitStatusUpdate(songId, 'downloading', 20, 'Downloading audio and converting to lossless FLAC...');

  return new Promise((resolve, reject) => {
    const songDir = getSongDir(songId);
    const targetPattern = path.join(songDir, 'original.%(ext)s');

    const args = PYTHON_CMD.includes('python.exe')
      ? [
          '-m', 'yt_dlp',
          '-x',
          '--audio-format', 'flac',
          '--audio-quality', '0',
          '-o', targetPattern,
          `https://www.youtube.com/watch?v=${item.id}`,
        ]
      : [
          '-3.12', '-m', 'yt_dlp',
          '-x',
          '--audio-format', 'flac',
          '--audio-quality', '0',
          '-o', targetPattern,
          `https://www.youtube.com/watch?v=${item.id}`,
        ];

    const proc = spawn(PYTHON_CMD, args);

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath)) {
        const metadata: SongMetadata = {
          id: songId,
          source: 'youtube',
          title: item.title,
          artist: item.channel,
          duration: item.duration,
          format: 'flac',
          hasCoverArt: !!item.thumbnail,
          coverArtUrl: item.thumbnail,
          cachedAt: Date.now(),
          isSeparated: false,
          hasLyrics: false,
          originalUrl: `/audio/${songId}/original.flac`,
          channel: item.channel,
        };

        saveMetadata(metadata);
        appEvents.emitStatusUpdate(songId, 'downloaded', 100, 'Audio ready.');
        resolve(metadata);
      } else {
        reject(new Error(`Failed to extract audio for YouTube video ${item.id}`));
      }
    });
  });
}
