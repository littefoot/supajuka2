import json
import os

cache_dir = 'c:/Projects/supajuka2/server/audio-cache'
for folder in os.listdir(cache_dir):
    lyrics_file = os.path.join(cache_dir, folder, 'lyrics.json')
    if os.path.exists(lyrics_file):
        try:
            data = json.load(open(lyrics_file, encoding='utf-8'))
            segs = data.get('segments', [])
            overlaps = []
            for i in range(len(segs) - 1):
                if segs[i]['end'] > segs[i+1]['start']:
                    overlaps.append((i, segs[i]['text'], segs[i]['end'], segs[i+1]['text'], segs[i+1]['start']))
            if overlaps:
                print(f"Song {folder} ({data.get('source', 'unknown')}): {len(overlaps)} overlaps")
        except Exception as e:
            print(f"Error checking {folder}: {e}")
