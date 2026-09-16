import sys
import os
import re
import json
import gc
import difflib
import numpy as np
import soundfile as sf
import librosa
import pyphen
from faster_whisper import WhisperModel

dic = pyphen.Pyphen(lang='en_US')

def clean_w(w):
    return re.sub(r'[^a-zA-Z0-9]', '', w).lower()

def count_vowels(word):
    clean = re.sub(r'[^a-zA-Z]', '', word).lower()
    if not clean:
        return 0
    vowels = 'aeiouy'
    count = 0
    prev_vowel = False
    for char in clean:
        is_v = char in vowels
        if is_v and not prev_vowel:
            count += 1
        prev_vowel = is_v
    if clean.endswith('e') and not clean.endswith('ee') and not clean.endswith('le') and count > 1:
        count -= 1
    elif (clean.endswith('es') or clean.endswith('ed')) and not clean.endswith(('ted', 'ded', 'ses', 'zes', 'ches', 'shes')) and count > 1:
        count -= 1
    return max(1, count)

def syllabify(word):
    clean = re.sub(r'^[^\w]+|[^\w]+$', '', word)
    if not clean or len(clean) <= 3 or count_vowels(clean) <= 1:
        return [word]
    hyph = dic.inserted(clean)
    parts = hyph.split('-')
    if len(parts) <= 1:
        matches = re.findall(r'([^aeiouy]*[aeiouy]+(?:[^aeiouy]+(?=[^aeiouy][aeiouy]))?)', clean, re.I)
        parts = matches if (matches and ''.join(matches) == clean) else [clean]
    lead = word[:word.find(clean)]
    trail = word[word.find(clean) + len(clean):]
    parts[0] = lead + parts[0]
    parts[-1] = parts[-1] + trail
    return parts

def word_similarity(w1, w2):
    c1 = clean_w(w1)
    c2 = clean_w(w2)
    if not c1 or not c2:
        return 0.0
    if c1 == c2:
        return 1.0
    if c1.startswith(c2) or c2.startswith(c1):
        if min(len(c1), len(c2)) >= 3:
            return 0.85
    ratio = difflib.SequenceMatcher(None, c1, c2).ratio()
    if ratio >= 0.70:
        return ratio
    return 0.0

