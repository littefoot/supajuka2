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
  Target,
  Download,
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

/**
 * Ensures all words and syllables across the entire track are strictly sequential and non-overlapping.
 * - Expands artificially crushed words (e.g. Whisper duration < numSyls * 0.22s) into trailing gaps
 *   so that multi-syllabic words like "Remember," have healthy, editable, realistic singing duration.
 * - Expands intra-word syllable sustains into natural vocal resonance gaps.
 * - Guarantees every syllable has at least 0.08s - 0.12s duration.
 * - Mathematically enforces: syl[i].start >= syl[i-1].end for all syllables.
 * - Reconstructs segment and word envelopes to match their contained syllables.
 */
export function sanitizeNoOverlapLyrics(input: LyricResult): LyricResult {
  const result: LyricResult = JSON.parse(JSON.stringify(input));
  if (!result.segments || result.segments.length === 0) return result;

  let globalEndCursor = 0.0;

  for (let sIdx = 0; sIdx < result.segments.length; sIdx++) {
    const seg = result.segments[sIdx];
    if (seg.text === '[INSTRUMENTAL]') {
      seg.start = Math.max(globalEndCursor, Math.round(seg.start * 100) / 100);
      seg.end = Math.max(seg.start + 0.5, Math.round(seg.end * 100) / 100);
      if (seg.words && seg.words[0]) {
        seg.words[0].start = seg.start;
        seg.words[0].end = seg.end;
      }
      globalEndCursor = seg.end;
      continue;
    }

    if (!seg.words || seg.words.length === 0) {
      const wordsList = seg.text.split(/\s+/).filter((x) => x.trim() !== '');
      if (wordsList.length > 0) {
        const segDur = Math.max(wordsList.length * 0.35, seg.end - seg.start);
        const wDur = segDur / wordsList.length;
        seg.words = wordsList.map((wt, wi) => ({
          text: wt,
          start: Math.round((seg.start + wi * wDur) * 100) / 100,
          end: Math.round((seg.start + (wi + 1) * wDur) * 100) / 100,
          probability: 1.0,
        }));
      } else {
        continue;
      }
    }

    // Look ahead to find the next vocal segment start
    let nextVocalStart = seg.end + 4.0;
    for (let n = sIdx + 1; n < result.segments.length; n++) {
      if (result.segments[n].text !== '[INSTRUMENTAL]') {
        nextVocalStart = result.segments[n].start;
        break;
      }
    }

    // Process each word in this segment
    for (let wIdx = 0; wIdx < seg.words.length; wIdx++) {
      const w = seg.words[wIdx];
      const nextWord = wIdx < seg.words.length - 1 ? seg.words[wIdx + 1] : null;
      const nextBoundary = nextWord ? nextWord.start : Math.min(seg.end + 2.0, nextVocalStart - 0.15);

      const sylTexts = (w.syllables && w.syllables.length > 0)
        ? w.syllables.map((s) => s.text)
        : syllabifyWord(w.text);
      const numSyls = Math.max(1, sylTexts.length);

      // Clamp word start after global cursor
      w.start = Math.max(globalEndCursor, Math.round(w.start * 100) / 100);

      // Detect artificially crushed words (e.g. 3 syllables squeezed into 0.12s)
      const rawDur = w.end - w.start;
      const minHealthyDur = numSyls * 0.22;
      const availableHeadroom = nextBoundary - w.start;

      if (rawDur < minHealthyDur && availableHeadroom > rawDur) {
        const targetDur = Math.min(availableHeadroom - 0.08, Math.max(numSyls * 0.30, 0.40));
        w.end = Math.round((w.start + Math.max(rawDur, targetDur)) * 100) / 100;
      } else {
        w.end = Math.max(w.start + 0.10 * numSyls, Math.round(w.end * 100) / 100);
      }

      const wDur = w.end - w.start;
      let syllables: Array<{ text: string; start: number; end: number }> = [];

      if (w.syllables && w.syllables.length === numSyls) {
        const existingSpan = w.syllables[numSyls - 1].end - w.syllables[0].start;
        if (existingSpan < minHealthyDur && wDur > existingSpan) {
          // Re-apportion across expanded word
          syllables = sylTexts.map((st, si) => ({
            text: st,
            start: Math.round((w.start + (wDur / numSyls) * si) * 100) / 100,
            end: Math.round((w.start + (wDur / numSyls) * (si + 1)) * 100) / 100,
          }));
        } else {
          // Keep existing but enforce strict non-overlap and min duration
          let sylCursor = w.start;
          syllables = w.syllables.map((es, si) => {
            const sStart = Math.max(sylCursor, Math.round(es.start * 100) / 100);
            const nextSylStart = si < numSyls - 1 ? w.syllables![si + 1].start : w.end;
            const sEnd = Math.max(sStart + 0.08, Math.min(Math.max(sStart + 0.08, nextSylStart), Math.round(es.end * 100) / 100));
            sylCursor = sEnd;
            return {
              text: es.text || sylTexts[si],
              start: sStart,
              end: sEnd,
            };
          });
        }
      } else {
        // Distribute evenly across wDur
        syllables = sylTexts.map((st, si) => ({
          text: st,
          start: Math.round((w.start + (wDur / numSyls) * si) * 100) / 100,
          end: Math.round((w.start + (wDur / numSyls) * (si + 1)) * 100) / 100,
        }));
      }

      // Enforce strictly sequential non-overlap within word syllables, expanding micro-syllables naturally
      let wCursor = w.start;
      for (let si = 0; si < syllables.length; si++) {
        const s = syllables[si];
        s.start = Math.max(wCursor, Math.round(s.start * 100) / 100);
        const sNext = si < syllables.length - 1 ? syllables[si + 1].start : w.end;
        let sEnd = Math.round(s.end * 100) / 100;
        if (sEnd - s.start < 0.16 && sNext > sEnd) {
          sEnd = Math.min(sNext - 0.02, Math.max(sEnd, s.start + 0.25));
        }
        s.end = Math.max(s.start + 0.08, Math.min(Math.max(s.start + 0.08, sNext), sEnd));
        s.start = Math.round(s.start * 100) / 100;
        s.end = Math.round(s.end * 100) / 100;
        wCursor = s.end;
      }

      w.syllables = syllables;
      w.start = syllables[0].start;
      w.end = syllables[syllables.length - 1].end;
      globalEndCursor = w.end;
    }

    // Segment envelope matches words
    if (seg.words.length > 0) {
      seg.start = seg.words[0].start;
      seg.end = seg.words[seg.words.length - 1].end;
      globalEndCursor = seg.end;
    }
  }

  return result;
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
  const [editedLyrics, setEditedLyrics] = useState<LyricResult>(() => sanitizeNoOverlapLyrics(lyrics));
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
        if (data && data.peaks) return data;
        return fetch(`/audio/${song.id}/waveform_vocals.json`).then((r) => (r.ok ? r.json() : null));
      })
      .then((data) => {
        if (data && data.peaks) setWaveform(data);
      })
      .catch(() => {})
      .finally(() => setIsLoadingWaveform(false));
  }, [isOpen, song?.id]);

  useEffect(() => {
    if (!lyrics) return;
    setEditedLyrics(sanitizeNoOverlapLyrics(lyrics));
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
          sEnd = Math.max(sStart + 0.08, sEnd);
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
            duration: Math.max(0.08, sEnd - sStart),
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
    if (newEnd < newStart + 0.08) {
      newEnd = Math.min(maxBound, newStart + 0.08);
      if (newEnd - newStart < 0.08) {
        newStart = Math.max(minBound, newEnd - 0.08);
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
          Math.min(kfDragState.initialEnd - 0.08, kfDragState.initialStart + deltaSec)
        );
        newStart = Math.round(newStart * 100) / 100;
        newEnd = kfDragState.initialEnd;
      } else if (kfDragState.type === 'right') {
        // Dragging right handle to the right makes syllable larger (sustain longer, clamped by maxEnd)
        // Dragging right handle to the left makes syllable smaller (sustain shorter, clamped by start + 0.08)
        newEnd = Math.min(
          kfDragState.maxEnd,
          Math.max(kfDragState.initialStart + 0.08, kfDragState.initialEnd + deltaSec)
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
      newStart = Math.max(minStart, Math.min(selectedKeyframe.end - 0.08, selectedKeyframe.start + deltaSec));
      newStart = Math.round(newStart * 100) / 100;
    } else if (mode === 'end') {
      newEnd = Math.min(maxEnd, Math.max(selectedKeyframe.start + 0.08, selectedKeyframe.end + deltaSec));
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

    // Check if the current position is sitting on silence (< 0.08 amplitude)
    const curIdx = Math.floor(currentStart * pps);
    const curAmp = curIdx >= 0 && curIdx < pts.length ? pts[curIdx] : 0;
    const isOverSilence = curAmp < 0.08;

    // Search window: if over silence, wide-scan forward up to +6.0s and backward up to -3.0s to locate nearest vocal wave packet!
    const backLimit = isOverSilence ? 3.0 : 0.06;
    const fwdLimit = isOverSilence ? 6.0 : 1.40;

    const sMin = Math.max(minBound, currentStart - backLimit);
    const sMax = Math.min(maxBound, Math.max(currentEnd ? currentEnd + 0.10 : currentStart, currentStart + fwdLimit));

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
      if (p < 0.15) continue; // Noise floor threshold
      const prev = i > 0 ? pts[i - 1] : 0;
      const next = i < pts.length - 1 ? pts[i + 1] : 0;

      // Local maximum
      if (p >= prev && p >= next) {
        // Walk backwards to find valley floor / beginning transient
        const vStart = Math.max(0, i - Math.floor(1.5 * pps), Math.floor(minBound * pps));
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
        // Prioritize clear attack rises; reduce distance penalty if searching over dead silence
        const distPenalty = isOverSilence ? dist * 0.15 : dist * 0.5;
        const score = (rise * 3.0) + (p * 2.0) - distPenalty;
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
    if (!seg || !seg.words || seg.words.length === 0) return;

    // Collect all vocal syllables in this segment, ensuring minimum 0.25s per word / 0.20s per syllable
    interface SylRef {
      wIdx: number;
      sIdx: number;
      syl: { text: string; start: number; end: number };
    }
    const lineSyls: SylRef[] = [];
    seg.words.forEach((w, wIdx) => {
      const sylTexts = syllabifyWord(w.text);
      const numSyls = sylTexts.length;
      const curDur = Math.max(0.25 * numSyls, w.end - w.start);
      const syls = (w.syllables && w.syllables.length === numSyls)
        ? w.syllables
        : sylTexts.map((st, si) => {
            return {
              text: st,
              start: Math.round((w.start + (curDur / numSyls) * si) * 100) / 100,
              end: Math.round((w.start + (curDur / numSyls) * (si + 1)) * 100) / 100,
            };
          });
      w.syllables = syls;
      syls.forEach((s, sIdx) => {
        lineSyls.push({ wIdx, sIdx, syl: s });
      });
    });

    if (lineSyls.length === 0) return;

    // Preceding boundary: previous VOCAL segment
    let prevVocalSeg: any = null;
    for (let p = segIdx - 1; p >= 0; p--) {
      if (newLyrics.segments[p].text !== '[INSTRUMENTAL]') {
        prevVocalSeg = newLyrics.segments[p];
        break;
      }
    }
    let runningCursor = prevVocalSeg ? prevVocalSeg.end + 0.1 : 0.0;

    // Following boundary: next VOCAL segment
    let nextVocalSeg: any = null;
    for (let n = segIdx + 1; n < newLyrics.segments.length; n++) {
      if (newLyrics.segments[n].text !== '[INSTRUMENTAL]') {
        nextVocalSeg = newLyrics.segments[n];
        break;
      }
    }
    const maxLineBound = nextVocalSeg ? nextVocalSeg.start - 0.2 : totalDuration;

    // If first syllable sits on flat silence, wide-scan for true vocal onset and shift all syllables
    const firstSyl = lineSyls[0].syl;
    const pts = waveform.peaks;
    const pps = waveform.sampleRate || 50;
    const firstIdx = Math.floor(firstSyl.start * pps);
    const firstAmp = firstIdx >= 0 && firstIdx < pts.length ? pts[firstIdx] : 0;

    if (firstAmp < 0.08) {
      const lineAttack = findVocalAttackPeak(firstSyl.start, runningCursor, maxLineBound - 1.0, firstSyl.end);
      const deltaT = Math.round((lineAttack - firstSyl.start) * 100) / 100;
      if (Math.abs(deltaT) >= 0.15) {
        for (const item of lineSyls) {
          item.syl.start = Math.round((item.syl.start + deltaT) * 100) / 100;
          item.syl.end = Math.round((item.syl.end + deltaT) * 100) / 100;
        }
      }
    }

    for (let i = 0; i < lineSyls.length; i++) {
      const item = lineSyls[i];
      const nextSyl = i < lineSyls.length - 1 ? lineSyls[i + 1].syl : null;
      const nextBound = nextSyl ? Math.max(item.syl.end + 0.4, nextSyl.start) : maxLineBound;

      const peakT = findVocalAttackPeak(item.syl.start, runningCursor, nextBound - 0.12, item.syl.end);
      const originalDur = Math.max(0.18, item.syl.end - item.syl.start);

      item.syl.start = Math.max(runningCursor, Math.min(nextBound - 0.12, peakT));
      const targetEnd = Math.max(item.syl.start + 0.10, Math.min(nextBound, item.syl.start + originalDur));
      item.syl.end = Math.round(targetEnd * 100) / 100;
      item.syl.start = Math.round(item.syl.start * 100) / 100;

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

    // Rebuild clean instrumental breaks after line movement
    const nonMarkers = newLyrics.segments.filter((s) => s.text !== '[INSTRUMENTAL]');
    const finalSegments: LyricSegment[] = [];
    let lastEnd = 0.0;
    for (const s of nonMarkers) {
      if (s.start - lastEnd >= 6.0) {
        const instS = Math.round(lastEnd * 100) / 100;
        const instE = Math.round(s.start * 100) / 100;
        finalSegments.push({
          start: instS,
          end: instE,
          text: '[INSTRUMENTAL]',
          words: [
            {
              text: '[INSTRUMENTAL]',
              start: instS,
              end: instE,
              probability: 1.0,
              isMarker: true,
            },
          ],
        });
      }
      finalSegments.push(s);
      lastEnd = s.end;
    }
    newLyrics.segments = finalSegments;
    setEditedLyrics(newLyrics);
  };

  const alignSelectedLineToPlayhead = (segIdx: number) => {
    if (segIdx < 0 || segIdx >= editedLyrics.segments.length) return;
    const newLyrics: LyricResult = JSON.parse(JSON.stringify(editedLyrics));
    const seg = newLyrics.segments[segIdx];
    if (!seg || seg.text === '[INSTRUMENTAL]' || !seg.words || seg.words.length === 0) return;

    let prevVocal: any = null;
    for (let p = segIdx - 1; p >= 0; p--) {
      if (newLyrics.segments[p].text !== '[INSTRUMENTAL]') {
        prevVocal = newLyrics.segments[p];
        break;
      }
    }
    const minBound = prevVocal ? prevVocal.end + 0.1 : 0.0;

    let nextVocal: any = null;
    for (let n = segIdx + 1; n < newLyrics.segments.length; n++) {
      if (newLyrics.segments[n].text !== '[INSTRUMENTAL]') {
        nextVocal = newLyrics.segments[n];
        break;
      }
    }
    const maxBound = nextVocal ? nextVocal.start - 0.2 : totalDuration;

    // Target start from playhead: snap to nearest vocal attack peak if available
    let targetStart = liveClock;
    if (waveform && waveform.peaks && waveform.peaks.length > 0) {
      targetStart = findVocalAttackPeak(liveClock, minBound, maxBound - 0.5);
    }
    targetStart = Math.max(minBound, Math.min(maxBound - 0.8, targetStart));

    // Syllabify words and compute total syllable count
    const wordSyllables = seg.words.map((w) => syllabifyWord(w.text));
    const totalSyllables = wordSyllables.reduce((acc, syls) => acc + syls.length, 0) || 1;

    // Healthy phrase duration: min 0.35s per syllable, respecting gap before next vocal line
    const availableSpan = maxBound - targetStart;
    const targetPhraseDur = Math.min(availableSpan - 0.2, Math.max(totalSyllables * 0.38, (seg.end - seg.start) || 2.0));
    const phraseDuration = Math.max(0.6, targetPhraseDur);

    // Distribute words and syllables evenly across the phrase starting from targetStart
    let curCursor = targetStart;
    seg.words.forEach((w, wIdx) => {
      const syls = wordSyllables[wIdx];
      const numSyls = syls.length;
      const wDur = Math.max(0.25 * numSyls, (numSyls / totalSyllables) * phraseDuration);
      const wStart = Math.round(curCursor * 100) / 100;
      const wEnd = Math.round((curCursor + wDur) * 100) / 100;

      w.start = wStart;
      w.end = wEnd;
      w.syllables = syls.map((st, si) => {
        const sStart = Math.round((wStart + (wDur / numSyls) * si) * 100) / 100;
        const sEnd = Math.round((wStart + (wDur / numSyls) * (si + 1)) * 100) / 100;
        return { text: st, start: sStart, end: sEnd };
      });

      curCursor = wEnd;
    });

    seg.start = seg.words[0].start;
    seg.end = seg.words[seg.words.length - 1].end;

    // If waveform is available, snap the newly distributed syllables to the vocal peaks in this phrase
    if (waveform && waveform.peaks && waveform.peaks.length > 0) {
      let sylRunning = seg.start;
      for (let wIdx = 0; wIdx < seg.words.length; wIdx++) {
        const w = seg.words[wIdx];
        if (!w.syllables) continue;
        for (let sIdx = 0; sIdx < w.syllables.length; sIdx++) {
          const s = w.syllables[sIdx];
          const isLastInWord = sIdx === w.syllables.length - 1;
          const nextWord = wIdx < seg.words.length - 1 ? seg.words[wIdx + 1] : null;
          const nxtSylStart = isLastInWord
            ? (nextWord?.syllables?.[0]?.start ?? nextWord?.start ?? maxBound)
            : (w.syllables[sIdx + 1]?.start ?? maxBound);

          const sBound = Math.max(s.end + 0.35, nxtSylStart);
          const peakT = findVocalAttackPeak(s.start, sylRunning, sBound - 0.12, s.end);
          const sDur = Math.max(0.18, s.end - s.start);

          s.start = Math.max(sylRunning, Math.min(sBound - 0.12, peakT));
          const targetEnd = Math.max(s.start + 0.10, Math.min(sBound, s.start + sDur));
          s.end = Math.round(targetEnd * 100) / 100;
          s.start = Math.round(s.start * 100) / 100;
          sylRunning = s.end;
        }
        w.start = w.syllables[0].start;
        w.end = w.syllables[w.syllables.length - 1].end;
      }
      seg.start = seg.words[0].start;
      seg.end = seg.words[seg.words.length - 1].end;
    }

    newLyrics.segments[segIdx] = seg;

    // Rebuild clean instrumental breaks
    const nonMarkers = newLyrics.segments.filter((s) => s.text !== '[INSTRUMENTAL]');
    const finalSegments: LyricSegment[] = [];
    let lastEnd = 0.0;
    for (const s of nonMarkers) {
      if (s.start - lastEnd >= 6.0) {
        const instS = Math.round(lastEnd * 100) / 100;
        const instE = Math.round(s.start * 100) / 100;
        finalSegments.push({
          start: instS,
          end: instE,
          text: '[INSTRUMENTAL]',
          words: [
            {
              text: '[INSTRUMENTAL]',
              start: instS,
              end: instE,
              probability: 1.0,
              isMarker: true,
            },
          ],
        });
      }
      finalSegments.push(s);
      lastEnd = s.end;
    }
    newLyrics.segments = finalSegments;
    setEditedLyrics(newLyrics);
  };

  const nudgeSelectedLine = (segIdx: number, delta: number) => {
    if (segIdx < 0 || segIdx >= editedLyrics.segments.length) return;
    const newLyrics: LyricResult = JSON.parse(JSON.stringify(editedLyrics));
    const seg = newLyrics.segments[segIdx];
    if (!seg || seg.text === '[INSTRUMENTAL]') return;

    const minBound = 0.0;
    seg.start = Math.max(minBound, Math.round((seg.start + delta) * 100) / 100);
    seg.end = Math.max(seg.start + 0.5, Math.round((seg.end + delta) * 100) / 100);

    if (seg.words) {
      seg.words.forEach((w) => {
        w.start = Math.max(minBound, Math.round((w.start + delta) * 100) / 100);
        w.end = Math.max(w.start + 0.1, Math.round((w.end + delta) * 100) / 100);
        if (w.syllables) {
          w.syllables.forEach((s) => {
            s.start = Math.max(minBound, Math.round((s.start + delta) * 100) / 100);
            s.end = Math.max(s.start + 0.05, Math.round((s.end + delta) * 100) / 100);
          });
        }
      });
    }

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
              const numSyls = arr.length;
              const wDur = Math.max(0.25 * numSyls, w.end - w.start);
              return {
                text: st,
                start: Math.round((w.start + (wDur / numSyls) * si) * 100) / 100,
                end: Math.round((w.start + (wDur / numSyls) * (si + 1)) * 100) / 100,
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

      const peakT = findVocalAttackPeak(current.syl.start, minBound, maxBound - 0.12, current.syl.end);
      const originalDur = Math.max(0.18, current.syl.end - current.syl.start);

      current.syl.start = Math.max(minBound, Math.min(maxBound - 0.12, peakT));
      const targetEnd = Math.max(current.syl.start + 0.10, Math.min(maxBound, current.syl.start + originalDur));
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

    setEditedLyrics(sanitizeNoOverlapLyrics(newLyrics));
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

  const handleDeoverlapAndSpaceAll = () => {
    const sanitized = sanitizeNoOverlapLyrics(editedLyrics);
    setEditedLyrics(sanitized);
  };

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

    const cleanPayload = sanitizeNoOverlapLyrics(payload);

    // 1. Immediately persist to localStorage for live party playback on this machine
    try {
      localStorage.setItem(`supajuka_lyrics_${song.id}`, JSON.stringify(cleanPayload));
    } catch (e) {}

    // 2. Immediately update state in parent stage
    setEditedLyrics(cleanPayload);
    onSave(cleanPayload);

    // 3. Attempt to save to backend API if available
    try {
      await fetch(`/api/audio/lyrics/${song.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lyrics: cleanPayload }),
      });
    } catch (err: any) {
      // Backend not running (expected on static Firebase Hosting)
    } finally {
      setIsSaving(false);
      onClose();
    }
  };

  const handleExportJson = () => {
    const clean = sanitizeNoOverlapLyrics(editedLyrics);
    const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${song.id}_lyrics.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-2 md:p-6 animate-in fade-in duration-200">
      <div
        className="w-full max-w-7xl h-[94vh] bg-[#181818] border border-[#2d2d2d] rounded-2xl shadow-2xl flex flex-col overflow-hidden font-sans select-none"
      >
        {/* Top Header */}
        <div className="px-6 py-3.5 border-b border-[#2d2d2d] flex items-center justify-between bg-[#1e1e1e] flex-wrap gap-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Sliders size={15} className="text-blue-400" />
              <span>DAW Syllable Keyframe & Waveform Editor</span>
              <span className="text-xs px-2.5 py-0.5 rounded bg-[#252526] text-[#cccccc] border border-[#333333] font-mono">
                {song.title}
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-3">
            {/* Live Playhead Display */}
            <div className="flex items-center gap-2 bg-[#252526] px-3 py-1.5 rounded-lg border border-[#333333]">
              <button
                onClick={togglePlay}
                className="p-1 rounded bg-blue-600 hover:bg-blue-500 text-white transition cursor-pointer shadow-sm"
                title="Play/Pause (Spacebar)"
              >
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <span className="font-mono text-xs text-[#cccccc] font-bold tracking-wider">
                {liveClock.toFixed(2)}s / {totalDuration.toFixed(2)}s
              </span>
            </div>

            {/* Mode Switcher */}
            <div className="flex bg-[#252526] p-0.5 rounded-lg border border-[#333333] text-xs">
              <button
                onClick={() => setMode('visual')}
                className={`px-3 py-1 rounded font-semibold flex items-center gap-1.5 transition cursor-pointer font-mono ${
                  mode === 'visual'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <Sliders size={13} /> Single-Row DAW
              </button>
              <button
                onClick={() => setMode('json')}
                className={`px-3 py-1 rounded font-semibold flex items-center gap-1.5 transition cursor-pointer font-mono ${
                  mode === 'json'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <Code size={13} /> Raw JSON
              </button>
            </div>

            {/* Export JSON Button */}
            <button
              onClick={handleExportJson}
              className="px-3 py-1.5 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-blue-400 hover:text-blue-300 border border-[#333333] text-xs font-mono font-bold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
              title="Download lyrics.json to computer"
            >
              <Download size={13} />
              <span className="hidden sm:inline">Export JSON</span>
            </button>

            {/* Save Button */}
            <button
              onClick={handleSaveToServer}
              disabled={isSaving}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold flex items-center gap-1.5 shadow-sm transition cursor-pointer disabled:opacity-50"
            >
              <Save size={13} />
              {isSaving ? 'Saving...' : 'Save & Sync'}
            </button>

            {/* Close */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-neutral-400 hover:text-white border border-[#333333] transition cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {mode === 'json' ? (
          <div className="flex-1 p-6 flex flex-col min-h-0 bg-[#121212]">
            {jsonError && (
              <div className="mb-3 px-4 py-2 bg-red-950/60 border border-red-800 text-red-300 text-xs rounded-lg font-mono">
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
              className="flex-1 w-full bg-[#181818] border border-[#2d2d2d] rounded-lg p-4 font-mono text-xs text-[#cccccc] focus:outline-none focus:border-blue-500 scrollbar-thin resize-none"
              spellCheck={false}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* DAW Control Toolbar */}
            <div className="px-6 py-2 bg-[#1c1c1c] border-b border-[#2d2d2d] flex items-center justify-between text-xs flex-wrap gap-3 flex-shrink-0">
              <div className="flex items-center gap-4">
                {/* Zoom */}
                <div className="flex items-center gap-1 bg-[#252526] px-2 py-1 rounded-lg border border-[#333333]">
                  <button
                    onClick={() => setZoom((z) => Math.max(60, z <= 240 ? z - 30 : z <= 500 ? z - 60 : z - 100))}
                    className="p-1 rounded bg-[#1e1e1e] hover:bg-[#2a2a2a] text-[#cccccc] cursor-pointer"
                    title="Zoom Out"
                  >
                    <ZoomOut size={13} />
                  </button>
                  <span className="font-mono text-[11px] text-[#cccccc] font-bold px-2 min-w-[65px] text-center">{zoom} px/s</span>
                  <button
                    onClick={() => setZoom((z) => Math.min(1000, z < 240 ? z + 30 : z < 500 ? z + 60 : z + 100))}
                    className="p-1 rounded bg-[#1e1e1e] hover:bg-[#2a2a2a] text-[#cccccc] cursor-pointer"
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
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-[#252526] text-neutral-400 hover:text-white hover:bg-[#2d2d2d] border border-[#333333]'
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
                    className="p-1.5 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] border border-[#333333] cursor-pointer"
                    title="Rewind 1s (Left Arrow)"
                  >
                    <Rewind size={13} />
                  </button>
                  <button
                    onClick={() => scrubDelta(1.0)}
                    className="p-1.5 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] border border-[#333333] cursor-pointer"
                    title="Forward 1s (Right Arrow)"
                  >
                    <FastForward size={13} />
                  </button>
                </div>

                {/* Center view buttons */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => scrollToTime(liveClock)}
                    className="px-2.5 py-1 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-blue-300 border border-[#333333] flex items-center gap-1.5 cursor-pointer font-semibold font-mono"
                    title="Center view on playhead"
                  >
                    <LocateFixed size={13} />
                    <span className="hidden sm:inline">Center Playhead</span>
                  </button>
                  {selectedKeyframe && (
                    <button
                      onClick={() => scrollToTime(selectedKeyframe.start)}
                      className="px-2.5 py-1 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-amber-300 border border-[#333333] flex items-center gap-1.5 cursor-pointer font-semibold font-mono"
                      title="Center view on selected syllable"
                    >
                      <Focus size={13} />
                      <span className="hidden sm:inline">Center Syllable</span>
                    </button>
                  )}
                </div>

                {/* Acapella Stem Badge */}
                <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-[#18222d] border border-blue-600/60 text-blue-300 font-mono text-[11px]">
                  <Activity size={13} className="text-blue-400 animate-pulse" />
                  <span className="font-bold">Acapella Stem Waveform</span>
                </div>

                {/* Automated Peak Snapping Button for ENTIRE SONG */}
                <button
                  onClick={snapAllSyllablesToPeaks}
                  disabled={!waveform || !waveform.peaks || waveform.peaks.length === 0}
                  className="px-3 py-1 rounded-lg bg-[#282116] hover:bg-[#342a1c] border border-amber-600/70 text-amber-300 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-sm disabled:opacity-40 font-mono"
                  title="Automatically snap all syllable start positions to vocal audio waveform peaks"
                >
                  <Zap size={13} className="text-amber-400" />
                  <span>Snap All to Peaks</span>
                </button>

                {/* Fix Spacing & De-Overlap All Button */}
                <button
                  onClick={handleDeoverlapAndSpaceAll}
                  className="px-3 py-1 rounded-lg bg-[#14232c] hover:bg-[#1a2f3b] border border-cyan-500/70 text-cyan-300 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-sm font-mono"
                  title="Expand crushed syllables, eliminate overlapping keyframes, and ensure clean DAW spacing"
                >
                  <Sliders size={13} className="text-cyan-400" />
                  <span>Fix Spacing & Overlaps</span>
                </button>

                <div className="text-neutral-400 text-xs hidden 2xl:block font-mono">
                  <span className="text-blue-400 font-semibold">Single-Row Lane:</span> Syllables sit sequentially over audio peaks with zero overlap. Drag edges to adjust attack/sustain. Spacebar toggles Play/Pause.
                </div>
              </div>

              {selectedKeyframe && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => auditionKeyframe(selectedKeyframe)}
                    className="px-3 py-1 rounded-lg bg-[#18222d] border border-blue-600/60 text-blue-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-blue-900/40 transition cursor-pointer shadow-sm font-mono"
                  >
                    <Play size={12} /> Play Syllable ({selectedKeyframe.text})
                  </button>
                  {selectedSeg && (
                    <button
                      onClick={() => auditionSegment(selectedSeg.start)}
                      className="px-3 py-1 rounded-lg bg-[#252526] border border-[#3e3e42] text-neutral-200 text-xs font-semibold flex items-center gap-1.5 hover:bg-[#2d2d2d] transition cursor-pointer shadow-sm font-mono"
                    >
                      <Play size={12} /> Play Line
                    </button>
                  )}
                  {selectedSeg && (
                    <button
                      onClick={() => snapSelectedLineToPeaks(selectedSegIdx)}
                      disabled={!waveform || !waveform.peaks || waveform.peaks.length === 0}
                      className="px-3 py-1 rounded-lg bg-[#282116] border border-amber-700/80 text-amber-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-[#342a1c] transition cursor-pointer shadow-sm disabled:opacity-40 font-mono"
                      title="Snap all syllables in this line to local vocal peaks"
                    >
                      <Zap size={12} className="text-amber-400" /> Snap Line
                    </button>
                  )}
                  {selectedSeg && (
                    <button
                      onClick={() => alignSelectedLineToPlayhead(selectedSegIdx)}
                      className="px-3 py-1 rounded-lg bg-[#15241b] border border-emerald-700/80 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-[#1d3527] transition cursor-pointer shadow-sm font-mono"
                      title="Align start of this line to current scrubber playhead time"
                    >
                      <Target size={12} className="text-emerald-400" /> Align Line to Playhead
                    </button>
                  )}
                  {selectedSeg && (
                    <div className="flex items-center gap-1 pl-1 border-l border-[#333333]">
                      <span className="text-[10px] text-neutral-400 font-mono font-semibold">Nudge:</span>
                      <button
                        onClick={() => nudgeSelectedLine(selectedSegIdx, -0.5)}
                        className="px-1.5 py-0.5 rounded bg-[#252526] hover:bg-[#2d2d2d] border border-[#333333] text-neutral-300 text-[10px] font-mono cursor-pointer"
                        title="Nudge entire line -0.5s"
                      >
                        -0.5s
                      </button>
                      <button
                        onClick={() => nudgeSelectedLine(selectedSegIdx, 0.5)}
                        className="px-1.5 py-0.5 rounded bg-[#252526] hover:bg-[#2d2d2d] border border-[#333333] text-neutral-300 text-[10px] font-mono cursor-pointer"
                        title="Nudge entire line +0.5s"
                      >
                        +0.5s
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Scrollable Single-Row DAW Timeline Track */}
            <div
              ref={timelineScrollRef}
              className="flex-1 overflow-x-auto overflow-y-hidden bg-[#121212] p-6 relative select-none scrollbar-thin scrollbar-thumb-[#2d2d2d] flex flex-col justify-center"
            >
              <div
                ref={timelineContentRef}
                style={{ width: `${totalDuration * zoom}px`, height: '220px' }}
                onClick={handleTimelineScrubClick}
                className="relative cursor-pointer select-none"
              >
                {/* Second Ruler with Click-to-Scrub & Sub-second Ticks */}
                <div className="h-7 border-b border-[#2d2d2d] relative bg-[#181818]/95 z-20 overflow-hidden">
                  {Array.from({ length: Math.ceil(totalDuration) }).map((_, sec) => {
                    if (sec % 2 !== 0 && zoom < 60) return null;
                    return (
                      <React.Fragment key={sec}>
                        <div
                          style={{ left: `${sec * zoom}px` }}
                          className="absolute top-0 flex flex-col items-start pointer-events-none"
                        >
                          <span className="text-[10px] font-mono text-[#858585] pl-1 font-bold">{sec}s</span>
                          <div className="w-px h-3.5 bg-[#333333]" />
                        </div>

                        {/* Half-second mark at zoom >= 200 */}
                        {zoom >= 200 && (
                          <div
                            style={{ left: `${(sec + 0.5) * zoom}px` }}
                            className="absolute top-0 flex flex-col items-start pointer-events-none"
                          >
                            <span className="text-[9px] font-mono text-[#555555] pl-0.5">{sec}.5s</span>
                            <div className="w-px h-2 bg-[#2d2d2d]" />
                          </div>
                        )}

                        {/* Quarter-second tick marks at zoom >= 500 */}
                        {zoom >= 500 && (
                          <>
                            <div
                              style={{ left: `${(sec + 0.25) * zoom}px` }}
                              className="absolute top-2 w-px h-1.5 bg-[#2d2d2d] pointer-events-none"
                            />
                            <div
                              style={{ left: `${(sec + 0.75) * zoom}px` }}
                              className="absolute top-2 w-px h-1.5 bg-[#2d2d2d] pointer-events-none"
                            />
                          </>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>

                {/* TRACK CONTAINER (Waveform Background + Single Row Syllable Keyframes) */}
                <div className="relative w-full h-[180px] bg-[#121212] border-b border-[#2d2d2d] overflow-hidden">
                  
                  {/* Layer 1: Acapella Waveform SVG Background - Rendered in Crisp Sky Blue above block fills */}
                  {waveformPathD && (
                    <svg
                      className="absolute inset-0 w-full h-full pointer-events-none z-20"
                      style={{ width: `${totalDuration * zoom}px`, height: '180px' }}
                    >
                      <line
                        x1="0"
                        y1="90"
                        x2={totalDuration * zoom}
                        y2="90"
                        stroke="rgba(71, 85, 105, 0.45)"
                        strokeDasharray="4 4"
                      />
                      <path
                        d={waveformPathD}
                        fill="rgba(56, 189, 248, 0.25)"
                        stroke="#38bdf8"
                        strokeWidth="1.4"
                      />
                    </svg>
                  )}

                  {/* Layer 2: Single-Row Syllable Keyframe Blocks (Non-Overlapping, Transparent Glass Body) */}
                  <div className="absolute inset-0 z-10 pointer-events-none">
                    {allKeyframes.map((kf, kfIdx) => {
                      const isSelected = kf.key === selectedKeyframe?.key;
                      const left = kf.start * zoom;
                      const naturalWidth = (kf.end - kf.start) * zoom;
                      const nextKf = allKeyframes[kfIdx + 1];
                      // Max allowable width in pixels before entering next keyframe's horizontal territory:
                      const distToNext = nextKf ? (nextKf.start - kf.start) * zoom : naturalWidth;
                      const maxAllowedWidth = nextKf ? Math.max(4, distToNext) : naturalWidth;
                      const width = Math.max(4, Math.min(naturalWidth, maxAllowedWidth));
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
                            className={`absolute top-2 h-8 rounded border border-dashed cursor-move flex items-center justify-between px-2.5 shadow-sm transition-all pointer-events-auto select-none overflow-hidden ${
                              isSelected
                                ? 'bg-blue-950/80 border-blue-400 text-blue-200 ring-2 ring-blue-400/80 shadow-[0_0_15px_rgba(59,130,246,0.3)] z-30'
                                : 'bg-[#18222d]/40 border-blue-600/40 text-blue-300/80 hover:bg-[#18222d]/60 hover:border-blue-500 z-10'
                            }`}
                          >
                            {/* Left handle */}
                            <div
                              onMouseDown={(e) => handleKfMouseDown(e, kf, kfIdx, 'left')}
                              className="absolute left-0 top-0 bottom-0 w-2.5 bg-blue-500/60 hover:bg-blue-400 rounded-l cursor-ew-resize z-30"
                              title="Adjust start of instrumental break"
                            />
                            <span className="text-[11px] font-mono font-bold truncate pl-1">
                              [INSTRUMENTAL]
                            </span>
                            <span className="text-[10px] font-mono text-blue-300/70 pr-1">
                              {(kf.end - kf.start).toFixed(1)}s
                            </span>
                            {/* Right handle */}
                            <div
                              onMouseDown={(e) => handleKfMouseDown(e, kf, kfIdx, 'right')}
                              className="absolute right-0 top-0 bottom-0 w-2.5 bg-blue-500/60 hover:bg-blue-400 rounded-r cursor-ew-resize z-30"
                              title="Adjust end of instrumental break"
                            />
                          </div>
                        );
                      }

                      const curSylIdx = Math.floor(kf.start * (waveform?.sampleRate || 50));
                      const curSylAmp = (waveform?.peaks && curSylIdx >= 0 && curSylIdx < waveform.peaks.length)
                        ? waveform.peaks[curSylIdx]
                        : 0.5;
                      const isSylOverSilence = curSylAmp < 0.04;

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
                          className={`absolute top-2 bottom-2 rounded-lg border cursor-move flex flex-col justify-between p-1 transition-all pointer-events-auto select-none overflow-hidden ${
                            isSelected
                              ? 'bg-amber-400/10 border-2 border-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.35)] ring-1 ring-amber-400/70 z-30'
                              : kf.sIdx === selectedSegIdx
                              ? 'bg-blue-500/10 border border-blue-500/60 text-blue-100 hover:border-blue-400 hover:bg-blue-500/15 z-20'
                              : isSylOverSilence
                              ? 'bg-amber-950/10 border border-amber-700/50 text-slate-300 hover:border-amber-400 hover:bg-amber-950/20 z-10'
                              : 'bg-[#181818]/15 border border-[#333333] text-neutral-300 hover:border-neutral-500 hover:bg-[#222222]/25 z-10'
                          }`}
                        >
                          {/* Left Resize Handle (Attack / Onset) - Flush inside left edge: ZERO Overlap */}
                          <div
                            onMouseDown={(e) => handleKfMouseDown(e, kf, kfIdx, 'left')}
                            className="absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize z-40 group flex flex-col justify-between items-start select-none"
                            title="Drag to adjust syllable onset (attack)"
                          >
                            {/* Top Grab Flag */}
                            <div className="w-2 h-3 bg-amber-400 hover:bg-amber-300 rounded-r-sm shadow-sm flex items-center justify-center transition-colors">
                              <div className="w-1 h-0.5 bg-neutral-950 rounded-full" />
                            </div>

                            {/* Center Hairline - 1.5px Laser Line */}
                            <div className="w-[1.5px] flex-1 bg-amber-400/90 group-hover:bg-amber-300 group-hover:w-[2px] transition-all" />

                            {/* Bottom Grab Pip */}
                            <div className="w-1.5 h-1.5 bg-amber-400 hover:bg-amber-300 rounded-r-sm shadow-sm transition-colors" />
                          </div>

                          {/* Top Header: Syllable Text Pill */}
                          <div className="flex items-center justify-between overflow-hidden pointer-events-none px-1 relative z-20">
                            <span
                              className={`font-bold text-[10px] uppercase px-1 py-0.5 rounded tracking-wide truncate font-mono shadow-sm ${
                                isSelected
                                  ? 'bg-amber-400 text-neutral-950 shadow-amber-400/30'
                                  : 'bg-[#1e1e1e]/90 text-neutral-200 border border-neutral-700/80'
                              }`}
                            >
                              {kf.text}
                            </span>
                            {/* Silence Warning Indicator */}
                            {isSylOverSilence && width >= 44 && (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse ml-1 shrink-0"
                                title="Positioned over silence (no vocal energy detected)"
                              />
                            )}
                          </div>

                          {/* Center Body: Transparent gap allowing vocal waveform peaks to be visible directly through the card */}
                          <div className="flex-1 pointer-events-none" />

                          {/* Bottom Tag: Timestamp & Duration - Displayed when width allows */}
                          {width >= 42 && (
                            <div className="flex items-center justify-between text-[9px] font-mono text-neutral-400 font-semibold px-1 py-0.5 bg-[#181818]/90 rounded border border-[#2d2d2d] pointer-events-none mx-0.5 relative z-20">
                              <span className="truncate">{kf.start.toFixed(2)}s</span>
                              <span className="text-amber-300 font-bold pl-1">
                                {(kf.end - kf.start).toFixed(2)}s
                              </span>
                            </div>
                          )}

                          {/* Right Resize Handle (Sustain / Release) - Flush inside right edge: ZERO Overlap */}
                          <div
                            onMouseDown={(e) => handleKfMouseDown(e, kf, kfIdx, 'right')}
                            className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize z-40 group flex flex-col justify-between items-end select-none"
                            title="Drag to adjust syllable duration (sustain)"
                          >
                            {/* Top Grab Flag */}
                            <div className="w-2 h-3 bg-blue-500 hover:bg-blue-400 rounded-l-sm shadow-sm flex items-center justify-center transition-colors">
                              <div className="w-1 h-0.5 bg-white rounded-full" />
                            </div>

                            {/* Center Hairline - 1.5px Laser Line */}
                            <div className="w-[1.5px] flex-1 bg-blue-400/90 group-hover:bg-blue-300 group-hover:w-[2px] transition-all" />

                            {/* Bottom Grab Pip */}
                            <div className="w-1.5 h-1.5 bg-blue-500 hover:bg-blue-400 rounded-l-sm shadow-sm transition-colors" />
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
                            ? 'bg-amber-400 shadow-[0_0_12px_#fbbf24]'
                            : 'bg-blue-400 shadow-[0_0_12px_#388bfd]'
                        }`}
                      />
                      <div
                        className={`absolute -top-7 -left-12 px-2 py-0.5 rounded text-[10px] font-mono font-extrabold text-white shadow-xl whitespace-nowrap border ${
                          kfDragState.type === 'left'
                            ? 'bg-amber-600 border-amber-400 shadow-amber-600/50'
                            : 'bg-blue-600 border-blue-400 shadow-blue-600/50'
                        }`}
                      >
                        {(kfDragState.currentPosSec ?? (kfDragState.type === 'left' ? kfDragState.initialStart : kfDragState.initialEnd)).toFixed(2)}s ({kfDragState.type === 'left' ? 'Attack' : 'Release'})
                      </div>
                    </div>
                  )}

                  {/* Layer 3: Live Vertical Audio Playhead & Draggable Scrubber */}
                  <div
                    style={{ transform: `translate3d(${liveClock * zoom}px, 0, 0)` }}
                    className="absolute top-0 bottom-0 z-50 pointer-events-none will-change-transform"
                  >
                    <div className="w-0.5 h-full bg-blue-400 shadow-[0_0_8px_#388bfd]" />
                    <div
                      onMouseDown={handleScrubberMouseDown}
                      className="absolute -top-3.5 -left-3 w-6 h-6 rounded bg-[#007acc] border-2 border-white shadow-[0_0_12px_#007acc] flex items-center justify-center cursor-ew-resize pointer-events-auto hover:scale-110 active:scale-95 transition-transform z-50"
                      title={`Scrub: ${liveClock.toFixed(2)}s (Drag to scrub audio live)`}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    </div>
                    <div className="absolute top-5 -left-7 px-1.5 py-0.5 rounded bg-[#1e1e1e] border border-blue-500 text-[10px] font-mono text-blue-200 font-bold pointer-events-none shadow-lg whitespace-nowrap z-50">
                      {liveClock.toFixed(2)}s
                    </div>
                  </div>

                </div>
              </div>
            </div>

            {/* Micro-Tuning & Inspector Panel (Bottom) */}
            <div className="h-56 bg-[#181818] border-t border-[#2d2d2d] p-4 flex flex-col md:flex-row gap-6 flex-shrink-0">
              {/* Syllable Keyframe Inspector */}
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-neutral-400 font-mono">
                        Selected Syllable Keyframe:
                      </span>
                      <span className="px-2.5 py-0.5 rounded-lg bg-[#252526] border border-amber-500/60 text-amber-300 font-bold font-mono text-sm shadow-sm">
                        {selectedKeyframe ? `"${selectedKeyframe.text}"` : 'None'}
                      </span>
                      {selectedKeyframe && !selectedKeyframe.isInstrumental && (
                        <span className="text-xs text-neutral-400 font-mono">
                          (in word: <span className="text-white font-semibold">{selectedKeyframe.fullWordText}</span>)
                        </span>
                      )}

                      {/* Syllable Step Buttons */}
                      <div className="flex items-center gap-1 ml-2">
                        <button
                          onClick={() => stepKeyframe(-1)}
                          disabled={!selectedKeyframe || allKeyframes.findIndex((k) => k.key === selectedKeyframe.key) <= 0}
                          className="px-2 py-0.5 rounded bg-[#252526] hover:bg-[#2d2d2d] text-neutral-300 disabled:opacity-30 border border-[#333333] text-xs font-mono font-semibold flex items-center gap-1 cursor-pointer"
                          title="Previous Syllable (Up Arrow)"
                        >
                          <ChevronLeft size={13} /> Prev Syllable
                        </button>
                        <button
                          onClick={() => stepKeyframe(1)}
                          disabled={!selectedKeyframe || allKeyframes.findIndex((k) => k.key === selectedKeyframe.key) >= allKeyframes.length - 1}
                          className="px-2 py-0.5 rounded bg-[#252526] hover:bg-[#2d2d2d] text-neutral-300 disabled:opacity-30 border border-[#333333] text-xs font-mono font-semibold flex items-center gap-1 cursor-pointer"
                          title="Next Syllable (Down Arrow)"
                        >
                          Next Syllable <ChevronRight size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Direct Millisecond Number Inputs */}
                    {selectedKeyframe && (
                      <div className="flex items-center gap-2 text-xs font-mono text-neutral-300 bg-[#141414] px-3 py-1 rounded-lg border border-[#2d2d2d]">
                        <div className="flex items-center gap-1">
                          <span className="text-neutral-400 font-sans">Onset:</span>
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
                            className="w-16 bg-[#1e1e1e] border border-[#333333] rounded px-1.5 py-0.5 text-blue-300 font-bold focus:outline-none focus:border-blue-400 text-right"
                          />
                          <span className="text-neutral-500">s</span>
                        </div>
                        <span className="text-neutral-600">|</span>
                        <div className="flex items-center gap-1">
                          <span className="text-neutral-400 font-sans">End:</span>
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
                            className="w-16 bg-[#1e1e1e] border border-[#333333] rounded px-1.5 py-0.5 text-blue-300 font-bold focus:outline-none focus:border-blue-400 text-right"
                          />
                          <span className="text-neutral-500">s</span>
                        </div>
                        <span className="text-neutral-600">|</span>
                        <div className="flex items-center gap-1">
                          <span className="text-neutral-400 font-sans">Dur:</span>
                          <strong className="text-amber-300 font-mono font-bold">
                            {(selectedKeyframe.end - selectedKeyframe.start).toFixed(2)}s
                          </strong>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Micro-Nudge Shift Controls */}
                  <div className="flex items-center gap-3 flex-wrap mt-2.5">
                    <div className="flex items-center gap-1 bg-[#141414] p-1 rounded-lg border border-[#2d2d2d]">
                      <span className="text-[11px] font-semibold text-neutral-400 px-2 font-mono">Position Nudge:</span>
                      <button
                        onClick={() => nudgeSelectedKeyframe(-0.05, 'both')}
                        className="px-2 py-1 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] text-xs font-mono font-bold transition cursor-pointer"
                        title="Shift entire syllable -50ms earlier"
                      >
                        -50ms
                      </button>
                      <button
                        onClick={() => nudgeSelectedKeyframe(-0.02, 'both')}
                        className="px-2 py-1 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] text-xs font-mono font-bold transition cursor-pointer"
                        title="Shift entire syllable -20ms earlier"
                      >
                        -20ms
                      </button>
                      <button
                        onClick={() => nudgeSelectedKeyframe(-0.01, 'both')}
                        className="px-1.5 py-1 rounded bg-[#252526] hover:bg-[#2d2d2d] text-neutral-300 text-xs font-mono transition cursor-pointer"
                        title="Shift entire syllable -10ms earlier"
                      >
                        -10ms
                      </button>
                      <button
                        onClick={() => nudgeSelectedKeyframe(0.01, 'both')}
                        className="px-1.5 py-1 rounded bg-[#252526] hover:bg-[#2d2d2d] text-neutral-300 text-xs font-mono transition cursor-pointer"
                        title="Shift entire syllable +10ms later"
                      >
                        +10ms
                      </button>
                      <button
                        onClick={() => nudgeSelectedKeyframe(0.02, 'both')}
                        className="px-2 py-1 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] text-xs font-mono font-bold transition cursor-pointer"
                        title="Shift entire syllable +20ms later"
                      >
                        +20ms
                      </button>
                      <button
                        onClick={() => nudgeSelectedKeyframe(0.05, 'both')}
                        className="px-2 py-1 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] text-xs font-mono font-bold transition cursor-pointer"
                        title="Shift entire syllable +50ms later"
                      >
                        +50ms
                      </button>
                    </div>

                    <div className="flex items-center gap-1 bg-[#141414] p-1 rounded-lg border border-[#2d2d2d]">
                      <span className="text-[11px] font-semibold text-neutral-400 px-2 font-mono">Onset (Attack):</span>
                      <button
                        onClick={() => nudgeSelectedKeyframe(-0.02, 'start')}
                        className="px-2 py-1 rounded bg-[#252526] hover:bg-[#2d2d2d] text-amber-300 text-xs font-mono font-bold transition cursor-pointer"
                        title="Move onset earlier -20ms"
                      >
                        -20ms
                      </button>
                      <button
                        onClick={() => nudgeSelectedKeyframe(0.02, 'start')}
                        className="px-2 py-1 rounded bg-[#252526] hover:bg-[#2d2d2d] text-amber-300 text-xs font-mono font-bold transition cursor-pointer"
                        title="Move onset later +20ms"
                      >
                        +20ms
                      </button>
                    </div>

                    {/* Snap Single Syllable to Peak */}
                    <div className="flex items-center gap-1 bg-[#141414] p-1 rounded-lg border border-[#2d2d2d]">
                      <button
                        onClick={snapSelectedKeyframeToPeak}
                        disabled={!selectedKeyframe || !waveform || !waveform.peaks || waveform.peaks.length === 0}
                        className="px-2 py-1 rounded bg-[#282116] hover:bg-[#342a1c] border border-amber-700/80 text-amber-300 text-xs font-mono font-bold transition cursor-pointer flex items-center gap-1 disabled:opacity-40"
                        title="Snap this syllable's onset directly to the nearest acoustic peak"
                      >
                        <Zap size={11} className="text-amber-400" /> Snap to Peak
                      </button>
                    </div>

                    <div className="flex items-center gap-1 bg-[#141414] p-1 rounded-lg border border-[#2d2d2d]">
                      <span className="text-[11px] font-semibold text-neutral-400 px-2 font-mono">Release (Sustain):</span>
                      <button
                        onClick={() => nudgeSelectedKeyframe(-0.02, 'end')}
                        className="px-2 py-1 rounded bg-[#252526] hover:bg-[#2d2d2d] text-blue-300 text-xs font-mono font-bold transition cursor-pointer"
                        title="Shorten sustain -20ms"
                      >
                        -20ms
                      </button>
                      <button
                        onClick={() => nudgeSelectedKeyframe(0.02, 'end')}
                        className="px-2 py-1 rounded bg-[#252526] hover:bg-[#2d2d2d] text-blue-300 text-xs font-mono font-bold transition cursor-pointer"
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
                    <span className="text-xs font-semibold text-neutral-400 whitespace-nowrap font-mono">Edit Line Text:</span>
                    <input
                      type="text"
                      value={selectedSeg.text}
                      onChange={(e) => updateLineText(e.target.value)}
                      className="flex-1 bg-[#141414] border border-[#2d2d2d] rounded-lg px-3 py-1.5 text-xs text-white font-semibold focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                )}
              </div>

              {/* Line Navigation & Audition Box */}
              <div className="w-full md:w-64 bg-[#141414] p-3 rounded-xl border border-[#2d2d2d] flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs text-neutral-400 mb-2 font-mono">
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
                        className="p-1 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] disabled:opacity-30 cursor-pointer border border-[#333333]"
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
                        className="p-1 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] disabled:opacity-30 cursor-pointer border border-[#333333]"
                        title="Next Line"
                      >
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-white font-semibold truncate font-mono">
                    {selectedSeg?.text || 'No line selected'}
                  </p>
                </div>

                <div className="flex flex-col gap-1.5 mt-3">
                  {selectedKeyframe && (
                    <button
                      onClick={() => auditionKeyframe(selectedKeyframe)}
                      className="w-full py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm"
                    >
                      <Play size={12} /> Audition Syllable ({selectedKeyframe.text})
                    </button>
                  )}
                  {selectedSeg && (
                    <button
                      onClick={() => auditionSegment(selectedSeg.start)}
                      className="w-full py-1.5 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] border border-[#3e3e42] text-neutral-200 text-xs font-mono font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
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
