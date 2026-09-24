import fs from 'fs';
import path from 'path';
import { getMetadata, saveMetadata } from './metadata.js';
import { getPlainLyricsPath, getLyricsPath, getSongDir } from './paths.js';
import { LyricResult, LyricSegment, LyricWord } from '../types.js';

let customGeminiKey = process.env.GEMINI_API_KEY || '';

export function getGeminiKey(): string {
  return customGeminiKey || process.env.GEMINI_API_KEY || '';
}

export function setGeminiKey(key: string): void {
  customGeminiKey = key.trim();
  try {
    const envPath = path.join(process.cwd(), '.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
    if (envContent.includes('GEMINI_API_KEY=')) {
      envContent = envContent.replace(/GEMINI_API_KEY=.*/, `GEMINI_API_KEY=${customGeminiKey}`);
    } else {
      envContent += `\nGEMINI_API_KEY=${customGeminiKey}\n`;
    }
    fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf-8');
  } catch (e) {
    console.error('Failed to update .env with GEMINI_API_KEY', e);
  }
}

/**
 * Syllabifies an English word into readable vowel clusters.
 */
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
  let cur = '';
  for (let i = 0; i < core.length; i++) {
    cur += core[i];
    if (vowels.includes(core[i]) && i < core.length - 2) {
      if (!vowels.includes(core[i + 1]) && vowels.includes(core[i + 2])) {
        chunks.push(cur);
        cur = '';
      } else if (!vowels.includes(core[i + 1]) && !vowels.includes(core[i + 2]) && i < core.length - 3 && vowels.includes(core[i + 3])) {
        cur += core[i + 1];
        i++;
        chunks.push(cur);
        cur = '';
      }
    }
  }
  if (cur) chunks.push(cur);
  if (chunks.length > 0) {
    chunks[0] = lead + chunks[0];
    chunks[chunks.length - 1] += trail;
    return chunks;
  }
  return [word];
}

/**
 * Parse standard LRC format into fully populated LyricResult segments & words
 * using realistic syllable-aware vocal singing duration (min 0.25s per word / 0.22s per syllable)
 * so words highlight in exact sync with vocals rather than dragging across guitar breaks or collapsing into slivers.
 */
