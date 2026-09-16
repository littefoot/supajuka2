from faster_whisper import WhisperModel
model = WhisperModel('large-v3-turbo', device='cuda', compute_type='float16')
segs, _ = model.transcribe(r'C:\Projects\supajuka2\server\audio-cache\flac_385c1d653da7\vocals.flac', word_timestamps=True, vad_filter=True)
with open(r'C:\Projects\supajuka2\server\audio-cache\flac_385c1d653da7\verified_text.txt', encoding='utf-8') as pf:
    lines = [l.strip() for l in pf if l.strip() and not l.startswith('[')]

print(f"Whisper produced {len(list(segs))} segments. Ground truth has {len(lines)} lines.")
