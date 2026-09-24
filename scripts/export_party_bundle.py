import os
import json
import shutil
import sys

# Priority party track IDs (Iconic sing-alongs, crowd pleasers, classics)
PRIORITY_PARTY_IDS = [
    'yt_J7_bMdYfSws',       # California Love - 2Pac
    'yt_gGdGFtwCNBE',       # Mr. Brightside - The Killers
    'yt_fJ9rUzIMcZQ',       # Bohemian Rhapsody - Queen
    'yt_1k8craCGpgs',       # Don't Stop Believin' - Journey
    'yt_4F_RCWVoL4s',       # Sweet Caroline - Neil Diamond
    'flac_516ba4eb4a17',    # Piano Man - Billy Joel
    'flac_2b180affdece',    # Uptown Girl - Billy Joel
    'flac_ff4cb1ce79af',    # We Didn't Start the Fire - Billy Joel
    'flac_50ab96e17430',    # Movin' Out - Billy Joel
    'flac_59100bf0db81',    # The Longest Time - Billy Joel
    'yt_ZJL4UGSbeFg',       # Man! I Feel Like A Woman! - Shania Twain
    'flac_d02feb70cde9',    # Baby Got Back - Sir Mix-A-Lot
    'flac_a7e3cd88e60a',    # Don't Look Back in Anger - Oasis
    'flac_df8a7231ec76',    # Wonderwall - Oasis
    'flac_74fe02bee241',    # American Idiot - Green Day
    'flac_15caee050556',    # Boulevard of Broken Dreams - Green Day
    'flac_76362ddbe871',    # Give Me Novacaine - Green Day
    'flac_385c1d653da7',    # Holiday - Green Day
    'yt_O-aavAlSYgc',       # Can't Help Falling in Love - Elvis Presley
    'flac_42a0c0004e96',    # Knockin' On Heaven's Door - Guns N' Roses
    'flac_2359b8281994',    # Numb - Linkin Park
    'flac_5fac1fbcb060',    # Faint - Linkin Park
    'flac_648382266d14',    # Breaking The Habit - Linkin Park
    'yt_6vwNcNOTVzY',       # Gold Digger - Kanye West
    'flac_92d6ff2a15d7',    # Stronger - Kanye West
    'flac_3890be2d4d58',    # Hey Jude - The Beatles
    'flac_5cfe3a8269a9',    # Here Comes The Sun - The Beatles
    'flac_a97b52b22384',    # Come Together - The Beatles
    'flac_dc7cabe27379',    # Let It Be - The Beatles
    'yt_dsgBpsNPQ50',       # Working for the Weekend - Loverboy
]

