import sys
import os
import re
import json
import difflib
import pyphen
from faster_whisper import WhisperModel

sys.stdout.reconfigure(encoding='utf-8')

dic = pyphen.Pyphen(lang='en_US')

def clean_w(w):
    return re.sub(r'[^a-zA-Z0-9]', '', w).lower()

def count_vowels(word):
    clean = re.sub(r'[^a-zA-Z]', '', word).lower()
    if not clean: return 0
    clean_stem = re.sub(r'([^aeiouy])e$', r'\1', clean) if len(clean) > 3 else clean
    vowels = 'aeiouy'
    count = sum(1 for c in clean_stem if c in vowels)
    return max(1, count)

def syllabify(word):
    clean = re.sub(r'^[^\w]+|[^\w]+$', '', word)
    if not clean or len(clean) <= 3 or count_vowels(clean) <= 1:
        return [word]
    hyph = dic.inserted(clean)
    parts = hyph.split('-')
    if len(parts) <= 1:
        stem = re.sub(r'([^aeiouy])e$', r'\1', clean, flags=re.I) if len(clean) > 3 else clean
        matches = re.findall(r'([^aeiouy]*[aeiouy]+(?:[^aeiouy]+(?=[^aeiouy][aeiouy]))?)', stem, re.I)
        if matches and len(matches) > 1:
            if len(clean) > len(stem):
                matches[-1] += clean[len(stem):]
            parts = matches if ''.join(matches) == clean else [clean]
        else:
            parts = [clean]
    lead = word[:word.find(clean)]
    trail = word[word.find(clean) + len(clean):]
    parts[0] = lead + parts[0]
    parts[-1] = parts[-1] + trail
    return parts

def word_sim(w1, w2):
    c1 = clean_w(w1)
    c2 = clean_w(w2)
    if not c1 or not c2: return 0.0
    if c1 == c2: return 1.0
    if c1.startswith(c2) or c2.startswith(c1):
        if min(len(c1), len(c2)) >= 3: return 0.85
    return difflib.SequenceMatcher(None, c1, c2).ratio()

