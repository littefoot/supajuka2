import { useState, useEffect, useCallback, useRef } from 'react';
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
import { Mic2, Library, Youtube, UploadCloud, Sparkles, Maximize, Minimize } from 'lucide-react';
import { UserAuthButton } from './components/auth/UserAuthButton';
import { LoginGate } from './components/auth/LoginGate';
import { onAuthChange, User } from './services/firebase';

export default function App() {
  const [activeTab, setActiveTab] = useState<'stage' | 'library'>('stage');
  const [audioState, setAudioState] = useState<AudioEngineState>(audioEngine.getState());
  const [songs, setSongs] = useState<SongMetadata[]>([]);
  const [currentSong, setCurrentSong] = useState<SongMetadata | null>(null);
  const [lyrics, setLyrics] = useState<LyricResult | null>(null);
  const [isLyricsLoading, setIsLyricsLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const defaultSongLoadedRef = useRef(false);
  const activeSongRequestIdRef = useRef<string | null>(null);

  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isYouTubeOpen, setIsYouTubeOpen] = useState(false);
  const [isGeminiOpen, setIsGeminiOpen] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorSong, setEditorSong] = useState<SongMetadata | null>(null);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
    };
  }, []);

  useEffect(() => {
    const unsub = onAuthChange((user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  const toggleFullscreen = async () => {
    try {
      const doc = document as any;
      const docEl = document.documentElement as any;
      const isFs = Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
      if (!isFs) {
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen();
        } else if (docEl.webkitRequestFullscreen) {
          await docEl.webkitRequestFullscreen();
        }
      } else {
        if (doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        }
      }
    } catch (e) {
      console.warn('Fullscreen toggle failed:', e);
    }
  };

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

      // If current song was separated, reload its stems in audioEngine and update metadata
      if (currentSong && update.songId === currentSong.id && update.stage === 'separated') {
        fetch(`/api/audio/song/${currentSong.id}`)
          .then((r) => r.json())
          .then((updatedSong: SongMetadata) => {
            setCurrentSong(updatedSong);
            audioEngine.updateStems(updatedSong);
          })
          .catch(() => {});
      }

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

  const handleSelectSong = async (song: SongMetadata, autoPlay: boolean = true) => {
    // 1. Tag this request to prevent out-of-order race conditions when switching songs quickly
    activeSongRequestIdRef.current = song.id;

    // 2. Immediately update active song, switch to stage, and reset lyrics
    setCurrentSong(song);
    setActiveTab('stage');
    setLyrics(null);
    setIsLyricsLoading(true);

    // 3. Instant load from localStorage if user-saved edits exist
    const localCustom = localStorage.getItem(`supajuka_lyrics_${song.id}`);
    if (localCustom) {
      try {
        const parsed = JSON.parse(localCustom);
        if (activeSongRequestIdRef.current === song.id) {
          setLyrics(parsed);
          setIsLyricsLoading(false);
        }
      } catch (e) {}
    }

    // 4. Concurrently fetch lyrics in parallel with audio stem buffering (do NOT block lyrics on audio!)
    const lyricsPromise = (async () => {
      if (localCustom) return;

      try {
        // Direct static JSON fetch first (fastest on static CDN / Firebase Hosting)
        const staticLyr = await fetch(`/audio/${song.id}/lyrics.json?t=${Date.now()}`);
        if (staticLyr.ok) {
          const lData = await staticLyr.json();
          if (activeSongRequestIdRef.current === song.id) {
            setLyrics(lData);
            setIsLyricsLoading(false);
            return;
          }
        }
      } catch (e) {}

      // Fallback: Check local backend API if available
      try {
        const res = await fetch(`/api/audio/song/${song.id}`);
        if (res.ok) {
          const cType = res.headers.get('content-type');
          if (cType && cType.includes('application/json')) {
            const apiSong = await res.json();
            if (apiSong.hasLyrics) {
              const lyrRes = await fetch(`/audio/${song.id}/lyrics.json?t=${Date.now()}`);
              if (lyrRes.ok) {
                const lData = await lyrRes.json();
                if (activeSongRequestIdRef.current === song.id) {
                  setLyrics(lData);
                  setIsLyricsLoading(false);
                  return;
                }
              }
            }
          }
        }
      } catch (e) {}

      if (activeSongRequestIdRef.current === song.id) {
        setLyrics(null);
        setIsLyricsLoading(false);
      }
    })();

    // 5. Concurrently load audio stems into WasmAudioEngine
    try {
      await audioEngine.loadSong(song);
      if (autoPlay && activeSongRequestIdRef.current === song.id) {
        try {
          await audioEngine.play();
        } catch (e) {
          console.warn('Autoplay gesture required or play deferred:', e);
        }
      }
    } catch (e) {
      console.warn('Failed to load audio stems for song:', e);
    }

    await lyricsPromise;
  };

  // Automatically set 'Give Me Novacaine' as the default loaded track on stage
  useEffect(() => {
    if (songs.length > 0 && !currentSong && !defaultSongLoadedRef.current) {
      defaultSongLoadedRef.current = true;
      const novacaine =
        songs.find(
          (s) => s.id === 'flac_76362ddbe871' || s.title?.toLowerCase().includes('give me novacaine')
        ) || songs[0];

      if (novacaine) {
        handleSelectSong(novacaine, false);
      }
    }
  }, [songs, currentSong]);

  const handleOpenEditor = async (songToEdit?: SongMetadata) => {
    const target = songToEdit || currentSong;
    if (!target) return;
    setEditorSong(target);

    // Fetch latest lyrics (checking localStorage first for on-the-fly edits)
    const localCustom = localStorage.getItem(`supajuka_lyrics_${target.id}`);
    if (localCustom) {
      setLyrics(JSON.parse(localCustom));
    } else {
      try {
        const lyrRes = await fetch(`/audio/${target.id}/lyrics.json?t=${Date.now()}`);
        if (lyrRes.ok) {
          const lData = await lyrRes.json();
          setLyrics(lData);
        }
      } catch (e) {}
    }

    setIsEditorOpen(true);
  };

  const isPartyMode = typeof window !== 'undefined' && (
    (import.meta as any).env?.VITE_PARTY_MODE === 'true' ||
    window.location.hostname.includes('web.app') ||
    window.location.hostname.includes('firebaseapp.com')
  );

  // 1. Loading state while checking Firebase Auth session
  if (authLoading) {
    return (
      <div className="h-[100dvh] w-screen bg-[#101012] flex flex-col items-center justify-center gap-4 text-[#888888] select-none font-mono">
        <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/30 animate-pulse">
          <Mic2 size={24} />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span>CHECKING CREDENTIALS...</span>
        </div>
      </div>
    );
  }

  // 2. Lock down the entire app unless the user is logged in
  if (!currentUser) {
    return <LoginGate onSuccess={() => setStatusNotification('Welcome to SupaJuka!')} />;
  }

  return (
    <div className="h-[100dvh] max-h-[100dvh] w-screen bg-[#181818] text-[#cccccc] flex flex-col justify-between overflow-hidden select-none">
      
      {/* Top Header - Google Antigravity Matte Theme */}
      <header className="border-b border-[#2d2d2d] bg-[#1e1e1e] px-2.5 sm:px-4 md:px-6 py-1.5 sm:py-2 sticky top-0 z-30 flex items-center justify-between shadow-sm flex-shrink-0">
        <div className="flex items-center gap-2 sm:gap-2.5">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm border border-blue-500/40 flex-shrink-0">
            <Mic2 size={16} />
          </div>
          <div className="flex flex-col justify-center leading-none">
            <h1 className="flex flex-col font-mono font-black tracking-wider leading-none select-none">
              <span className="text-[11px] sm:text-xs text-white uppercase">SUPA</span>
              <span className="text-[11px] sm:text-xs text-blue-400 uppercase mt-0.5">JUKA</span>
            </h1>
          </div>
        </div>

        {/* Center Tabs */}
        <div className="flex items-center gap-1 bg-[#141414] p-0.5 sm:p-1 rounded-lg border border-[#2d2d2d]">
          <button
            onClick={() => setActiveTab('stage')}
            className={`px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-md text-[11px] sm:text-xs font-semibold flex items-center gap-1 sm:gap-1.5 transition cursor-pointer ${
              activeTab === 'stage'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-[#858585] hover:text-[#d4d4d4] hover:bg-[#1f1f1f]'
            }`}
          >
            <Mic2 size={12} /> Stage
          </button>
          <button
            onClick={() => setActiveTab('library')}
            className={`px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-md text-[11px] sm:text-xs font-semibold flex items-center gap-1 sm:gap-1.5 transition cursor-pointer ${
              activeTab === 'library'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-[#858585] hover:text-[#d4d4d4] hover:bg-[#1f1f1f]'
            }`}
          >
            <Library size={12} /> Library ({songs.length})
          </button>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          {/* User Auth (Google Sign-In / Party Member Lead Capture) */}
          <UserAuthButton
            user={currentUser}
            onStatusMessage={(msg) => {
              setStatusNotification(msg);
              setTimeout(() => setStatusNotification(null), 4000);
            }}
            onSignOut={() => {
              audioEngine.pause();
              setCurrentSong(null);
              defaultSongLoadedRef.current = false;
            }}
          />

          {/* Fullscreen Button - Top Right Mobile & Desktop */}
          <button
            onClick={toggleFullscreen}
            className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] hover:text-white border border-[#333333] transition cursor-pointer shadow-sm flex items-center gap-1.5 text-xs font-mono font-semibold"
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen (Optimal for Mobile & Stage)"}
          >
            {isFullscreen ? <Minimize size={15} className="text-blue-400" /> : <Maximize size={15} />}
            <span className="hidden md:inline">{isFullscreen ? 'Exit' : 'Fullscreen'}</span>
          </button>

          {!isPartyMode && <GpuVramBadge />}

          {!isPartyMode && (
            <button
              onClick={() => setIsGeminiOpen(true)}
              className="p-1.5 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-amber-400 hover:text-amber-300 border border-[#333333] transition cursor-pointer shadow-sm"
              title="Gemini AI Official Lyrics Configuration"
            >
              <Sparkles size={16} />
            </button>
          )}

          {!isPartyMode && (
            <button
              onClick={() => setIsUploadOpen(true)}
              className="p-1.5 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] hover:text-white border border-[#333333] transition cursor-pointer shadow-sm"
              title="Upload FLAC/WAV"
            >
              <UploadCloud size={16} />
            </button>
          )}

          {!isPartyMode && (
            <button
              onClick={() => setIsYouTubeOpen(true)}
              className="p-1.5 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-red-400 hover:text-red-300 border border-[#333333] transition cursor-pointer shadow-sm"
              title="YouTube to FLAC"
            >
              <Youtube size={16} />
            </button>
          )}
        </div>
      </header>

      {/* Real-time Status Toast */}
      {statusNotification && (
        <div className="fixed top-14 right-6 z-50 bg-[#1e232a] border border-blue-500/50 text-blue-200 px-4 py-2 rounded-lg shadow-2xl text-xs font-mono flex items-center gap-2">
          <span>⚡</span> {statusNotification}
        </div>
      )}

      {/* Main Viewport */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden relative bg-[#181818]">
        {activeTab === 'stage' ? (
          <LyricStage
            lyrics={lyrics}
            isLyricsLoading={isLyricsLoading}
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
              isPartyMode={isPartyMode}
            />
          </div>
        )}
      </main>

      {/* Spectrum Visualizer Background Bar */}
      <div className="h-2.5 sm:h-4 md:h-6 w-full bg-[#141414] border-t border-[#252526] flex items-center justify-center px-4 overflow-hidden pointer-events-none flex-shrink-0">
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

