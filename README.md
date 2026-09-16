# SupaJuka 2: Lossless FLAC & WASM Karaoke Engine

SupaJuka 2 is a modern, high-fidelity karaoke workstation and jukebox engineered for bit-perfect audio, artifact-free time-stretching, state-of-the-art stem separation, and real-time word-synchronized lyrics.

---

## 🚀 Key Improvements Over SupaJuka v1

| Feature | SupaJuka 1 (Legacy) | SupaJuka 2 (Modern) |
| :--- | :--- | :--- |
| **Audio Format** | Lossy 320k MP3 (pre-echo & metallic artifacts) | **Lossless 24-bit/16-bit FLAC & WAV** |
| **Time-Stretching** | Tone.js granular delay pitch-shift (comb filtering) | **Dedicated WSOLA Audio Engine** (phase-coherent, no tin-can sound) |
| **Vocal Stem Separation** | Demucs v4 (MP3 output, underwater bleed) | **Mel-Band RoFormer / BS-RoFormer** (FLAC output, Demucs fallback) |
| **Speech-to-Text (ASR)** | OpenAI Whisper PyTorch (4.5GB VRAM) | **Faster-Whisper large-v3-turbo** (CTranslate2 float16, ~1.8GB VRAM) |
| **Local LLM Proofread** | Basic Ollama prompt | **Gemma 4 (e4b / 12b)** with Google Gemini 3.0 Pro fallback |
| **GPU Architecture** | Unmanaged VRAM (vulnerable to OOM) | **Sequential VRAM Task Queue** (Optimized for RTX 4050 6GB) |
| **FLAC File Ingestion** | YouTube only (no upload) | **Drag-and-drop FLAC/WAV upload modal** with Vorbis tag inspection |
| **Component Layout** | Monolithic `App.tsx` (687 lines) | **Modular components** (< 250 lines per orchestrator) |

---

## 🛠️ Tech Stack

- **Client**: React 19, Vite, TypeScript, Tailwind CSS v4, Web Audio API + WSOLA engine, Lucide React.
- **Server**: Node.js (Express), TypeScript, Socket.io, Multer, `music-metadata`.
- **Python ML Pipeline**:
  - `audio-separator` (Mel-Band RoFormer `model_mel_band_roformer_crowd.ckpt`)
  - `demucs` 4.0.1 (Lossless FLAC mode)
  - `faster-whisper` (large-v3-turbo in float16)
  - `yt-dlp` (lossless FLAC conversion)
  - `gemma4:e4b` (via local Ollama)

---

## 🎮 GPU & VRAM Budget (RTX 4050 6GB)

An NVIDIA GeForce RTX 4050 Laptop GPU has **6GB VRAM**. Running Mel-Band RoFormer, Faster-Whisper, and Ollama Gemma 4 concurrently would cause an out-of-memory crash.

SupaJuka 2 solves this with `vramQueue.ts`:
1. Heavy tasks are strictly serialized (concurrency = 1).
2. PyTorch memory is flushed after every run using `torch.cuda.empty_cache()` and garbage collection.
3. Live status and active task badges are streamed in real-time to the frontend.

---

## 🏃 Running the Application

### 1. Install Dependencies
```bash
npm install
npm --prefix server install
npm --prefix client install
```

### 2. Start Both Server & Client
```bash
npm run dev
```

- **Frontend**: `http://localhost:5173`
- **Backend API**: `http://localhost:3001`
