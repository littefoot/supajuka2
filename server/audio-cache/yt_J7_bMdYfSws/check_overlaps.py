import json

data = json.load(open('c:/Projects/supajuka2/server/audio-cache/yt_J7_bMdYfSws/lyrics.json', encoding='utf-8'))
segs = data['segments']
overlaps = []
for i in range(len(segs) - 1):
    s1 = segs[i]
    s2 = segs[i + 1]
    if s1['end'] > s2['start']:
        overlaps.append((i, s1['text'], s1['end'], s2['text'], s2['start']))

print(f"Total overlapping segments: {len(overlaps)}")
for o in overlaps:
    print(f"[{o[0]}] '{o[1]}' ends at {o[2]:.2f}s > [{o[0]+1}] '{o[3]}' starts at {o[4]:.2f}s (overlap: {o[2]-o[4]:.2f}s)")
