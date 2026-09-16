import React, { useEffect, useRef, useState, useMemo } from 'react';
import { LyricResult, SongMetadata } from '../../types';
import { Music, Disc, Music2, RotateCcw, Minus, Plus } from 'lucide-react';
import { audioEngine } from '../../audio/WasmAudioEngine';

interface Props {
  lyrics: LyricResult | null;
  currentTime: number;
  currentSong: SongMetadata | null;
  pitch: number;
  onSelectSongModal: () => void;
  onSeek?: (timeSeconds: number) => void;
  onOpenLyricEditor?: () => void;
}

export function syllabifyWord(word: string): string[] {
  const clean = word.trim();
  if (!clean) return [word];
  const match = clean.match(/^([^\w]*)(.*?)([^\w]*)$/);
  const lead = match ? match[1] : '';
  const core = match ? match[2] : clean;
  const trail = match ? match[3] : '';

  if (core.length <= 3) return [word];

  const vowels = 'aeiouyAEIOUY';
  let count = 0;
  let inVowel = false;
  for (let i = 0; i < core.length; i++) {
    const isV = vowels.includes(core[i]);
    if (isV && !inVowel) { count++; inVowel = true; }
    else if (!isV) { inVowel = false; }
  }
  if (core.endsWith('e') && !core.endsWith('ee') && !core.endsWith('le') && count > 1) count--;
  if (count <= 1) return [word];

  const regex = /([^aeiouy]*[aeiouy]+(?:[^aeiouy]+(?=[^aeiouy][aeiouy]))?)/gi;
  const matches = core.match(regex);
  if (matches && matches.join('') === core) {
    matches[0] = lead + matches[0];
    matches[matches.length - 1] += trail;
    return matches;
  }

  const chunks: string[] = [];
  let lastIdx = 0;
  let vCount = 0;
  for (let i = 0; i < core.length; i++) {
    if (vowels.includes(core[i]) && (i === 0 || !vowels.includes(core[i-1]))) {
      vCount++;
      if (vCount > 1 && i > 1) {
        const splitAt = (i - lastIdx > 2) ? i - 1 : i;
        chunks.push(core.slice(lastIdx, splitAt));
        lastIdx = splitAt;
      }
    }
  }
  chunks.push(core.slice(lastIdx));
  chunks[0] = lead + chunks[0];
  chunks[chunks.length - 1] += trail;
  return chunks;
}

