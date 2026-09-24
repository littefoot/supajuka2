import json

data = json.load(open('c:/Projects/supajuka2/server/audio-cache/yt_J7_bMdYfSws/lyrics.json', encoding='utf-8'))
segs = data['segments']
wf = json.load(open('c:/Projects/supajuka2/server/audio-cache/yt_J7_bMdYfSws/waveform_vocals.json', encoding='utf-8'))
peaks = wf['peaks']
pps = wf['sampleRate']

def find_vocal_onset(t_start, max_search_sec=5.0):
    start_idx = max(0, int(t_start * pps))
    end_idx = min(len(peaks) - 1, int((t_start + max_search_sec) * pps))
    # Look for transient peak >= 0.15
    for i in range(start_idx, end_idx):
        if peaks[i] >= 0.15:
            # Walk backward to valley
            onset = i
            cutoff = max(0.04, peaks[i] * 0.20)
            for j in range(i, max(0, i - 25), -1):
                if peaks[j] <= cutoff:
                    onset = j
                    break
                if peaks[j] < peaks[onset]:
                    onset = j
            return round(onset / pps, 2)
    return round(t_start, 2)

for i in range(len(segs) - 1):
    s1 = segs[i]
    s2 = segs[i + 1]
    if s2['text'] == '[INSTRUMENTAL]':
        continue
    
    # If s2 starts before s1 ends, find the true vocal onset after s1 finishes
    if s2['start'] < s1['end']:
        search_from = s1['end']
        new_start = find_vocal_onset(search_from)
        if new_start <= s1['end']:
            new_start = round(s1['end'] + 0.08, 2)
        
        delta = round(new_start - s2['start'], 2)
        s2['start'] = new_start
        s2['end'] = round(s2['end'] + delta, 2)
        if 'words' in s2:
            for w in s2['words']:
                w['start'] = round(w['start'] + delta, 2)
                w['end'] = round(w['end'] + delta, 2)
                if 'syllables' in w:
                    for syl in w['syllables']:
                        syl['start'] = round(syl['start'] + delta, 2)
                        syl['end'] = round(syl['end'] + delta, 2)

# Check overlaps
remaining = [i for i in range(len(segs)-1) if segs[i]['end'] > segs[i+1]['start']]
print(f"Remaining overlaps after acoustic separation: {len(remaining)}")

print("\nLines 10 to 15:")
for i in range(10, 16):
    s = segs[i]
    print(f"[{i}] {s['start']:.2f}s -> {s['end']:.2f}s: '{s['text']}'")
