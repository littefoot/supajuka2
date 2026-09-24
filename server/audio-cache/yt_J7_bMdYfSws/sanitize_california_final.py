import json

lyrics_path = 'c:/Projects/supajuka2/server/audio-cache/yt_J7_bMdYfSws/lyrics.json'
wf_path = 'c:/Projects/supajuka2/server/audio-cache/yt_J7_bMdYfSws/waveform_vocals.json'

data = json.load(open(lyrics_path, encoding='utf-8'))
segs = data['segments']
wf = json.load(open(wf_path, encoding='utf-8'))
peaks = wf['peaks']
pps = wf['sampleRate']

def get_peak(t):
    idx = int(t * pps)
    return peaks[idx] if 0 <= idx < len(peaks) else 0

# Step 1: Sequential segment non-overlap enforcement with acoustic onset detection
last_end = 0.0
for i in range(len(segs)):
    seg = segs[i]
    if seg['text'] == '[INSTRUMENTAL]':
        if seg['start'] < last_end:
            seg['start'] = round(last_end + 0.05, 2)
        if seg['end'] < seg['start'] + 0.5:
            seg['end'] = round(seg['start'] + 0.5, 2)
        last_end = seg['end']
        continue

    words = seg.get('words', [])
    if not words:
        if seg['start'] < last_end:
            seg['start'] = round(last_end + 0.05, 2)
            seg['end'] = round(seg['start'] + 2.0, 2)
        last_end = seg['end']
        continue

    # If this segment starts earlier than previous line finished, shift it
    if seg['start'] < last_end:
        # Search for vocal onset after last_end
        search_start = int(last_end * pps)
        search_end = min(len(peaks) - 1, int((last_end + 3.0) * pps))
        best_onset = last_end + 0.06
        for p in range(search_start, search_end):
            if peaks[p] >= 0.12:
                # Walk back to valley
                onset = p
                for j in range(p, max(search_start, p - 20), -1):
                    if peaks[j] <= 0.04:
                        onset = j
                        break
                    if peaks[j] < peaks[onset]:
                        onset = j
                best_onset = max(last_end + 0.05, onset / pps)
                break

        shift = round(best_onset - words[0]['start'], 2)
        for w in words:
            w['start'] = round(w['start'] + shift, 2)
            w['end'] = round(w['end'] + shift, 2)
            if 'syllables' in w:
                for syl in w['syllables']:
                    syl['start'] = round(syl['start'] + shift, 2)
                    syl['end'] = round(syl['end'] + shift, 2)

    # Clean word-to-word and syllable-to-syllable monotonicity
    cur_w_start = words[0]['start']
    for w in words:
        if w['start'] < cur_w_start:
            w_shift = round(cur_w_start - w['start'], 2)
            w['start'] = round(w['start'] + w_shift, 2)
            w['end'] = round(w['end'] + w_shift, 2)
            if 'syllables' in w:
                for syl in w['syllables']:
                    syl['start'] = round(syl['start'] + w_shift, 2)
                    syl['end'] = round(syl['end'] + w_shift, 2)

        if 'syllables' in w and w['syllables']:
            cur_s_start = w['syllables'][0]['start']
            for s in w['syllables']:
                if s['start'] < cur_s_start:
                    s_shift = round(cur_s_start - s['start'], 2)
                    s['start'] = round(s['start'] + s_shift, 2)
                    s['end'] = round(s['end'] + s_shift, 2)
                cur_s_start = s['end']

        cur_w_start = w['end']

    seg['start'] = words[0]['start']
    seg['end'] = words[-1]['end']
    last_end = seg['end']

# Save sanitized lyrics
with open(lyrics_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)

print("Successfully sanitized California Love lyrics.json!")

# Check remaining overlaps
overlaps = []
for i in range(len(segs) - 1):
    if segs[i]['end'] > segs[i+1]['start']:
        overlaps.append((i, segs[i]['text'], segs[i]['end'], segs[i+1]['text'], segs[i+1]['start']))
print(f"Remaining overlaps in California Love: {len(overlaps)}")

for i in range(10, 16):
    s = segs[i]
    print(f"[{i}] {s['start']:.2f}s -> {s['end']:.2f}s: '{s['text']}'")
