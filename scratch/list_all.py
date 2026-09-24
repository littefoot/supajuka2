import os, json

cache_dir = 'c:/Projects/supajuka2/server/audio-cache'
songs = []
for d in os.listdir(cache_dir):
    dir_path = os.path.join(cache_dir, d)
    meta_path = os.path.join(dir_path, 'metadata.json')
    if os.path.exists(meta_path) and os.path.exists(os.path.join(dir_path, 'instrumental.flac')) and os.path.exists(os.path.join(dir_path, 'lyrics.json')):
        m = json.load(open(meta_path, encoding='utf-8'))
        songs.append((m.get('title', 'Unknown'), m.get('artist', 'Unknown'), d))

songs.sort(key=lambda x: (x[1], x[0]))
for i, s in enumerate(songs):
    print(f"{i+1:2d}. {s[0]} — {s[1]} ({s[2]})")
