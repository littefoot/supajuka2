import json

data = json.load(open('c:/Projects/supajuka2/server/audio-cache/yt_J7_bMdYfSws/lyrics.json', encoding='utf-8'))
segs = data['segments']

prev_end = 0.0
adjusted_count = 0

for i, seg in enumerate(segs):
    if seg['text'] == '[INSTRUMENTAL]':
        if seg['start'] < prev_end:
            seg['start'] = round(prev_end + 0.05, 2)
        if seg['end'] < seg['start'] + 0.5:
            seg['end'] = round(seg['start'] + 0.5, 2)
        prev_end = seg['end']
        continue

    # Vocal segment
    words = seg.get('words', [])
    if not words:
        if seg['start'] < prev_end:
            shift = round((prev_end + 0.05) - seg['start'], 2)
            seg['start'] = round(seg['start'] + shift, 2)
            seg['end'] = round(seg['end'] + shift, 2)
        prev_end = seg['end']
        continue

    line_start = words[0]['start']
    if line_start < prev_end:
        shift = round((prev_end + 0.04) - line_start, 2)
        adjusted_count += 1
        for w in words:
            w['start'] = round(w['start'] + shift, 2)
            w['end'] = round(w['end'] + shift, 2)
            if 'syllables' in w:
                for syl in w['syllables']:
                    syl['start'] = round(syl['start'] + shift, 2)
                    syl['end'] = round(syl['end'] + shift, 2)

    # Clean word-to-word monotonicity
    w_prev_end = words[0]['start']
    for w in words:
        if w['start'] < w_prev_end:
            w_shift = round(w_prev_end - w['start'], 2)
            w['start'] = round(w['start'] + w_shift, 2)
            w['end'] = round(w['end'] + w_shift, 2)
            if 'syllables' in w:
                for syl in w['syllables']:
                    syl['start'] = round(syl['start'] + w_shift, 2)
                    syl['end'] = round(syl['end'] + w_shift, 2)
        w_prev_end = w['end']

    seg['start'] = words[0]['start']
    seg['end'] = words[-1]['end']
    prev_end = seg['end']

print(f"Adjusted {adjusted_count} overlapping vocal lines.")

# Verify remaining overlaps:
overlaps = []
for i in range(len(segs) - 1):
    if segs[i]['end'] > segs[i+1]['start']:
        overlaps.append((i, segs[i]['text'], segs[i]['end'], segs[i+1]['text'], segs[i+1]['start']))

print(f"Remaining overlaps: {len(overlaps)}")

for i in range(10, 16):
    s = segs[i]
    print(f"[{i}] {s['start']:.2f}s -> {s['end']:.2f}s: '{s['text']}'")
