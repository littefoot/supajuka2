"""
Lyrics proofreader and bar formatter for SupaJuka 2.
Formats lyrics into short 4-8 word karaoke bars.
Supports Ollama (Gemma 4:e4b / Gemma 4:12b) with Google Gemini 3.0 Pro fallback.
"""

import sys
import json
import os
import requests

def load_env():
    env = {}
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    if os.path.exists(env_path):
        with open(env_path, encoding='utf-8') as f:
            for line in f:
                if '=' in line and not line.strip().startswith('#'):
                    k, v = line.strip().split('=', 1)
                    env[k.strip()] = v.strip()
    return env

def proofread_with_ollama(track_name, raw_text, host, model):
    url = f"{host}/api/generate"
    prompt = (
        f"You are an API that formats song lyrics for a karaoke screen.\n"
        f"Track: '{track_name}'\n\n"
        f"RAW LYRICS:\n{raw_text}\n\n"
        f"RULES:\n"
        f"1. Break lyrics into short, natural singing lines (4 to 8 words per line).\n"
        f"2. Retain original language. DO NOT translate.\n"
        f"3. Strip out metadata, web ads, or bracket notes like [Chorus] if they break the flow.\n"
        f"4. Output ONLY the formatted lyrics lines, nothing else.\n"
    )
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False
    }
    resp = requests.post(url, json=payload, timeout=45)
    if resp.status_code == 200:
        return resp.json().get("response", "").strip()
    return None

def proofread_with_gemini(track_name, raw_text, api_key):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    prompt = (
        f"Format these lyrics for karaoke (4-8 words per line, no translation, no conversational filler):\n\n"
        f"{raw_text}"
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}]
    }
    resp = requests.post(url, json=payload, timeout=20)
    if resp.status_code == 200:
        data = resp.json()
        return data['candidates'][0]['content']['parts'][0]['text'].strip()
    return None

def main():
    if len(sys.argv) < 3:
        print("Usage: python proofread.py <track_title> <lyrics_input_file> [output_file]")
        sys.exit(1)
        
    title = sys.argv[1]
    input_file = sys.argv[2]
    out_file = sys.argv[3] if len(sys.argv) > 3 else None
    
    with open(input_file, 'r', encoding='utf-8') as f:
        raw_text = f.read()
        
    env = load_env()
    provider = env.get("LLM_PROVIDER", "ollama")
    host = env.get("OLLAMA_HOST", "http://localhost:11434")
    model = env.get("LLM_MODEL", "gemma4:e4b")
    api_key = env.get("GOOGLE_API_KEY", "")
    
    result = None
    if provider == "ollama":
        try:
            print(f"Proofreading lyrics with Ollama ({model})...")
            result = proofread_with_ollama(title, raw_text, host, model)
        except Exception as e:
            print(f"Ollama proofread failed: {e}")
            
    if not result and api_key:
        try:
            print("Falling back to Gemini...")
            result = proofread_with_gemini(title, raw_text, api_key)
        except Exception as e:
            print(f"Gemini fallback failed: {e}")
            
    if not result:
        result = raw_text
        
    if out_file:
        with open(out_file, 'w', encoding='utf-8') as f:
            f.write(result)
        print(f"Proofread lyrics saved to {out_file}")
    else:
        print(result)

if __name__ == "__main__":
    main()
