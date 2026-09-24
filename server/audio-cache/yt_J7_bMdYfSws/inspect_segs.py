import json

data = json.load(open('c:/Projects/supajuka2/server/audio-cache/yt_J7_bMdYfSws/lyrics.json', encoding='utf-8'))
segs = data['segments']

# Let's inspect segments 10 to 18
for i in range(10, 18):
    s = segs[i]
    first_w = s['words'][0]['text'] if s.get('words') else ''
    last_w = s['words'][-1]['text'] if s.get('words') else ''
    print(f"[{i}] {s['start']:.2f}s -> {s['end']:.2f}s: '{s['text']}' (words: {first_w}...{last_w})")
