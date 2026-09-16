import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getSongDir, findOriginalAudio, getVocalsPath, getLyricsPath, getPlainLyricsPath } from './paths.js';
import { separateSong } from './separationService.js';
import { vramQueue } from './vramQueue.js';
import { appEvents } from './events.js';
import { getMetadata, saveMetadata } from './metadata.js';
import { resolveGroundTruthLyrics } from './lyricsGroundTruth.js';
import { LyricResult } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TRANSCRIBE_SCRIPT = path.join(__dirname, '..', '..', 'python', 'transcribe.py');
const WAVEFORM_SCRIPT = path.join(__dirname, '..', '..', 'python', 'generate_waveform.py');
const PYTHON_CMD = process.env.PYTHON_PATH || 'py';

export async function transcribeSong(songId: string, force = false): Promise<LyricResult> {
  const lyricsPath = getLyricsPath(songId);

  // If already transcribed and not forced, return cached
  if (!force && fs.existsSync(lyricsPath)) {
    try {
      const cached: LyricResult = JSON.parse(fs.readFileSync(lyricsPath, 'utf-8'));
      appEvents.emitStatusUpdate(songId, 'transcribed', 100, 'Lyrics cached.');
      return cached;
    } catch (e) {}
  }

  // --- STAGE 1: GROUND-TRUTH CANONICAL SYNC & SEARCH ---
  appEvents.emitStatusUpdate(
    songId,
    'ground_truth',
    15,
    '🔍 Step 1/2: Resolving canonical lyrics & search grounding...'
  );

  let gtResult = { isSynced: false, text: null as string | null };
  try {
    gtResult = await resolveGroundTruthLyrics(songId);
  } catch (e) {
    console.warn('[GroundTruth] Resolution failed:', e);
  }

  // If canonical synced lyrics exist (e.g. from LRCLIB), immediately adopt them with 100% human sync
  if (gtResult.isSynced && fs.existsSync(lyricsPath)) {
    console.log(`[Lyrics] Canonical synced lyrics ready for ${songId}. Skipping Whisper transcription.`);
    const result: LyricResult = JSON.parse(fs.readFileSync(lyricsPath, 'utf-8'));
    const meta = getMetadata(songId);
    if (meta) {
      meta.hasLyrics = true;
      saveMetadata(meta);
    }
    appEvents.emitStatusUpdate(songId, 'transcribed', 100, '🎉 Canonical synced lyrics loaded!');
    return result;
  }

  // --- STAGE 2: MANDATORY ACAPELLA STEM SEPARATION & ACOUSTIC ALIGNMENT ---
  let vocalsPath = getVocalsPath(songId);
  if (!fs.existsSync(vocalsPath)) {
    console.log(`[Acapella] Vocals stem missing for ${songId}. Extracting with Mel-Band RoFormer first...`);
    appEvents.emitStatusUpdate(songId, 'separating', 25, '🎙️ Extracting isolated acapella stem with Mel-Band RoFormer...');
    await separateSong(songId);
    vocalsPath = getVocalsPath(songId);
  }
  const inputAudio = fs.existsSync(vocalsPath) ? vocalsPath : findOriginalAudio(songId);
  if (!inputAudio) {
    throw new Error(`No audio found for song: ${songId}`);
  }

  const pPath = getPlainLyricsPath(songId);
  const verifiedPromptPath = fs.existsSync(pPath) ? pPath : null;

  // Pre-generate waveform in background if not already present
  const songDir = getSongDir(songId);
  const waveformPath = path.join(songDir, 'waveform_vocals.json');
  if (!fs.existsSync(waveformPath) && fs.existsSync(inputAudio)) {
    try {
      const wfArgs = PYTHON_CMD.includes('python.exe')
        ? [WAVEFORM_SCRIPT, inputAudio, waveformPath, '50']
        : ['-3.12', WAVEFORM_SCRIPT, inputAudio, waveformPath, '50'];
      spawn(PYTHON_CMD, wfArgs);
    } catch (e) {}
  }

  appEvents.emitStatusUpdate(
    songId,
    'ground_truth',
    30,
    '✨ Ground-truth text resolved! Enqueueing RTX GPU acoustic transient alignment...'
  );

  await new Promise((r) => setTimeout(r, 600));

  return vramQueue.run(`RTX 4050: Aligning ${songId}`, async () => {
    appEvents.emitStatusUpdate(
      songId,
      'transcribing',
      45,
      `🎙️ Step 2/2: Aligning syllables with Faster-Whisper + Acoustic Transients on RTX 4050 (${fs.existsSync(vocalsPath) ? 'Acapella Stem' : 'Full Mix'})...`
    );

    return new Promise<LyricResult>((resolve, reject) => {
      const scriptArgs = [TRANSCRIBE_SCRIPT, inputAudio, lyricsPath];
      if (verifiedPromptPath) {
        scriptArgs.push(verifiedPromptPath);
      }

      const args = PYTHON_CMD.includes('python.exe')
        ? scriptArgs
        : ['-3.12', ...scriptArgs];

      console.log(`[Whisper] Executing: ${PYTHON_CMD} ${args.join(' ')}`);
      const proc = spawn(PYTHON_CMD, args);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => {
        stdout += d.toString();
        console.log(`[Whisper] ${d.toString().trim()}`);
      });

      proc.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(lyricsPath)) {
          const result: LyricResult = JSON.parse(fs.readFileSync(lyricsPath, 'utf-8'));
          const meta = getMetadata(songId);
          if (meta) {
            meta.hasLyrics = true;
            saveMetadata(meta);
          }
          appEvents.emitStatusUpdate(songId, 'transcribed', 100, '🎉 Syllable alignment complete!');
          resolve(result);
        } else {
          reject(new Error(`Transcription failed: ${stderr || stdout}`));
        }
      });
    });
  });
}
