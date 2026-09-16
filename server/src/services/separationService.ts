import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getSongDir, findOriginalAudio, getInstrumentalPath, getVocalsPath } from './paths.js';
import { vramQueue } from './vramQueue.js';
import { appEvents } from './events.js';
import { getMetadata, saveMetadata } from './metadata.js';
import { SeparationResult } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.join(__dirname, '..', '..', 'python', 'separator.py');
const PYTHON_CMD = process.env.PYTHON_PATH || 'py';

export async function separateSong(songId: string): Promise<SeparationResult> {
  return vramQueue.run(`Separating ${songId}`, async () => {
    const instPath = getInstrumentalPath(songId);
    const vocalsPath = getVocalsPath(songId);

    if (fs.existsSync(instPath) && fs.existsSync(vocalsPath)) {
      console.log(`📦 Cache hit for stems: ${songId}`);
      appEvents.emitStatusUpdate(songId, 'separated', 100, 'Stems ready.');
      return {
        instrumentalUrl: `/audio/${songId}/${path.basename(instPath)}`,
        vocalsUrl: `/audio/${songId}/${path.basename(vocalsPath)}`,
        modelUsed: 'Cache',
      };
    }

    const inputAudio = findOriginalAudio(songId);
    if (!inputAudio) {
      throw new Error(`Original audio not found for song: ${songId}`);
    }

    const songDir = getSongDir(songId);
    appEvents.emitStatusUpdate(songId, 'separating', 15, 'Running Mel-Band RoFormer stem separation...');

    return new Promise<SeparationResult>((resolve, reject) => {
      const args = PYTHON_CMD.includes('python.exe') 
        ? [SCRIPT_PATH, inputAudio, songDir]
        : ['-3.12', SCRIPT_PATH, inputAudio, songDir];

      const proc = spawn(PYTHON_CMD, args);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        console.log(`[RoFormer] ${text.trim()}`);
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          const finalInst = getInstrumentalPath(songId);
          const finalVocals = getVocalsPath(songId);

          const meta = getMetadata(songId);
          if (meta) {
            meta.isSeparated = true;
            meta.instrumentalUrl = `/audio/${songId}/${path.basename(finalInst)}`;
            meta.vocalsUrl = `/audio/${songId}/${path.basename(finalVocals)}`;
            saveMetadata(meta);
          }

          appEvents.emitStatusUpdate(songId, 'separated', 100, 'Separation complete.');
          resolve({
            instrumentalUrl: `/audio/${songId}/${path.basename(finalInst)}`,
            vocalsUrl: `/audio/${songId}/${path.basename(finalVocals)}`,
            modelUsed: stdout.includes('Mel-Band') ? 'Mel-Band RoFormer' : 'Demucs v4 FLAC',
          });
        } else {
          console.error(`Separation failed (code ${code}):`, stderr);
          reject(new Error(`Separation process failed: ${stderr}`));
        }
      });
    });
  });
}