def align_lyrics_to_audio(audio_path, output_json, prompt_file=None):
    print(f"Loading audio: {audio_path}...")
    y, sr = sf.read(audio_path)
    if y.ndim > 1:
        y = y.mean(axis=1)
    duration = float(len(y)) / float(sr)

    frame_len = int(0.04 * sr)
    hop_len = int(0.01 * sr)
    rms = librosa.feature.rms(y=y, frame_length=frame_len, hop_length=hop_len)[0]
    times = librosa.frames_to_time(range(len(rms)), sr=sr, hop_length=hop_len)

    def find_sustain_end(start_t, max_extend=4.5, threshold=0.018):
        mask = (times >= start_t) & (times <= min(duration, start_t + max_extend))
        w_rms = rms[mask]
        w_times = times[mask]
        if len(w_rms) == 0:
            return start_t
        sustain_end = start_t
        silence_run = 0
        for t_val, r_val in zip(w_times, w_rms):
            if r_val >= threshold:
                sustain_end = t_val
                silence_run = 0
            else:
                silence_run += 1
                if silence_run >= 12: # 120ms silence
                    break
        return round(max(start_t, sustain_end), 2)

    official_lines = []
    if prompt_file and os.path.exists(prompt_file):
        with open(prompt_file, 'r', encoding='utf-8') as pf:
            for l in pf:
                l = l.strip()
                if l and not l.startswith('[') and not l.startswith('('):
                    official_lines.append(l)
        print(f"Using {len(official_lines)} official lyric lines for line-by-line alignment.")

    print("Transcribing vocals with Faster-Whisper on RTX 4050 (CUDA)...")
    model = WhisperModel('large-v3-turbo', device='cuda', compute_type='float16')
    segs_gen, info = model.transcribe(
        audio_path,
        word_timestamps=True,
        vad_filter=False
    )
    whisper_segs = list(segs_gen)

    del model
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass

    print(f"Whisper produced {len(whisper_segs)} acoustic segments.")

    final_segments = []

    if official_lines:
        print("Executing line-by-line alignment with zero missing syllables guarantee...")
        curr_seg_idx = 0
        num_segs = len(whisper_segs)
        last_seg_end = 0.0

        for l_idx, line in enumerate(official_lines):
            line_tokens = line.split()
            if not line_tokens:
                continue

            token_syls = [syllabify(tok) for tok in line_tokens]

            # Match line to best whisper segment in lookahead window
            best_idx = -1
            best_score = -1
            for s_idx in range(curr_seg_idx, min(num_segs, curr_seg_idx + 4)):
                c1 = clean_w(line)
                c2 = clean_w(whisper_segs[s_idx].text)
                score = difflib.SequenceMatcher(None, c1, c2).ratio()
                if score > best_score:
                    best_score = score
                    best_idx = s_idx

            if best_idx != -1 and best_score >= 0.35:
                seg = whisper_segs[best_idx]
                curr_seg_idx = best_idx + 1
                seg_words = seg.words or []

                # Word-level matching within this line
                word_anchors = {}
                seg_w_idx = 0
                for ti, tok in enumerate(line_tokens):
                    best_sim = 0
                    best_k = -1
                    for k in range(seg_w_idx, min(len(seg_words), seg_w_idx + 4)):
                        sim = word_similarity(tok, seg_words[k].word)
                        if sim > best_sim:
                            best_sim = sim
                            best_k = k
                    if best_k != -1 and best_sim >= 0.5:
                        w_start = round(float(seg_words[best_k].start), 2)
                        w_end = round(float(seg_words[best_k].end), 2)
                        word_anchors[ti] = (w_start, w_end)
                        seg_w_idx = best_k + 1

                # Determine line start and end
                if word_anchors:
                    first_ti = min(word_anchors.keys())
                    last_ti = max(word_anchors.keys())

                    if first_ti == 0:
                        l_start = word_anchors[0][0]
                    else:
                        pre_syls = sum(len(token_syls[k]) for k in range(first_ti))
                        l_start = max(last_seg_end + 0.05, word_anchors[first_ti][0] - (pre_syls * 0.25))

                    if last_ti == len(line_tokens) - 1:
                        raw_end = word_anchors[last_ti][1]
                        l_end = find_sustain_end(raw_end, max_extend=4.5)
                    else:
                        post_syls = sum(len(token_syls[k]) for k in range(last_ti + 1, len(line_tokens)))
                        raw_end = word_anchors[last_ti][1] + (post_syls * 0.26)
                        l_end = find_sustain_end(raw_end, max_extend=4.0)
                else:
                    l_start = max(last_seg_end + 0.05, round(float(seg.start), 2))
                    l_end = find_sustain_end(round(float(seg.end), 2), max_extend=3.5)
            else:
                # Synthesize fallback line cleanly
                l_start = round(last_seg_end + 1.0, 2)
                total_syls = sum(len(s) for s in token_syls)
                l_end = round(l_start + max(1.2, total_syls * 0.28), 2)
                word_anchors = {}

            # Strict chronological ordering between lines
            l_start = max(last_seg_end + 0.04, l_start)
            if l_end <= l_start + 0.2:
                total_syls = sum(len(s) for s in token_syls)
                l_end = round(l_start + max(1.0, total_syls * 0.26), 2)

            # Insert [INSTRUMENTAL] break if gap >= 2.6s
            if l_start - last_seg_end >= 2.6:
                inst_s = round(last_seg_end, 2)
                inst_e = round(l_start, 2)
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

            # Distribute words and syllables inside [l_start, l_end]
            num_words = len(line_tokens)
            word_times = [None] * num_words
            for ti in sorted(word_anchors.keys()):
                word_times[ti] = word_anchors[ti]

            anchor_keys = sorted(word_anchors.keys())
            if not anchor_keys:
                tot_syls = sum(len(s) for s in token_syls)
                step = (l_end - l_start) / max(1, tot_syls)
                curr = l_start
                for ti in range(num_words):
                    s_count = len(token_syls[ti])
                    w_s = curr
                    w_e = curr + (s_count * step)
                    word_times[ti] = (round(w_s, 2), round(w_e, 2))
                    curr = w_e
            else:
                first_a = anchor_keys[0]
                if first_a > 0:
                    pre_syls = sum(len(token_syls[k]) for k in range(first_a))
                    pre_start = max(l_start, word_times[first_a][0] - (pre_syls * 0.26))
                    step = (word_times[first_a][0] - pre_start) / max(1, pre_syls)
                    curr = pre_start
                    for ti in range(first_a):
                        s_count = len(token_syls[ti])
                        w_s = curr
                        w_e = curr + (s_count * step)
                        word_times[ti] = (round(w_s, 2), round(w_e, 2))
                        curr = w_e

                for idx_a in range(len(anchor_keys) - 1):
                    a1 = anchor_keys[idx_a]
                    a2 = anchor_keys[idx_a + 1]
                    between_count = a2 - a1 - 1
                    if between_count > 0:
                        b_syls = sum(len(token_syls[k]) for k in range(a1 + 1, a2))
                        gap_start = word_times[a1][1]
                        gap_end = word_times[a2][0]
                        gap = max(b_syls * 0.22, gap_end - gap_start)
                        step = gap / max(1, b_syls)
                        curr = gap_start
                        for ti in range(a1 + 1, a2):
                            s_count = len(token_syls[ti])
                            w_s = curr
                            w_e = curr + (s_count * step)
                            word_times[ti] = (round(w_s, 2), round(w_e, 2))
                            curr = w_e

                last_a = anchor_keys[-1]
                if last_a < num_words - 1:
                    post_syls = sum(len(token_syls[k]) for k in range(last_a + 1, num_words))
                    post_end = max(l_end, word_times[last_a][1] + (post_syls * 0.26))
                    step = (post_end - word_times[last_a][1]) / max(1, post_syls)
                    curr = word_times[last_a][1]
                    for ti in range(last_a + 1, num_words):
                        s_count = len(token_syls[ti])
                        w_s = curr
                        w_e = curr + (s_count * step)
                        word_times[ti] = (round(w_s, 2), round(w_e, 2))
                        curr = w_e

            # Build final word and syllable objects with strict non-overlap
            words_data = []
            curr_time_cursor = l_start
            for ti, tok in enumerate(line_tokens):
                syl_list = token_syls[ti]
                w_s, w_e = word_times[ti]

                w_s = max(curr_time_cursor, w_s)
                w_e = max(w_s + 0.08 * len(syl_list), w_e)

                syl_objs = []
                num_s = len(syl_list)
                w_dur = w_e - w_s

                if num_s == 1:
                    syl_objs.append({
                        'text': syl_list[0],
                        'start': round(w_s, 2),
                        'end': round(w_e, 2)
                    })
                else:
                    if w_dur >= 0.8:
                        attack_dur = min(0.35, (w_dur * 0.40) / (num_s - 1))
                        s_curr = w_s
                        for s_i in range(num_s - 1):
                            s_nxt = s_curr + attack_dur
                            syl_objs.append({'text': syl_list[s_i], 'start': round(s_curr, 2), 'end': round(s_nxt, 2)})
                            s_curr = s_nxt
                        syl_objs.append({'text': syl_list[-1], 'start': round(s_curr, 2), 'end': round(w_e, 2)})
                    else:
                        step = w_dur / num_s
                        for s_i, s_txt in enumerate(syl_list):
                            syl_objs.append({
                                'text': s_txt,
                                'start': round(w_s + s_i * step, 2),
                                'end': round(w_s + (s_i + 1) * step, 2)
                            })

                words_data.append({
                    'text': tok,
                    'start': round(w_s, 2),
                    'end': round(w_e, 2),
                    'probability': 1.0 if ti in word_anchors else 0.85,
                    'syllables': syl_objs
                })
                curr_time_cursor = w_e

            actual_line_start = words_data[0]['start']
            actual_line_end = words_data[-1]['end']

            final_segments.append({
                'start': actual_line_start,
                'end': actual_line_end,
                'text': line,
                'words': words_data
            })
            last_seg_end = actual_line_end

    result = {
        'language': info.language if 'info' in locals() else 'en',
        'duration': round(duration, 2),
        'source': 'line_by_line_syllable_guarantee_v3',
        'segments': final_segments,
        'text': ' '.join(s['text'] for s in final_segments if s['text'] != '[INSTRUMENTAL]')
    }

    with open(output_json, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"Alignment complete! Saved {len(final_segments)} line segments with full syllables to {output_json}")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python transcribe.py <audio_path> <output_json> [prompt_file]")
        sys.exit(1)

    prompt = sys.argv[3] if len(sys.argv) > 3 else None
    align_lyrics_to_audio(sys.argv[1], sys.argv[2], prompt)
