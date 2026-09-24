import json

wf = json.load(open('c:/Projects/supajuka2/server/audio-cache/yt_J7_bMdYfSws/waveform_vocals.json', encoding='utf-8'))
peaks = wf['peaks']
pps = wf['sampleRate']

data = json.load(open('c:/Projects/supajuka2/server/audio-cache/yt_J7_bMdYfSws/lyrics.json', encoding='utf-8'))
segs = data['segments']

print("--- BEFORE SANITIZATION ---")
for i in range(10, 16):
    s = segs[i]
    print(f"[{i}] {s['start']:.2f}s -> {s['end']:.2f}s: '{s['text']}'")

# Sequential non-overlap cascade
# If seg[i+1].start < seg[i].end, shift seg[i+1] so it starts at seg[i].end + 0.05
# And snap to next vocal onset if there's an onset peak
for i in range(len(segs) - 1):
    s1 = segs[i]
    s2 = segs[i + 1]
    if s2['text'] == '[INSTRUMENTAL]':
        continue
    if s1['end'] > s2['start']:
        shift = (s1['end'] + 0.08) - s2['start']
        s2['start'] = round(s2['start'] + shift, 2)
        s2['end'] = round(s2['end'] + shift, 2)
        if 'words' in s2:
            for w in s2['words']:
                w['start'] = round(w['start'] + shift, 2)
                w['end'] = round(w['end'] + shift, 2)
                if 'syllables' in w:
                    for syl in w['syllables']:
                        syl['start'] = round(syl['start'] + shift, 2)
                        syl['end'] = round(syl['end'] + shift, 2)

print("\n--- AFTER NON-OVERLAP CASCADE ---")
for i in range(10, 16):
    s = segs[i]
    print(f"[{i}] {s['start']:.2f}s -> {s['end']:.2f}s: '{s['text']}'")
