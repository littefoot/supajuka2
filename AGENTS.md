# SupaJuka 2 — Agent Context, Architecture & Rules

## 🚀 System Overview
**SupaJuka 2** is a professional, high-fidelity lossless karaoke workstation and jukebox engineered for bit-perfect FLAC audio playback, zero-overlap syllable-level lyric synchronization, AI vocal isolation (Mel-Band RoFormer), speech-to-text alignment (Faster-Whisper), and dynamic key/tempo manipulation.

- **Client Directory**: `C:\Projects\supajuka2\client` (React 18, Vite, TypeScript, Tailwind CSS, Web Audio API)
- **Server Directory**: `C:\Projects\supajuka2\server` (Node.js, Express, Socket.io, TypeScript)
- **Python ML Workers**: `C:\Projects\supajuka2\server\python` (Python 3.12, PyTorch, CTranslate2)
- **Audio Storage Cache**: `C:\Projects\supajuka2\server\audio-cache`

---

## ⚠️ Critical Operational Directives & Rules

### 1. 🛑 PROTECTED USER-SAVED LYRICS: *Give Me Novacaine* & *Don't Look Back In Anger*
> [!CAUTION]
> **DO NOT OVERWRITE USER-SAVED TIMINGS!**
> The user has manually tuned and saved lyric syncs for:
> 1. Green Day – *Give Me Novacaine* (`flac_76362ddbe871`)
> 2. Oasis – *Don't Look Back in Anger* (`flac_a7e3cd88e60a`)
> 
> **Agents must NEVER recalculate, overwrite, re-align, or run automated scripts on `lyrics.json` for these songs unless the user explicitly and unambiguously requests it.**

### 2. ⚡ VRAM & ML Hardware Constraints
- **Host GPU**: NVIDIA GeForce RTX 4050 Laptop GPU (6GB VRAM limit).
- **Strict Concurrency Rule**: NEVER run stem separation (PyTorch / Mel-Band RoFormer) and speech-to-text (Faster-Whisper large-v3) concurrently. Port collisions or VRAM spikes will crash the local driver.
- Heavy ML jobs must always route sequentially through the task queue (`server/src/services/vramQueue.ts`).

### 3. 🎵 Lossless FLAC & Bit-Perfect Pipeline
- All master audio, separated vocals, and separated backing tracks must remain in lossless **FLAC** format.
- Do not compress or downsample intermediate or cached audio to lossy MP3.
- In `WasmAudioEngine.ts`, when key change / pitch is `0` semitones, audio routing MUST completely bypass processing (`wet = 0`) to preserve bit-perfect dry lossless playback.

---

## 📁 Repository Architecture

### 1. Client (`/client`)
- **`src/audio/WasmAudioEngine.ts`**: Web Audio API engine orchestrating dual HTML5 audio elements (`instrumental.flac` and `vocals.flac`), real-time vocal balance crossfader (backing only vs full vocals), FFT spectrum analysis, and dynamic semitone pitch shifting.
- **`src/components/karaoke/LyricEditorModal.tsx`**: High-precision DAW Syllable Keyframe & Waveform Editor:
  - Single-row interactive syllable lane with zero-overlap guarantees ($syl[i].end \le syl[i+1].start$).
  - Dual attack/sustain handles, position nudgers (±10ms, ±20ms, ±50ms).
  - Waveform canvas visualization with sample rate resolution (50 pps).
  - Transient peak snapping (`findVocalAttackPeak`) with a noise gate threshold of $p \ge 0.18$ to reject guitar bleed.
- **`src/components/karaoke/LyricStage.tsx`**: Full-screen stage view with active line glowing, bouncing ball syllable progress, and upcoming line previews. Segment-anchored line resolution guarantees that inter-line and post-instrumental pauses transition forward cleanly rather than regressing to completed lines.
- **`src/components/karaoke/AudioControlsBar.tsx`**: Transport bar with play/pause, time scrubbing, key change slider (±12 half-steps), backing/vocal slider, and playback speed controls.

### 2. Server (`/server`)
- **`src/services/lyricsGroundTruth.ts`**: Ingests LRCLIB crowd-sourced synchronized lyrics or Gemini/Ollama official lyrics. Uses syllable-aware duration calculations (`estSyllables * 0.38s`) to ensure multi-syllabic phrases are not prematurely compressed.
- **`src/services/lyricsService.ts`**: Orchestrates two-stage lyrics resolution: (1) Canonical synced LRC lookup, (2) Faster-Whisper word-level acoustic alignment on isolated RoFormer vocal stems.
- **`src/services/separationService.ts`**: Invokes Mel-Band RoFormer (`server/python/separator.py`) to produce pristine `vocals.flac` and `instrumental.flac`.
- **`src/services/vramQueue.ts`**: Serializes heavy PyTorch tasks to prevent out-of-memory errors on 6GB VRAM.

### 3. Audio Cache Structure (`server/audio-cache/<songId>/`)
```
flac_<hash>/
├── original.flac          # Source lossless input
├── instrumental.flac      # Mel-Band RoFormer backing track
├── vocals.flac            # Mel-Band RoFormer isolated acapella track
├── waveform_vocals.json   # 50 samples/sec normalised acoustic peaks for the editor
├── lyrics.json            # Word- and syllable-level timestamps and metadata
├── metadata.json          # Track title, artist, duration, format
└── cover.jpg              # Album artwork
```

---

## 📍 Current State & Active Focus Areas

1. **Lyric Timing & Syllable Engine**:
   - ✅ DAW syllable keyframe editor operational with zero-overlap constraint.
   - ✅ Syllable-aware duration allocator implemented to prevent word-count duration collapse.
   - ✅ Snapping noise floor elevated to 0.18 to ignore guitar pluck bleed.
   - ✅ Segment-anchored active line synchronization in `LyricStage.tsx`: eliminates post-instrumental regression / flashing of previously sung lines.
   - 🔒 User manual edits preserved on active library tracks (*Give Me Novacaine* & *Don't Look Back In Anger* locked).

2. **Pitch Shifting Quality (Active Investigation)**:
   - *Issue*: Lowering pitch using `Tone.PitchShift` produces metallic comb filtering, flutter, and gargling artifacts.
   - *Cause*: `Tone.PitchShift` is a granular delay-line crossfader (using 50ms window slices), not a true spectral phase vocoder or WSOLA engine.
   - *Next Step*: Transition from Tone.js granular pitch shift to true WSOLA / SoundTouch WASM (`soundtouchjs` is installed in `client/package.json`) or an AudioWorklet phase vocoder (`signalsmith-stretch`).
