"""
High-Fidelity Stem Separator for SupaJuka 2.
Primary: Mel-Band RoFormer / BS-RoFormer via audio-separator (nomadkaraoke)
Fallback: Demucs v4 (htdemucs) with lossless FLAC output
Strictly frees CUDA VRAM on completion for RTX 4050 6GB.
"""

import sys
import os
import gc
import shutil

def run_audio_separator(input_audio, output_dir):
    try:
        from audio_separator.separator import Separator
        print(f"Loading Mel-Band RoFormer model via audio-separator...")
        
        separator = Separator(
            output_dir=output_dir,
            output_format="FLAC",
            log_level=20
        )
        
        separator.load_model(model_filename="model_mel_band_roformer_crowd.ckpt")
        print("Separating stems with Mel-Band RoFormer...")
        output_files = separator.separate(input_audio)
        
        inst_path = os.path.join(output_dir, "instrumental.flac")
        vocals_path = os.path.join(output_dir, "vocals.flac")
        
        for f in output_files:
            low = f.lower()
            src = os.path.join(output_dir, f) if not os.path.isabs(f) else f
            if "vocals" in low:
                shutil.move(src, vocals_path)
            elif "instrumental" in low or "background" in low or "other" in low:
                shutil.move(src, inst_path)
                
        return True
    except Exception as e:
        print(f"Audio-separator Mel-Band RoFormer encountered an issue: {e}", file=sys.stderr)
        return False

def run_demucs_flac(input_audio, output_dir):
    import subprocess
    print("Falling back to Demucs v4 (htdemucs) with lossless FLAC output...")
    
    temp_dir = os.path.join(output_dir, "demucs_out")
    os.makedirs(temp_dir, exist_ok=True)
    
    cmd = [
        "py", "-3.12", "-m", "demucs",
        "--two-stems", "vocals",
        "-n", "htdemucs",
        "-d", "cuda",
        "--flac",
        "-o", temp_dir,
        input_audio
    ]
    
    ret = subprocess.run(cmd, capture_output=True, text=True)
    if ret.returncode != 0:
        print(f"Demucs failed: {ret.stderr}", file=sys.stderr)
        return False
        
    track_name = os.path.splitext(os.path.basename(input_audio))[0]
    sub_dir = os.path.join(temp_dir, "htdemucs", track_name)
    
    v_src = os.path.join(sub_dir, "vocals.flac")
    i_src = os.path.join(sub_dir, "no_vocals.flac")
    
    if os.path.exists(v_src) and os.path.exists(i_src):
        shutil.move(v_src, os.path.join(output_dir, "vocals.flac"))
        shutil.move(i_src, os.path.join(output_dir, "instrumental.flac"))
        shutil.rmtree(temp_dir, ignore_errors=True)
        return True
        
    return False

def main():
    if len(sys.argv) < 3:
        print("Usage: python separator.py <input_audio> <output_dir>")
        sys.exit(1)
        
    input_audio = sys.argv[1]
    output_dir = sys.argv[2]
    
    if not os.path.exists(input_audio):
        print(f"Error: Input file {input_audio} does not exist", file=sys.stderr)
        sys.exit(1)
        
    os.makedirs(output_dir, exist_ok=True)
    
    success = False
    model_used = "Mel-Band RoFormer"
    
    try:
        success = run_audio_separator(input_audio, output_dir)
    except Exception as e:
        print(f"audio-separator exception: {e}")
        
    if not success:
        model_used = "Demucs v4 (FLAC)"
        success = run_demucs_flac(input_audio, output_dir)
        
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except Exception:
        pass
    gc.collect()
    
    if success:
        print(f"SUCCESS: Separation complete using {model_used}.")
        sys.exit(0)
    else:
        print("ERROR: All separation engines failed.", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
