import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LyricResult, SongMetadata, LyricWord, LyricSegment } from '../../types';
import { audioEngine } from '../../audio/WasmAudioEngine';
import { syllabifyWord } from './LyricStage';
import {
  X,
  Save,
  Play,
  Pause,
  ZoomIn,
  ZoomOut,
  Code,
  Sliders,
  ChevronLeft,
  ChevronRight,
  FastForward,
  Rewind,
  Activity,
  LocateFixed,
  Focus,
  Zap,
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  song: SongMetadata;
  lyrics: LyricResult;
  currentTime: number;
  duration: number;
  onClose: () => void;
  onSave: (newLyrics: LyricResult) => void;
}

export interface SyllableKeyframe {
  key: string;
  sIdx: number;
  wIdx: number;
  sylIdx: number;
  totalSyls: number;
  text: string;
  fullWordText: string;
  lineText: string;
  start: number;
  end: number;
  duration: number;
  isInstrumental?: boolean;
}

export const LyricEditorModal: React.FC<Props> = ({
  isOpen,
  song,
  lyrics,
  currentTime,
  duration,
  onClose,
  onSave,
}) => {
  const [editedLyrics, setEditedLyrics] = useState<LyricResult>(JSON.parse(JSON.stringify(lyrics)));
  const [selectedKeyframeKey, setSelectedKeyframeKey] = useState<string>('');
  const [selectedSegIdx, setSelectedSegIdx] = useState<number>(0);
  const [selectedWordIdx, setSelectedWordIdx] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(240);
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [waveform, setWaveform] = useState<{ sampleRate: number; peaks: number[]; duration: number } | null>(null);
  const [isLoadingWaveform, setIsLoadingWaveform] = useState(false);

  const [liveClock, setLiveClock] = useState<number>(currentTime);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);

  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const timelineContentRef = useRef<HTMLDivElement>(null);

  const [kfDragState, setKfDragState] = useState<{
    kf: SyllableKeyframe;
    type: 'move' | 'left' | 'right';
    startX: number;
    initialStart: number;
    initialEnd: number;
    minStart: number;
    maxEnd: number;
    currentPosSec?: number;
  } | null>(null);

  useEffect(() => {
    if (!isOpen || !song?.id) return;
    setIsLoadingWaveform(true);
    fetch(`/api/audio/waveform/${song.id}/vocals`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.peaks) setWaveform(data);
      })
      .catch(() => {})
      .finally(() => setIsLoadingWaveform(false));
  }, [isOpen, song?.id]);

  useEffect(() => {
    setEditedLyrics(JSON.parse(JSON.stringify(lyrics)));
    setSelectedSegIdx(0);
    setSelectedWordIdx(0);
  }, [lyrics, isOpen]);

  useEffect(() => {
    if (mode === 'json') {
      setJsonText(JSON.stringify(editedLyrics, null, 2));
      setJsonError('');
    }
  }, [mode, editedLyrics]);

  useEffect(() => {
    if (!isOpen) return;
    let animId: number;
    const updateTime = () => {
      if (!isScrubbing) {
        setLiveClock(audioEngine.getCurrentTime());
        setIsPlaying(audioEngine.getState().isPlaying);
      }
      animId = requestAnimationFrame(updateTime);
    };
    animId = requestAnimationFrame(updateTime);
    return () => cancelAnimationFrame(animId);
  }, [isOpen, isScrubbing]);

  const allKeyframes = useMemo(() => {
    const kfs: SyllableKeyframe[] = [];
    let lastEnd = 0.0;

    editedLyrics.segments.forEach((seg, sIdx) => {
      if (seg.text === '[INSTRUMENTAL]') {
        const s = Math.max(lastEnd, seg.start);
        const e = Math.max(s + 0.1, seg.end);
        kfs.push({
          key: `inst_${sIdx}`,
          sIdx,
          wIdx: -1,
          sylIdx: -1,
          totalSyls: 1,
          text: '[INSTRUMENTAL]',
          fullWordText: '[INSTRUMENTAL]',
          lineText: '[INSTRUMENTAL]',
          start: s,
          end: e,
          duration: Math.max(0.1, e - s),
          isInstrumental: true,
        });
        lastEnd = e;
        return;
      }

      if (!seg.words) return;
      seg.words.forEach((w, wIdx) => {
        const syls = (w.syllables && w.syllables.length > 0) ? w.syllables.map(s => s.text) : syllabifyWord(w.text);
        const numSyls = syls.length;
        const wDur = Math.max(0.12, w.end - w.start);
        for (let s = 0; s < numSyls; s++) {
          let sStart =
            w.syllables?.[s]?.start ??
            Math.round((w.start + (wDur / numSyls) * s) * 100) / 100;
          let sEnd =
            w.syllables?.[s]?.end ??
            Math.round((w.start + (wDur / numSyls) * (s + 1)) * 100) / 100;

          sStart = Math.max(lastEnd, sStart);
          sEnd = Math.max(sStart + 0.04, sEnd);
          lastEnd = sEnd;

          kfs.push({
            key: `${sIdx}_${wIdx}_${s}`,
            sIdx,
            wIdx,
            sylIdx: s,
            totalSyls: numSyls,
            text: syls[s],
            fullWordText: w.text,
            lineText: seg.text,
            start: sStart,
            end: sEnd,
            duration: Math.max(0.04, sEnd - sStart),
            isInstrumental: false,
          });
        }
      });
    });
    return kfs;
  }, [editedLyrics]);

  // Smart initial keyframe selection: prefer vocal syllable at or near currentTime
  useEffect(() => {
    if (allKeyframes.length === 0) return;
    if (!selectedKeyframeKey || !allKeyframes.some((k) => k.key === selectedKeyframeKey)) {
      const atTime = allKeyframes.find(
        (k) => liveClock >= k.start && liveClock <= k.end && !k.isInstrumental
      );
      let closest: SyllableKeyframe | null = null;
      let minDiff = Infinity;
      for (const kf of allKeyframes) {
        if (kf.isInstrumental) continue;
        const diff = Math.abs(kf.start - liveClock);
        if (diff < minDiff) {
          minDiff = diff;
          closest = kf;
        }
      }
      const firstVocal = allKeyframes.find((k) => !k.isInstrumental);
      const target = atTime || closest || firstVocal || allKeyframes[0];
      if (target) {
        setSelectedKeyframeKey(target.key);
        setSelectedSegIdx(target.sIdx);
        if (target.wIdx >= 0) setSelectedWordIdx(target.wIdx);
      }
    }
  }, [allKeyframes, selectedKeyframeKey, liveClock]);

  const selectedKeyframe = useMemo(() => {
    return allKeyframes.find((k) => k.key === selectedKeyframeKey) || allKeyframes[0];
  }, [allKeyframes, selectedKeyframeKey]);

  const totalDuration = Math.max(
    duration || 180,
    (editedLyrics.segments[editedLyrics.segments.length - 1]?.end || 0) + 10
  );

  const selectedSeg = editedLyrics.segments[selectedSegIdx];

  const scrollToTime = (timeSec: number) => {
    if (!timelineScrollRef.current) return;
    const containerWidth = timelineScrollRef.current.clientWidth;
    const targetX = timeSec * zoom - containerWidth / 2;
    timelineScrollRef.current.scrollTo({
      left: Math.max(0, targetX),
      behavior: 'smooth',
    });
  };

  // Auto-center timeline on open
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        const firstVocal = allKeyframes.find((k) => !k.isInstrumental);
        const targetTime = liveClock > 0 ? liveClock : (firstVocal?.start || 0);
        scrollToTime(targetTime);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const togglePlay = () => {
    if (audioEngine.getState().isPlaying) {
      audioEngine.pause();
      setIsPlaying(false);
    } else {
      audioEngine.play();
      setIsPlaying(true);
    }
  };

  const scrubDelta = (deltaSec: number) => {
    const nextTime = Math.max(0, Math.min(totalDuration, liveClock + deltaSec));
    setLiveClock(nextTime);
    audioEngine.seek(nextTime);
  };

  const stepKeyframe = (direction: -1 | 1) => {
    const curIdx = allKeyframes.findIndex((k) => k.key === selectedKeyframeKey);
    const nextIdx = curIdx + direction;
    if (nextIdx >= 0 && nextIdx < allKeyframes.length) {
      const next = allKeyframes[nextIdx];
      setSelectedKeyframeKey(next.key);
      setSelectedSegIdx(next.sIdx);
      if (next.wIdx >= 0) setSelectedWordIdx(next.wIdx);
      scrollToTime(next.start);
    }
  };

  useEffect(() => {
    if (!isOpen || mode === 'json') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        scrubDelta(-0.25);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        scrubDelta(0.25);
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        stepKeyframe(-1);
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        stepKeyframe(1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, mode, liveClock, selectedKeyframeKey, allKeyframes]);

  const handleTimelineScrubClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineContentRef.current) return;
    const rect = timelineContentRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const newTime = Math.max(0, Math.min(totalDuration, clickX / zoom));
    setLiveClock(newTime);
    audioEngine.seek(newTime);
  };

  const handleScrubberMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsScrubbing(true);
    const startClientX = e.clientX;
    const startAudioTime = liveClock;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startClientX;
      const targetTime = Math.max(0, Math.min(totalDuration, startAudioTime + deltaX / zoom));
      setLiveClock(targetTime);
      audioEngine.seek(targetTime);
    };

    const onMouseUp = () => {
      setIsScrubbing(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const applyKeyframeUpdate = (kf: SyllableKeyframe, newStart: number, newEnd: number) => {
    const newLyrics: LyricResult = JSON.parse(JSON.stringify(editedLyrics));
    const seg = newLyrics.segments[kf.sIdx];
    if (!seg) return;

    // GLOBAL CHRONOLOGICAL LOCK: Look up neighbor boundaries from allKeyframes
    const kfIdx = allKeyframes.findIndex((k) => k.key === kf.key);
    const prevKf = kfIdx > 0 ? allKeyframes[kfIdx - 1] : null;
    const nextKf = kfIdx < allKeyframes.length - 1 ? allKeyframes[kfIdx + 1] : null;

    const minBound = prevKf ? prevKf.end : 0.0;
    const maxBound = nextKf ? nextKf.start : totalDuration;

    newStart = Math.max(minBound, newStart);
    newEnd = Math.min(maxBound, newEnd);
    if (newEnd < newStart + 0.04) {
      newEnd = Math.min(maxBound, newStart + 0.04);
      if (newEnd - newStart < 0.04) {
        newStart = Math.max(minBound, newEnd - 0.04);
      }
    }

    if (kf.isInstrumental) {
      seg.start = newStart;
      seg.end = newEnd;
      if (seg.words && seg.words[0]) {
        seg.words[0].start = newStart;
        seg.words[0].end = newEnd;
      }
    } else if (seg.words && seg.words[kf.wIdx]) {
      const w = seg.words[kf.wIdx];
      const syls = (w.syllables && w.syllables.length > 0) ? w.syllables.map(s => s.text) : syllabifyWord(w.text);
      const numSyls = syls.length;

      // Ensure w.syllables array is populated
      let syllables: Array<{ text: string; start: number; end: number }> = [];
      if (w.syllables && w.syllables.length === numSyls) {
        syllables = w.syllables.map((s) => ({ ...s }));
      } else {
        const wDur = Math.max(0.12, w.end - w.start);
        syllables = syls.map((sText, s) => ({
          text: sText,
          start: Math.round((w.start + (wDur / numSyls) * s) * 100) / 100,
          end: Math.round((w.start + (wDur / numSyls) * (s + 1)) * 100) / 100,
        }));
      }

      // Clamp strictly within its assigned syllable neighbors to guarantee zero reordering
      if (kf.sylIdx > 0) {
        newStart = Math.max(syllables[kf.sylIdx - 1].end, newStart);
      }
      if (kf.sylIdx < numSyls - 1) {
        newEnd = Math.min(syllables[kf.sylIdx + 1].start, newEnd);
      }

      // Update targeted syllable:
      if (syllables[kf.sylIdx]) {
        syllables[kf.sylIdx].start = newStart;
        syllables[kf.sylIdx].end = newEnd;
      }

      w.syllables = syllables;
      // Word boundaries envelop all its syllables:
      w.start = syllables[0].start;
      w.end = syllables[syllables.length - 1].end;

      // Segment boundaries envelop all words:
      seg.start = seg.words[0].start;
      seg.end = seg.words[seg.words.length - 1].end;
    }

    setEditedLyrics(newLyrics);
  };

  const handleKfMouseDown = (
    e: React.MouseEvent,
    kf: SyllableKeyframe,
    kfIdx: number,
    type: 'move' | 'left' | 'right'
  ) => {
    e.stopPropagation();
    setSelectedKeyframeKey(kf.key);
    setSelectedSegIdx(kf.sIdx);
    if (kf.wIdx >= 0) setSelectedWordIdx(kf.wIdx);

    const prevKf = kfIdx > 0 ? allKeyframes[kfIdx - 1] : null;
    const nextKf = kfIdx < allKeyframes.length - 1 ? allKeyframes[kfIdx + 1] : null;

    // STRICT CHRONOLOGICAL LOCK: Syllables can NEVER leapfrog or reorder past their neighbors!
    const minStart = prevKf ? prevKf.end : 0.0;
    const maxEnd = nextKf ? nextKf.start : totalDuration;

    setKfDragState({
      kf,
      type,
      startX: e.clientX,
      initialStart: kf.start,
      initialEnd: kf.end,
      minStart,
      maxEnd,
    });
  };

  // Window-level mouse listener for smooth, uninterrupted keyframe dragging
  useEffect(() => {
    if (!kfDragState) return;

    const onWindowMouseMove = (moveEvent: MouseEvent) => {
      const deltaSec = (moveEvent.clientX - kfDragState.startX) / zoom;
      const kf = kfDragState.kf;
      const dur = kfDragState.initialEnd - kfDragState.initialStart;

      let newStart = kfDragState.initialStart;
      let newEnd = kfDragState.initialEnd;

      if (kfDragState.type === 'move') {
        newStart = Math.max(
          kfDragState.minStart,
          Math.min(kfDragState.maxEnd - dur, kfDragState.initialStart + deltaSec)
        );
        newStart = Math.round(newStart * 100) / 100;
        newEnd = Math.round((newStart + dur) * 100) / 100;
      } else if (kfDragState.type === 'left') {
        // Dragging left handle to the right makes syllable smaller (onset later)
        // Dragging left handle to the left makes syllable larger (onset earlier, clamped by minStart)
        newStart = Math.max(
          kfDragState.minStart,
          Math.min(kfDragState.initialEnd - 0.04, kfDragState.initialStart + deltaSec)
        );
        newStart = Math.round(newStart * 100) / 100;
        newEnd = kfDragState.initialEnd;
      } else if (kfDragState.type === 'right') {
        // Dragging right handle to the right makes syllable larger (sustain longer, clamped by maxEnd)
        // Dragging right handle to the left makes syllable smaller (sustain shorter, clamped by start + 0.04)
        newEnd = Math.min(
          kfDragState.maxEnd,
          Math.max(kfDragState.initialStart + 0.04, kfDragState.initialEnd + deltaSec)
        );
        newEnd = Math.round(newEnd * 100) / 100;
        newStart = kfDragState.initialStart;
      }

      setKfDragState((prev) => (prev ? { ...prev, currentPosSec: kfDragState.type === 'left' ? newStart : newEnd } : null));
      applyKeyframeUpdate(kf, newStart, newEnd);
    };

    const onWindowMouseUp = () => {
      setKfDragState(null);
    };

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [kfDragState, zoom]);

  const nudgeSelectedKeyframe = (deltaSec: number, mode: 'both' | 'start' | 'end' = 'both') => {
    if (!selectedKeyframe) return;
    const kfIdx = allKeyframes.findIndex((k) => k.key === selectedKeyframe.key);
    if (kfIdx === -1) return;

    const prevKf = kfIdx > 0 ? allKeyframes[kfIdx - 1] : null;
    const nextKf = kfIdx < allKeyframes.length - 1 ? allKeyframes[kfIdx + 1] : null;

    // STRICT CHRONOLOGICAL LOCK: Cannot nudge past preceding or following syllables
    const minStart = prevKf ? prevKf.end : 0.0;
    const maxEnd = nextKf ? nextKf.start : totalDuration;

    let newStart = selectedKeyframe.start;
    let newEnd = selectedKeyframe.end;

    if (mode === 'both') {
      const dur = selectedKeyframe.end - selectedKeyframe.start;
      newStart = Math.max(minStart, Math.min(maxEnd - dur, selectedKeyframe.start + deltaSec));
      newEnd = Math.round((newStart + dur) * 100) / 100;
      newStart = Math.round(newStart * 100) / 100;
    } else if (mode === 'start') {
      newStart = Math.max(minStart, Math.min(selectedKeyframe.end - 0.04, selectedKeyframe.start + deltaSec));
      newStart = Math.round(newStart * 100) / 100;
    } else if (mode === 'end') {
      newEnd = Math.min(maxEnd, Math.max(selectedKeyframe.start + 0.04, selectedKeyframe.end + deltaSec));
      newEnd = Math.round(newEnd * 100) / 100;
    }

    applyKeyframeUpdate(selectedKeyframe, newStart, newEnd);
  };

  const auditionKeyframe = (kf: SyllableKeyframe) => {
    audioEngine.seek(kf.start);
    audioEngine.play();
    setIsPlaying(true);
  };

  const auditionSegment = (start: number) => {
    audioEngine.seek(start);
    audioEngine.play();
    setIsPlaying(true);
  };

  // Finds the beginning transient (attack onset) of the vocal syllable,
  // ensuring it starts on the rising transient of this syllable and NOT on the ending transient of the previous line.
  const findVocalAttackPeak = (
    currentStart: number,
    minBound: number,
    maxBound: number,
    currentEnd?: number
  ): number => {
    if (!waveform || !waveform.peaks || waveform.peaks.length === 0) return currentStart;
    const pts = waveform.peaks;
    const pps = waveform.sampleRate || 50;

    // Search window: never look backwards into previous syllable decay (at most -0.06s),
    // and look forward across silence gaps up to the end of this syllable or +1.40s.
    const sMin = Math.max(minBound, currentStart - 0.06);
    const sMax = Math.min(maxBound, Math.max(currentEnd ? currentEnd + 0.10 : currentStart, currentStart + 1.40));

    const i0 = Math.max(0, Math.floor(sMin * pps));
    const i1 = Math.min(pts.length - 1, Math.ceil(sMax * pps));
    if (i0 >= i1) return currentStart;

    interface PeakCandidate {
      tOnset: number;
      tPeak: number;
      val: number;
      rise: number;
      score: number;
    }

    const candidates: PeakCandidate[] = [];
    for (let i = i0; i <= i1; i++) {
      const p = pts[i];
      if (p < 0.18) continue;
      const prev = i > 0 ? pts[i - 1] : 0;
      const next = i < pts.length - 1 ? pts[i + 1] : 0;

      // Local maximum
      if (p >= prev && p >= next) {
        // Walk backwards up to 0.4s to find valley floor / beginning transient
        const vStart = Math.max(0, i - 20, Math.floor(minBound * pps));
        let minDip = p;
        let minDipIdx = i;
        for (let j = i; j >= vStart; j--) {
          if (pts[j] < minDip) {
            minDip = pts[j];
            minDipIdx = j;
          }
          if (pts[j] <= 0.04) {
            minDip = pts[j];
            minDipIdx = j;
            break;
          }
        }
        const rise = p - minDip;
        const tOnset = Math.round((minDipIdx / pps) * 100) / 100;
        const tPeak = Math.round((i / pps) * 100) / 100;
        const dist = Math.abs(tOnset - currentStart);
        // Prioritize clear attack rises from silence/valley
        const score = (rise * 2.5) + (p * 1.5) - (dist * 0.5);
        candidates.push({ tOnset, tPeak, val: p, rise, score });
      }
    }

    if (candidates.length === 0) return currentStart;

    candidates.sort((a, b) => b.score - a.score);
    const bestOnset = candidates[0].tOnset;
    return Math.max(minBound, Math.min(maxBound - 0.04, bestOnset));
  };

  const snapSelectedKeyframeToPeak = () => {
    if (!selectedKeyframe || !waveform) return;
    const kfIdx = allKeyframes.findIndex((k) => k.key === selectedKeyframe.key);
    if (kfIdx === -1) return;

    const prevKf = kfIdx > 0 ? allKeyframes[kfIdx - 1] : null;
    const nextKf = kfIdx < allKeyframes.length - 1 ? allKeyframes[kfIdx + 1] : null;

    const minBound = prevKf ? prevKf.end : 0.0;
    const maxBound = nextKf ? nextKf.start : totalDuration;

    const newStart = findVocalAttackPeak(selectedKeyframe.start, minBound, maxBound, selectedKeyframe.end);
    const dur = Math.max(0.06, selectedKeyframe.end - selectedKeyframe.start);
    const newEnd = Math.min(maxBound, Math.max(newStart + 0.06, selectedKeyframe.end));

    applyKeyframeUpdate(selectedKeyframe, newStart, newEnd);
  };

  const snapSelectedLineToPeaks = (segIdx: number) => {
    if (!waveform || !waveform.peaks || waveform.peaks.length === 0) return;
    const newLyrics: LyricResult = JSON.parse(JSON.stringify(editedLyrics));
    const seg = newLyrics.segments[segIdx];
    if (!seg || !seg.words) return;

    // Collect all vocal syllables in this segment
    interface SylRef {
      wIdx: number;
      sIdx: number;
      syl: { text: string; start: number; end: number };
    }
    const lineSyls: SylRef[] = [];
    seg.words.forEach((w, wIdx) => {
      const syls = (w.syllables && w.syllables.length > 0)
        ? w.syllables
        : syllabifyWord(w.text).map((st, si, arr) => {
            const wDur = Math.max(0.12, w.end - w.start);
            return {
              text: st,
              start: Math.round((w.start + (wDur / arr.length) * si) * 100) / 100,
              end: Math.round((w.start + (wDur / arr.length) * (si + 1)) * 100) / 100,
            };
          });
      w.syllables = syls;
      syls.forEach((s, sIdx) => {
        lineSyls.push({ wIdx, sIdx, syl: s });
      });
    });

    if (lineSyls.length === 0) return;

    // Preceding boundary is end of previous segment (or 0)
    const prevSeg = segIdx > 0 ? newLyrics.segments[segIdx - 1] : null;
    let runningCursor = prevSeg ? prevSeg.end : 0.0;

    // Following boundary is start of next segment (or totalDuration)
    const nextSeg = segIdx < newLyrics.segments.length - 1 ? newLyrics.segments[segIdx + 1] : null;
    const maxLineBound = nextSeg ? nextSeg.start : totalDuration;

    for (let i = 0; i < lineSyls.length; i++) {
      const item = lineSyls[i];
      const nextSyl = i < lineSyls.length - 1 ? lineSyls[i + 1].syl : null;
      const nextBound = nextSyl ? Math.max(item.syl.end + 0.5, nextSyl.start) : maxLineBound;

      const peakT = findVocalAttackPeak(item.syl.start, runningCursor, nextBound, item.syl.end);
      const originalDur = Math.max(0.08, item.syl.end - item.syl.start);

      item.syl.start = Math.max(runningCursor, peakT);
      item.syl.end = Math.min(nextBound, Math.max(item.syl.start + 0.06, item.syl.start + originalDur));

      runningCursor = item.syl.end;
    }

    // Re-enforce word and segment boundaries
    seg.words.forEach((w) => {
      if (w.syllables && w.syllables.length > 0) {
        w.start = w.syllables[0].start;
        w.end = w.syllables[w.syllables.length - 1].end;
      }
    });
    seg.start = seg.words[0].start;
    seg.end = seg.words[seg.words.length - 1].end;

    newLyrics.segments[segIdx] = seg;
    setEditedLyrics(newLyrics);
  };

  const snapAllSyllablesToPeaks = () => {
    if (!waveform || !waveform.peaks || waveform.peaks.length === 0) return;
    const newLyrics: LyricResult = JSON.parse(JSON.stringify(editedLyrics));

    // Flatten all syllables across all non-instrumental segments
    interface GlobalSylRef {
      segIdx: number;
      wIdx: number;
      sylIdx: number;
      syl: { text: string; start: number; end: number };
    }

    const allSyls: GlobalSylRef[] = [];

    newLyrics.segments.forEach((seg, segIdx) => {
      if (!seg.words) return;
      seg.words.forEach((w, wIdx) => {
        const syls = (w.syllables && w.syllables.length > 0)
          ? w.syllables
          : syllabifyWord(w.text).map((st, si, arr) => {
              const wDur = Math.max(0.12, w.end - w.start);
              return {
                text: st,
                start: Math.round((w.start + (wDur / arr.length) * si) * 100) / 100,
                end: Math.round((w.start + (wDur / arr.length) * (si + 1)) * 100) / 100,
              };
            });
        w.syllables = syls;
        syls.forEach((s, sylIdx) => {
          allSyls.push({ segIdx, wIdx, sylIdx, syl: s });
        });
      });
    });

    let runningBound = 0.0;

    for (let i = 0; i < allSyls.length; i++) {
      const current = allSyls[i];
      const next = i < allSyls.length - 1 ? allSyls[i + 1] : null;

      const minBound = runningBound;
      const maxBound = next ? Math.max(current.syl.end + 0.6, next.syl.start) : totalDuration;

      const peakT = findVocalAttackPeak(current.syl.start, minBound, maxBound, current.syl.end);
      const originalDur = Math.max(0.08, current.syl.end - current.syl.start);

      current.syl.start = Math.max(minBound, peakT);
      const targetEnd = Math.min(maxBound, Math.max(current.syl.start + 0.06, current.syl.start + originalDur));
      current.syl.end = Math.round(targetEnd * 100) / 100;
      current.syl.start = Math.round(current.syl.start * 100) / 100;

      runningBound = current.syl.end;
    }

    // Re-enforce word and segment boundaries
    newLyrics.segments.forEach((seg) => {
      if (seg.words && seg.words.length > 0) {
        seg.words.forEach((w) => {
          if (w.syllables && w.syllables.length > 0) {
            w.start = w.syllables[0].start;
            w.end = w.syllables[w.syllables.length - 1].end;
          }
        });
        seg.start = seg.words[0].start;
        seg.end = seg.words[seg.words.length - 1].end;
      }
    });

    setEditedLyrics(newLyrics);
  };


  const updateLineText = (newText: string) => {
    if (!selectedSeg) return;
    const newLyrics = { ...editedLyrics };
    const seg = { ...newLyrics.segments[selectedSegIdx] };
    seg.text = newText;

    const wordsList = newText.split(/\s+/).filter((x) => x.trim() !== '');
    if (wordsList.length > 0) {
      const dur = (seg.end - seg.start) / wordsList.length;
      seg.words = wordsList.map((wText, i) => ({
        text: wText,
        start: Math.round((seg.start + i * dur) * 100) / 100,
        end: Math.round((seg.start + (i + 1) * dur) * 100) / 100,
        probability: 1.0,
      }));
    }

    newLyrics.segments[selectedSegIdx] = seg;
    setEditedLyrics(newLyrics);
  };

  const waveformPathD = useMemo(() => {
    if (!waveform || !waveform.peaks || waveform.peaks.length === 0) return '';
    const pts = waveform.peaks;
    const pps = waveform.sampleRate || 50;
    const centerY = 90;
    const maxH = 68;

    let topPath = '';
    let bottomPath = '';

    const step = Math.max(1, Math.floor(pps / (zoom * 0.45)));

    for (let i = 0; i < pts.length; i += step) {
      const t = i / pps;
      const x = t * zoom;
      const h = pts[i] * maxH;
      const yTop = centerY - h;
      const yBottom = centerY + h;

      if (i === 0) {
        topPath += `M ${x.toFixed(1)} ${centerY} L ${x.toFixed(1)} ${yTop.toFixed(1)}`;
        bottomPath = `L ${x.toFixed(1)} ${yBottom.toFixed(1)} Z`;
      } else {
        topPath += ` L ${x.toFixed(1)} ${yTop.toFixed(1)}`;
        bottomPath = ` L ${x.toFixed(1)} ${yBottom.toFixed(1)}` + bottomPath;
      }
    }

    return topPath + bottomPath;
  }, [waveform, zoom]);

  const handleSaveToServer = async () => {
    setIsSaving(true);
    let payload = editedLyrics;
    if (mode === 'json') {
      try {
        payload = JSON.parse(jsonText);
      } catch (err: any) {
        setJsonError(err.message);
        setIsSaving(false);
        return;
      }
    }

    try {
      const res = await fetch(`/api/audio/lyrics/${song.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lyrics: payload }),
      });

      if (res.ok) {
        onSave(payload);
        onClose();
      } else {
        const data = await res.json();
        alert(`Save failed: ${data.error || 'Server error'}`);
      }
    } catch (err: any) {
      alert(`Network error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 md:p-6 animate-in fade-in duration-200">
      <div
        className="w-full max-w-7xl h-[94vh] bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden font-['Outfit'] select-none"
      >
        {/* Top Header */}
        <div className="px-6 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60 flex-wrap gap-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-extrabold text-white flex items-center gap-2">
              <span className="text-fuchsia-400">✨</span>
              <span>DAW Syllable Keyframe & Waveform Editor</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-fuchsia-950 text-fuchsia-300 border border-fuchsia-800 font-mono">
                {song.title}
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-3">
            {/* Live Playhead Display */}
            <div className="flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
              <button
                onClick={togglePlay}
                className="p-1 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white transition cursor-pointer"
                title="Play/Pause (Spacebar)"
              >
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <span className="font-mono text-xs text-cyan-300 font-bold tracking-wider">
                {liveClock.toFixed(2)}s / {totalDuration.toFixed(2)}s
              </span>
            </div>

            {/* Mode Switcher */}
            <div className="flex bg-slate-900 p-0.5 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setMode('visual')}
                className={`px-3 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                  mode === 'visual'
                    ? 'bg-gradient-to-r from-fuchsia-600 to-indigo-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Sliders size={13} /> Single-Row DAW
              </button>
              <button
                onClick={() => setMode('json')}
                className={`px-3 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                  mode === 'json'
                    ? 'bg-gradient-to-r from-fuchsia-600 to-indigo-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Code size={13} /> Raw JSON
              </button>
            </div>

            {/* Save Button */}
            <button
              onClick={handleSaveToServer}
              disabled={isSaving}
              className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-600/20 transition cursor-pointer disabled:opacity-50"
            >
              <Save size={13} />
              {isSaving ? 'Saving...' : 'Save & Sync'}
            </button>

            {/* Close */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {mode === 'json' ? (
          <div className="flex-1 p-6 flex flex-col min-h-0 bg-slate-950">
            {jsonError && (
              <div className="mb-3 px-4 py-2 bg-red-950/60 border border-red-800 text-red-300 text-xs rounded-xl">
                ⚠️ JSON Error: {jsonError}
              </div>
            )}
            <textarea
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value);
                try {
                  setEditedLyrics(JSON.parse(e.target.value));
                  setJsonError('');
                } catch (err: any) {
                  setJsonError(err.message);
                }
              }}
              className="flex-1 w-full bg-slate-900 border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-200 focus:outline-none focus:border-fuchsia-500 scrollbar-thin resize-none"
              spellCheck={false}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* DAW Control Toolbar */}
            <div className="px-6 py-2 bg-slate-900/40 border-b border-slate-800 flex items-center justify-between text-xs flex-wrap gap-3 flex-shrink-0">
              <div className="flex items-center gap-4">
                {/* Zoom */}
                <div className="flex items-center gap-1 bg-slate-900 px-2 py-1 rounded-xl border border-slate-800">
                  <button
                    onClick={() => setZoom((z) => Math.max(60, z <= 240 ? z - 30 : z <= 500 ? z - 60 : z - 100))}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                    title="Zoom Out"
                  >
                    <ZoomOut size={13} />
                  </button>
                  <span className="font-mono text-[11px] text-cyan-300 font-bold px-2 min-w-[65px] text-center">{zoom} px/s</span>
                  <button
                    onClick={() => setZoom((z) => Math.min(1000, z < 240 ? z + 30 : z < 500 ? z + 60 : z + 100))}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                    title="Zoom In to max 1000 px/s"
                  >
                    <ZoomIn size={13} />
                  </button>
                </div>

                {/* Quick Zoom Presets */}
                <div className="hidden sm:flex items-center gap-1">
                  {[120, 240, 500, 1000].map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setZoom(preset)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition cursor-pointer ${
                        zoom === preset
                          ? 'bg-cyan-600 text-white shadow-sm'
                          : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800'
                      }`}
                      title={`Set Zoom to ${preset} px/s`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                {/* Step controls */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => scrubDelta(-1.0)}
                    className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 cursor-pointer"
                    title="Rewind 1s (Left Arrow)"
                  >
                    <Rewind size={13} />
                  </button>
                  <button
                    onClick={() => scrubDelta(1.0)}
                    className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 cursor-pointer"
                    title="Forward 1s (Right Arrow)"
                  >
                    <FastForward size={13} />
                  </button>
                </div>

                {/* Center view buttons */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => scrollToTime(liveClock)}
                    className="px-2.5 py-1 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 flex items-center gap-1.5 cursor-pointer font-semibold"
                    title="Center view on playhead"
                  >
                    <LocateFixed size={13} />
                    <span className="hidden sm:inline">Center Playhead</span>
                  </button>
                  {selectedKeyframe && (
                    <button
                      onClick={() => scrollToTime(selectedKeyframe.start)}
                      className="px-2.5 py-1 rounded-xl bg-slate-900 hover:bg-slate-800 text-fuchsia-300 border border-slate-800 flex items-center gap-1.5 cursor-pointer font-semibold"
                      title="Center view on selected syllable"
                    >
                      <Focus size={13} />
                      <span className="hidden sm:inline">Center Syllable</span>
                    </button>
                  )}
                </div>

                {/* Acapella Stem Badge */}
                <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-cyan-950/60 border border-cyan-800/80 text-cyan-300">
                  <Activity size={13} className="text-cyan-400 animate-pulse" />
                  <span className="font-bold">Acapella Stem Waveform</span>
                </div>

                {/* Automated Peak Snapping Button for ENTIRE SONG */}
                <button
                  onClick={snapAllSyllablesToPeaks}
                  disabled={!waveform || !waveform.peaks || waveform.peaks.length === 0}
                  className="px-3 py-1 rounded-xl bg-amber-950/80 hover:bg-amber-900 border border-amber-600/80 text-amber-300 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-sm disabled:opacity-40"
                  title="Automatically snap all syllable start positions to vocal audio waveform peaks"
                >
                  <Zap size={13} className="text-amber-400" />
                  <span>Snap All to Peaks</span>
                </button>

                <div className="text-slate-400 text-xs hidden 2xl:block">
                  <span className="text-cyan-300 font-semibold">Single-Row Lane:</span> Syllables sit sequentially over audio peaks with zero overlap. Drag edges to adjust attack/sustain. Spacebar toggles Play/Pause.
                </div>
              </div>

              {selectedKeyframe && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => auditionKeyframe(selectedKeyframe)}
                    className="px-3 py-1 rounded-lg bg-fuchsia-950 border border-fuchsia-800 text-fuchsia-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-fuchsia-900 transition cursor-pointer shadow-sm"
                  >
                    <Play size={12} /> Play Syllable ({selectedKeyframe.text})
                  </button>
                  {selectedSeg && (
                    <button
                      onClick={() => auditionSegment(selectedSeg.start)}
                      className="px-3 py-1 rounded-lg bg-cyan-950 border border-cyan-800 text-cyan-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-cyan-900 transition cursor-pointer shadow-sm"
                    >
                      <Play size={12} /> Play Line
                    </button>
                  )}
                  {selectedSeg && (
                    <button
                      onClick={() => snapSelectedLineToPeaks(selectedSegIdx)}
                      disabled={!waveform || !waveform.peaks || waveform.peaks.length === 0}
                      className="px-3 py-1 rounded-lg bg-amber-950/80 border border-amber-700/80 text-amber-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-amber-900 transition cursor-pointer shadow-sm disabled:opacity-40"
                      title="Snap all syllables in this line to local vocal peaks"
                    >
                      <Zap size={12} className="text-amber-400" /> Snap Line
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Scrollable Single-Row DAW Timeline Track */}
            <div
              ref={timelineScrollRef}
              className="flex-1 overflow-x-auto overflow-y-hidden bg-slate-950 p-6 relative select-none scrollbar-thin scrollbar-thumb-slate-800 flex flex-col justify-center"
            >
              <div
                ref={timelineContentRef}
                style={{ width: `${totalDuration * zoom}px`, height: '220px' }}
                onClick={handleTimelineScrubClick}
                className="relative cursor-pointer select-none"
              >
                {/* Second Ruler with Click-to-Scrub & Sub-second Ticks */}
                <div className="h-7 border-b border-slate-800/80 relative bg-slate-950/90 z-20 overflow-hidden">
                  {Array.from({ length: Math.ceil(totalDuration) }).map((_, sec) => {
                    if (sec % 2 !== 0 && zoom < 60) return null;
                    return (
                      <React.Fragment key={sec}>
                        <div
                          style={{ left: `${sec * zoom}px` }}
                          className="absolute top-0 flex flex-col items-start pointer-events-none"
                        >
                          <span className="text-[10px] font-mono text-slate-400 pl-1 font-bold">{sec}s</span>
                          <div className="w-px h-3.5 bg-slate-700" />
                        </div>

                        {/* Half-second mark at zoom >= 200 */}
                        {zoom >= 200 && (
                          <div
                            style={{ left: `${(sec + 0.5) * zoom}px` }}
                            className="absolute top-0 flex flex-col items-start pointer-events-none"
                          >
                            <span className="text-[9px] font-mono text-slate-600 pl-0.5">{sec}.5s</span>
                            <div className="w-px h-2 bg-slate-800" />
                          </div>
                        )}

                        {/* Quarter-second tick marks at zoom >= 500 */}
                        {zoom >= 500 && (
                          <>
                            <div
                              style={{ left: `${(sec + 0.25) * zoom}px` }}
                              className="absolute top-2 w-px h-1.5 bg-slate-800/80 pointer-events-none"
                            />
                            <div
                              style={{ left: `${(sec + 0.75) * zoom}px` }}
                              className="absolute top-2 w-px h-1.5 bg-slate-800/80 pointer-events-none"
                            />
                          </>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>

                {/* TRACK CONTAINER (Waveform Background + Single Row Syllable Keyframes) */}
                <div className="relative w-full h-[180px] bg-slate-950/40 border-b border-slate-800/80 overflow-hidden">
                  
                  {/* Layer 1: Acapella Waveform SVG Background */}
                  {waveformPathD && (
                    <svg
                      className="absolute inset-0 w-full h-full pointer-events-none"
                      style={{ width: `${totalDuration * zoom}px`, height: '180px' }}
                    >
                      <line
                        x1="0"
                        y1="90"
                        x2={totalDuration * zoom}
                        y2="90"
                        stroke="rgba(51, 65, 85, 0.4)"
                        strokeDasharray="4 4"
                      />
                      <path
                        d={waveformPathD}
                        fill="rgba(6, 182, 212, 0.22)"
                        stroke="#22d3ee"
                        strokeWidth="1.2"
                      />
                    </svg>
                  )}

                  {/* Layer 2: Single-Row Syllable Keyframe Blocks (Non-Overlapping) */}
                  <div className="absolute inset-0 z-10 pointer-events-none">
                    {allKeyframes.map((kf, kfIdx) => {
                      const isSelected = kf.key === selectedKeyframe?.key;
                      const left = kf.start * zoom;
                      const width = Math.max(28, (kf.end - kf.start) * zoom);
                      const isInst = kf.isInstrumental;

                      if (isInst) {
                        return (
                          <div
                            key={kf.key}
                            style={{
                              left: `${left}px`,
                              width: `${width}px`,
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedKeyframeKey(kf.key);
                              setSelectedSegIdx(kf.sIdx);
                            }}
                            onMouseDown={(e) => handleKfMouseDown(e, kf, kfIdx, 'move')}
                            className={`absolute top-2 h-8 rounded-lg border border-dashed cursor-move flex items-center justify-between px-2.5 shadow-sm transition-all pointer-events-auto select-none ${
                              isSelected
                                ? 'bg-cyan-950/80 border-cyan-400 text-cyan-200 ring-2 ring-cyan-400/80 shadow-[0_0_15px_rgba(34,211,238,0.4)] z-20'
                                : 'bg-cyan-950/25 border-cyan-800/50 text-cyan-400/80 hover:bg-cyan-950/40 hover:border-cyan-600 z-10'
                            }`}
                          >
                            {/* Left handle */}
                            <div
                              onMouseDown={(e) => handleKfMouseDown(e, kf, kfIdx, 'left')}
                              className="absolute left-0 top-0 bottom-0 w-2.5 bg-cyan-500/50 hover:bg-cyan-400 rounded-l-lg cursor-ew-resize z-30"
                              title="Adjust start of instrumental break"
                            />
                            <span className="text-[11px] font-mono font-bold truncate pl-1">
                              [INSTRUMENTAL]
                            </span>
                            <span className="text-[10px] font-mono text-cyan-400/60 pr-1">
                              {(kf.end - kf.start).toFixed(1)}s
                            </span>
                            {/* Right handle */}
                            <div
                              onMouseDown={(e) => handleKfMouseDown(e, kf, kfIdx, 'right')}
                              className="absolute right-0 top-0 bottom-0 w-2.5 bg-cyan-500/50 hover:bg-cyan-400 rounded-r-lg cursor-ew-resize z-30"
                              title="Adjust end of instrumental break"
                            />
                          </div>
                        );
                      }

                      return (
                        <div
                          key={kf.key}
                          style={{
                            left: `${left}px`,
                            width: `${width}px`,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedKeyframeKey(kf.key);
                            setSelectedSegIdx(kf.sIdx);
                            if (kf.wIdx >= 0) setSelectedWordIdx(kf.wIdx);
                          }}
                          onMouseDown={(e) => handleKfMouseDown(e, kf, kfIdx, 'move')}
                          className={`absolute top-2 bottom-2 rounded-xl border cursor-move flex flex-col justify-between p-1.5 shadow-md transition-all pointer-events-auto select-none backdrop-blur-[2px] ${
                            isSelected
                              ? 'bg-fuchsia-950/45 border-2 border-fuchsia-400 shadow-[0_0_24px_rgba(217,70,239,0.5)] ring-2 ring-fuchsia-400/80 z-30'
                              : kf.sIdx === selectedSegIdx
                              ? 'bg-indigo-950/35 border border-indigo-500/80 text-indigo-100 hover:border-indigo-400 hover:bg-indigo-900/50 z-20'
                              : 'bg-slate-900/35 border border-slate-700/70 text-slate-200 hover:border-slate-400 hover:bg-slate-800/50 z-10'
                          }`}
                        >
                          {/* Left Resize Handle (Attack / Onset) - Transparent Waveform Gap + Top/Bottom Grip Brackets */}
                          <div
                            onMouseDown={(e) => handleKfMouseDown(e, kf, kfIdx, 'left')}
                            className="absolute -left-2 top-0 bottom-0 w-4 cursor-ew-resize z-40 group flex flex-col justify-between items-center select-none"
                            title="Drag to adjust syllable onset (attack)"
                          >
                            {/* Top Grab Bracket (Outside waveform zone) */}
                            <div className="w-3 h-5 bg-fuchsia-500 hover:bg-fuchsia-400 active:bg-fuchsia-300 rounded-t-md shadow-md flex items-center justify-center transition-colors">
                              <div className="w-1 h-0.5 bg-white/90 rounded-full" />
                            </div>

                            {/* Center Hairline - 1.5px Laser Line: ZERO Waveform Obstruction */}
                            <div className="w-[1.5px] flex-1 bg-fuchsia-400/90 group-hover:bg-fuchsia-300 group-hover:w-[2px] group-hover:shadow-[0_0_8px_#f43f5e] transition-all" />

                            {/* Bottom Grab Bracket (Outside waveform zone) */}
                            <div className="w-3 h-5 bg-fuchsia-500 hover:bg-fuchsia-400 active:bg-fuchsia-300 rounded-b-md shadow-md flex items-center justify-center transition-colors">
                              <div className="w-1 h-0.5 bg-white/90 rounded-full" />
                            </div>
                          </div>

                          {/* Top Header: Syllable Text Pill */}
                          <div className="flex items-center justify-between overflow-hidden pointer-events-none px-1">
                            <span
                              className={`font-black text-xs uppercase px-2 py-0.5 rounded shadow-sm tracking-wide truncate ${
                                isSelected
                                  ? 'bg-fuchsia-500 text-white shadow-fuchsia-500/40'
                                  : 'bg-slate-800/90 text-slate-100 border border-slate-700'
                              }`}
                            >
                              {kf.text}
                            </span>
                          </div>

                          {/* Center Body: Transparent gap allowing vocal waveform peaks to be visible directly through the card */}
                          <div className="flex-1 pointer-events-none" />

                          {/* Bottom Tag: Timestamp & Duration */}
                          <div className="flex items-center justify-between text-[10px] font-mono text-cyan-300 font-bold px-1.5 py-0.5 bg-slate-950/85 rounded border border-slate-800 pointer-events-none mx-0.5">
                            <span className="truncate">{kf.start.toFixed(2)}s</span>
                            <span className="text-fuchsia-300 font-semibold pl-1">
                              {(kf.end - kf.start).toFixed(2)}s
                            </span>
                          </div>

                          {/* Right Resize Handle (Sustain / Release) - Transparent Waveform Gap + Top/Bottom Grip Brackets */}
                          <div
                            onMouseDown={(e) => handleKfMouseDown(e, kf, kfIdx, 'right')}
                            className="absolute -right-2 top-0 bottom-0 w-4 cursor-ew-resize z-40 group flex flex-col justify-between items-center select-none"
                            title="Drag to adjust syllable duration (sustain)"
                          >
                            {/* Top Grab Bracket (Outside waveform zone) */}
                            <div className="w-3 h-5 bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-300 rounded-t-md shadow-md flex items-center justify-center transition-colors">
                              <div className="w-1 h-0.5 bg-white/90 rounded-full" />
                            </div>

                            {/* Center Hairline - 1.5px Laser Line: ZERO Waveform Obstruction */}
                            <div className="w-[1.5px] flex-1 bg-cyan-400/90 group-hover:bg-cyan-300 group-hover:w-[2px] group-hover:shadow-[0_0_8px_#22d3ee] transition-all" />

                            {/* Bottom Grab Bracket (Outside waveform zone) */}
                            <div className="w-3 h-5 bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-300 rounded-b-md shadow-md flex items-center justify-center transition-colors">
                              <div className="w-1 h-0.5 bg-white/90 rounded-full" />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Live Transient Laser Alignment Guide while dragging handle */}
                  {kfDragState && (kfDragState.type === 'left' || kfDragState.type === 'right') && (
                    <div
                      style={{
                        transform: `translate3d(${(kfDragState.currentPosSec ?? (kfDragState.type === 'left' ? kfDragState.initialStart : kfDragState.initialEnd)) * zoom}px, 0, 0)`,
                      }}
                      className="absolute top-0 bottom-0 pointer-events-none z-50 will-change-transform"
                    >
                      <div
                        className={`w-[2px] h-full ${
                          kfDragState.type === 'left'
                            ? 'bg-fuchsia-400 shadow-[0_0_12px_#f43f5e]'
                            : 'bg-cyan-400 shadow-[0_0_12px_#22d3ee]'
                        }`}
                      />
                      <div
                        className={`absolute -top-7 -left-12 px-2 py-0.5 rounded text-[10px] font-mono font-extrabold text-white shadow-xl whitespace-nowrap border ${
                          kfDragState.type === 'left'
                            ? 'bg-fuchsia-600 border-fuchsia-400 shadow-fuchsia-600/50'
                            : 'bg-cyan-600 border-cyan-400 shadow-cyan-600/50'
                        }`}
                      >
                        {(kfDragState.currentPosSec ?? (kfDragState.type === 'left' ? kfDragState.initialStart : kfDragState.initialEnd)).toFixed(2)}s ({kfDragState.type === 'left' ? 'Attack' : 'Release'})
                      </div>
                    </div>
                  )}

                  {/* Layer 3: Live Vertical Audio Playhead & Draggable Scrubber */}
                  <div
                    style={{ transform: `translate3d(${liveClock * zoom}px, 0, 0)` }}
                    className="absolute top-0 bottom-0 z-30 pointer-events-none will-change-transform"
                  >
                    <div className="w-0.5 h-full bg-cyan-400 shadow-[0_0_12px_#38bdf8,0_0_24px_#06b6d4]" />
                    <div
                      onMouseDown={handleScrubberMouseDown}
                      className="absolute -top-3.5 -left-3.5 w-7 h-7 rounded-full bg-gradient-to-tr from-cyan-300 to-cyan-500 border-2 border-white shadow-[0_0_16px_#38bdf8] flex items-center justify-center cursor-ew-resize pointer-events-auto hover:scale-125 active:scale-110 transition-transform z-40"
                      title={`Scrub: ${liveClock.toFixed(2)}s (Drag to scrub audio live)`}
                    >
                      <div className="w-2.5 h-2.5 rounded-full bg-slate-950" />
                    </div>
                    <div className="absolute top-5 -left-7 px-1.5 py-0.5 rounded bg-cyan-950/95 border border-cyan-500 text-[10px] font-mono text-cyan-200 font-extrabold pointer-events-none shadow-lg whitespace-nowrap z-40">
                      {liveClock.toFixed(2)}s
                    </div>
                  </div>

                </div>
              </div>
            </div>

            {/* Micro-Tuning & Inspector Panel (Bottom) */}
            <div className="h-56 bg-slate-900/80 border-t border-slate-800 p-4 flex flex-col md:flex-row gap-6 flex-shrink-0">
              {/* Syllable Keyframe Inspector */}
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-fuchsia-400">
                        Selected Syllable Keyframe:
                      </span>
                      <span className="px-2.5 py-0.5 rounded-lg bg-fuchsia-950 border border-fuchsia-800 text-white font-extrabold font-mono text-sm shadow-sm">
                        {selectedKeyframe ? `"${selectedKeyframe.text}"` : 'None'}
                      </span>
                      {selectedKeyframe && !selectedKeyframe.isInstrumental && (
                        <span className="text-xs text-slate-400">
                          (in word: <span className="text-white font-semibold">{selectedKeyframe.fullWordText}</span>)
                        </span>
                      )}

                      {/* Syllable Step Buttons */}
                      <div className="flex items-center gap-1 ml-2">
                        <button
                          onClick={() => stepKeyframe(-1)}
                          disabled={!selectedKeyframe || allKeyframes.findIndex((k) => k.key === selectedKeyframe.key) <= 0}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 border border-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                          title="Previous Syllable (Up Arrow)"
                        >
                          <ChevronLeft size={13} /> Prev Syllable
                        </button>
                        <button
                          onClick={() => stepKeyframe(1)}
                          disabled={!selectedKeyframe || allKeyframes.findIndex((k) => k.key === selectedKeyframe.key) >= allKeyframes.length - 1}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 border border-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                          title="Next Syllable (Down Arrow)"
                        >
                          Next Syllable <ChevronRight size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Direct Millisecond Number Inputs */}
                    {selectedKeyframe && (
                      <div className="flex items-center gap-2 text-xs font-mono text-slate-300 bg-slate-950 px-3 py-1 rounded-xl border border-slate-800">
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400 font-sans">Onset:</span>
                          <input
                            type="number"
                            step="0.01"
                            value={selectedKeyframe.start}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) {
                                applyKeyframeUpdate(
                                  selectedKeyframe,
                                  Math.max(0, val),
                                  Math.max(val + 0.04, selectedKeyframe.end)
                                );
                              }
                            }}
                            className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-cyan-300 font-bold focus:outline-none focus:border-cyan-400 text-right"
                          />
                          <span className="text-slate-500">s</span>
                        </div>
                        <span className="text-slate-600">|</span>
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400 font-sans">End:</span>
                          <input
                            type="number"
                            step="0.01"
                            value={selectedKeyframe.end}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) {
                                applyKeyframeUpdate(
                                  selectedKeyframe,
                                  selectedKeyframe.start,
                                  Math.max(selectedKeyframe.start + 0.04, val)
                                );
                              }
                            }}
                            className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-cyan-300 font-bold focus:outline-none focus:border-cyan-400 text-right"
                          />
                          <span className="text-slate-500">s</span>
                        </div>
                        <span className="text-slate-600">|</span>
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400 font-sans">Dur:</span>
                          <strong className="text-fuchsia-300">
                            {(selectedKeyframe.end - selectedKeyframe.start).toFixed(2)}s
                          </strong>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Micro-Nudge Shift Controls */}
                  <div className="flex items-center gap-3 flex-wrap mt-2.5">
                    <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                      <span className="text-[11px] font-semibold text-slate-400 px-2">Position Nudge:</span>
                      <button
                        onClick={() => nudgeSelectedKeyframe(-0.05, 'both')}
                        className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-mono font-bold transition cursor-pointer"
                        title="Shift entire syllable -50ms earlier"
                      >
                        -50ms
                      </button>
                      <button
                        onClick={() => nudgeSelectedKeyframe(-0.02, 'both')}
                        className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-mono font-bold transition cursor-pointer"
                        title="Shift entire syllable -20ms earlier"
                      >
                        -20ms
                      </button>
                      <button
                        onClick={() => nudgeSelectedKeyframe(-0.01, 'both')}
                        className="px-1.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-mono transition cursor-pointer"
                        title="Shift entire syllable -10ms earlier"
                      >
                        -10ms
                      </button>
                      <button
                        onClick={() => nudgeSelectedKeyframe(0.01, 'both')}
                        className="px-1.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-mono transition cursor-pointer"
                        title="Shift entire syllable +10ms later"
                      >
                        +10ms
                      </button>
                      <button
                        onClick={() => nudgeSelectedKeyframe(0.02, 'both')}
                        className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-mono font-bold transition cursor-pointer"
                        title="Shift entire syllable +20ms later"
                      >
                        +20ms
                      </button>
                      <button
                        onClick={() => nudgeSelectedKeyframe(0.05, 'both')}
                        className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-mono font-bold transition cursor-pointer"
                        title="Shift entire syllable +50ms later"
                      >
                        +50ms
                      </button>
                    </div>

                    <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                      <span className="text-[11px] font-semibold text-slate-400 px-2">Onset (Attack):</span>
                      <button
                        onClick={() => nudgeSelectedKeyframe(-0.02, 'start')}
                        className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-fuchsia-300 text-xs font-mono font-bold transition cursor-pointer"
                        title="Move onset earlier -20ms"
                      >
                        -20ms
                      </button>
                      <button
                        onClick={() => nudgeSelectedKeyframe(0.02, 'start')}
                        className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-fuchsia-300 text-xs font-mono font-bold transition cursor-pointer"
                        title="Move onset later +20ms"
                      >
                        +20ms
                      </button>
                    </div>

                    {/* Snap Single Syllable to Peak */}
                    <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                      <button
                        onClick={snapSelectedKeyframeToPeak}
                        disabled={!selectedKeyframe || !waveform || !waveform.peaks || waveform.peaks.length === 0}
                        className="px-2 py-1 rounded bg-amber-950 hover:bg-amber-900 border border-amber-700 text-amber-300 text-xs font-mono font-bold transition cursor-pointer flex items-center gap-1 disabled:opacity-40"
                        title="Snap this syllable's onset directly to the nearest acoustic peak"
                      >
                        <Zap size={11} className="text-amber-400" /> Snap to Peak
                      </button>
                    </div>

                    <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                      <span className="text-[11px] font-semibold text-slate-400 px-2">Release (Sustain):</span>
                      <button
                        onClick={() => nudgeSelectedKeyframe(-0.02, 'end')}
                        className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-cyan-300 text-xs font-mono font-bold transition cursor-pointer"
                        title="Shorten sustain -20ms"
                      >
                        -20ms
                      </button>
                      <button
                        onClick={() => nudgeSelectedKeyframe(0.02, 'end')}
                        className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-cyan-300 text-xs font-mono font-bold transition cursor-pointer"
                        title="Lengthen sustain +20ms"
                      >
                        +20ms
                      </button>
                    </div>
                  </div>
                </div>

                {/* Line text editor */}
                {selectedSeg && (
                  <div className="flex items-center gap-3 mt-2.5">
                    <span className="text-xs font-semibold text-slate-400 whitespace-nowrap">Edit Line Text:</span>
                    <input
                      type="text"
                      value={selectedSeg.text}
                      onChange={(e) => updateLineText(e.target.value)}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white font-semibold focus:outline-none focus:border-fuchsia-500"
                    />
                  </div>
                )}
              </div>

              {/* Line Navigation & Audition Box */}
              <div className="w-full md:w-64 bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                    <span className="font-bold">Line {selectedSegIdx + 1} of {editedLyrics.segments.length}</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          const nextIdx = Math.max(0, selectedSegIdx - 1);
                          setSelectedSegIdx(nextIdx);
                          const firstKfInSeg = allKeyframes.find((k) => k.sIdx === nextIdx);
                          if (firstKfInSeg) {
                            setSelectedKeyframeKey(firstKfInSeg.key);
                            scrollToTime(firstKfInSeg.start);
                          }
                        }}
                        disabled={selectedSegIdx === 0}
                        className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 disabled:opacity-30 cursor-pointer"
                        title="Previous Line"
                      >
                        <ChevronLeft size={13} />
                      </button>
                      <button
                        onClick={() => {
                          const nextIdx = Math.min(editedLyrics.segments.length - 1, selectedSegIdx + 1);
                          setSelectedSegIdx(nextIdx);
                          const firstKfInSeg = allKeyframes.find((k) => k.sIdx === nextIdx);
                          if (firstKfInSeg) {
                            setSelectedKeyframeKey(firstKfInSeg.key);
                            scrollToTime(firstKfInSeg.start);
                          }
                        }}
                        disabled={selectedSegIdx === editedLyrics.segments.length - 1}
                        className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 disabled:opacity-30 cursor-pointer"
                        title="Next Line"
                      >
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-white font-semibold truncate">
                    {selectedSeg?.text || 'No line selected'}
                  </p>
                </div>

                <div className="flex flex-col gap-1.5 mt-3">
                  {selectedKeyframe && (
                    <button
                      onClick={() => auditionKeyframe(selectedKeyframe)}
                      className="w-full py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-md shadow-fuchsia-600/30"
                    >
                      <Play size={12} /> Audition Syllable ({selectedKeyframe.text})
                    </button>
                  )}
                  {selectedSeg && (
                    <button
                      onClick={() => auditionSegment(selectedSeg.start)}
                      className="w-full py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      <Play size={12} /> Audition Full Line
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
