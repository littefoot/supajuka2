import { SongMetadata } from '../types';
import * as Tone from 'tone';

export interface AudioEngineState {
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  speed: number;
  pitch: number; // in semitones (-12 to +12 half steps)
  vocalBalance: number; // 0 = Karaoke (Backing only), 100 = Full Vocals
  fftData: number[];
}

export type StateListener = (state: AudioEngineState) => void;

export class WasmAudioEngine {
  private ctx: AudioContext | null = null;
  private instrumentalAudio: HTMLAudioElement | null = null;
  private vocalsAudio: HTMLAudioElement | null = null;
  private instrumentalSource: MediaElementAudioSourceNode | null = null;
  private vocalsSource: MediaElementAudioSourceNode | null = null;
  private instrumentalGain: GainNode | null = null;
  private vocalsGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private pitchShift: Tone.PitchShift | null = null;

  private isInitialized = false;
  private animFrame = 0;
  private listeners: Set<StateListener> = new Set();

  private state: AudioEngineState = {
    isPlaying: false,
    isLoading: false,
    currentTime: 0,
    duration: 0,
    speed: 1.0,
    pitch: 0,
    vocalBalance: 0,
    fftData: [],
  };

  constructor() {}

  public async initialize() {
    if (this.isInitialized) return;

    await Tone.start();
    const rawCtx = Tone.getContext().rawContext as AudioContext;
    this.ctx = rawCtx;

    this.instrumentalAudio = new Audio();
    this.instrumentalAudio.crossOrigin = 'anonymous';
    this.instrumentalAudio.preload = 'auto';
    this.instrumentalAudio.preservesPitch = true;

    this.vocalsAudio = new Audio();
    this.vocalsAudio.crossOrigin = 'anonymous';
    this.vocalsAudio.preload = 'auto';
    this.vocalsAudio.preservesPitch = true;

    this.instrumentalSource = this.ctx.createMediaElementSource(this.instrumentalAudio);
    this.vocalsSource = this.ctx.createMediaElementSource(this.vocalsAudio);

    this.instrumentalGain = this.ctx.createGain();
    this.vocalsGain = this.ctx.createGain();
    this.masterGain = this.ctx.createGain();

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 128;
    this.analyser.smoothingTimeConstant = 0.45;

    // Initialize Tone PitchShift with tight 50ms window (avoids 100ms hollow comb filter)
    this.pitchShift = new Tone.PitchShift({
      pitch: 0,
      windowSize: 0.05,
    });
    // CRITICAL: Wet is 0 when pitch is 0 -> 100% bit-perfect dry lossless bypass!
    this.pitchShift.wet.value = 0;

    // Audio Graph:
    // [Inst Source] -> [Inst Gain] ─┐
    //                               ├─> [PitchShift Input] -> [Master Gain] -> [Analyser] -> Destination
    // [Voc Source]  -> [Voc Gain]  ─┘
    this.instrumentalSource.connect(this.instrumentalGain);
    this.vocalsSource.connect(this.vocalsGain);

    // Connect native gains to Tone PitchShift input
    const ps = this.pitchShift as any;
    const psInput = ps.input?.input || ps.input;
    const psOutput = ps.output?.output || ps.output;

    if (psInput && psOutput) {
      this.instrumentalGain.connect(psInput);
      this.vocalsGain.connect(psInput);
      psOutput.connect(this.masterGain);
    } else {
      // Fallback direct connect if Tone pitch shift internal structure differs
      this.instrumentalGain.connect(this.masterGain);
      this.vocalsGain.connect(this.masterGain);
    }

    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    this.instrumentalGain.gain.value = 1.0;
    this.vocalsGain.gain.value = 0.0;

    this.setupEventListeners();
    this.startRenderLoop();
    this.isInitialized = true;
    console.log('🎧 WasmAudioEngine Initialized with Dynamic Key Shifting (Half Steps)');
  }

  private lastHardResyncTime = 0;

