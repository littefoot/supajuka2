import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getSongDir, findOriginalAudio, getVocalsPath, getLyricsPath, getPlainLyricsPath } from './paths.js';
import { separateSong, generateVocalsWaveform } from './separationService.js';
import { vramQueue } from './vramQueue.js';
import { appEvents } from './events.js';
import { getMetadata, saveMetadata } from './metadata.js';
import { resolveGroundTruthLyrics, calibrateAndSnapLrcToWaveform } from './lyricsGroundTruth.js';
import { LyricResult } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TRANSCRIBE_SCRIPT = path.join(__dirname, '..', '..', 'python', 'transcribe.py');
const WAVEFORM_SCRIPT = path.join(__dirname, '..', '..', 'python', 'generate_waveform.py');
const PYTHON_CMD = process.env.PYTHON_PATH || 'py';

const PROTECTED_SONG_IDS = ['flac_76362ddbe871', 'flac_a7e3cd88e60a'];

export async function transcribeSong(songId: string, force = false): Promise<LyricResult> {
  const lyricsPath = getLyricsPath(songId);

  // CRITICAL RULE: Never overwrite or re-align user-saved protected songs
  if (PROTECTED_SONG_IDS.includes(songId)) {
    console.log(`[Lyrics] Protected song detected: ${songId}. Returning saved timings without re-aligning.`);
    if (fs.existsSync(lyricsPath)) {
      return JSON.parse(fs.readFileSync(lyricsPath, 'utf-8'));
    }
  }

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

  // If canonical synced lyrics exist (e.g. from LRCLIB), calibrate against waveform & adopt
  if (gtResult.isSynced && fs.existsSync(lyricsPath)) {
    const songDir = getSongDir(songId);
    const waveformPath = path.join(songDir, 'waveform_vocals.json');
    if (!fs.existsSync(waveformPath)) {
      await generateVocalsWaveform(songId);
    }
    let result: LyricResult = JSON.parse(fs.readFileSync(lyricsPath, 'utf-8'));

    if (fs.existsSync(waveformPath)) {
      result = calibrateAndSnapLrcToWaveform(result, waveformPath);
      fs.writeFileSync(lyricsPath, JSON.stringify(result, null, 2), 'utf-8');
    }

    if (result.segments && result.segments.length > 0) {
      console.log(`[Lyrics] Canonical synced lyrics ready and calibrated for ${songId} (${result.segments.length} lines). Skipping Whisper transcription.`);
      const meta = getMetadata(songId);
      if (meta) {
        meta.hasLyrics = true;
        saveMetadata(meta);
      }
      appEvents.emitStatusUpdate(songId, 'transcribed', 100, '🎉 Canonical synced lyrics loaded!');
      return result;
    }
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
          if (result.segments && result.segments.length > 0) {
            if (meta) {
              meta.hasLyrics = true;
              saveMetadata(meta);
            }
            appEvents.emitStatusUpdate(songId, 'transcribed', 100, '🎉 Syllable alignment complete!');
            resolve(result);
          } else {
            if (meta) {
              meta.hasLyrics = false;
              saveMetadata(meta);
            }
            appEvents.emitStatusUpdate(songId, 'error', 0, 'No vocal segments could be identified in acapella stem.');
            resolve(result);
          }
        } else {
          reject(new Error(`Transcription failed: ${stderr || stdout}`));
        }
      });
    });
  });
}