export function parseLrcToLyricResult(lrc: string, totalDuration: number = 240): LyricResult {
  const lines = lrc.split('\n');
  const parsed: { start: number; text: string }[] = [];
  const regex = /\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)/;

  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseFloat(match[2]);
      const start = Math.round((minutes * 60 + seconds) * 100) / 100;
      const text = match[3].trim();
      if (text) {
        parsed.push({ start, text });
      }
    }
  }

  const segments: LyricSegment[] = [];
  let lastEnd = 0.0;

  for (let i = 0; i < parsed.length; i++) {
    const cur = parsed[i];
    const next = parsed[i + 1];
    const end = next ? next.start : Math.round((cur.start + 4.0) * 100) / 100;

    // Check for instrumental break before this line (gap >= 6.0s)
    if (cur.start - lastEnd >= 6.0) {
      const instStart = Math.round(lastEnd * 100) / 100;
      const instEnd = Math.round(cur.start * 100) / 100;
      segments.push({
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

    const totalGap = end - cur.start;
    const rawWords = cur.text.split(/\s+/).filter(Boolean);
    if (rawWords.length === 0) continue;

    // Estimate syllables per word to prevent single-letter words like "a" or "I" from collapsing
    const wordSyllables = rawWords.map((w) => syllabifyWord(w));
    const totalSyllables = wordSyllables.reduce((acc, syls) => acc + syls.length, 0) || 1;

    // Vocal tempo: allocate minimum 0.35s per syllable
    const minDurBySyllables = Math.max(rawWords.length * 0.40, totalSyllables * 0.38);
    const expectedSingingDur = Math.min(totalGap - 0.25, minDurBySyllables);
    const singingDuration = Math.max(0.6, Math.min(totalGap, expectedSingingDur));

    let wordStart = cur.start;
    const words: LyricWord[] = [];
    for (let wIdx = 0; wIdx < rawWords.length; wIdx++) {
      const w = rawWords[wIdx];
      const syls = wordSyllables[wIdx];
      const numSyls = syls.length;
      // Proportional to syllable count, with minimum 0.25s per word
      const wDuration = Math.max(0.25 * numSyls, (numSyls / totalSyllables) * singingDuration);
      const wEnd = Math.round((wordStart + wDuration) * 100) / 100;

      // Pre-populate clean syllables on the word
      const syllables = syls.map((st, si) => {
        const sStart = Math.round((wordStart + (wDuration / numSyls) * si) * 100) / 100;
        const sEnd = Math.round((wordStart + (wDuration / numSyls) * (si + 1)) * 100) / 100;
        return { text: st, start: sStart, end: sEnd };
      });

      words.push({
        text: w,
        start: Math.round(wordStart * 100) / 100,
        end: wEnd,
        probability: 1.0,
        syllables: syllables,
      });
      wordStart = wEnd;
    }

    const vocalLineEnd = words.length > 0 ? words[words.length - 1].end : end;

    segments.push({
      start: cur.start,
      end: vocalLineEnd,
      text: cur.text,
      words: words,
    });
    lastEnd = vocalLineEnd;
  }

  return {
    language: 'en',
    duration: totalDuration,
    source: 'canonical_synced_lrc',
    segments: segments,
    text: segments.filter(s => s.text !== '[INSTRUMENTAL]').map((s) => s.text).join(' '),
  };
}

/**
 * Clean and sanitize raw lyric text.
 */
function sanitizeLyricText(raw: string): string {
  const lines = raw.split('\n');
  const cleaned: string[] = [];
  for (let l of lines) {
    l = l.trim();
    l = l.replace(/\*\*/g, '').replace(/\*/g, '').replace(/_/g, '').trim();
    if (!l || l === '***' || l === '---' || l === '===') continue;
    if (/^\[.*\]$/.test(l) || /^\(Chorus.*\)$/i.test(l) || /^\(Verse.*\)$/i.test(l)) continue;
    if (
      l.toLowerCase().startsWith('here are the lyrics') ||
      l.toLowerCase().startsWith('lyrics to') ||
      l.toLowerCase().startsWith('song:') ||
      l.toLowerCase().startsWith('title:') ||
      l.toLowerCase().startsWith('album:') ||
      l.toLowerCase().startsWith('artist:')
    ) {
      continue;
    }
    cleaned.push(l);
  }
  return cleaned.join('\n');
}

/**
 * Fetch official lyrics from LRCLIB.
 * Returns either parsed LyricResult (if synced) or plain text.
 */

export function cleanArtist(artist: string): string {
  let cleaned = (artist || '').trim();
  cleaned = cleaned
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s+Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\s+VEVO$/i, '')
    .replace(/\s+Official$/i, '')
    .replace(/\s+Records$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  // If camelCase or handle like "TheKillersMusic" or "JourneyVEVO"
  if (/^[A-Za-z0-9_]+Music$/i.test(cleaned) && cleaned.length > 5) {
    cleaned = cleaned.replace(/Music$/i, '');
  }
  if (/^[A-Za-z0-9_]+Official$/i.test(cleaned) && cleaned.length > 8) {
    cleaned = cleaned.replace(/Official$/i, '');
  }
  if (/^[A-Za-z0-9_]+Records$/i.test(cleaned) && cleaned.length > 7) {
    cleaned = cleaned.replace(/Records$/i, '');
  }

  return cleaned.trim();
}

/**
 * Intelligent song title cleaner.
 * Strips artist prefixes ("Artist - ", "Artist : "), YouTube video tags,
 * release annotations, and quotes to produce a pristine canonical song title.
 */
export function cleanSongTitle(title: string, rawArtist?: string): string {
  let cleaned = (title || '').trim();

  // 1. If artist is provided, strip leading "Artist - " or "Artist : " (case-insensitive)
  if (rawArtist) {
    const artist = cleanArtist(rawArtist);
    if (artist && artist.toLowerCase() !== 'unknown artist') {
      const escaped = artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      cleaned = cleaned.replace(new RegExp(`^${escaped}\\s*[-–—:]\\s*`, 'i'), '');
    }
  }

  // 2. If title has "X - Y" and left side looks like artist, strip it
  if (cleaned.includes(' - ') || cleaned.includes(' – ') || cleaned.includes(' — ')) {
    const parts = cleaned.split(/\s*[-–—]\s*/);
    if (parts.length >= 2) {
      if (rawArtist && cleanArtist(rawArtist).toLowerCase().includes(parts[0].toLowerCase())) {
        cleaned = parts.slice(1).join(' - ');
      }
    }
  }

  // 3. Strip trailing YouTube / release tags in parentheses, brackets, or after vertical pipes
  cleaned = cleaned
    .replace(/\s*\|.*$/g, '') // Strip "| Official Video", "| Vevo", etc.
    .replace(/\s*[\(\[](?:official(?:\s+(?:music\s+|lyric\s+)?video|\s+audio)?|lyric\s+video|lyrics?|visualizer|audio|hd|4k|hq|remaster(?:ed)?|deluxe(?: edition)?|bonus track|anniversary(?: edition)?)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*[\(\[]video\s+officiel[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*[\(\[]?(?:ft\.?|feat\.?|featuring)\s+[^()\]]+[\)\]]?/gi, '') // Strip "ft. Lil Baby, DaBaby"
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '') // Strip quotes around title
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
}

/**
 * Intelligent artist & song title extractor from raw metadata.
 * Correctly parses "Artist - Title (Official Video)" patterns,
 * cross-references against YouTube channel handles, and removes video/release noise.
 */
export function extractArtistAndTitle(rawTitle: string, rawArtist?: string): { artist: string; title: string } {
  let cleanedTitle = (rawTitle || '').trim();
  let candidateArtist = cleanArtist(rawArtist || '');

  // Check if rawTitle has "Artist - Title" format
  if (cleanedTitle.includes(' - ') || cleanedTitle.includes(' – ') || cleanedTitle.includes(' — ')) {
    const parts = cleanedTitle.split(/\s*[-–—]\s*/);
    if (parts.length >= 2) {
      const leftPart = parts[0].trim();
      const rightPart = parts.slice(1).join(' - ').trim();

      const normCandidate = candidateArtist.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normLeft = leftPart.toLowerCase().replace(/[^a-z0-9]/g, '');

      // Check if leftPart is the artist
      if (
        !candidateArtist ||
        candidateArtist.toLowerCase() === 'unknown artist' ||
        normCandidate.includes(normLeft) ||
        normLeft.includes(normCandidate) ||
        /(?:music|records|official|vevo|topic|channel)$/i.test(rawArtist || '') ||
        normCandidate.length < 3 ||
        parts.length === 2
      ) {
        candidateArtist = leftPart;
        cleanedTitle = rightPart;
      }
    }
  }

  cleanedTitle = cleanSongTitle(cleanedTitle, candidateArtist);
  candidateArtist = cleanArtist(candidateArtist);

  return {
    artist: candidateArtist,
    title: cleanedTitle,
  };
}

async function fetchLrclibLyrics(rawArtist: string, rawTitle: string, duration: number): Promise<{ synced?: LyricResult; plain?: string } | null> {
  const extracted = extractArtistAndTitle(rawTitle, rawArtist);
  const artist = extracted.artist || cleanArtist(rawArtist);
  const cleanTitle = extracted.title || cleanSongTitle(rawTitle, rawArtist);
  const titleNoTags = cleanSongTitle(rawTitle);

  const artistsToTry = Array.from(new Set([artist, cleanArtist(rawArtist)])).filter(Boolean);
  const titlesToTry = Array.from(new Set([cleanTitle, titleNoTags, rawTitle.trim()])).filter(Boolean);

  // 1. Try exact match on /api/get for combinations
  for (const a of artistsToTry) {
    for (const t of titlesToTry) {
      try {
        const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(a)}&track_name=${encodeURIComponent(t)}`;
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'SupaJuka/2.0 (Karaoke Engine; https://github.com/littefoot/supa-juka)',
          },
          signal: AbortSignal.timeout(6000),
        });

        if (res.ok) {
          const data: any = await res.json();
          if (data.syncedLyrics) {
            console.log(`[GroundTruth] Found CANONICAL SYNCED lyrics on LRCLIB for "${a}" - "${t}"`);
            const synced = parseLrcToLyricResult(data.syncedLyrics, duration);
            return { synced, plain: sanitizeLyricText(data.syncedLyrics.replace(/\[\d+:\d+\.\d+\]\s*/g, '')) };
          }
          if (data.plainLyrics) {
            console.log(`[GroundTruth] Found plain lyrics on LRCLIB for "${a}" - "${t}"`);
            return { plain: sanitizeLyricText(data.plainLyrics) };
          }
        }
      } catch (e: any) {
        console.warn(`[GroundTruth] LRCLIB get for "${a}" - "${t}" failed: ${e.message}`);
      }
    }
  }

  // 2. Fallback to /api/search
  const searchQueries = [
    `track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(artist)}`,
    `q=${encodeURIComponent(`${artist} ${cleanTitle}`)}`,
  ];

  for (const q of searchQueries) {
    try {
      const url = `https://lrclib.net/api/search?${q}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'SupaJuka/2.0 (Karaoke Engine; https://github.com/littefoot/supa-juka)',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const items: any[] = await res.json();
        if (Array.isArray(items) && items.length > 0) {
          let bestSynced: any = null;
          let bestPlain: any = null;

          for (const item of items) {
            if (item.syncedLyrics) {
              if (!bestSynced) {
                bestSynced = item;
              } else if (duration > 0 && Math.abs(item.duration - duration) < Math.abs(bestSynced.duration - duration)) {
                bestSynced = item;
              }
            } else if (item.plainLyrics && !bestPlain) {
              bestPlain = item;
            }
          }

          if (bestSynced) {
            console.log(`[GroundTruth] Found CANONICAL SYNCED lyrics on LRCLIB search ("${bestSynced.artistName}" - "${bestSynced.trackName}")`);
            const synced = parseLrcToLyricResult(bestSynced.syncedLyrics, duration);
            return { synced, plain: sanitizeLyricText(bestSynced.syncedLyrics.replace(/\[\d+:\d+\.\d+\]\s*/g, '')) };
          }

          if (bestPlain) {
            console.log(`[GroundTruth] Found plain lyrics on LRCLIB search ("${bestPlain.artistName}" - "${bestPlain.trackName}")`);
            return { plain: sanitizeLyricText(bestPlain.plainLyrics) };
          }
        }
      }
    } catch (e: any) {
      console.warn(`[GroundTruth] LRCLIB search for "${q}" failed: ${e.message}`);
    }
  }

  return null;
}

/**
 * Fetch official lyrics via Google Gemini with Google Search Grounding.
 */
async function fetchGeminiLyrics(artist: string, title: string, apiKey: string): Promise<string | null> {
  if (!apiKey) return null;

  const models = ['gemini-flash-latest', 'gemini-3.6-flash', 'gemini-3.5-flash'];
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const prompt = `Search Google for the canonical, official, verbatim lyrics to "${title}" by "${artist}".
Output ONLY the verbatim lyrics text line by line.
Format each line as a short musical phrase / bar (approx 3 to 6 words per line).
Do not include any intro explanations, headers like [Chorus] or [Verse], website ads, or conversational commentary.`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2500,
          },
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (res.ok) {
        const data: any = await res.json();
        const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
        const isRefusal = candidate && (
          candidate.toLowerCase().includes('copyright') ||
          candidate.toLowerCase().includes('cannot provide the complete lyrics') ||
          candidate.toLowerCase().includes('as an ai')
        );
        if (candidate && candidate.length > 50 && !isRefusal) {
          console.log(`[GroundTruth] Found official lyrics via Gemini with Google Search (${model}) for "${title}"`);
          return sanitizeLyricText(candidate);
        }
      } else {
        const errText = await res.text();
        console.warn(`[GroundTruth] Gemini ${model} returned ${res.status}: ${errText.slice(0, 150)}`);
      }
    } catch (e: any) {
      console.warn(`[GroundTruth] Gemini ${model} failed: ${e.message}`);
    }
  }
  return null;
}

