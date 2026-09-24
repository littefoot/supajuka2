import json

data = json.load(open('c:/Projects/supajuka2/server/audio-cache/yt_J7_bMdYfSws/lyrics.json', encoding='utf-8'))
segs = data['segments']

wf = json.load(open('c:/Projects/supajuka2/server/audio-cache/yt_J7_bMdYfSws/waveform_vocals.json', encoding='utf-8'))
peaks = wf['peaks']
pps = wf['sampleRate']

def get_peak(t_sec):
    idx = int(t_sec * pps)
    if 0 <= idx < len(peaks):
        return peaks[idx]
    return 0

print("Testing vocal peak at key lines:")
print(f"52.72s (Line 12 'The track'): {get_peak(52.72):.3f}")
print(f"56.00s (Line 12 'chest'): {get_peak(56.0):.3f}")
print(f"56.25s (Silence gap): {get_peak(56.25):.3f}")
print(f"56.50s (Line 13 'Pack a vest'): {get_peak(56.5):.3f}")