  private waitForReady(audio: HTMLAudioElement, timeoutMs = 2500): Promise<void> {
    if (audio.readyState >= 3) return Promise.resolve();
    return new Promise((resolve) => {
      let resolved = false;
      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        audio.removeEventListener('canplay', onReady);
        audio.removeEventListener('canplaythrough', onReady);
        audio.removeEventListener('error', onReady);
        clearTimeout(timer);
        resolve();
      };
      const onReady = () => cleanup();
      audio.addEventListener('canplay', onReady, { once: true });
      audio.addEventListener('canplaythrough', onReady, { once: true });
      audio.addEventListener('error', onReady, { once: true });
      const timer = setTimeout(cleanup, timeoutMs);
    });
  }

  private syncStems() {
    if (!this.instrumentalAudio || !this.vocalsAudio || !this.vocalsAudio.src) return;
    if (this.instrumentalAudio.paused || this.vocalsAudio.paused) return;

    const instTime = this.instrumentalAudio.currentTime;
    const vocTime = this.vocalsAudio.currentTime;
    const drift = vocTime - instTime; // negative means vocals is lagging behind instrumental
    const absDrift = Math.abs(drift);
    const baseSpeed = this.state.speed;

    // 1. Catastrophic drift (> 300ms) - hard seek, throttled to at most once per 2 seconds
    if (absDrift > 0.3) {
      const now = performance.now();
      if (now - this.lastHardResyncTime > 2000) {
        this.lastHardResyncTime = now;
        this.vocalsAudio.currentTime = instTime;
        this.vocalsAudio.playbackRate = baseSpeed;
      }
      return;
    }

    // 2. Phase-Lock Loop (PLL) micro-adjustments for drift between 35ms and 300ms
    // If vocals is lagging, speed up vocals slightly (1.05x). If ahead, slow down slightly (0.95x).
    // This closes phase drift seamlessly without audio dropouts or hard seeking buffer flushes.
    if (absDrift > 0.035) {
      if (drift < 0) {
        this.vocalsAudio.playbackRate = baseSpeed * 1.05;
      } else {
        this.vocalsAudio.playbackRate = baseSpeed * 0.95;
      }
    } else {
      // Within tolerance (< 35ms): lock to base speed
      if (this.vocalsAudio.playbackRate !== baseSpeed) {
        this.vocalsAudio.playbackRate = baseSpeed;
      }
    }
  }

  private setupEventListeners() {
    if (!this.instrumentalAudio) return;

    this.instrumentalAudio.addEventListener('timeupdate', () => {
      if (!this.instrumentalAudio) return;
      const cur = this.instrumentalAudio.currentTime;

      // Phase-Lock Sync: keep vocal stem sample-accurate with instrumental stem
      this.syncStems();

      this.updateState({ currentTime: cur });
    });

    this.instrumentalAudio.addEventListener('durationchange', () => {
      if (!this.instrumentalAudio) return;
      this.updateState({ duration: this.instrumentalAudio.duration || 0 });
    });

    this.instrumentalAudio.addEventListener('ended', () => {
      this.updateState({ isPlaying: false, currentTime: 0 });
    });

    this.instrumentalAudio.addEventListener('waiting', () => {
      if (this.vocalsAudio && !this.vocalsAudio.paused) {
        this.vocalsAudio.pause();
      }
      this.updateState({ isLoading: true });
    });

    this.instrumentalAudio.addEventListener('playing', () => {
      if (this.vocalsAudio && this.vocalsAudio.src && this.vocalsAudio.paused && this.state.isPlaying) {
        this.vocalsAudio.currentTime = this.instrumentalAudio!.currentTime;
        this.vocalsAudio.play().catch(() => {});
      }
      this.updateState({ isLoading: false, isPlaying: true });
    });
  }

  public async loadSong(song: SongMetadata) {
    await this.initialize();
    try {
      if (this.ctx && this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
    } catch (e) {
      // AudioContext will resume on first user interaction
    }

    this.updateState({ isLoading: true, isPlaying: false });

    if (this.instrumentalAudio) {
      this.instrumentalAudio.pause();
      this.instrumentalAudio.currentTime = 0;
      this.instrumentalAudio.playbackRate = this.state.speed;
    }
    if (this.vocalsAudio) {
      this.vocalsAudio.pause();
      this.vocalsAudio.currentTime = 0;
      this.vocalsAudio.playbackRate = this.state.speed;
    }

    const instUrl = song.instrumentalUrl || song.originalUrl;
    const vocalsUrl = song.vocalsUrl || '';

    if (this.instrumentalAudio) {
      this.instrumentalAudio.src = instUrl;
      this.instrumentalAudio.load();
    }

    if (this.vocalsAudio) {
      if (vocalsUrl) {
        this.vocalsAudio.src = vocalsUrl;
        this.vocalsAudio.load();
      } else {
        this.vocalsAudio.removeAttribute('src');
      }
    }

    this.updateState({
      isLoading: false,
      currentTime: 0,
      duration: song.duration || 0,
      isPlaying: false,
    });
  }

  public async updateStems(song: SongMetadata) {
    if (!this.instrumentalAudio || !this.vocalsAudio) return;
    const curTime = this.instrumentalAudio.currentTime;
    const wasPlaying = this.state.isPlaying;

    const instUrl = song.instrumentalUrl || song.originalUrl;
    const vocalsUrl = song.vocalsUrl || '';

    let changed = false;
    const targetInst = new URL(instUrl, window.location.origin).href;
    if (this.instrumentalAudio.src !== targetInst) {
      this.instrumentalAudio.src = instUrl;
      this.instrumentalAudio.currentTime = curTime;
      changed = true;
    }

    if (vocalsUrl) {
      const targetVoc = new URL(vocalsUrl, window.location.origin).href;
      if (this.vocalsAudio.src !== targetVoc) {
        this.vocalsAudio.src = vocalsUrl;
        this.vocalsAudio.currentTime = curTime;
        changed = true;
      }
    }

    if (changed && wasPlaying) {
      await this.play();
    }
  }

  public async play() {
    await this.initialize();
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    if (!this.instrumentalAudio) return;

    const curTime = this.instrumentalAudio.currentTime;
    const hasVocals = Boolean(this.vocalsAudio && this.vocalsAudio.src);

    // 1. Prime both elements so neither plays while the other is still buffering
    if (hasVocals) {
      await Promise.all([
        this.waitForReady(this.instrumentalAudio),
        this.waitForReady(this.vocalsAudio!),
      ]);
    } else {
      await this.waitForReady(this.instrumentalAudio);
    }

    // 2. Align timestamps and speeds before firing play
    this.instrumentalAudio.currentTime = curTime;
    this.instrumentalAudio.playbackRate = this.state.speed;

    if (hasVocals) {
      this.vocalsAudio!.currentTime = curTime;
      this.vocalsAudio!.playbackRate = this.state.speed;
    }

    // 3. Fire playback concurrently
    if (hasVocals) {
      await Promise.all([
        this.instrumentalAudio.play(),
        this.vocalsAudio!.play(),
      ]);
    } else {
      await this.instrumentalAudio.play();
    }

    this.updateState({ isPlaying: true });
  }

  public pause() {
    if (this.instrumentalAudio) this.instrumentalAudio.pause();
    if (this.vocalsAudio) this.vocalsAudio.pause();
    this.updateState({ isPlaying: false });
  }

  public seek(timeSeconds: number) {
    if (this.instrumentalAudio) {
      this.instrumentalAudio.currentTime = timeSeconds;
      this.instrumentalAudio.playbackRate = this.state.speed;
    }
    if (this.vocalsAudio && this.vocalsAudio.src) {
      this.vocalsAudio.currentTime = timeSeconds;
      this.vocalsAudio.playbackRate = this.state.speed;
    }
    this.updateState({ currentTime: timeSeconds });
  }

  public setSpeed(speed: number) {
    const clamped = Math.max(0.5, Math.min(1.5, speed));
    if (this.instrumentalAudio) {
      this.instrumentalAudio.preservesPitch = true;
      this.instrumentalAudio.playbackRate = clamped;
    }
    if (this.vocalsAudio) {
      this.vocalsAudio.preservesPitch = true;
      this.vocalsAudio.playbackRate = clamped;
    }
    this.updateState({ speed: clamped });
  }

  /**
   * Set Key Shift in half steps / semitones (-12 to +12).
   * When semitones is 0, wet.value is 0 for 100% bit-perfect dry bypass!
   */
  public setPitch(semitones: number) {
    const clamped = Math.max(-12, Math.min(12, semitones));
    if (this.pitchShift) {
      if (clamped === 0) {
        this.pitchShift.wet.value = 0; // 100% bit-perfect dry lossless
      } else {
        this.pitchShift.pitch = clamped;
        this.pitchShift.wet.value = 1; // Active pitch shift
      }
    }
    this.updateState({ pitch: clamped });
  }

  public setVocalBalance(balancePercent: number) {
    const clamped = Math.max(0, Math.min(100, balancePercent));
    const vocalVol = clamped / 100.0;
    if (this.vocalsGain) {
      this.vocalsGain.gain.setTargetAtTime(vocalVol, this.ctx?.currentTime || 0, 0.05);
    }
    this.updateState({ vocalBalance: clamped });
  }

  private startRenderLoop() {
    const buffer = new Uint8Array(64);

    const loop = () => {
      if (this.analyser && this.state.isPlaying) {
        this.analyser.getByteFrequencyData(buffer);
        const normalized = Array.from(buffer).map((b) => b / 255);
        this.updateState({ fftData: normalized });
      }
      this.animFrame = requestAnimationFrame(loop);
    };

    this.animFrame = requestAnimationFrame(loop);
  }

  public subscribe(fn: StateListener) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private updateState(partial: Partial<AudioEngineState>) {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  public getCurrentTime(): number {
    if (this.instrumentalAudio) {
      return this.instrumentalAudio.currentTime;
    }
    return this.state.currentTime;
  }

  public getState() {
    return this.state;
  }
}

export const audioEngine = new WasmAudioEngine();
