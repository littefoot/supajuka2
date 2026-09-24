import React, { useEffect, useRef, useState, useMemo } from 'react';
import { LyricResult, SongMetadata } from '../../types';
import { Music, Disc, Music2, RotateCcw, Minus, Plus, Sparkles, Circle, CircleDot } from 'lucide-react';
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
  const dotLeftRef = useRef<HTMLSpanElement>(null);
  const dotRightRef = useRef<HTMLSpanElement>(null);
  const dotDynamicsRef = useRef({
    currentScale: 0.85,
    runningAverage: 0.20,
    runningPeak: 0.45,
    prevEnergy: 0,
  });

  const isUserScrolling = useRef(false);
  const [activeLineIndex, setActiveLineIndex] = useState<number>(0);
  const activeLineRef = useRef<number>(0);
  const userScrollTimeout = useRef<any>(null);

  // User Visual Stage Preferences with LocalStorage persistence (default OFF)
  const [showColorHighlights, setShowColorHighlights] = useState<boolean>(() => {
    const saved = localStorage.getItem('supajuka_stage_show_highlights');
    return saved !== null ? saved === 'true' : false;
  });
  const [showBouncingBall, setShowBouncingBall] = useState<boolean>(() => {
    const saved = localStorage.getItem('supajuka_stage_show_ball');
    return saved !== null ? saved === 'true' : false;
  });
  const [showSyllableDots, setShowSyllableDots] = useState<boolean>(() => {
    const saved = localStorage.getItem('supajuka_stage_show_dots');
    return saved !== null ? saved === 'true' : false;
  });

  // Ensure clean OFF default for existing sessions
  useEffect(() => {
    if (!localStorage.getItem('supajuka_stage_defaults_off_v1')) {
      localStorage.setItem('supajuka_stage_defaults_off_v1', 'true');
      localStorage.setItem('supajuka_stage_show_highlights', 'false');
      localStorage.setItem('supajuka_stage_show_ball', 'false');
      localStorage.setItem('supajuka_stage_show_dots', 'false');
      setShowColorHighlights(false);
      setShowBouncingBall(false);
      setShowSyllableDots(false);
    }
  }, []);

  const showColorHighlightsRef = useRef(showColorHighlights);
  const showBouncingBallRef = useRef(showBouncingBall);
  const showSyllableDotsRef = useRef(showSyllableDots);

  useEffect(() => {
    showColorHighlightsRef.current = showColorHighlights;
    localStorage.setItem('supajuka_stage_show_highlights', String(showColorHighlights));
  }, [showColorHighlights]);

  useEffect(() => {
    showBouncingBallRef.current = showBouncingBall;
    localStorage.setItem('supajuka_stage_show_ball', String(showBouncingBall));
  }, [showBouncingBall]);

  useEffect(() => {
    showSyllableDotsRef.current = showSyllableDots;
    localStorage.setItem('supajuka_stage_show_dots', String(showSyllableDots));
  }, [showSyllableDots]);

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

  // Next upcoming vocal line index (rendered in high-contrast white, not gray)
  const nextVocalLineIndex = useMemo(() => {
    for (let i = activeLineIndex + 1; i < segments.length; i++) {
      if (segments[i].text !== '[INSTRUMENTAL]') {
        return i;
      }
    }
    return -1;
  }, [segments, activeLineIndex]);

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

      // 1. SYNC ACTIVE LINE WITH AUDIO TIME (HANDLING BOTH VOCAL LINES & INSTRUMENTAL BREAKS)
      let currentLineIdx = -1;

      // Check if current time falls directly within any segment (vocal or instrumental)
      for (let s = 0; s < segments.length; s++) {
        const seg = segments[s];
        if (time >= seg.start && time < seg.end) {
          if (seg.text === '[INSTRUMENTAL]') {
            // Find upcoming vocal segment for cue lead-in
            let nextVocalIdx = -1;
            for (let nv = s + 1; nv < segments.length; nv++) {
              if (segments[nv].text !== '[INSTRUMENTAL]' && segments[nv].words?.length > 0) {
                nextVocalIdx = nv;
                break;
              }
            }

            // Lead-in duration before vocal starts (1.8s) so singer has time to read ahead
            const leadIn = Math.min(1.8, Math.max(0.5, (seg.end - seg.start) * 0.25));
            if (time < seg.end - leadIn || nextVocalIdx === -1) {
              currentLineIdx = s; // Instrumental is active and focused!
            } else {
              currentLineIdx = nextVocalIdx; // Focus shifts to upcoming vocal line right before singing begins
            }
          } else {
            currentLineIdx = s;
          }
          break;
        }
      }

      // If time falls in an inter-segment gap or before/after all segments
      if (currentLineIdx === -1) {
        if (segments.length > 0) {
          if (time < segments[0].start) {
            currentLineIdx = 0;
          } else if (time >= segments[segments.length - 1].end) {
            currentLineIdx = segments.length - 1;
          } else {
            for (let s = 0; s < segments.length - 1; s++) {
              if (time >= segments[s].end && time < segments[s + 1].start) {
                const timeSincePrev = time - segments[s].end;
                const timeToNext = segments[s + 1].start - time;
                if (timeSincePrev >= 0.35 || timeToNext <= 2.5) {
                  currentLineIdx = s + 1;
                } else {
                  currentLineIdx = s;
                }
                break;
              }
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
      let nextVocalIdx = -1;
      for (let s = lineIdx + 1; s < segments.length; s++) {
        if (segments[s].text !== '[INSTRUMENTAL]') {
          nextVocalIdx = s;
          break;
        }
      }

      allTargets.forEach((target) => {
        const sylKey = `${target.lineIdx}_${target.wordIdx}_${target.sylIdx}`;
        const el = sylEls.current.get(sylKey);
        const pip = sylPipEls.current.get(sylKey);
        if (!el) return;

        const isLinePast = target.lineIdx < lineIdx;
        const isLineCurrent = target.lineIdx === lineIdx;
        const isNextVocal = target.lineIdx === nextVocalIdx;
        const isSylActive = isLineCurrent && time >= target.start && time < target.end;
        const isSylDone = isLineCurrent && time >= target.end;

        if (!showColorHighlightsRef.current) {
          // Clean typography mode (no color-wipe shifting)
          if (isLineCurrent) {
            el.style.color = '#ffffff';
            el.style.textShadow = '0 1px 3px rgba(0,0,0,0.9)';
          } else if (isNextVocal) {
            el.style.color = '#cbd5e1';
            el.style.textShadow = 'none';
          } else {
            el.style.color = '#555555';
            el.style.textShadow = 'none';
          }
        } else {
          // Color-wipe singing mode
          if (isSylActive) {
            // Actively being sung in CURRENT line: vivid glowing amber with halo
            el.style.color = '#fbbf24';
            el.style.textShadow = '0 2px 14px rgba(251,191,36,0.55), 0 0 28px rgba(245,158,11,0.35)';
          } else if (isSylDone) {
            // Already sung words in the active line REMAIN the highlight color!
            el.style.color = '#fbbf24';
            el.style.textShadow = '0 1px 6px rgba(245,158,11,0.4), 0 0 14px rgba(251,191,36,0.2)';
          } else if (isLinePast) {
            // Line has finished and scrolled into past
            el.style.color = '#555555';
            el.style.textShadow = 'none';
          } else if (isLineCurrent) {
            // Unsung syllables in the active line
            el.style.color = '#cbd5e1';
            el.style.textShadow = 'none';
          } else if (isNextVocal) {
            // Next line coming up: crisp white for singer readability (NEVER amber or dimmed)
            el.style.color = '#ffffff';
            el.style.textShadow = '0 1px 4px rgba(0,0,0,0.8)';
          } else {
            // Distant future lines
            el.style.color = '#555555';
            el.style.textShadow = 'none';
          }
        }

        // Syllable rhythm indicator pips
        if (pip) {
          if (!showSyllableDotsRef.current) {
            pip.style.display = 'none';
          } else {
            pip.style.display = 'block';
            if (isSylActive) {
              pip.style.backgroundColor = '#fbbf24';
              pip.style.boxShadow = '0 0 10px #fbbf24, 0 0 16px rgba(245,158,11,0.8)';
              pip.style.transform = 'scale(1.4)';
              pip.style.opacity = '1';
            } else if (isSylDone) {
              pip.style.backgroundColor = '#fbbf24';
              pip.style.boxShadow = '0 0 6px rgba(251,191,36,0.6)';
              pip.style.transform = 'scale(1)';
              pip.style.opacity = '0.9';
            } else if (isLinePast) {
              pip.style.backgroundColor = '#333333';
              pip.style.boxShadow = 'none';
              pip.style.transform = 'scale(0.7)';
              pip.style.opacity = '0.2';
            } else if (isLineCurrent) {
              pip.style.backgroundColor = '#64748b';
              pip.style.boxShadow = 'none';
              pip.style.transform = 'scale(1.1)';
              pip.style.opacity = '0.75';
            } else if (isNextVocal) {
              pip.style.backgroundColor = '#64748b';
              pip.style.boxShadow = 'none';
              pip.style.transform = 'scale(1)';
              pip.style.opacity = '0.5';
            } else {
              pip.style.backgroundColor = '#2d2d2d';
              pip.style.boxShadow = 'none';
              pip.style.transform = 'scale(0.7)';
              pip.style.opacity = '0.2';
            }
          }
        }
      });

      // 3.5. DYNAMIC TRANSIENT & PUNK ROCK OVERDRIVE FOR INSTRUMENTAL BREAK DOTS
      if (dotLeftRef.current || dotRightRef.current) {
        const fft = audioEngine.getState().fftData;
        const dyn = dotDynamicsRef.current;

        if (!fft || fft.length === 0 || !audioEngine.getState().isPlaying) {
          // Idle resting state: calm, stable, non-jittery
          dyn.currentScale = dyn.currentScale * 0.90 + 0.85 * 0.10;
          const idleStyle = `scale(${dyn.currentScale.toFixed(3)})`;
          const idleShadow = `0 0 6px rgba(14, 165, 233, 0.35)`;
          if (dotLeftRef.current) {
            dotLeftRef.current.style.transform = idleStyle;
            dotLeftRef.current.style.boxShadow = idleShadow;
            dotLeftRef.current.style.backgroundColor = '#0284c7';
          }
          if (dotRightRef.current) {
            dotRightRef.current.style.transform = idleStyle;
            dotRightRef.current.style.boxShadow = idleShadow;
            dotRightRef.current.style.backgroundColor = '#0284c7';
          }
        } else {
          // 1. Dual-Band Extraction: Kick/Sub-bass (bins 1-6) + Snare/Guitar Crunch (bins 7-22)
          const bassBins = Math.min(6, fft.length);
          let bassSum = 0;
          for (let i = 1; i < bassBins; i++) {
            bassSum += fft[i] * fft[i];
          }
          const bassEnergy = Math.sqrt(bassSum / Math.max(1, bassBins - 1));

          const midBins = Math.min(22, fft.length);
          let midSum = 0;
          for (let i = 6; i < midBins; i++) {
            midSum += fft[i] * fft[i];
          }
          const midEnergy = Math.sqrt(midSum / Math.max(1, midBins - 6));

          // Full mix energy with heavy kick and snare transient weighting
          const rawEnergy = bassEnergy * 0.65 + midEnergy * 0.35;

          // 2. Adaptive Peak and Dynamic Noise Floor Follower
          // Adapts to track volume so soft intros don't trigger false hits,
          // and wall-of-sound punk rock choruses don't peg at 100% ceiling!
          dyn.runningPeak = Math.max(rawEnergy, dyn.runningPeak * 0.993, 0.28);
          dyn.runningAverage = dyn.runningAverage * 0.96 + rawEnergy * 0.04;

          // Noise gate threshold: eliminates ambient hiss/quiet guitar buzz
          const noiseGate = Math.max(0.05, dyn.runningAverage * 0.40);
          const dynamicHeadroom = Math.max(0.12, dyn.runningPeak - noiseGate);
          let effectiveEnergy = Math.max(0, rawEnergy - noiseGate) / dynamicHeadroom;
          effectiveEnergy = Math.min(1.0, effectiveEnergy);

          // 3. Exponential Response Curve: Suppresses quiet music, explodes on hard hits
          const curvedEnergy = Math.pow(effectiveEnergy, 1.85);

          // 4. Transient Attack Onset: Detects sudden drum strikes / guitar downbeats
          const transientDelta = Math.max(0, rawEnergy - dyn.prevEnergy);
          dyn.prevEnergy = rawEnergy * 0.65 + dyn.prevEnergy * 0.35;
          const transientPunch = Math.min(0.75, transientDelta * 2.5);

          const totalImpact = Math.min(1.0, curvedEnergy * 0.70 + transientPunch * 0.60);

          // 5. Ballistic Attack & Decay (Instant impact on beat, springy snap-back)
          // Scale ranges from 0.80 (calm) to 2.15 (massive punk rock hit)
          const targetScale = 0.80 + totalImpact * 1.35;
          if (targetScale > dyn.currentScale) {
            // Instant attack on kick/snare hit
            dyn.currentScale = targetScale;
          } else {
            // Snappy decay between hits
            dyn.currentScale = dyn.currentScale * 0.82 + targetScale * 0.18;
          }

          // 6. Hard Rock Chorus Flare Visuals:
          // In high-energy choruses (scale > 1.45), dots turn white-hot cyan with expanding double shockwaves
          const isHardHit = dyn.currentScale > 1.45;
          const glowRadius = Math.max(6, (dyn.currentScale - 0.75) * 28);
          const coreColor = isHardHit ? '#e0f2fe' : (dyn.currentScale > 1.15 ? '#38bdf8' : '#0284c7');
          const shadowStr = isHardHit
            ? `0 0 ${glowRadius.toFixed(1)}px rgba(56, 189, 248, 0.95), 0 0 ${(glowRadius * 1.8).toFixed(1)}px rgba(59, 130, 246, 0.75), 0 0 6px #ffffff`
            : `0 0 ${glowRadius.toFixed(1)}px rgba(56, 189, 248, 0.65), 0 0 ${(glowRadius * 1.4).toFixed(1)}px rgba(14, 165, 233, 0.4)`;
          const transformStr = `scale(${dyn.currentScale.toFixed(3)})`;

          if (dotLeftRef.current) {
            dotLeftRef.current.style.transform = transformStr;
            dotLeftRef.current.style.boxShadow = shadowStr;
            dotLeftRef.current.style.backgroundColor = coreColor;
          }
          if (dotRightRef.current) {
            dotRightRef.current.style.transform = transformStr;
            dotRightRef.current.style.boxShadow = shadowStr;
            dotRightRef.current.style.backgroundColor = coreColor;
          }
        }
      }

      // 4. COORDINATE RESOLVER FOR ANY SYLLABLE TARGET
      const getTargetCoords = (target: SyllableTarget) => {
        const el = sylEls.current.get(`${target.lineIdx}_${target.wordIdx}_${target.sylIdx}`);
        if (!el) return null;
        const sRect = el.getBoundingClientRect();
        const x = (sRect.left - vRect.left) + sRect.width / 2;
        const y = (sRect.top - vRect.top) - 16;
        return { x, y };
      };

      // 5. UNIFIED BOUNCY BALL PHYSICS ENGINE
      if (!showBouncingBallRef.current || allTargets.length === 0) {
        ballEl.style.opacity = '0';
        ballEl.style.transform = 'translate3d(-100px, -100px, 0)';
        animId = requestAnimationFrame(tick);
        return;
      }

      let currentX = -100;
      let currentY = -100;
      let scaleX = 1;
      let scaleY = 1;
      let rotation = 0;
      let opacity = 0;

      // CONTINUOUS VERTICAL SQUASH & STRETCH (ZERO SLANT / UPRIGHT ORIENTATION)
      // Smoothly expands and contracts vertically through continuous keyframes:
      // CONTINUOUS VERTICAL SQUASH & STRETCH:
      // 1. Expands vertically ONLY when bouncing up (p: 0 -> 0.45)
      // 2. Stays a clean round circle when coming down (p: 0.45 -> 1.00)
      // 3. Squishes ONLY after touching ground on impact (timeSinceLand: 0 -> 0.20s), then springs back to normal
      const calculateBallFlightPhysics = (
        pVal: number,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        arcH: number
      ) => {
        const clampedP = Math.min(1, Math.max(0, pVal));

        // Parabolic trajectory path
        const x = x1 + (x2 - x1) * clampedP;
        const y = y1 + (y2 - y1) * clampedP - 4 * arcH * clampedP * (1 - clampedP);

        let sY = 1;

        if (clampedP < 0.16) {
          // Bouncing up: expand vertically into upward stretch (1.00 -> 1.24)
          const t = clampedP / 0.16;
          const ease = 0.5 - 0.5 * Math.cos(t * Math.PI);
          sY = 1.00 + (1.24 - 1.00) * ease;
        } else if (clampedP < 0.45) {
          // Reaching apex: smoothly contract back to round circle (1.24 -> 1.00)
          const t = (clampedP - 0.16) / 0.29;
          const ease = 0.5 - 0.5 * Math.cos(t * Math.PI);
          sY = 1.24 + (1.00 - 1.24) * ease;
        } else {
          // Coming down: clean round circle (no expansion on descent, no mid-air squash)
          sY = 1.00;
        }

        // Volume-preserving horizontal scale
        const sX = 1 / sY;

        return { x, y, scaleX: sX, scaleY: sY, rotation: 0 };
      };

      // GROUND CONTACT: Squishes ONLY after touching the ground on impact, then springs back to normal
      const calculateBallRestPhysics = (coords: { x: number; y: number }, timeSinceLand: number) => {
        let sY = 1;

        if (timeSinceLand >= 0 && timeSinceLand < 0.20) {
          // Immediate impact squash (0.74), springs smoothly back to normal circle (1.00)
          const t = timeSinceLand / 0.20;
          const ease = 0.5 - 0.5 * Math.cos(t * Math.PI);
          sY = 0.74 + (1.00 - 0.74) * ease;
        } else {
          // Settled on ground: pure round circle
          sY = 1.00;
        }

        const sX = 1 / sY;

        return {
          x: coords.x,
          y: coords.y,
          scaleX: sX,
          scaleY: sY,
          rotation: 0,
        };
      };

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
          const phys = calculateBallFlightPhysics(p, launchX, launchY, firstCoords.x, firstCoords.y, arcH);
          currentX = phys.x;
          currentY = phys.y;
          scaleX = phys.scaleX;
          scaleY = phys.scaleY;
          rotation = phys.rotation;
          opacity = p < 0.20 ? p / 0.20 : 1;
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
                const rest = calculateBallRestPhysics(curCoords, Math.max(0, time - curTarget.start));
                currentX = rest.x;
                currentY = rest.y;
                scaleX = rest.scaleX;
                scaleY = rest.scaleY;
                rotation = rest.rotation;
                opacity = 1;
              } else if (time < nextTarget.start - 0.65) {
                const fadeProgress = (time - (curTarget.end + 0.35)) / 0.30;
                currentX = curCoords.x;
                currentY = curCoords.y;
                scaleX = 1;
                scaleY = 1;
                rotation = 0;
                opacity = Math.max(0, 1 - fadeProgress);
              } else {
                if (nextCoords) {
                  const p = (time - (nextTarget.start - 0.65)) / 0.65;
                  const launchX = nextCoords.x - 55;
                  const launchY = nextCoords.y;
                  const arcH = 40;
                  const phys = calculateBallFlightPhysics(p, launchX, launchY, nextCoords.x, nextCoords.y, arcH);
                  currentX = phys.x;
                  currentY = phys.y;
                  scaleX = phys.scaleX;
                  scaleY = phys.scaleY;
                  rotation = phys.rotation;
                  opacity = p < 0.25 ? p / 0.25 : 1;
                } else {
                  opacity = 0;
                }
              }
            } else if (!isSameLine) {
              if (nextCoords) {
                const transitionDur = Math.min(0.70, deltaT);
                const jumpStart = nextTarget.start - transitionDur;

                if (time < jumpStart) {
                  const rest = calculateBallRestPhysics(curCoords, Math.max(0, time - curTarget.start));
                  currentX = rest.x;
                  currentY = rest.y;
                  scaleX = rest.scaleX;
                  scaleY = rest.scaleY;
                  rotation = rest.rotation;
                  opacity = 1;
                } else {
                  const p = Math.min(1, Math.max(0, (time - jumpStart) / transitionDur));
                  const arcHeight = Math.max(50, Math.abs(nextCoords.y - curCoords.y) * 0.4 + 40);
                  const phys = calculateBallFlightPhysics(p, curCoords.x, curCoords.y, nextCoords.x, nextCoords.y, arcHeight);
                  currentX = phys.x;
                  currentY = phys.y;
                  scaleX = phys.scaleX;
                  scaleY = phys.scaleY;
                  rotation = phys.rotation;
                  opacity = 1;
                }
              } else {
                const rest = calculateBallRestPhysics(curCoords, Math.max(0, time - curTarget.start));
                currentX = rest.x;
                currentY = rest.y;
                scaleX = rest.scaleX;
                scaleY = rest.scaleY;
                rotation = rest.rotation;
                opacity = 1;
              }
            } else {
              if (nextCoords) {
                const p = Math.min(1, Math.max(0, (time - curTarget.start) / deltaT));
                const arcH = Math.min(45, Math.max(18, Math.abs(nextCoords.x - curCoords.x) * 0.40));
                const phys = calculateBallFlightPhysics(p, curCoords.x, curCoords.y, nextCoords.x, nextCoords.y, arcH);
                currentX = phys.x;
                currentY = phys.y;
                scaleX = phys.scaleX;
                scaleY = phys.scaleY;
                rotation = phys.rotation;
                opacity = 1;
              } else {
                const rest = calculateBallRestPhysics(curCoords, Math.max(0, time - curTarget.start));
                currentX = rest.x;
                currentY = rest.y;
                scaleX = rest.scaleX;
                scaleY = rest.scaleY;
                rotation = rest.rotation;
                opacity = 1;
              }
            }
          } else {
            const rest = calculateBallRestPhysics(curCoords, Math.max(0, time - curTarget.start));
            currentX = rest.x;
            currentY = rest.y;
            scaleX = rest.scaleX;
            scaleY = rest.scaleY;
            rotation = rest.rotation;
            opacity = time <= curTarget.end + 0.5 ? 1 : Math.max(0, 1 - (time - (curTarget.end + 0.5)) / 0.5);
          }
        }
      }

      ballEl.style.transform = `translate3d(${currentX}px, ${currentY}px, 0) scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)})`;
      ballEl.style.opacity = `${opacity}`;

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [segments, allTargets]);

  if (!currentSong) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[450px]">
        <div className="w-16 h-16 rounded-xl bg-[#1e1e1e] border border-[#2d2d2d] flex items-center justify-center text-blue-400 mb-4 shadow-md">
          <Disc size={32} />
        </div>
        <h2 className="text-xl font-bold text-white mb-2 font-mono">NO TRACK LOADED</h2>
        <p className="text-[#858585] text-xs max-w-md mb-6 font-mono">
          Upload a pristine 24-bit FLAC audio file or select a track from your library to begin.
        </p>
        <button
          onClick={onSelectSongModal}
          className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs font-mono shadow-sm transition active:scale-95 cursor-pointer border border-blue-500/40"
        >
          BROWSE LIBRARY / UPLOAD FLAC
        </button>
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[450px]">
        <div className="w-14 h-14 rounded-xl bg-[#1e1e1e] border border-[#2d2d2d] flex items-center justify-center text-blue-400 mb-4">
          <Music size={28} />
        </div>
        <h3 className="text-lg font-bold text-white mb-1 font-mono">{currentSong.title}</h3>
        <p className="text-[#858585] text-xs font-mono">{currentSong.artist}</p>
        <p className="text-[#666666] text-xs mt-4 font-mono">
          Lyrics not yet transcribed. Click "Lyrics" in Library tab to align syllables.
        </p>
      </div>
    );
  }

  const formatPitchLabel = (p: number) => {
    if (p === 0) return '• 0 ST (ORIGINAL)';
    if (p > 0) return `+${p} ST`;
    return `${p} ST`;
  };

  // Dynamic font scaling for active lyrics to keep lines on a single row on mobile
  const getActiveLineFontSize = (text: string) => {
    const len = text.length;
    if (len > 34) return 'text-[13px] xs:text-sm sm:text-2xl md:text-4xl lg:text-5xl';
    if (len > 24) return 'text-[15px] xs:text-base sm:text-3xl md:text-5xl lg:text-6xl';
    if (len > 16) return 'text-base xs:text-xl sm:text-3xl md:text-5xl lg:text-6xl';
    return 'text-lg xs:text-2xl sm:text-3xl md:text-5xl lg:text-6xl';
  };

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 relative overflow-hidden bg-[#181818]">
      
      {/* Stage Key Shift Toolbar - Rugged Studio Rackmount */}
      <div className="flex items-center justify-center md:justify-between px-2.5 sm:px-5 py-1 sm:py-1.5 bg-[#1b1b1b] border-b border-[#2d2d2d] gap-2 flex-shrink-0 shadow-sm overflow-x-auto scrollbar-none">
        
        {/* Left: Key Indicator & Controls (Hidden on mobile) */}
        <div className="hidden md:flex items-center gap-1.5 sm:gap-2.5 flex-shrink-0">
          <Music2 size={14} className="text-blue-400" />
          <span className="text-[10px] sm:text-xs font-mono font-semibold text-[#858585] uppercase tracking-wider hidden xs:inline">KEY:</span>
          <span className={`text-[10px] sm:text-xs font-mono font-bold px-1.5 sm:px-2 py-0.5 rounded border ${
            pitch === 0 
              ? 'bg-[#252526] text-[#cccccc] border-[#333333]' 
              : pitch > 0 
              ? 'bg-[#262118] text-amber-300 border-amber-600/60' 
              : 'bg-[#18222d] text-blue-300 border-blue-600/60'
          }`}>
            {formatPitchLabel(pitch)}
          </span>

          <div className="flex items-center gap-1 sm:gap-2 ml-0.5 sm:ml-1">
            <button
              onClick={() => audioEngine.setPitch(pitch - 1)}
              disabled={pitch <= -6}
              className="p-1 sm:p-1.5 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] border border-[#333333] disabled:opacity-30 transition cursor-pointer"
              title="Lower 1 Half Step"
            >
              <Minus size={11} />
            </button>

            <input
              type="range"
              min={-6}
              max={6}
              step={1}
              value={pitch}
              onChange={(e) => audioEngine.setPitch(Number(e.target.value))}
              className="w-14 sm:w-24 md:w-28 h-1.5 bg-[#2d2d2d] rounded appearance-none cursor-pointer accent-blue-500"
            />

            <button
              onClick={() => audioEngine.setPitch(pitch + 1)}
              disabled={pitch >= 6}
              className="p-1 sm:p-1.5 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] border border-[#333333] disabled:opacity-30 transition cursor-pointer"
              title="Raise 1 Half Step"
            >
              <Plus size={11} />
            </button>

            {pitch !== 0 && (
              <button
                onClick={() => audioEngine.setPitch(0)}
                className="p-1 sm:p-1.5 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#858585] hover:text-white border border-[#333333] text-[10px] sm:text-[11px] font-mono font-semibold flex items-center gap-1 transition ml-0.5 cursor-pointer"
                title="Reset to Original Key"
              >
                <RotateCcw size={10} /> <span className="hidden sm:inline">Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Right: Visual Toggles & Waveform Action */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {/* Visual Display Toggles */}
          <div className="flex items-center bg-[#141414] p-0.5 sm:p-1 rounded-lg border border-[#2d2d2d] shadow-inner gap-0.5 sm:gap-1">
            <span className="text-[9px] sm:text-[10px] font-mono font-bold text-[#666666] uppercase px-1 hidden md:inline">VIEW:</span>

            {/* Toggle 1: Color Wipe */}
            <button
              onClick={() => setShowColorHighlights(prev => !prev)}
              className={`px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded text-[10px] sm:text-xs font-mono font-semibold flex items-center gap-1 sm:gap-1.5 transition cursor-pointer select-none border ${
                showColorHighlights
                  ? 'bg-[#252015] text-amber-300 border-amber-600/60 shadow-[0_0_8px_rgba(245,158,11,0.2)]'
                  : 'bg-[#1e1e1e] text-[#777777] hover:text-[#aaaaaa] border-[#2e2e2e]'
              }`}
              title="Toggle Word Color Wipe (Real-time singing word highlights)"
            >
              <Sparkles size={11} className={showColorHighlights ? 'text-amber-400' : 'text-[#555555]'} />
              <span>Color Wipe</span>
              <span className={`w-1.5 h-1.5 rounded-full ${showColorHighlights ? 'bg-amber-400 shadow-[0_0_5px_#fbbf24]' : 'bg-[#444444]'}`} />
            </button>

            {/* Toggle 2: Bouncing Ball */}
            <button
              onClick={() => setShowBouncingBall(prev => !prev)}
              className={`px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded text-[10px] sm:text-xs font-mono font-semibold flex items-center gap-1 sm:gap-1.5 transition cursor-pointer select-none border ${
                showBouncingBall
                  ? 'bg-[#152230] text-blue-300 border-blue-600/60 shadow-[0_0_8px_rgba(59,130,246,0.2)]'
                  : 'bg-[#1e1e1e] text-[#777777] hover:text-[#aaaaaa] border-[#2e2e2e]'
              }`}
              title="Toggle Bouncing Ball (Floating syllable guide pointer)"
            >
              <Circle size={11} className={showBouncingBall ? 'text-blue-400 fill-blue-400/30' : 'text-[#555555]'} />
              <span>Bouncing Ball</span>
              <span className={`w-1.5 h-1.5 rounded-full ${showBouncingBall ? 'bg-blue-400 shadow-[0_0_5px_#60a5fa]' : 'bg-[#444444]'}`} />
            </button>

            {/* Toggle 3: Syllable Dots */}
            <button
              onClick={() => setShowSyllableDots(prev => !prev)}
              className={`px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded text-[10px] sm:text-xs font-mono font-semibold flex items-center gap-1 sm:gap-1.5 transition cursor-pointer select-none border ${
                showSyllableDots
                  ? 'bg-[#13261f] text-emerald-300 border-emerald-600/60 shadow-[0_0_8px_rgba(16,185,129,0.2)]'
                  : 'bg-[#1e1e1e] text-[#777777] hover:text-[#999999] border-[#2e2e2e]'
              }`}
              title="Toggle Syllable Dots (Rhythm target indicators under words)"
            >
              <CircleDot size={11} className={showSyllableDots ? 'text-emerald-400' : 'text-[#555555]'} />
              <span>Syllable Dots</span>
              <span className={`w-1.5 h-1.5 rounded-full ${showSyllableDots ? 'bg-emerald-400 shadow-[0_0_5px_#34d399]' : 'bg-[#444444]'}`} />
            </button>
          </div>

          {/* Edit Lyrics Action */}
          {lyrics && onOpenLyricEditor && (
            <button
              onClick={onOpenLyricEditor}
              className="px-2 sm:px-2.5 py-1 sm:py-1.5 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] hover:text-white border border-[#333333] text-[10px] sm:text-xs font-mono font-semibold flex items-center gap-1 sm:gap-1.5 transition cursor-pointer shadow-sm hover:border-[#444444]"
              title="Fine-tune syllable timings & transient alignment"
            >
              <span className="text-amber-400">⚡</span> <span className="hidden xs:inline">Edit Waveform</span><span className="xs:hidden">Edit</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Karaoke Viewport */}
      <div
        ref={stageViewportRef}
        className="flex-1 w-full max-w-[96vw] 2xl:max-w-[92vw] mx-auto min-h-0 relative overflow-hidden flex flex-col"
      >
        {/* Single Persistent Floating Bouncing Ball - Precision Hardware Pointer */}
        <div
          ref={ballRef}
          className="absolute top-0 left-0 pointer-events-none z-30 will-change-transform"
          style={{
            display: showBouncingBall ? 'block' : 'none',
            transform: 'translate3d(-100px, -100px, 0)',
          }}
        >
          <div className="w-6 h-6 -ml-3 -mt-3 rounded-full bg-amber-400 border-2 border-white shadow-[0_2px_12px_rgba(0,0,0,0.85),0_0_16px_rgba(251,191,36,0.65)] ring-1 ring-amber-500" />
        </div>

        {/* Scrolling Lyrics Container */}
        <div
          ref={containerRef}
          onWheel={handleUserScroll}
          onTouchMove={handleUserScroll}
          style={{
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
            paddingTop: '25vh',
            paddingBottom: '35vh',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
          }}
          className="flex-1 w-full h-full min-h-0 overflow-y-auto relative px-1.5 sm:px-6 md:px-8 scrollbar-none"
        >
          <div className="flex flex-col items-center space-y-3 sm:space-y-5 md:space-y-7 text-center">
            {segments.map((segment, sIdx) => {
              const isActive = sIdx === activeLineIndex;
              const isNext = sIdx === nextVocalLineIndex;
              const isPast = currentTime > segment.end && !isActive;
              const isInstrumental = segment.text === '[INSTRUMENTAL]';

              if (isInstrumental) {
                const isInstrumentalActive = sIdx === activeLineIndex;
                const isIntro = sIdx === 0;
                return (
                  <div
                    key={sIdx}
                    ref={(el) => {
                      if (el) lineEls.current.set(sIdx, el);
                      else lineEls.current.delete(sIdx);
                    }}
                    onClick={() => onSeek && onSeek(segment.start)}
                    className={`transition-all duration-300 cursor-pointer select-none text-center ${
                      isInstrumentalActive
                        ? 'py-2 sm:py-4 md:py-6 px-3 sm:px-8 opacity-100'
                        : 'py-1 sm:py-2 px-3 opacity-30 hover:opacity-60'
                    }`}
                  >
                    <div className={`inline-flex items-center justify-center max-w-[94vw] gap-2 sm:gap-3.5 md:gap-4 rounded-xl sm:rounded-2xl border transition-all duration-300 font-mono uppercase ${
                      isInstrumentalActive
                        ? 'px-4 py-2 sm:px-8 sm:py-4 md:px-12 md:py-6 bg-[#142333]/95 border-2 border-blue-500 shadow-[0_0_35px_rgba(59,130,246,0.45)] text-blue-300 ring-1 ring-blue-400/40 text-base sm:text-2xl md:text-4xl font-black tracking-wider sm:tracking-widest scale-105'
                        : 'px-3 py-1 sm:px-5 sm:py-2 bg-[#181818] border-[#333333] text-[#777777] text-[10px] sm:text-xs md:text-sm font-semibold tracking-wider'
                    }`}>
                      {isInstrumentalActive && (
                        <span
                          ref={dotLeftRef}
                          className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 md:w-4 md:h-4 rounded-full bg-cyan-400 inline-block will-change-transform shadow-[0_0_12px_rgba(56,189,248,0.6)]"
                        />
                      )}
                      <span>
                        {isIntro ? '// INSTRUMENTAL INTRO //' : '// INSTRUMENTAL BREAK //'}
                      </span>
                      {isInstrumentalActive && (
                        <span
                          ref={dotRightRef}
                          className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 md:w-4 md:h-4 rounded-full bg-cyan-400 inline-block will-change-transform shadow-[0_0_12px_rgba(56,189,248,0.6)]"
                        />
                      )}
                    </div>
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
                  className={`relative inline-block max-w-[98vw] sm:max-w-[94vw] text-center cursor-pointer select-none transition-all duration-300 whitespace-nowrap sm:whitespace-normal ${
                    isActive
                      ? `${getActiveLineFontSize(segment.text)} font-black py-1.5 px-2.5 sm:py-3.5 sm:px-7 md:py-5 md:px-9 text-white opacity-100 bg-[#212121]/95 border border-[#3c3c3c] shadow-xl md:shadow-2xl rounded-xl tracking-tight sm:tracking-normal ring-1 ring-white/5`
                      : isNext
                      ? 'text-xs xs:text-sm sm:text-2xl md:text-3xl font-bold py-1 px-2.5 sm:py-2.5 sm:px-6 text-white opacity-90 border border-transparent'
                      : isPast
                      ? 'text-[11px] sm:text-base md:text-xl font-medium py-0.5 px-2 text-[#555555] opacity-25 hover:opacity-50 border border-transparent'
                      : 'text-[11px] sm:text-base md:text-xl font-medium py-0.5 px-2 text-[#666666] opacity-35 hover:opacity-60 border border-transparent'
                  }`}
                >
                  {/* Word Spans with Syllables and Syllable Rhythm Indicators */}
                  {segment.words.map((w, wIdx) => {
                    const syls = (w.syllables && w.syllables.length > 0) ? w.syllables.map(s => s.text) : syllabifyWord(w.text);
                    return (
                      <span key={wIdx} className="inline-flex mx-0.5 sm:mx-1.5 relative whitespace-nowrap align-bottom my-0.5">
                        {syls.map((sylText, s) => {
                          const sylKey = `${sIdx}_${wIdx}_${s}`;
                          return (
                            <span
                              key={s}
                              ref={(el) => {
                                if (el) sylEls.current.set(sylKey, el);
                                else sylEls.current.delete(sylKey);
                              }}
                              className="inline-flex flex-col items-center relative will-change-transform font-bold"
                            >
                              <span>{sylText}</span>
                              {/* Rhythmic syllable hit-indicator target pip */}
                              <span
                                ref={(el) => {
                                  if (el) sylPipEls.current.set(sylKey, el);
                                  else sylPipEls.current.delete(sylKey);
                                }}
                                data-syl-pip={sylKey}
                                style={{ display: showSyllableDots ? 'block' : 'none' }}
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
