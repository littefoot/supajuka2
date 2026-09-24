import json

wf = json.load(open('server/audio-cache/yt_1k8craCGpgs/waveform_vocals.json'))
lyr = json.load(open('server/audio-cache/yt_1k8craCGpgs/lyrics.json'))
pps = wf['sampleRate']
pts = wf['peaks']

print("--- Peaks around 'Just a city boy' (33.0s to 37.0s) ---")
for t_tenth in range(330, 370, 2):
    t = t_tenth / 10.0
    idx = int(t * pps)
    chunk = pts[idx:idx+pps//5]
    avg_amp = sum(chunk)/len(chunk) if chunk else 0
    max_amp = max(chunk) if chunk else 0
    bar = '#' * int(max_amp * 40)
    print(f"{t:5.1f}s | max: {max_amp:.3f} avg: {avg_amp:.3f} | {bar}")

# Print words in Line 4
seg = lyr['segments'][4]
print("\nSegment 4 words:")
for w in seg.get('words', []):
    print(f"  {w.get('text'):10s}: [{w.get('start'):.2f}s - {w.get('end'):.2f}s]")
    for syl in w.get('syllables', []):
        print(f"    syl {syl.get('text'):6s}: [{syl.get('start'):.2f}s - {syl.get('end'):.2f}s]")
