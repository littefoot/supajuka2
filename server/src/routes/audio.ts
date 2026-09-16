import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { uploadMiddleware, processUploadedFile } from '../services/uploadService.js';
import { separateSong } from '../services/separationService.js';
import { transcribeSong } from '../services/lyricsService.js';
import { listLibrary, getMetadata, saveMetadata, deleteSong } from '../services/metadata.js';
import { vramQueue } from '../services/vramQueue.js';
import { getSongDir, getVocalsPath, findOriginalAudio, getLyricsPath } from '../services/paths.js';
import { resolveGroundTruthLyrics, getGeminiKey, setGeminiKey } from '../services/lyricsGroundTruth.js';
import { appEvents } from '../services/events.js';
import { LyricResult } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WAVEFORM_SCRIPT = path.join(__dirname, '..', '..', 'python', 'generate_waveform.py');

export const audioRouter = Router();

// Upload lossless FLAC/WAV audio
audioRouter.post('/upload', uploadMiddleware.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }
    const metadata = await processUploadedFile(req.file);
    res.json(metadata);
  } catch (err: any) {
    console.error('Audio upload error:', err);
    res.status(500).json({ error: err.message || 'Failed to process upload' });
  }
});

// Trigger stem separation
audioRouter.post('/separate', async (req, res) => {
  const { songId } = req.body;
  if (!songId) return res.status(400).json({ error: 'songId required' });

  try {
    const result = await separateSong(songId);
    res.json(result);
  } catch (err: any) {
    console.error('Separation error:', err);
    res.status(500).json({ error: err.message || 'Separation failed' });
  }
});

// Trigger lyrics transcription
audioRouter.post('/lyrics', async (req, res) => {
  const { songId, force } = req.body;
  if (!songId) return res.status(400).json({ error: 'songId required' });

  try {
    const lyrics = await transcribeSong(songId, force === true);
    res.json(lyrics);
  } catch (err: any) {
    console.error('Transcription error:', err);
    res.status(500).json({ error: err.message || 'Transcription failed' });
  }
});

// Fetch official ground-truth lyrics and re-transcribe
audioRouter.post('/lyrics/official', async (req, res) => {
  const { songId } = req.body;
  if (!songId) return res.status(400).json({ error: 'songId required' });

  try {
    const pLyrics = getLyricsPath(songId);
    if (fs.existsSync(pLyrics)) fs.unlinkSync(pLyrics);

    await resolveGroundTruthLyrics(songId);
    const lyrics = await transcribeSong(songId, true);
    res.json(lyrics);
  } catch (err: any) {
    console.error('Official lyrics alignment error:', err);
    res.status(500).json({ error: err.message || 'Failed to align official lyrics' });
  }
});

// Save edited lyrics from LyricEditor
audioRouter.put('/lyrics/:id', async (req, res) => {
  const { id } = req.params;
  const { lyrics } = req.body;
  if (!lyrics || !lyrics.segments) {
    return res.status(400).json({ error: 'Invalid lyrics payload' });
  }

  try {
    const lyricsPath = getLyricsPath(id);
    fs.writeFileSync(lyricsPath, JSON.stringify(lyrics, null, 2), 'utf-8');

    const meta = getMetadata(id);
    if (meta && !meta.hasLyrics) {
      meta.hasLyrics = true;
      saveMetadata(meta);
    }

    appEvents.emitStatusUpdate(id, 'lyrics_saved', 100, 'Lyrics edited and saved.');
    res.json({ success: true, lyrics });
  } catch (err: any) {
    console.error('Failed to save edited lyrics:', err);
    res.status(500).json({ error: err.message || 'Failed to save lyrics' });
  }
});

// Acapella waveform endpoint for DAW timeline view
audioRouter.get('/waveform/:id/vocals', async (req, res) => {
  const { id } = req.params;
  const songDir = getSongDir(id);
  const waveformPath = path.join(songDir, 'waveform_vocals.json');

  if (fs.existsSync(waveformPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(waveformPath, 'utf-8'));
      return res.json(data);
    } catch (e) {}
  }

  const vocalsPath = getVocalsPath(id);
  const audioInput = fs.existsSync(vocalsPath) ? vocalsPath : findOriginalAudio(id);
  if (!audioInput || !fs.existsSync(audioInput)) {
    return res.status(404).json({ error: 'No audio found for waveform generation' });
  }

  const proc = spawn('py', ['-3.12', WAVEFORM_SCRIPT, audioInput, waveformPath, '50']);

  proc.on('close', (code) => {
    if (code === 0 && fs.existsSync(waveformPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(waveformPath, 'utf-8'));
        return res.json(data);
      } catch (e) {
        return res.status(500).json({ error: 'Failed to read generated waveform' });
      }
    }
    res.status(500).json({ error: 'Failed to generate waveform' });
  });
});

// Gemini API Key Settings
audioRouter.get('/settings/gemini-key', (req, res) => {
  const key = getGeminiKey();
  res.json({
    hasKey: !!key,
    preview: key ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : '',
  });
});

audioRouter.post('/settings/gemini-key', async (req, res) => {
  const { apiKey } = req.body;
  if (typeof apiKey !== 'string') {
    return res.status(400).json({ error: 'apiKey string required' });
  }

  setGeminiKey(apiKey);

  let testSuccess = false;
  let testError = '';
  if (apiKey.trim()) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey.trim()}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Ping' }] }] }),
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        testSuccess = true;
      } else {
        const errJson: any = await resp.json().catch(() => ({}));
        testError = errJson.error?.message || `Gemini returned HTTP ${resp.status}`;
      }
    } catch (e: any) {
      testError = e.message;
    }
  }

  res.json({
    success: true,
    hasKey: !!apiKey.trim(),
    testSuccess,
    testError: testError || undefined,
  });
});

// List all songs in library
audioRouter.get('/library', (req, res) => {
  const songs = listLibrary();
  res.json(songs);
});

// Get single song metadata
audioRouter.get('/song/:id', (req, res) => {
  const meta = getMetadata(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Song not found' });
  res.json(meta);
});

// Delete song from cache
audioRouter.delete('/song/:id', (req, res) => {
  const ok = deleteSong(req.params.id);
  res.json({ success: ok });
});

// VRAM & Queue status
audioRouter.get('/status', (req, res) => {
  res.json(vramQueue.getStatus());
});
