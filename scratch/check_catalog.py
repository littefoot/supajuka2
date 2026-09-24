import os, json

cache_dir = 'c:/Projects/supajuka2/server/audio-cache'
songs = []
total_bytes = 0

for d in os.listdir(cache_dir):
    dir_path = os.path.join(cache_dir, d)
    if not os.path.isdir(dir_path):
        continue
    meta_path = os.path.join(dir_path, 'metadata.json')
    if os.path.exists(meta_path):
        try:
            m = json.load(open(meta_path, encoding='utf-8'))
            inst_path = os.path.join(dir_path, 'instrumental.flac')
            voc_path = os.path.join(dir_path, 'vocals.flac')
            lyr_path = os.path.join(dir_path, 'lyrics.json')
            wf_path = os.path.join(dir_path, 'waveform_vocals.json')
            
            s_bytes = 0
            has_separated = os.path.exists(inst_path) and os.path.exists(voc_path)
            has_lyrics = os.path.exists(lyr_path)
            
            for f in [inst_path, voc_path, lyr_path, wf_path]:
                if os.path.exists(f):
                    s_bytes += os.path.getsize(f)
            
            total_bytes += s_bytes
            songs.append({
                'id': m.get('id', d),
                'title': m.get('title', 'Unknown'),
                'artist': m.get('artist', 'Unknown'),
                'has_separated': has_separated,
                'has_lyrics': has_lyrics,
                'size_mb': round(s_bytes / (1024 * 1024), 1)
            })
        except Exception as e:
            pass

print(f"Total songs ready: {len(songs)}")
print(f"Total stem/lyrics size across all songs: {round(total_bytes / (1024 * 1024), 1)} MB ({round(total_bytes / (1024 * 1024 * 1024), 2)} GB)")

ready_songs = [s for s in songs if s['has_separated'] and s['has_lyrics']]
print(f"Fully ready (separated + lyrics): {len(ready_songs)}")
for s in ready_songs[:25]:
    print(f"  • {s['title']} - {s['artist']} ({s['size_mb']} MB)")
