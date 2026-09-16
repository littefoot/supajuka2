import { useState, useEffect, useCallback } from 'react';
import { audioEngine, AudioEngineState } from './audio/WasmAudioEngine';
import { AudioControlsBar } from './components/audio/AudioControlsBar';
import { SpectrumVisualizer } from './components/audio/SpectrumVisualizer';
import { LyricStage } from './components/karaoke/LyricStage';
import { LyricEditorModal } from './components/karaoke/LyricEditorModal';
import { SongLibrary } from './components/library/SongLibrary';
import { FlacUploadModal } from './components/library/FlacUploadModal';
import { YouTubeModal } from './components/library/YouTubeModal';
import { GpuVramBadge } from './components/system/GpuVramBadge';
import { GeminiSettingsModal } from './components/system/GeminiSettingsModal';
import { getLibrary, socket } from './services/api';
import { SongMetadata, LyricResult, SongStatusUpdate } from './types';
import { Mic2, Library, Youtube, UploadCloud, Sparkles } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'stage' | 'library'>('stage');
  const [audioState, setAudioState] = useState<AudioEngineState>(audioEngine.getState());
  const [songs, setSongs] = useState<SongMetadata[]>([]);
  const [currentSong, setCurrentSong] = useState<SongMetadata | null>(null);
  const [lyrics, setLyrics] = useState<LyricResult | null>(null);

  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isYouTubeOpen, setIsYouTubeOpen] = useState(false);
  const [isGeminiOpen, setIsGeminiOpen] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorSong, setEditorSong] = useState<SongMetadata | null>(null);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);

  const refreshLibrary = useCallback(async () => {
    try {
      const data = await getLibrary();
      setSongs(data);
    } catch (e) {}
  }, []);

  useEffect(() => {
    const unsub = audioEngine.subscribe(setAudioState);
    refreshLibrary();

    socket.on('song:status', (update: SongStatusUpdate) => {
      setStatusNotification(update.message || `${update.stage}`);
      setTimeout(() => setStatusNotification(null), 4000);
      refreshLibrary();

      // If current song was transcribed or updated, reload its lyrics
      if (currentSong && update.songId === currentSong.id && (update.stage === 'transcribed' || update.stage === 'lyrics_saved')) {
        fetch(`/audio/${currentSong.id}/lyrics.json?t=${Date.now()}`)
          .then((r) => r.json())
          .then(setLyrics)
          .catch(() => {});
      }
    });

    return () => {
      unsub();
      socket.off('song:status');
    };
  }, [refreshLibrary, currentSong]);

  const handleSelectSong = async (song: SongMetadata) => {
    setCurrentSong(song);
    await audioEngine.loadSong(song);
    setActiveTab('stage');
    try {
      await audioEngine.play();
    } catch (e) {
      console.warn('Autoplay gesture required or play deferred:', e);
    }

    // Fetch lyrics if available
    try {
      const res = await fetch(`/api/audio/song/${song.id}`);
      if (res.ok) {
        const lyrRes = await fetch(`/audio/${song.id}/lyrics.json?t=${Date.now()}`);
        if (lyrRes.ok) {
          const lData = await lyrRes.json();
          setLyrics(lData);
        } else {
          setLyrics(null);
        }
      }
    } catch (e) {
      setLyrics(null);
    }
  };

  const handleOpenEditor = async (songToEdit?: SongMetadata) => {
    const target = songToEdit || currentSong;
    if (!target) return;
    setEditorSong(target);

    // Fetch latest lyrics if not current
    try {
      const lyrRes = await fetch(`/audio/${target.id}/lyrics.json?t=${Date.now()}`);
      if (lyrRes.ok) {
        const lData = await lyrRes.json();
        setLyrics(lData);
      }
    } catch (e) {}

    setIsEditorOpen(true);
  };

  return (
    <div className="h-screen max-h-screen w-screen bg-[#07090e] text-slate-100 flex flex-col justify-between font-['Outfit'] overflow-hidden">
      
      {/* Top Header */}
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md px-4 md:px-8 py-3 sticky top-0 z-30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-fuchsia-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-fuchsia-600/30">
            <Mic2 size={22} />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
              SupaJuka <span className="text-xs px-2 py-0.5 rounded-full bg-fuchsia-950 text-fuchsia-400 border border-fuchsia-800 font-mono">2.0 Lossless</span>
            </h1>
            <p className="text-[11px] text-slate-400">FLAC â€¢ Mel-Band RoFormer â€¢ Faster-Whisper â€¢ WSOLA</p>
          </div>
        </div>

        {/* Center Tabs */}
        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('stage')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'stage' ? 'bg-fuchsia-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Mic2 size={14} /> Stage
          </button>
          <button
            onClick={() => setActiveTab('library')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'library' ? 'bg-fuchsia-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Library size={14} /> Library ({songs.length})
          </button>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          <GpuVramBadge />

          <button
            onClick={() => setIsGeminiOpen(true)}
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-fuchsia-400 border border-slate-800 hover:border-fuchsia-800/60 transition cursor-pointer shadow-sm"
            title="Gemini AI Official Lyrics Configuration"
          >
            <Sparkles size={18} />
          </button>

          <button
            onClick={() => setIsUploadOpen(true)}
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition cursor-pointer"
            title="Upload FLAC/WAV"
          >
            <UploadCloud size={18} />
          </button>

          <button
            onClick={() => setIsYouTubeOpen(true)}
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-red-400 border border-slate-800 transition cursor-pointer"
            title="YouTube to FLAC"
          >
            <Youtube size={18} />
          </button>
        </div>
      </header>

      {/* Real-time Status Toast */}
      {statusNotification && (
        <div className="fixed top-16 right-8 z-50 bg-indigo-950 border border-indigo-700 text-indigo-200 px-4 py-2 rounded-xl shadow-xl text-xs animate-bounce font-mono">
          âš¡ {statusNotification}
        </div>
      )}

      {/* Main Viewport */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        {activeTab === 'stage' ? (
          <LyricStage
            lyrics={lyrics}
            currentTime={audioState.currentTime}
            currentSong={currentSong}
            pitch={audioState.pitch}
            onSelectSongModal={() => setActiveTab('library')}
            onSeek={(t) => audioEngine.seek(t)}
            onOpenLyricEditor={() => handleOpenEditor()}
          />
        ) : (
          <div className="flex-1 overflow-y-auto">
            <SongLibrary
              songs={songs}
              onSelectSong={handleSelectSong}
              onRefreshLibrary={refreshLibrary}
              onOpenUpload={() => setIsUploadOpen(true)}
              onOpenLyricEditor={(s) => handleOpenEditor(s)}
            />
          </div>
        )}
      </main>

      {/* Spectrum Visualizer Background Bar */}
      <div className="h-10 w-full bg-slate-950/40 border-t border-slate-900/60 flex items-center justify-center px-4 overflow-hidden pointer-events-none">
        <SpectrumVisualizer fftData={audioState.fftData} isPlaying={audioState.isPlaying} />
      </div>

      {/* Persistent Audio Controls Bar */}
      <AudioControlsBar state={audioState} />

      {/* Modals */}
      <FlacUploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onSongUploaded={async (newSong: SongMetadata) => {
          await refreshLibrary();
          handleSelectSong(newSong);
        }}
      />

      <YouTubeModal
        isOpen={isYouTubeOpen}
        onClose={() => setIsYouTubeOpen(false)}
        onExtracted={async (newSong) => {
          await refreshLibrary();
          handleSelectSong(newSong);
        }}
      />

      <GeminiSettingsModal
        isOpen={isGeminiOpen}
        onClose={() => setIsGeminiOpen(false)}
      />

      {isEditorOpen && (editorSong || currentSong) && lyrics && (
        <LyricEditorModal
          isOpen={isEditorOpen}
          song={editorSong || currentSong!}
          lyrics={lyrics}
          currentTime={audioState.currentTime}
          duration={audioState.duration}
          onClose={() => setIsEditorOpen(false)}
          onSave={(newLyrics) => {
            setLyrics(newLyrics);
            setStatusNotification('Lyrics updated and saved successfully!');
            setTimeout(() => setStatusNotification(null), 3000);
          }}
        />
      )}
    </div>
  );
}