export const LyricStage: React.FC<Props> = ({
  lyrics,
  currentTime,
  currentSong,
  pitch,
  onSelectSongModal,
  onSeek,
  onOpenLyricEditor,
}) => {
  const stageViewportRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const ballRef = useRef<HTMLDivElement>(null);

  // Maps for persistent, stable DOM element references
  const sylEls = useRef<Map<string, HTMLSpanElement>>(new Map());
  const sylPipEls = useRef<Map<string, HTMLSpanElement>>(new Map());
  const lineEls = useRef<Map<number, HTMLDivElement>>(new Map());

  const isUserScrolling = useRef(false);
  const [activeLineIndex, setActiveLineIndex] = useState<number>(0);
  const activeLineRef = useRef<number>(0);
  const userScrollTimeout = useRef<any>(null);

  // 1. SPLIT RAW SEGMENTS INTO STRICT MUSICAL LINES / BARS
  const segments = useMemo(() => {
    const rawSegments = lyrics?.segments || [];
    if (rawSegments.length === 0) return [];

    const splitBars: typeof rawSegments = [];
    let lastVocalEnd = 0.0;

    for (let i = 0; i < rawSegments.length; i++) {
      const seg = rawSegments[i];
      const words = seg.words || [];

      const lineVocalStart = words.length > 0 ? words[0].start : seg.start;
      let lineVocalEnd = words.length > 0 ? words[words.length - 1].end : seg.end;
      if (words.length <= 2 && (lineVocalEnd - lineVocalStart) > 2.0) {
        lineVocalEnd = Math.round((lineVocalStart + Math.min(1.2, words.length * 0.5)) * 100) / 100;
      }

      if (seg.text === '[INSTRUMENTAL]') {
        splitBars.push(seg);
        lastVocalEnd = seg.end;
        continue;
      }

      // Insert [INSTRUMENTAL] only if there is an extended musical break (gap >= 7.0 seconds)
      if (lineVocalStart - lastVocalEnd >= 7.0) {
        const instStart = Math.round(lastVocalEnd * 100) / 100;
        const instEnd = Math.round(lineVocalStart * 100) / 100;
        splitBars.push({
          start: instStart,
          end: instEnd,
          text: '[INSTRUMENTAL]',
          words: [{
            text: '[INSTRUMENTAL]',
            start: instStart,
            end: instEnd,
            probability: 1.0,
            isMarker: true,
          }],
        });
      }

      splitBars.push({
        ...seg,
        start: lineVocalStart,
        end: lineVocalEnd,
        words: words,
      });
      lastVocalEnd = lineVocalEnd;
    }

    return splitBars;
  }, [lyrics]);

  // 2. Build flat, ordered syllable target timeline for the entire song
  interface SyllableTarget {
    lineIdx: number;
    wordIdx: number;
    sylIdx: number;
    totalSyls: number;
    text: string;
    start: number;
    end: number;
  }

  const allTargets = useMemo(() => {
    const targets: SyllableTarget[] = [];
    segments.forEach((seg, sIdx) => {
      if (seg.text === '[INSTRUMENTAL]' || !seg.words) return;
      seg.words.forEach((w, wIdx) => {
        const syls = (w.syllables && w.syllables.length > 0) ? w.syllables.map(s => s.text) : syllabifyWord(w.text);
        const numSyls = syls.length;
        const wDur = Math.max(0.12, w.end - w.start);
        for (let s = 0; s < numSyls; s++) {
          targets.push({
            lineIdx: sIdx,
            wordIdx: wIdx,
            sylIdx: s,
            totalSyls: numSyls,
            text: syls[s],
            start: w.syllables?.[s]?.start ?? (w.start + (wDur / numSyls) * s),
            end: w.syllables?.[s]?.end ?? (w.start + (wDur / numSyls) * (s + 1)),
          });
        }
      });
    });
    return targets;
  }, [segments]);

  // Handle user manual scroll
  const handleUserScroll = () => {
    isUserScrolling.current = true;
    if (userScrollTimeout.current) clearTimeout(userScrollTimeout.current);
    userScrollTimeout.current = setTimeout(() => {
      isUserScrolling.current = false;
    }, 2500);
  };

  // HIGH-PRECISION 60FPS / 120FPS REQUESTANIMATIONFRAME CONTINUOUS VIEWPORT BALL & LYRIC ENGINE
  useEffect(() => {
    let animId: number;

    const tick = () => {
      const ballEl = ballRef.current;
      const viewportEl = stageViewportRef.current;
      const containerEl = containerRef.current;

      if (!ballEl || !viewportEl || !containerEl) {
        animId = requestAnimationFrame(tick);
        return;
      }

      const time = audioEngine.getCurrentTime();
      const vRect = viewportEl.getBoundingClientRect();

      // 1. SYNC ACTIVE LINE WITH AUDIO TIME (SEGMENT-ANCHORED)
      let currentLineIdx = -1;

      // Check if time is directly inside any segment [start, end)
      for (let s = 0; s < segments.length; s++) {
        if (time >= segments[s].start && time < segments[s].end) {
          currentLineIdx = s;
          break;
        }
      }

      // If time falls in an inter-segment gap or before/after the track
      if (currentLineIdx === -1 && segments.length > 0) {
        if (time < segments[0].start) {
          currentLineIdx = 0;
        } else if (time >= segments[segments.length - 1].end) {
          currentLineIdx = segments.length - 1;
        } else {
          for (let s = 0; s < segments.length - 1; s++) {
            if (time >= segments[s].end && time < segments[s + 1].start) {
              // In the gap between segments[s] and segments[s + 1]
              if (segments[s].text === '[INSTRUMENTAL]') {
                // If instrumental just ended, immediately activate the upcoming vocal line
                currentLineIdx = s + 1;
              } else {
                const timeSincePrev = time - segments[s].end;
                const timeToNext = segments[s + 1].start - time;
                // Transition forward if within 2s of upcoming line or after brief 0.4s phrase ringout
                if (timeToNext <= 2.0 || timeSincePrev > 0.4) {
                  currentLineIdx = s + 1;
                } else {
                  currentLineIdx = s;
                }
              }
              break;
            }
          }
        }
      }

      if (currentLineIdx === -1) {
        currentLineIdx = 0;
      }

      const lineIdx = currentLineIdx;

      if (lineIdx !== activeLineRef.current) {
        activeLineRef.current = lineIdx;
        setActiveLineIndex(lineIdx);
      }

      // 2. VIEWPORT-RELATIVE AUTO-SCROLL (CENTERS ACTIVE LINE)
      if (!isUserScrolling.current) {
        const targetLineEl = lineEls.current.get(lineIdx);
        if (targetLineEl) {
          const elRect = targetLineEl.getBoundingClientRect();
          const containerRect = containerEl.getBoundingClientRect();
          const elCenter = elRect.top + elRect.height / 2;
          const containerCenter = containerRect.top + containerRect.height / 2;
          const diff = elCenter - containerCenter;

          if (Math.abs(diff) > 300) {
            containerEl.scrollTop += diff;
          } else if (Math.abs(diff) > 0.6) {
            containerEl.scrollTop += diff * 0.14;
          }
        }
      }

      // 3. REAL-TIME SYLLABLE HIGHLIGHTING & INDICATOR PIPS
      allTargets.forEach((target) => {
        const sylKey = `${target.lineIdx}_${target.wordIdx}_${target.sylIdx}`;
        const el = sylEls.current.get(sylKey);
        const pip = sylPipEls.current.get(sylKey);
        if (!el) return;

        const isLineCurrent = target.lineIdx === lineIdx;
        const isSylActive = time >= target.start && time < target.end;
        const isSylDone = time >= target.end;

        if (isSylActive) {
          el.style.color = '#f472b6';
          el.style.textShadow = '0 0 16px rgba(244,114,182,0.9), 0 0 32px rgba(236,72,153,0.6)';
          if (pip) {
            pip.style.backgroundColor = '#f472b6';
            pip.style.boxShadow = '0 0 10px #f472b6, 0 0 20px #ec4899';
            pip.style.transform = 'scale(1.5)';
            pip.style.opacity = '1';
          }
        } else if (isSylDone && isLineCurrent) {
          el.style.color = '#67e8f9';
          el.style.textShadow = 'none';
          if (pip) {
            pip.style.backgroundColor = '#22d3ee';
            pip.style.boxShadow = '0 0 6px #06b6d4';
            pip.style.transform = 'scale(1)';
            pip.style.opacity = '0.85';
          }
        } else if (isSylDone) {
          el.style.color = '#64748b';
          el.style.textShadow = 'none';
          if (pip) {
            pip.style.backgroundColor = '#475569';
            pip.style.boxShadow = 'none';
            pip.style.transform = 'scale(0.8)';
            pip.style.opacity = '0.3';
          }
        } else {
          el.style.color = isLineCurrent ? '#ffffff' : '#94a3b8';
          el.style.textShadow = 'none';
          if (pip) {
            pip.style.backgroundColor = isLineCurrent ? '#94a3b8' : '#334155';
            pip.style.boxShadow = isLineCurrent ? '0 0 4px rgba(148,163,184,0.4)' : 'none';
            pip.style.transform = 'scale(1)';
            pip.style.opacity = isLineCurrent ? '0.75' : '0.25';
          }
        }
      });

      // 4. COORDINATE RESOLVER FOR ANY SYLLABLE TARGET
      const getTargetCoords = (target: SyllableTarget) => {
        const el = sylEls.current.get(`${target.lineIdx}_${target.wordIdx}_${target.sylIdx}`);
        if (!el) return null;
        const sRect = el.getBoundingClientRect();
        const x = (sRect.left - vRect.left) + sRect.width / 2;
        const y = (sRect.top - vRect.top) - 14;
        return { x, y };
      };

      // 5. UNIFIED BOUNCY BALL PHYSICS ENGINE
      if (allTargets.length === 0) {
        ballEl.style.opacity = '0';
        animId = requestAnimationFrame(tick);
        return;
      }

      let currentX = -100;
      let currentY = -100;
      let scaleX = 1;
      let scaleY = 1;
      let opacity = 0;

      let curIdx = -1;
      for (let i = 0; i < allTargets.length; i++) {
        const nextStart = i < allTargets.length - 1 ? allTargets[i + 1].start : Infinity;
        if (time >= allTargets[i].start && time < nextStart) {
          curIdx = i;
          break;
        }
      }

      // CASE A: BEFORE THE VERY FIRST VOCAL OF THE SONG (Intro Lead-In)
      if (curIdx === -1 && time < allTargets[0].start) {
        const firstTarget = allTargets[0];
        const firstCoords = getTargetCoords(firstTarget);
        const introLeadTime = 0.65;

        if (firstCoords && time >= firstTarget.start - introLeadTime) {
          const p = (time - (firstTarget.start - introLeadTime)) / introLeadTime;
          const launchX = firstCoords.x - 55;
          const launchY = firstCoords.y;
          const arcH = 40;

          currentX = launchX + (firstCoords.x - launchX) * p;
          currentY = launchY + (firstCoords.y - launchY) * p - 4 * arcH * p * (1 - p);

          if (p < 0.20) {
            opacity = p / 0.20;
          } else {
            opacity = 1;
          }

          if (p >= 0.88) {
            scaleX = 1.25;
            scaleY = 0.75;
          } else if (p >= 0.15) {
            scaleX = 0.88;
            scaleY = 1.15;
          }
        } else {
          opacity = 0;
        }
      }
      // CASE B: ACTIVE SINGING TARGET
      else if (curIdx !== -1) {
        const curTarget = allTargets[curIdx];
        const curCoords = getTargetCoords(curTarget);

        if (curCoords) {
          if (curIdx < allTargets.length - 1) {
            const nextTarget = allTargets[curIdx + 1];
            const nextCoords = getTargetCoords(nextTarget);

            const isSameLine = curTarget.lineIdx === nextTarget.lineIdx;
            const deltaT = nextTarget.start - curTarget.start;
            const gap = nextTarget.start - curTarget.end;

            if (gap > 1.8) {
              if (time <= curTarget.end + 0.35) {
                currentX = curCoords.x;
                currentY = curCoords.y;
                opacity = 1;
              } else if (time < nextTarget.start - 0.65) {
                const fadeProgress = (time - (curTarget.end + 0.35)) / 0.30;
                currentX = curCoords.x;
                currentY = curCoords.y;
                opacity = Math.max(0, 1 - fadeProgress);
              } else {
                if (nextCoords) {
                  const p = (time - (nextTarget.start - 0.65)) / 0.65;
                  const launchX = nextCoords.x - 55;
                  const launchY = nextCoords.y;
                  const arcH = 40;

                  currentX = launchX + (nextCoords.x - launchX) * p;
                  currentY = launchY + (nextCoords.y - launchY) * p - 4 * arcH * p * (1 - p);
                  opacity = p < 0.25 ? p / 0.25 : 1;

                  if (p >= 0.88) {
                    scaleX = 1.25;
                    scaleY = 0.75;
                  } else if (p >= 0.15) {
                    scaleX = 0.88;
                    scaleY = 1.15;
                  }
                } else {
                  opacity = 0;
                }
              }
            } else if (!isSameLine) {
              if (nextCoords) {
                const transitionDur = Math.min(0.70, deltaT);
                const jumpStart = nextTarget.start - transitionDur;

                if (time < jumpStart) {
                  currentX = curCoords.x;
                  currentY = curCoords.y;
                  opacity = 1;
                } else {
                  const p = Math.min(1, Math.max(0, (time - jumpStart) / transitionDur));
                  const arcHeight = Math.max(50, Math.abs(nextCoords.y - curCoords.y) * 0.4 + 40);

                  currentX = curCoords.x + (nextCoords.x - curCoords.x) * p;
                  currentY = curCoords.y + (nextCoords.y - curCoords.y) * p - 4 * arcHeight * p * (1 - p);
                  opacity = 1;

                  if (p >= 0.88) {
                    scaleX = 1.25;
                    scaleY = 0.75;
                  } else if (p >= 0.15) {
                    scaleX = 0.88;
                    scaleY = 1.15;
                  }
                }
              } else {
                currentX = curCoords.x;
                currentY = curCoords.y;
                opacity = 1;
              }
            } else {
              if (nextCoords) {
                const p = Math.min(1, Math.max(0, (time - curTarget.start) / deltaT));
                const arcH = Math.min(45, Math.max(18, Math.abs(nextCoords.x - curCoords.x) * 0.40));

                currentX = curCoords.x + (nextCoords.x - curCoords.x) * p;
                currentY = curCoords.y + (nextCoords.y - curCoords.y) * p - 4 * arcH * p * (1 - p);
                opacity = 1;

                if (p <= 0.18) {
                  scaleX = 1.25;
                  scaleY = 0.75;
                } else if (p >= 0.85) {
                  scaleX = 1.25;
                  scaleY = 0.75;
                } else {
                  scaleX = 0.88;
                  scaleY = 1.15;
                }
              } else {
                currentX = curCoords.x;
                currentY = curCoords.y;
                opacity = 1;
              }
            }
          } else {
            currentX = curCoords.x;
            currentY = curCoords.y;
            opacity = time <= curTarget.end + 0.5 ? 1 : Math.max(0, 1 - (time - (curTarget.end + 0.5)) / 0.5);
          }
        }
      }

      ballEl.style.transform = `translate3d(${currentX}px, ${currentY}px, 0) scale(${scaleX}, ${scaleY})`;
      ballEl.style.opacity = `${opacity}`;

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [segments, allTargets]);

  if (!currentSong) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[450px]">
        <div className="w-20 h-20 rounded-2xl bg-fuchsia-950/40 border border-fuchsia-800/40 flex items-center justify-center text-fuchsia-400 mb-4 shadow-xl shadow-fuchsia-950/50 animate-pulse">
          <Disc size={40} />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2 font-['Outfit']">No Song Selected</h2>
        <p className="text-slate-400 max-w-md mb-6">
          Upload a pristine 24-bit FLAC audio file or select a track from your library to start the karaoke stage.
        </p>
        <button
          onClick={onSelectSongModal}
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-fuchsia-600 to-indigo-600 hover:from-fuchsia-500 hover:to-indigo-500 text-white font-semibold shadow-lg shadow-fuchsia-600/30 transition active:scale-95 cursor-pointer"
        >
          Browse Library / Upload FLAC
        </button>
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[450px]">
        <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-cyan-400 mb-4 animate-bounce">
          <Music size={32} />
        </div>
        <h3 className="text-xl font-bold text-white mb-1">Playing: {currentSong.title}</h3>
        <p className="text-slate-400 text-sm">{currentSong.artist}</p>
        <p className="text-slate-500 text-xs mt-4">
          Lyrics not yet transcribed. Click "Lyrics" in the Library tab to generate word-synced lyrics with Faster-Whisper.
        </p>
      </div>
    );
  }

  const formatPitchLabel = (p: number) => {
    if (p === 0) return '• Original Key';
    if (p > 0) return `+${p} Half Step${p > 1 ? 's' : ''}`;
    return `${p} Half Step${Math.abs(p) > 1 ? 's' : ''}`;
  };

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 relative overflow-hidden">
      
      {/* Stage Key Shift Toolbar */}
      <div className="flex items-center justify-between px-6 py-2.5 bg-slate-950/60 backdrop-blur-md rounded-2xl border border-slate-800/80 mb-2 flex-wrap gap-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Music2 size={16} className="text-fuchsia-400" />
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Key Control:</span>
          <span className={`text-xs font-mono font-bold px-2.5 py-0.5 rounded-full border ${
            pitch === 0 
              ? 'bg-slate-900 text-slate-300 border-slate-700' 
              : pitch > 0 
              ? 'bg-fuchsia-950 text-fuchsia-300 border-fuchsia-800' 
              : 'bg-cyan-950 text-cyan-300 border-cyan-800'
          }`}>
            {formatPitchLabel(pitch)}
          </span>
        </div>

        {/* Half-Step Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => audioEngine.setPitch(pitch - 1)}
            disabled={pitch <= -6}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 disabled:opacity-40 transition cursor-pointer"
            title="Lower 1 Half Step"
          >
            <Minus size={14} />
          </button>

          <input
            type="range"
            min={-6}
            max={6}
            step={1}
            value={pitch}
            onChange={(e) => audioEngine.setPitch(Number(e.target.value))}
            className="w-28 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-fuchsia-400"
          />

          <button
            onClick={() => audioEngine.setPitch(pitch + 1)}
            disabled={pitch >= 6}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 disabled:opacity-40 transition cursor-pointer"
            title="Raise 1 Half Step"
          >
            <Plus size={14} />
          </button>

          {pitch !== 0 && (
            <button
              onClick={() => audioEngine.setPitch(0)}
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 text-[11px] font-semibold flex items-center gap-1 transition ml-1 cursor-pointer"
              title="Reset to Original Key"
            >
              <RotateCcw size={12} /> Reset
            </button>
          )}
        </div>

        {/* Edit Lyrics Action */}
        {lyrics && onOpenLyricEditor && (
          <button
            onClick={onOpenLyricEditor}
            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm hover:border-slate-700"
            title="Fine-tune syllable timings & transient alignment"
          >
            <span>✨</span> Edit Lyrics & Waveform
          </button>
        )}
      </div>

      {/* Main Karaoke Viewport */}
      <div
        ref={stageViewportRef}
        className="flex-1 w-full max-w-4xl mx-auto min-h-0 relative overflow-hidden flex flex-col"
      >
        {/* Single Persistent Floating Bouncing Ball */}
        <div
          ref={ballRef}
          className="absolute top-0 left-0 pointer-events-none z-30 will-change-transform"
          style={{ transform: 'translate3d(-100px, -100px, 0)' }}
        >
          <div className="w-6 h-6 -ml-3 -mt-3 rounded-full bg-white shadow-[0_0_15px_#38bdf8,0_0_30px_#ec4899] border-2 border-cyan-300 ring-2 ring-fuchsia-500/80" />
        </div>

        {/* Scrolling Lyrics Container */}
        <div
          ref={containerRef}
          onWheel={handleUserScroll}
          onTouchMove={handleUserScroll}
          style={{
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
            paddingTop: '32vh',
            paddingBottom: '48vh',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
          }}
          className="flex-1 w-full h-full min-h-0 overflow-y-auto relative px-4 md:px-8 scrollbar-none"
        >
          <div className="flex flex-col items-center space-y-7 text-center">
            {segments.map((segment, sIdx) => {
              const isActive = sIdx === activeLineIndex;
              const isPast = currentTime > segment.end;
              const isInstrumental = segment.text === '[INSTRUMENTAL]';

              if (isInstrumental) {
                return (
                  <div
                    key={sIdx}
                    ref={(el) => {
                      if (el) lineEls.current.set(sIdx, el);
                      else lineEls.current.delete(sIdx);
                    }}
                    onClick={() => onSeek && onSeek(segment.start)}
                    className={`py-3 transition-opacity duration-300 cursor-pointer ${
                      isActive ? 'opacity-100' : 'opacity-25 hover:opacity-60'
                    }`}
                  >
                    <span className="inline-block px-6 py-2 rounded-2xl bg-cyan-950/40 border border-cyan-400/30 text-cyan-300 text-lg md:text-xl font-bold tracking-widest uppercase shadow-lg shadow-cyan-950/40">
                      [INSTRUMENTAL]
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={sIdx}
                  ref={(el) => {
                    if (el) lineEls.current.set(sIdx, el);
                    else lineEls.current.delete(sIdx);
                  }}
                  onClick={() => onSeek && onSeek(segment.start)}
                  className={`py-3.5 px-6 rounded-2xl relative inline-block max-w-full text-center font-['Outfit'] cursor-pointer select-none transition-all duration-300 text-2xl md:text-3xl font-bold ${
                    isActive
                      ? 'text-white opacity-100 bg-fuchsia-950/25 border border-fuchsia-500/20 shadow-[0_0_35px_rgba(236,72,153,0.18)]'
                      : isPast
                      ? 'text-slate-500 opacity-25 hover:opacity-50 border border-transparent'
                      : 'text-slate-400 opacity-30 hover:opacity-60 border border-transparent'
                  }`}
                >
                  {/* Word Spans with Syllables and Syllable Rhythm Indicators */}
                  {segment.words.map((w, wIdx) => {
                    const syls = (w.syllables && w.syllables.length > 0) ? w.syllables.map(s => s.text) : syllabifyWord(w.text);
                    return (
                      <span key={wIdx} className="inline-inline-flex mx-1.5 relative whitespace-nowrap align-bottom">
                        {syls.map((sylText, s) => {
                          const sylKey = `${sIdx}_${wIdx}_${s}`;
                          return (
                            <span
                              key={s}
                              ref={(el) => {
                                if (el) sylEls.current.set(sylKey, el);
                                else sylEls.current.delete(sylKey);
                              }}
                              className="inline-flex flex-col items-center relative will-change-transform font-bold px-0.5"
                            >
                              <span>{sylText}</span>
                              {/* Rhythmic syllable hit-indicator target pip */}
                              <span
                                ref={(el) => {
                                  if (el) sylPipEls.current.set(sylKey, el);
                                  else sylPipEls.current.delete(sylKey);
                                }}
                                data-syl-pip={sylKey}
                                className="w-1.5 h-1.5 rounded-full mt-1.5 transition-all duration-150 bg-slate-700/60 pointer-events-none"
                              />
                            </span>
                          );
                        })}
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
