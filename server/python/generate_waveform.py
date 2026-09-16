import sys
import os
import json
import time
import numpy as np
import soundfile as sf

def compute_waveform(audio_path, output_json, points_per_sec=50):
    if not os.path.exists(audio_path):
        print(f"Error: audio file {audio_path} does not exist", file=sys.stderr)
        sys.exit(1)
        
    data, sr = sf.read(audio_path)
    if data.ndim > 1:
        data = data.mean(axis=1)
        
    duration = float(len(data)) / float(sr)
    block_size = max(1, int(sr / points_per_sec))
    num_blocks = len(data) // block_size
    
    peaks = []
    for i in range(num_blocks):
        chunk = data[i * block_size : (i + 1) * block_size]
        peak = float(np.max(np.abs(chunk)))
        peaks.append(round(peak, 4))
        
    # Normalize if max_peak > 0
    max_p = max(peaks) if peaks else 1.0
    if max_p > 0:
        normalized = [round(p / max_p, 4) for p in peaks]
    else:
        normalized = peaks
        
    result = {
        "sampleRate": points_per_sec,
        "duration": round(duration, 3),
        "totalPoints": len(normalized),
        "peaks": normalized
    }
    
    os.makedirs(os.path.dirname(output_json), exist_ok=True)
    with open(output_json, 'w', encoding='utf-8') as f:
        json.dump(result, f)
        
    print(f"Waveform saved to {output_json}: {len(normalized)} points")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python generate_waveform.py <audio_path> <output_json> [points_per_sec]")
        sys.exit(1)
    
    pts = int(sys.argv[3]) if len(sys.argv) > 3 else 50
    compute_waveform(sys.argv[1], sys.argv[2], pts)