/**
 * Snaps words and syllables to acoustic transient peaks in waveform_vocals.json.
 */
function snapWordsToWaveformPeaks(lyricResult: LyricResult, pts: number[], pps: number): void {
  let runningBound = 0.0;
  for (const seg of lyricResult.segments) {
    if (seg.text === '[INSTRUMENTAL]' || !seg.words || seg.words.length === 0) {
      if (seg.end) runningBound = seg.end;
      continue;
    }

    const words = seg.words;
    for (let i = 0; i < words.length; i++) {
      const cur = words[i];
      const nxt = i < words.length - 1 ? words[i + 1] : null;

      const minB = runningBound;
      const maxB = nxt ? nxt.start : cur.end + 0.6;

      const sMin = Math.max(minB, cur.start - 0.15);
      const sMax = Math.min(maxB, Math.max(cur.end + 0.15, cur.start + 1.20));

      const i0 = Math.max(0, Math.floor(sMin * pps));
      const i1 = Math.min(pts.length - 1, Math.ceil(sMax * pps));
      if (i0 >= i1) {
        runningBound = cur.end;
        continue;
      }

      // Find local peak in window
      let bestP = 0.0;
      let bestIdx = -1;
      for (let pIdx = i0; pIdx <= i1; pIdx++) {
        if (pts[pIdx] > bestP) {
          bestP = pts[pIdx];
          bestIdx = pIdx;
        }
      }

      if (bestIdx !== -1 && bestP >= 0.10) {
        // Walk backwards to find valley / onset
        let onsetIdx = bestIdx;
        const cutoff = Math.max(0.04, bestP * 0.20);
        for (let j = bestIdx; j >= i0; j--) {
          if (pts[j] <= cutoff) {
            onsetIdx = j;
            break;
          }
          if (pts[j] < pts[onsetIdx]) {
            onsetIdx = j;
          }
        }
        const newStart = Math.max(minB, Math.round((onsetIdx / pps) * 100) / 100);
        const origDur = Math.max(0.25, cur.end - cur.start);
        cur.start = newStart;
        cur.end = Math.min(maxB, Math.round((newStart + origDur) * 100) / 100);
      }

      // Keep syllables synchronized and non-overlapping within word boundaries
      if (cur.syllables && cur.syllables.length > 0) {
        const numSyls = cur.syllables.length;
        const wDur = Math.max(0.20 * numSyls, cur.end - cur.start);
        for (let s = 0; s < numSyls; s++) {
          cur.syllables[s].start = Math.round((cur.start + (wDur / numSyls) * s) * 100) / 100;
          cur.syllables[s].end = Math.round((cur.start + (wDur / numSyls) * (s + 1)) * 100) / 100;
        }
      }

      runningBound = cur.end;
    }

    if (words.length > 0) {
      seg.start = words[0].start;
      seg.end = words[words.length - 1].end;
      runningBound = seg.end;
    }
  }
}