def export_bundle(export_all=False):
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cache_dir = os.path.join(base_dir, 'server', 'audio-cache')
    dest_audio_dir = os.path.join(base_dir, 'client', 'public', 'audio')
    
    os.makedirs(dest_audio_dir, exist_ok=True)
    
    # Scan available songs
    available = []
    for d in os.listdir(cache_dir):
        dp = os.path.join(cache_dir, d)
        if not os.path.isdir(dp):
            continue
        meta_p = os.path.join(dp, 'metadata.json')
        inst_p = os.path.join(dp, 'instrumental.flac')
        voc_p = os.path.join(dp, 'vocals.flac')
        lyr_p = os.path.join(dp, 'lyrics.json')
        
        if os.path.exists(meta_p) and os.path.exists(inst_p) and os.path.exists(lyr_p):
            available.append(d)
            
    print(f"Found {len(available)} ready separated songs in cache.")
    
    # Select which songs to export
    if export_all:
        selected_ids = available
    else:
        # Prioritize curated party tracks, then fill up to 30
        selected_ids = [sid for sid in PRIORITY_PARTY_IDS if sid in available]
        for aid in available:
            if aid not in selected_ids and len(selected_ids) < 30:
                selected_ids.append(aid)
                
    print(f"Exporting {len(selected_ids)} tracks to {dest_audio_dir}...")
    
    library_items = []
    total_bytes = 0
    
    for sid in selected_ids:
        src_song_dir = os.path.join(cache_dir, sid)
        target_song_dir = os.path.join(dest_audio_dir, sid)
        os.makedirs(target_song_dir, exist_ok=True)
        
        # Read and adjust metadata
        meta = json.load(open(os.path.join(src_song_dir, 'metadata.json'), encoding='utf-8'))
        meta['hasLyrics'] = True
        
        # Audio file handling (Firebase 32MB limit safeguard)
        MAX_BYTES = 30 * 1024 * 1024  # 30 MB safe ceiling
        
        for audio_key, stem_name in [('instrumentalUrl', 'instrumental'), ('vocalsUrl', 'vocals')]:
            src_flac = os.path.join(src_song_dir, f"{stem_name}.flac")
            dest_flac = os.path.join(target_song_dir, f"{stem_name}.flac")
            dest_mp3 = os.path.join(target_song_dir, f"{stem_name}.mp3")
            
            if os.path.exists(src_flac):
                src_sz = os.path.getsize(src_flac)
                if src_sz > MAX_BYTES:
                    # Oversized stem! Convert to 320kbps MP3 to keep under 32MB
                    meta[audio_key] = f"/audio/{sid}/{stem_name}.mp3"
                    if os.path.exists(dest_flac):
                        os.remove(dest_flac)
                    if not os.path.exists(dest_mp3):
                        print(f"    [Transcode] {stem_name}.flac ({round(src_sz / (1024*1024), 1)} MB) -> {stem_name}.mp3 (320k)")
                        import subprocess
                        subprocess.run(['ffmpeg', '-y', '-i', src_flac, '-b:a', '320k', dest_mp3], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    total_bytes += os.path.getsize(dest_mp3)
                else:
                    # Within lossless 30MB limit: keep bit-perfect FLAC
                    meta[audio_key] = f"/audio/{sid}/{stem_name}.flac"
                    if os.path.exists(dest_mp3):
                        os.remove(dest_mp3)
                    if not os.path.exists(dest_flac) or os.path.getsize(dest_flac) != src_sz:
                        shutil.copy2(src_flac, dest_flac)
                    total_bytes += os.path.getsize(dest_flac)
                    
        # Copy remaining metadata/waveform/artwork
        for fn in ['lyrics.json', 'waveform_vocals.json', 'cover.jpg']:
            s_file = os.path.join(src_song_dir, fn)
            t_file = os.path.join(target_song_dir, fn)
            if os.path.exists(s_file):
                if not os.path.exists(t_file) or os.path.getsize(t_file) != os.path.getsize(s_file):
                    shutil.copy2(s_file, t_file)
                total_bytes += os.path.getsize(s_file)
                if fn == 'cover.jpg':
                    meta['coverArtUrl'] = f"/audio/{sid}/cover.jpg"
                    meta['hasCoverArt'] = True
                    
        with open(os.path.join(target_song_dir, 'metadata.json'), 'w', encoding='utf-8') as f:
            json.dump(meta, f, indent=2)
            
        library_items.append(meta)
        print(f"  + [{sid}] {meta.get('title')} - {meta.get('artist')}".encode('ascii', 'ignore').decode('ascii'))
        
    # Write master library.json
    library_items.sort(key=lambda x: (x.get('artist', ''), x.get('title', '')))
    lib_path = os.path.join(dest_audio_dir, 'library.json')
    with open(lib_path, 'w', encoding='utf-8') as f:
        json.dump(library_items, f, indent=2)
        
    print(f"\nSuccessfully exported {len(library_items)} songs ({round(total_bytes / (1024*1024), 1)} MB) to client/public/audio/library.json!")

if __name__ == '__main__':
    all_flag = '--all' in sys.argv
    export_bundle(export_all=all_flag)
