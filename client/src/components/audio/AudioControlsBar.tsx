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
    <div className="bg-[#1b1b1b] border-t border-[#2d2d2d] px-3 sm:px-4 md:px-6 py-2 sticky bottom-0 z-40 shadow-2xl flex-shrink-0">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center gap-2 md:gap-4 w-full">
        
        {/* Row 1 (Mobile) / Left (Desktop): Playback Controls & Scrubber */}
        <div className="flex items-center gap-2 sm:gap-3 w-full flex-1">
          {/* Play/Pause Button */}
          <button
            onClick={() => (state.isPlaying ? audioEngine.pause() : audioEngine.play())}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-md shadow-blue-600/30 transition active:scale-95 cursor-pointer border border-blue-500/50 flex-shrink-0"
            aria-label={state.isPlaying ? "Pause" : "Play"}
          >
            {state.isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
          </button>

          {/* Restart Button */}
          <button
            onClick={() => audioEngine.seek(0)}
            className="p-2 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] hover:text-white border border-[#333333] transition cursor-pointer flex-shrink-0"
            title="Restart Song"
            aria-label="Restart Song"
          >
            <RotateCcw size={14} />
          </button>

          {/* Time - Current */}
          <span className="text-xs font-mono font-bold text-[#858585] w-10 sm:w-12 text-right flex-shrink-0">
            {formatTime(state.currentTime)}
          </span>

          {/* Scrubber Bar */}
          <input
            type="range"
            min={0}
            max={state.duration || 100}
            value={state.currentTime}
            onChange={(e) => audioEngine.seek(Number(e.target.value))}
            className="flex-1 h-2 bg-[#2d2d2d] rounded appearance-none cursor-pointer accent-blue-500"
          />

          {/* Time - Total Duration */}
          <span className="text-xs font-mono font-bold text-[#858585] w-10 sm:w-12 flex-shrink-0">
            {formatTime(state.duration)}
          </span>
        </div>

        {/* Row 2 (Mobile) / Right (Desktop): Key Shift & Vocal Balance Pods */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end flex-shrink-0">
          
          {/* Key Shift (Half Steps) */}
          <div className="flex-1 md:flex-initial flex items-center gap-2 bg-[#141414] px-2.5 py-1.5 rounded-lg border border-[#2d2d2d]">
            <Music2 size={14} className={state.pitch === 0 ? 'text-[#858585]' : 'text-blue-400'} />
            <div className="flex-1 flex flex-col">
              <div className="flex justify-between text-[10px] text-[#858585] font-mono uppercase font-semibold gap-1">
                <span>KEY</span>
                <span className={state.pitch !== 0 ? 'text-blue-400 font-bold' : 'text-[#858585]'}>
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
                className="w-full md:w-20 h-1.5 bg-[#2d2d2d] rounded appearance-none cursor-pointer accent-blue-500"
              />
            </div>
          </div>

          {/* Vocal Balance Slider (Karaoke vs Original Stems) */}
          <div className="flex-1 md:flex-initial flex items-center gap-2 bg-[#141414] px-2.5 py-1.5 rounded-lg border border-[#2d2d2d]">
            <Mic size={14} className={state.vocalBalance === 0 ? 'text-emerald-400' : 'text-blue-400'} />
            <div className="flex-1 flex flex-col">
              <div className="flex justify-between text-[10px] text-[#858585] font-mono uppercase font-semibold gap-1">
                <span>VOCAL MIX</span>
                <span className={state.vocalBalance === 0 ? 'text-emerald-400 font-bold' : 'text-[#cccccc]'}>
                  {state.vocalBalance === 0 ? 'KARAOKE' : `${state.vocalBalance}%`}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={state.vocalBalance}
                onChange={(e) => audioEngine.setVocalBalance(Number(e.target.value))}
                className="w-full md:w-24 h-1.5 bg-[#2d2d2d] rounded appearance-none cursor-pointer accent-blue-500"
              />
            </div>
          </div>

          {/* Speed / WSOLA Time-Stretching (Visible on desktop/wide screens) */}
          <div className="hidden lg:flex items-center gap-2 bg-[#141414] px-2.5 py-1.5 rounded-lg border border-[#2d2d2d]">
            <Gauge size={14} className="text-amber-400" />
            <div className="flex flex-col">
              <div className="flex justify-between text-[10px] text-[#858585] font-mono uppercase font-semibold gap-1">
                <span>TEMPO</span>
                <span className="text-amber-400 font-bold">{state.speed.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.05}
                value={state.speed}
                onChange={(e) => audioEngine.setSpeed(Number(e.target.value))}
                className="w-16 h-1.5 bg-[#2d2d2d] rounded appearance-none cursor-pointer accent-amber-500"
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