def align_lyrics_to_audio(audio_path, output_json, prompt_file=None):
    verified_lines = []
    if prompt_file and os.path.exists(prompt_file):
        with open(prompt_file, 'r', encoding='utf-8') as pf:
            raw_lines = [l.strip() for l in pf if l.strip()]
            for l in raw_lines:
                if not re.match(r'^\[.*\]$', l):
                    verified_lines.append(l)

    print(f"Aligning {len(verified_lines)} canonical lines with Faster-Whisper Word-Stream Engine...")
    model = WhisperModel('small.en', device='cuda', compute_type='float16')
    segments, info = model.transcribe(audio_path, beam_size=5, word_timestamps=True, vad_filter=False)

    all_whisper_words = []
    for s in segments:
        if s.words:
            for w in s.words:
                all_whisper_words.append({
                    'word': w.word.strip(),
                    'clean': clean_w(w.word),
                    'start': round(float(w.start), 2),
                    'end': round(float(w.end), 2),
                    'probability': w.probability
                })

    print(f"Extracted {len(all_whisper_words)} acoustic word timestamps from isolated acapella.")

    cursor = 0
    final_segments = []
    last_line_end = 0.0

    for line_idx, line in enumerate(verified_lines):
        line_tokens = line.split()
        num_toks = len(line_tokens)
        token_syls = [syllabify(t) for t in line_tokens]

        best_match_score = -1.0
        best_word_matches = {}

        # Lookahead window of up to 40 whisper words
        window_end = min(len(all_whisper_words), cursor + 40)

        for start_cand in range(cursor, window_end):
            matches = {}
            curr_w_idx = start_cand
            matched_count = 0
            total_sim = 0.0

            for ti, tok in enumerate(line_tokens):
                best_s = 0.0
                best_k = -1
                for k in range(curr_w_idx, min(len(all_whisper_words), curr_w_idx + 4)):
                    s = word_sim(tok, all_whisper_words[k]['word'])
                    if s > best_s:
                        best_s = s
                        best_k = k
                if best_k != -1 and best_s >= 0.5:
                    matches[ti] = best_k
                    matched_count += 1
                    total_sim += best_s
                    curr_w_idx = best_k + 1

            score = total_sim / max(1, num_toks)
            min_req = 1 if num_toks <= 2 else 2
            if score > best_match_score and matched_count >= min_req:
                best_match_score = score
                best_word_matches = matches

        # Build words with realistic acoustic timestamps
        words_data = []
        if best_match_score >= 0.35 and best_word_matches:
            first_ti = min(best_word_matches.keys())
            last_ti = max(best_word_matches.keys())

            w_times = [None] * num_toks
            for ti, k_idx in best_word_matches.items():
                ww = all_whisper_words[k_idx]
                w_times[ti] = (ww['start'], ww['end'])

            anchor_keys = sorted(best_word_matches.keys())
            
            # Pre-anchor words
            if anchor_keys[0] > 0:
                first_k = anchor_keys[0]
                first_t = w_times[first_k][0]
                step = 0.28
                curr_t = max(last_line_end + 0.05, first_t - (first_k * step))
                for ti in range(first_k):
                    w_times[ti] = (round(curr_t, 2), round(curr_t + step, 2))
                    curr_t += step

            # In-between words
            for a_i in range(len(anchor_keys) - 1):
                a1 = anchor_keys[a_i]
                a2 = anchor_keys[a_i + 1]
                between_count = a2 - a1 - 1
                if between_count > 0:
                    gap_s = w_times[a1][1]
                    gap_e = w_times[a2][0]
                    gap = max(between_count * 0.20, gap_e - gap_s)
                    step = gap / between_count
                    curr_t = gap_s
                    for ti in range(a1 + 1, a2):
                        w_times[ti] = (round(curr_t, 2), round(curr_t + step, 2))
                        curr_t += step

            # Post-anchor words
            if anchor_keys[-1] < num_toks - 1:
                last_k = anchor_keys[-1]
                last_t = w_times[last_k][1]
                step = 0.32
                curr_t = last_t
                for ti in range(last_k + 1, num_toks):
                    w_times[ti] = (round(curr_t, 2), round(curr_t + step, 2))
                    curr_t += step

            # Advance cursor past the last matched word
            cursor = best_word_matches[last_ti] + 1
        else:
            # Synthesized fallback
            start_t = last_line_end + 0.5
            w_times = []
            curr_t = start_t
            for ti, tok in enumerate(line_tokens):
                dur = max(0.24, len(tok) * 0.08)
                w_times.append((round(curr_t, 2), round(curr_t + dur, 2)))
                curr_t += dur

        # Format words and syllables with non-overlap
        running_cursor = max(last_line_end + 0.04, w_times[0][0])
        for ti, tok in enumerate(line_tokens):
            w_s, w_e = w_times[ti]
            w_s = max(running_cursor, w_s)
            w_e = max(w_s + 0.10, w_e)

            syls = token_syls[ti]
            num_s = len(syls)
            w_dur = w_e - w_s
            s_step = w_dur / num_s

            syl_objs = []
            for s_i, s_txt in enumerate(syls):
                syl_objs.append({
                    'text': s_txt,
                    'start': round(w_s + (s_i * s_step), 2),
                    'end': round(w_s + ((s_i + 1) * s_step), 2)
                })

            words_data.append({
                'text': tok,
                'start': round(w_s, 2),
                'end': round(w_e, 2),
                'probability': 1.0,
                'syllables': syl_objs
            })
            running_cursor = w_e

        line_start = words_data[0]['start']
        line_end = words_data[-1]['end']

        # Check for instrumental break before this line (gap >= 7.0s)
        if line_start - last_line_end >= 7.0:
            inst_s = round(last_line_end, 2)
            inst_e = round(line_start, 2)
            final_segments.append({
                'start': inst_s,
                'end': inst_e,
                'text': '[INSTRUMENTAL]',
                'words': [{
                    'text': '[INSTRUMENTAL]',
                    'start': inst_s,
                    'end': inst_e,
                    'probability': 1.0,
                    'isMarker': True
                }]
            })

        final_segments.append({
            'start': line_start,
            'end': line_end,
            'text': line,
            'words': words_data
        })
        last_line_end = line_end

    # Apply waveform acoustic peak snapping if waveform exists
    song_dir = os.path.dirname(output_json)
    wf_path = os.path.join(song_dir, 'waveform_vocals.json')
    if os.path.exists(wf_path):
        print("Applying acoustic vocal peak snapping across all syllables...")
        with open(wf_path, 'r', encoding='utf-8') as wf_f:
            wf_data = json.load(wf_f)
        pts = wf_data.get('peaks', [])
        pps = wf_data.get('sampleRate', 50)

        if pts:
            all_syls = []
            for seg in final_segments:
                if seg['text'] != '[INSTRUMENTAL]':
                    for w in seg.get('words', []):
                        for s in w.get('syllables', []):
                            all_syls.append(s)

            running_bound = 0.0
            for i in range(len(all_syls)):
                curr = all_syls[i]
                nxt = all_syls[i + 1] if i < len(all_syls) - 1 else None

                min_b = running_bound
                max_b = nxt['start'] if nxt else info.duration

                # Locate this syllable's acoustic peak in the window leading up to curr['end']
                # Search window spans up to curr['end'], never exceeding max_b
                s_min = max(min_b, curr['start'] - 0.06)
                s_max = min(max_b, max(curr['end'] + 0.10, curr['start'] + 1.20))

                i0 = max(0, int(s_min * pps))
                i1 = min(len(pts) - 1, int(s_max * pps))
                
                # Syllable peak search window: within 0.85s before curr['end']
                i_peak_start = max(i0, int((curr['end'] - 0.85) * pps))

                best_onset = curr['start']
                best_p = 0.0
                best_peak_idx = -1
                for p_idx in range(i1, i_peak_start - 1, -1):
                    if pts[p_idx] > best_p:
                        best_p = pts[p_idx]
                        best_peak_idx = p_idx

                if best_peak_idx != -1 and best_p >= 0.07:
                    # Walk backwards down the slope from peak to find true beginning transient (valley floor)
                    cutoff = max(0.04, best_p * 0.18)
                    onset_idx = best_peak_idx
                    for j in range(best_peak_idx, i0 - 1, -1):
                        p = pts[j]
                        if p <= cutoff:
                            onset_idx = j
                            break
                        if j > i0 and j < len(pts) - 1:
                            if pts[j] <= pts[j-1] and pts[j] <= pts[j+1] and p < 0.09:
                                onset_idx = j
                                break
                        onset_idx = j
                    best_onset = onset_idx / pps

                orig_dur = max(0.08, curr['end'] - curr['start'])
                new_start = max(min_b, best_onset)
                new_end = min(max_b, max(new_start + 0.06, new_start + orig_dur))

                curr['start'] = round(new_start, 2)
                curr['end'] = round(new_end, 2)
                running_bound = curr['end']

            for seg in final_segments:
                if seg['text'] != '[INSTRUMENTAL]' and seg.get('words'):
                    for w in seg['words']:
                        if w.get('syllables'):
                            w['start'] = w['syllables'][0]['start']
                            w['end'] = w['syllables'][-1]['end']
                    seg['start'] = seg['words'][0]['start']
                    seg['end'] = seg['words'][-1]['end']

    result = {
        'language': info.language if 'info' in locals() else 'en',
        'duration': round(info.duration, 2),
        'source': 'word_stream_acoustic_v4',
        'segments': final_segments,
        'text': ' '.join(s['text'] for s in final_segments if s['text'] != '[INSTRUMENTAL]')
    }

    with open(output_json, 'w', encoding='utf-8') as out_f:
        json.dump(result, out_f, indent=2, ensure_ascii=False)

    print(f"Alignment complete! Saved {len(final_segments)} line segments with full syllables to {output_json}")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python transcribe.py <audio_path> <output_json> [prompt_file]")
        sys.exit(1)

    prompt = sys.argv[3] if len(sys.argv) > 3 else None
    align_lyrics_to_audio(sys.argv[1], sys.argv[2], prompt)
