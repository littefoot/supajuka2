import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import * as musicMetadata from 'music-metadata';
import { SongMetadata, AudioFormat } from '../types.js';
import { getSongDir, getOriginalPath, getCoverArtPath } from './paths.js';
import { saveMetadata } from './metadata.js';
import { appEvents } from './events.js';
import { separateSong } from './separationService.js';
import { transcribeSong } from './lyricsService.js';

const storage = multer.memoryStorage();

export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 250 * 1024 * 1024 }, // 250MB limit for 24-bit 96kHz FLAC
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (['flac', 'wav', 'mp3', 'm4a'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported audio format: .${ext}. Only FLAC, WAV, MP3, M4A allowed.`));
    }
  },
});

export async function processUploadedFile(file: Express.Multer.File): Promise<SongMetadata> {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '') as AudioFormat;
  
  // Deterministic hash based on file content
  const hash = crypto.createHash('md5').update(file.buffer).digest('hex').substring(0, 12);
  const songId = `flac_${hash}`;
  const songDir = getSongDir(songId);

  // Write original file
  const originalPath = getOriginalPath(songId, ext);
  fs.writeFileSync(originalPath, file.buffer);

  // Parse Vorbis comments, ID3 tags & pictures
  let title = path.basename(file.originalname, path.extname(file.originalname));
  let artist = 'Unknown Artist';
  let album: string | undefined;
  let duration = 0;
  let bitDepth: number | undefined;
  let sampleRate: number | undefined;
  let hasCoverArt = false;

  try {
    const parsed = await musicMetadata.parseBuffer(file.buffer, { mimeType: file.mimetype });
    if (parsed.common.title) title = parsed.common.title;
    if (parsed.common.artist) artist = parsed.common.artist;
    if (parsed.common.album) album = parsed.common.album;
    if (parsed.format.duration) duration = Math.round(parsed.format.duration);
    if (parsed.format.bitsPerSample) bitDepth = parsed.format.bitsPerSample;
    if (parsed.format.sampleRate) sampleRate = parsed.format.sampleRate;

    // Check embedded cover art (APIC in ID3 or PICTURE in Vorbis)
    if (parsed.common.picture && parsed.common.picture.length > 0) {
      const pic = parsed.common.picture[0];
      const coverPath = getCoverArtPath(songId);
      fs.writeFileSync(coverPath, pic.data);
      hasCoverArt = true;
    }
  } catch (err) {
    console.warn(`Could not parse audio metadata for ${file.originalname}:`, err);
  }

  const metadata: SongMetadata = {
    id: songId,
    source: 'local',
    title,
    artist,
    album,
    duration,
    format: ext,
    bitDepth,
    sampleRate,
    hasCoverArt,
    coverArtUrl: hasCoverArt ? `/audio/${songId}/cover.jpg` : undefined,
    cachedAt: Date.now(),
    isSeparated: false,
    hasLyrics: false,
    originalUrl: `/audio/${songId}/original.${ext}`,
  };

  saveMetadata(metadata);
  appEvents.emitStatusUpdate(songId, 'uploaded', 100, 'Audio file uploaded and indexed.');

  // AUTOMATED INGESTION PIPELINE:
  // 1. Separate Stems (Mel-Band RoFormer) -> creates isolated vocals.flac & instrumental.flac
  // 2. Transcribe Lyrics (Faster-Whisper + VAD on isolated acapella + Ground Truth Prompt)
  setTimeout(async () => {
    try {
      console.log(`[Pipeline] Auto-starting stem separation for ${songId} (${title})...`);
      await separateSong(songId);
      console.log(`[Pipeline] Stems separated. Auto-starting lyric transcription for ${songId}...`);
      await transcribeSong(songId);
      console.log(`[Pipeline] Automated ingestion complete for ${songId} (${title})!`);
    } catch (err) {
      console.error(`[Pipeline] Automated pipeline error for ${songId}:`, err);
    }
  }, 300);

  return metadata;
}