/**
 * Calibrates and snaps LRC line & word timestamps against the acapella waveform.
 * Detects if lines are positioned over dead silence (e.g. after instrumental/solo breaks)
 * and shifts lines to the true vocal acoustic attack transients.
 * Also snaps individual word onsets to local acoustic vocal transient attack peaks.
 */
export function calibrateAndSnapLrcToWaveform(
  lyricResult: LyricResult,
  waveformPath: string
): LyricResult {
  if (!fs.existsSync(waveformPath)) return lyricResult;

  try {
    const raw = fs.readFileSync(waveformPath, 'utf-8');
    const wf = JSON.parse(raw);
    const pts: number[] = wf.peaks || [];
    const pps: number = wf.sampleRate || 50;

    if (!pts || pts.length === 0) return lyricResult;

    // Filter out old [INSTRUMENTAL] markers; we will rebuild them cleanly
    const nonMarkers = lyricResult.segments.filter(
      (s) => s.text && s.text !== '[INSTRUMENTAL]' && !s.words?.every((w) => w.isMarker)
    );
    if (nonMarkers.length === 0) return lyricResult;

    // 1. Detect global intro offset on the very first singing line
    const firstLine = nonMarkers[0];
    const tLrc = firstLine.start;

    const checkStart = Math.max(0, Math.floor((tLrc - 0.2) * pps));
    const checkEnd = Math.min(pts.length - 1, Math.ceil((tLrc + 0.4) * pps));
    let maxCheckAmp = 0;
    for (let i = checkStart; i <= checkEnd; i++) {
      if (pts[i] > maxCheckAmp) maxCheckAmp = pts[i];
    }

    let globalOffset = 0;
    if (maxCheckAmp < 0.08) {
      console.log(`[AcousticAlign] First line "${firstLine.text}" at ${tLrc}s is over silence (max amp ${maxCheckAmp.toFixed(3)}). Searching for vocal onset...`);
      const searchStart = Math.max(0, Math.floor((tLrc - 3.0) * pps));
      const searchEnd = Math.min(pts.length - 1, Math.ceil((tLrc + 12.0) * pps));

      let bestOnset: number | null = null;
      for (let i = searchStart; i <= searchEnd; i++) {
        if (pts[i] >= 0.15) {
          let valleyIdx = i;
          for (let j = i; j >= Math.max(0, i - Math.floor(1.5 * pps)); j--) {
            if (pts[j] <= 0.04) {
              valleyIdx = j;
              break;
            }
            if (pts[j] < pts[valleyIdx]) {
              valleyIdx = j;
            }
          }
          bestOnset = Math.round((valleyIdx / pps) * 100) / 100;
          break;
        }
      }

      if (bestOnset !== null && Math.abs(bestOnset - tLrc) >= 0.25) {
        globalOffset = Math.round((bestOnset - tLrc) * 100) / 100;
        console.log(`[AcousticAlign] Detected global vocal intro offset of ${globalOffset > 0 ? '+' : ''}${globalOffset}s (LRC: ${tLrc}s -> Audio: ${bestOnset}s)`);
      }
    }

    // Apply global offset if detected
    if (globalOffset !== 0) {
      for (const seg of nonMarkers) {
        seg.start = Math.max(0, Math.round((seg.start + globalOffset) * 100) / 100);
        seg.end = Math.max(seg.start + 0.5, Math.round((seg.end + globalOffset) * 100) / 100);
        if (seg.words) {
          for (const w of seg.words) {
            w.start = Math.max(0, Math.round((w.start + globalOffset) * 100) / 100);
            w.end = Math.max(w.start + 0.1, Math.round((w.end + globalOffset) * 100) / 100);
            if (w.syllables) {
              for (const syl of w.syllables) {
                syl.start = Math.max(0, Math.round((syl.start + globalOffset) * 100) / 100);
                syl.end = Math.max(syl.start + 0.05, Math.round((syl.end + globalOffset) * 100) / 100);
              }
            }
          }
        }
      }
    }

    // 2. Per-line anti-silence acoustic calibration across ALL segments
    for (let sIdx = 0; sIdx < nonMarkers.length; sIdx++) {
      const seg = nonMarkers[sIdx];
      const nextSeg = sIdx < nonMarkers.length - 1 ? nonMarkers[sIdx + 1] : null;
      const prevSeg = sIdx > 0 ? nonMarkers[sIdx - 1] : null;
      const minBound = prevSeg ? prevSeg.end + 0.1 : 0.0;
      const maxSearchTime = nextSeg ? nextSeg.start - 0.5 : seg.start + 6.0;

      // Check immediate onset window [seg.start - 0.05s, seg.start + 0.12s]
      const i0 = Math.max(0, Math.floor((seg.start - 0.05) * pps));
      const i1 = Math.min(pts.length - 1, Math.ceil((seg.start + 0.12) * pps));
      let maxAmp = 0;
      for (let i = i0; i <= i1; i++) {
        if (pts[i] > maxAmp) maxAmp = pts[i];
      }

      // If segment onset sits on silence (< 0.08 amplitude)
      if (maxAmp < 0.08) {
        const s0 = Math.max(Math.floor(minBound * pps), Math.floor((seg.start - 0.5) * pps));
        const s1 = Math.min(pts.length - 1, Math.ceil(maxSearchTime * pps));
        let lineOnset: number | null = null;

        for (let i = s0; i <= s1; i++) {
          if (pts[i] >= 0.15) {
            let v = i;
            for (let j = i; j >= Math.max(s0, i - 25); j--) {
              if (pts[j] <= 0.04) { v = j; break; }
              if (pts[j] < pts[v]) v = j;
            }
            lineOnset = Math.round((v / pps) * 100) / 100;
            break;
          }
        }

        if (lineOnset !== null) {
          const lineDelta = Math.round((lineOnset - seg.start) * 100) / 100;
          if (Math.abs(lineDelta) >= 0.15) {
            console.log(`[AcousticAlign] Line [${sIdx}] "${seg.text}" over silence (amp ${maxAmp.toFixed(3)}). Shifted by ${lineDelta > 0 ? '+' : ''}${lineDelta}s -> ${lineOnset.toFixed(2)}s`);
            seg.start = Math.round((seg.start + lineDelta) * 100) / 100;
            seg.end = Math.round((seg.end + lineDelta) * 100) / 100;
            if (seg.words) {
              for (const w of seg.words) {
                w.start = Math.round((w.start + lineDelta) * 100) / 100;
                w.end = Math.round((w.end + lineDelta) * 100) / 100;
                if (w.syllables) {
                  for (const syl of w.syllables) {
                    syl.start = Math.round((syl.start + lineDelta) * 100) / 100;
                    syl.end = Math.round((syl.end + lineDelta) * 100) / 100;
                  }
                }
              }
            }
          }
        }
      }
    }

    // 3. Rebuild segments with new instrumental breaks
    const rebuiltSegments: LyricSegment[] = [];
    let lastEnd = 0.0;
    for (const cur of nonMarkers) {
      if (cur.start - lastEnd >= 6.0) {
        const instStart = Math.round(lastEnd * 100) / 100;
        const instEnd = Math.round(cur.start * 100) / 100;
        rebuiltSegments.push({
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
      rebuiltSegments.push(cur);
      lastEnd = cur.end;
    }
    lyricResult.segments = rebuiltSegments;

    // 4. Perform word-level acoustic transient snapping across all singing segments
    snapWordsToWaveformPeaks(lyricResult, pts, pps);

    lyricResult.source = globalOffset !== 0 ? 'canonical_synced_lrc_calibrated' : 'canonical_synced_lrc_aligned';
    return lyricResult;
  } catch (err) {
    console.warn('[AcousticAlign] Waveform calibration failed, keeping raw LRC timing:', err);
    return lyricResult;
  }
}

const PROTECTED_SONG_IDS = ['flac_76362ddbe871', 'flac_a7e3cd88e60a'];

/**
 * Primary Ground Truth Resolver:
 * 1. Checks LRCLIB for CANONICAL SYNCED LYRICS.
 *    If available, calibrates against acapella waveform and saves to lyrics.json!
 * 2. If no synced lyrics, queries Gemini with Google Search Grounding for plain text.
 * 3. Falls back to LRCLIB plain text.
 * Saves verified_text.txt for Whisper prompt constraint if Whisper is still needed.
 */
export async function resolveGroundTruthLyrics(songId: string): Promise<{ isSynced: boolean; text: string | null }> {
  // CRITICAL RULE: Never recalculate, overwrite, or re-align protected user-saved songs
  if (PROTECTED_SONG_IDS.includes(songId)) {
    console.log(`[GroundTruth] Skipping lyrics resolution: ${songId} has protected user-saved lyrics.`);
    return { isSynced: true, text: null };
  }

  const verifiedPath = getPlainLyricsPath(songId);
  const lyricsJsonPath = getLyricsPath(songId);

  const meta = getMetadata(songId);
  if (!meta || !meta.title) return { isSynced: false, text: null };

  const extracted = extractArtistAndTitle(meta.title, meta.artist);
  const artist = extracted.artist || meta.artist || '';
  const title = extracted.title || meta.title || '';
  const duration = meta.duration || 240;

  // If cleaner title or artist was identified, persist to metadata
  if ((extracted.artist && extracted.artist !== meta.artist) || (extracted.title && extracted.title !== meta.title)) {
    meta.artist = extracted.artist || meta.artist;
    meta.title = extracted.title || meta.title;
    saveMetadata(meta);
  }

  const apiKey = getGeminiKey();

  // 1. First priority: Check LRCLIB for canonical human-curated synced lyrics
  const lrclibRes = await fetchLrclibLyrics(artist, title, duration);
  if (lrclibRes?.synced) {
    let finalSynced = lrclibRes.synced;
    const songDir = getSongDir(songId);
    const wfPath = path.join(songDir, 'waveform_vocals.json');
    if (fs.existsSync(wfPath)) {
      finalSynced = calibrateAndSnapLrcToWaveform(finalSynced, wfPath);
    }

    if (finalSynced.segments && finalSynced.segments.length > 0) {
      // Write the canonical synced lyrics directly to lyrics.json
      fs.writeFileSync(lyricsJsonPath, JSON.stringify(finalSynced, null, 2), 'utf-8');
      if (lrclibRes.plain) {
        fs.writeFileSync(verifiedPath, lrclibRes.plain, 'utf-8');
      }
      meta.hasLyrics = true;
      saveMetadata(meta);
      console.log(`[GroundTruth] Successfully applied CANONICAL SYNCED lyrics for ${songId} (${finalSynced.segments.length} lines)`);
      return { isSynced: true, text: lrclibRes.plain || '' };
    }
  }

  // 2. Second priority: Query Gemini with Google Search Grounding for verified plain text
  let plainText: string | null = null;
  if (apiKey) {
    plainText = await fetchGeminiLyrics(artist, title, apiKey);
  }

  // 3. Third priority: LRCLIB plain text
  if (!plainText && lrclibRes?.plain) {
    plainText = lrclibRes.plain;
  }

  if (plainText) {
    fs.writeFileSync(verifiedPath, plainText, 'utf-8');
    console.log(`[GroundTruth] Saved canonical verified plain lyrics for ${songId} to ${verifiedPath}`);
    return { isSynced: false, text: plainText };
  }

  return { isSynced: false, text: null };
}
