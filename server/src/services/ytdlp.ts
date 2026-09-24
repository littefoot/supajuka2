import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { SongMetadata } from '../types.js';
import { getSongDir, getOriginalPath, getCoverArtPath } from './paths.js';
import { saveMetadata } from './metadata.js';
import { appEvents } from './events.js';
import { separateSong } from './separationService.js';
import { transcribeSong } from './lyricsService.js';
import { extractArtistAndTitle } from './lyricsGroundTruth.js';

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
      const meta: SongMetadata = JSON.parse(fs.readFileSync(existing, 'utf-8'));
      // If previously extracted but not yet separated or transcribed, auto-trigger pipeline
      if (!meta.isSeparated || !meta.hasLyrics) {
        setTimeout(async () => {
          try {
            if (!meta.isSeparated) {
              console.log(`[Pipeline] Auto-starting stem separation for cached YouTube track ${songId} (${meta.title})...`);
              await separateSong(songId);
            }
            if (!meta.hasLyrics) {
              console.log(`[Pipeline] Stems ready. Auto-starting lyric transcription for ${songId}...`);
              await transcribeSong(songId);
            }
            console.log(`[Pipeline] Automated ingestion complete for ${songId}!`);
          } catch (err) {
            console.error(`[Pipeline] Auto-ingestion failed for ${songId}:`, err);
          }
        }, 100);
      }
      return meta;
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
        const { artist: cleanArtistName, title: cleanTitleName } = extractArtistAndTitle(item.title, item.channel);
        const metadata: SongMetadata = {
          id: songId,
          source: 'youtube',
          title: cleanTitleName || item.title,
          artist: cleanArtistName || item.channel,
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

        // Download thumbnail locally if available
        if (item.thumbnail && item.thumbnail.startsWith('http')) {
          fetch(item.thumbnail)
            .then((r) => r.arrayBuffer())
            .then((buf) => {
              const coverPath = getCoverArtPath(songId);
              fs.writeFileSync(coverPath, Buffer.from(buf));
              metadata.hasCoverArt = true;
              metadata.coverArtUrl = `/audio/${songId}/cover.jpg`;
              saveMetadata(metadata);
            })
            .catch(() => {});
        }

        // AUTOMATED INGESTION PIPELINE (Identical to FLAC upload):
        // 1. Separate Stems (Mel-Band RoFormer) -> creates isolated vocals.flac & instrumental.flac
        // 2. Transcribe Lyrics (Faster-Whisper + VAD on isolated acapella + Ground Truth Prompt)
        setTimeout(async () => {
          try {
            console.log(`[Pipeline] Auto-starting stem separation for YouTube track ${songId} (${item.title})...`);
            await separateSong(songId);
            console.log(`[Pipeline] Stems separated. Auto-starting lyric transcription for ${songId}...`);
            await transcribeSong(songId);
            console.log(`[Pipeline] Automated ingestion complete for YouTube track ${songId} (${item.title})!`);
          } catch (err) {
            console.error(`[Pipeline] Auto-ingestion failed for YouTube track ${songId}:`, err);
          }
        }, 100);

        resolve(metadata);
      } else {
        reject(new Error(`Failed to extract audio for YouTube video ${item.id}`));
      }
    });
  });
}
