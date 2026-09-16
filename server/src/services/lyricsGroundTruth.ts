import fs from 'fs';
import path from 'path';
import { getMetadata, saveMetadata } from './metadata.js';
import { getPlainLyricsPath, getLyricsPath } from './paths.js';
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
 * Parse standard LRC format into fully populated LyricResult segments & words
 * using realistic vocal singing duration (0.35s - 0.45s per word) so words
 * highlight in exact sync with vocals rather than dragging across guitar breaks.
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

    // Check for instrumental break before this line (gap >= 7.0s)
    if (cur.start - lastEnd >= 7.0) {
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
    const totalChars = rawWords.reduce((sum, w) => sum + w.length, 0) || 1;

    // Estimate syllable count to properly space multi-syllabic phrases
    const estSyllables = rawWords.reduce((acc, w) => acc + Math.max(1, (w.match(/[aeiouy]+/gi) || []).length), 0);
    // Vocal tempo: words/syllables duration respecting available gap before next line
    const minDurBySyllables = Math.max(rawWords.length * 0.45, estSyllables * 0.38);
    const expectedSingingDur = Math.min(totalGap - 0.25, minDurBySyllables);
    const singingDuration = Math.max(0.6, Math.min(totalGap, expectedSingingDur));

    let wordStart = cur.start;
    const words: LyricWord[] = [];
    for (const w of rawWords) {
      const wDuration = Math.max(0.12, (w.length / totalChars) * singingDuration);
      const wEnd = Math.round((wordStart + wDuration) * 100) / 100;
      words.push({
        text: w,
        start: Math.round(wordStart * 100) / 100,
        end: wEnd,
        probability: 1.0,
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

export function cleanSongTitle(title: string): string {
  return title
    .replace(/\s*[\(\[](?:remaster(?:ed)?|deluxe|version|edition|anniversary|official|audio|video|lyrics|hd|4k|hq|bonus track)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanArtist(artist: string): string {
  return artist
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchLrclibLyrics(rawArtist: string, rawTitle: string, duration: number): Promise<{ synced?: LyricResult; plain?: string } | null> {
  const artist = cleanArtist(rawArtist);
  const titlesToTry = [cleanSongTitle(rawTitle), rawTitle.trim()];
  const uniqueTitles = Array.from(new Set(titlesToTry)).filter(Boolean);

  for (const title of uniqueTitles) {
    try {
      const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'SupaJuka/2.0 (Karaoke Engine; https://github.com/littefoot/supa-juka)',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const data: any = await res.json();
        if (data.syncedLyrics) {
          console.log(`[GroundTruth] Found CANONICAL SYNCED lyrics on LRCLIB for "${title}"`);
          const synced = parseLrcToLyricResult(data.syncedLyrics, duration);
          return { synced, plain: sanitizeLyricText(data.syncedLyrics.replace(/\[\d+:\d+\.\d+\]\s*/g, '')) };
        }
        if (data.plainLyrics) {
          console.log(`[GroundTruth] Found plain lyrics on LRCLIB for "${title}"`);
          return { plain: sanitizeLyricText(data.plainLyrics) };
        }
      }
    } catch (e: any) {
      console.warn(`[GroundTruth] LRCLIB lookup for "${title}" failed: ${e.message}`);
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
 * Primary Ground Truth Resolver:
 * 1. Checks LRCLIB for CANONICAL SYNCED LYRICS.
 *    If available, saves directly to lyrics.json with 100% human-verified line timings!
 * 2. If no synced lyrics, queries Gemini with Google Search Grounding for plain text.
 * 3. Falls back to LRCLIB plain text.
 * Saves verified_text.txt for Whisper prompt constraint if Whisper is still needed.
 */
export async function resolveGroundTruthLyrics(songId: string): Promise<{ isSynced: boolean; text: string | null }> {
  const verifiedPath = getPlainLyricsPath(songId);
  const lyricsJsonPath = getLyricsPath(songId);

  const meta = getMetadata(songId);
  if (!meta || !meta.title) return { isSynced: false, text: null };

  const artist = meta.artist || '';
  const title = meta.title || '';
  const duration = meta.duration || 240;
  const apiKey = getGeminiKey();

  // 1. First priority: Check LRCLIB for canonical human-curated synced lyrics
  const lrclibRes = await fetchLrclibLyrics(artist, title, duration);
  if (lrclibRes?.synced) {
    // Write the canonical synced lyrics directly to lyrics.json
    fs.writeFileSync(lyricsJsonPath, JSON.stringify(lrclibRes.synced, null, 2), 'utf-8');
    if (lrclibRes.plain) {
      fs.writeFileSync(verifiedPath, lrclibRes.plain, 'utf-8');
    }
    meta.hasLyrics = true;
    saveMetadata(meta);
    console.log(`[GroundTruth] Successfully applied CANONICAL SYNCED lyrics for ${songId} (${lrclibRes.synced.segments.length} lines)`);
    return { isSynced: true, text: lrclibRes.plain || '' };
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
