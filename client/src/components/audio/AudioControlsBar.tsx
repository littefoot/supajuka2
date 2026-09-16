import React from 'react';
import { Play, Pause, RotateCcw, Mic, Gauge, Music2 } from 'lucide-react';
import { audioEngine, AudioEngineState } from '../../audio/WasmAudioEngine';

interface Props {
  state: AudioEngineState;
}

export const AudioControlsBar: React.FC<Props> = ({ state }) => {
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const formatPitchShort = (p: number) => {
    if (p === 0) return '0 ♮';
    if (p > 0) return `+${p} ♯`;
    return `${p} ♭`;
  };

  return (
    <div className="bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 p-4 sticky bottom-0 z-40 shadow-2xl">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center gap-4">
        
        {/* Playback Controls & Scrubber */}
        <div className="flex-1 w-full flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <button
              onClick={() => (state.isPlaying ? audioEngine.pause() : audioEngine.play())}
              className="w-12 h-12 rounded-full bg-gradient-to-tr from-fuchsia-600 to-indigo-500 hover:from-fuchsia-500 hover:to-indigo-400 text-white flex items-center justify-center shadow-lg shadow-fuchsia-600/30 transition-transform active:scale-95 cursor-pointer"
            >
              {state.isPlaying ? <Pause size={22} /> : <Play size={22} className="ml-0.5" />}
            </button>

            <button
              onClick={() => audioEngine.seek(0)}
              className="p-2.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
              title="Restart Song"
            >
              <RotateCcw size={18} />
            </button>

            <span className="text-xs font-mono text-slate-400 w-12 text-right">
              {formatTime(state.currentTime)}
            </span>

            {/* Scrubber Bar */}
            <input
              type="range"
              min={0}
              max={state.duration || 100}
              value={state.currentTime}
              onChange={(e) => audioEngine.seek(Number(e.target.value))}
              className="flex-1 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-fuchsia-500"
            />

            <span className="text-xs font-mono text-slate-400 w-12">
              {formatTime(state.duration)}
            </span>
          </div>
        </div>

        {/* Stem Crossfader & Pitch/Speed Controls */}
        <div className="flex items-center flex-wrap gap-3 w-full md:w-auto justify-end">
          
          {/* Key Shift (Half Steps) */}
          <div className="flex items-center gap-2 bg-slate-950/80 px-3 py-1.5 rounded-xl border border-slate-800">
            <Music2 size={16} className={state.pitch === 0 ? 'text-slate-400' : 'text-fuchsia-400'} />
            <div className="flex flex-col">
              <div className="flex justify-between text-[10px] text-slate-400 uppercase font-semibold gap-2">
                <span>Key</span>
                <span className={state.pitch !== 0 ? 'text-fuchsia-400 font-bold' : 'text-slate-400'}>
                  {formatPitchShort(state.pitch)}
                </span>
              </div>
              <input
                type="range"
                min={-6}
                max={6}
                step={1}
                value={state.pitch}
                onChange={(e) => audioEngine.setPitch(Number(e.target.value))}
                className="w-20 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-fuchsia-400"
              />
            </div>
          </div>

          {/* Vocal Balance Slider (Karaoke vs Original Stems) */}
          <div className="flex items-center gap-2 bg-slate-950/80 px-3 py-1.5 rounded-xl border border-slate-800">
            <Mic size={16} className={state.vocalBalance === 0 ? 'text-cyan-400' : 'text-fuchsia-400'} />
            <div className="flex flex-col">
              <div className="flex justify-between text-[10px] text-slate-400 uppercase font-semibold gap-2">
                <span>Backing</span>
                <span>Vocals ({state.vocalBalance}%)</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={state.vocalBalance}
                onChange={(e) => audioEngine.setVocalBalance(Number(e.target.value))}
                className="w-24 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>
          </div>

          {/* Speed / WSOLA Time-Stretching */}
          <div className="flex items-center gap-2 bg-slate-950/80 px-3 py-1.5 rounded-xl border border-slate-800">
            <Gauge size={16} className="text-amber-400" />
            <div className="flex flex-col">
              <div className="flex justify-between text-[10px] text-slate-400 uppercase font-semibold gap-2">
                <span>Speed</span>
                <span className="text-amber-400">{state.speed.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.05}
                value={state.speed}
                onChange={(e) => audioEngine.setSpeed(Number(e.target.value))}
                className="w-20 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
