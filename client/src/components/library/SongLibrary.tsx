import React, { useState } from 'react';
import { SongMetadata } from '../../types';
import { Play, Sparkles, FileText, Trash2, Disc, Music, Edit3, Wand2 } from 'lucide-react';
import { separateStems, transcribeLyrics, fetchOfficialLyrics, deleteSongFromLibrary } from '../../services/api';

interface Props {
  songs: SongMetadata[];
  onSelectSong: (song: SongMetadata) => void;
  onRefreshLibrary: () => void;
  onOpenUpload: () => void;
  onOpenLyricEditor?: (song: SongMetadata) => void;
  isPartyMode?: boolean;
}

export const SongLibrary: React.FC<Props> = ({
  songs,
  onSelectSong,
  onRefreshLibrary,
  onOpenUpload,
  onOpenLyricEditor,
  isPartyMode = false,
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleSeparate = async (song: SongMetadata) => {
    setBusyId(song.id);
    try {
      await separateStems(song.id);
      onRefreshLibrary();
    } catch (e: any) {
      alert(`Separation failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleTranscribe = async (song: SongMetadata) => {
    setBusyId(song.id);
    try {
      await transcribeLyrics(song.id);
      onRefreshLibrary();
    } catch (e: any) {
      alert(`Transcription failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleOfficialLyrics = async (song: SongMetadata) => {
    setBusyId(song.id);
    try {
      await fetchOfficialLyrics(song.id);
      onRefreshLibrary();
    } catch (e: any) {
      alert(`Official lyrics alignment failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (song: SongMetadata) => {
    if (!confirm(`Delete "${song.title}" from library?`)) return;
    await deleteSongFromLibrary(song.id);
    onRefreshLibrary();
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white font-mono uppercase tracking-tight">Track Library</h2>
          <p className="text-[#858585] text-xs font-mono">LOSSLESS FLAC MASTER ARCHIVE // ISOLATED STEMS // ALIGNED SYLLABLES</p>
        </div>
        {!isPartyMode && (
          <button
            onClick={onOpenUpload}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-mono text-xs font-semibold flex items-center gap-2 shadow-sm border border-blue-500/40 transition cursor-pointer"
          >
            <span>+ UPLOAD FLAC</span>
          </button>
        )}
      </div>

      {songs.length === 0 ? (
        <div className="text-center py-16 bg-[#1e1e1e] border border-[#2d2d2d] rounded-xl p-8">
          <Disc size={40} className="text-[#555555] mx-auto mb-3" />
          <p className="text-[#cccccc] font-semibold text-sm mb-1 font-mono">LIBRARY EMPTY</p>
          <p className="text-[#858585] text-xs font-mono">No audio tracks found in library bundle.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {songs.map((song) => (
            <div
              key={song.id}
              className="bg-[#1e1e1e] border border-[#2d2d2d] rounded-xl p-4 flex flex-col justify-between hover:border-[#3c3c3c] transition shadow-md"
            >
              <div className="flex gap-3.5 items-start">
                <div className="w-16 h-16 rounded-lg bg-[#141414] flex-shrink-0 overflow-hidden relative border border-[#2d2d2d]">
                  {song.coverArtUrl ? (
                    <img src={song.coverArtUrl} alt={song.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#555555]">
                      <Music size={22} />
                    </div>
                  )}
                  <span className="absolute bottom-1 right-1 px-1.5 py-0.2 rounded bg-black/90 text-[9px] font-mono font-bold text-blue-300 uppercase border border-white/10">
                    {song.format}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-bold text-white truncate font-mono">{song.title}</h4>
                  <p className="text-xs text-[#858585] truncate font-mono">{song.artist}</p>

                  <div className="flex items-center gap-1.5 mt-2">
                    {song.isSeparated ? (
                      <span className="px-2 py-0.5 rounded bg-[#132219] border border-emerald-700/60 text-[10px] font-mono font-semibold text-emerald-300">
                        STEMS READY
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-[#141414] border border-[#2d2d2d] text-[10px] font-mono text-[#858585]">
                        ORIGINAL
                      </span>
                    )}

                    {song.hasLyrics && (
                      <span className="px-2 py-0.5 rounded bg-[#241e12] border border-amber-700/60 text-[10px] font-mono font-semibold text-amber-300">
                        LYRICS READY
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[#2d2d2d] justify-between">
                <button
                  onClick={() => onSelectSong(song)}
                  className="px-3.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono font-semibold flex items-center gap-1.5 transition cursor-pointer border border-blue-500/40"
                >
                  <Play size={13} /> PLAY
                </button>

                <div className="flex items-center gap-1.5">
                  {!isPartyMode && !song.isSeparated && (
                    <button
                      disabled={busyId === song.id}
                      onClick={() => handleSeparate(song)}
                      className="px-2.5 py-1.5 rounded-md bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] text-xs font-mono border border-[#333333] flex items-center gap-1 transition cursor-pointer disabled:opacity-40"
                      title="Run Mel-Band RoFormer stem separation"
                    >
                      <Sparkles size={12} className="text-blue-400" />
                      <span>STEMS</span>
                    </button>
                  )}

                  {!isPartyMode && !song.hasLyrics && (
                    <button
                      disabled={busyId === song.id}
                      onClick={() => handleTranscribe(song)}
                      className="px-2.5 py-1.5 rounded-md bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] text-xs font-mono border border-[#333333] flex items-center gap-1 transition cursor-pointer disabled:opacity-40"
                      title="Transcribe lyrics with Faster-Whisper + VAD"
                    >
                      <FileText size={12} className="text-amber-400" />
                      <span>LYRICS</span>
                    </button>
                  )}

                  {!isPartyMode && song.hasLyrics && (
                    <button
                      disabled={busyId === song.id}
                      onClick={() => handleOfficialLyrics(song)}
                      className="px-2 py-1.5 rounded-md bg-[#252526] hover:bg-[#2d2d2d] text-[#cccccc] text-xs font-mono border border-[#333333] flex items-center gap-1 transition cursor-pointer disabled:opacity-40"
                      title="Align with official Gemini / LRCLIB lyrics"
                    >
                      <Wand2 size={11} className="text-amber-400" />
                      <span className="hidden sm:inline">OFFICIAL</span>
                    </button>
                  )}

                  {/* Lyrical DAW Editor: ALWAYS accessible (even in Party Mode!) */}
                  {onOpenLyricEditor && song.hasLyrics && (
                    <button
                      onClick={() => onOpenLyricEditor(song)}
                      className="px-2.5 py-1.5 rounded-md bg-[#252526] hover:bg-[#2d2d2d] text-blue-400 hover:text-blue-300 text-xs font-mono border border-[#333333] flex items-center gap-1 transition cursor-pointer"
                      title="Open Lyrical DAW Editor"
                    >
                      <Edit3 size={12} className="text-blue-400" />
                      <span className="font-semibold">EDIT</span>
                    </button>
                  )}

                  {!isPartyMode && (
                    <button
                      onClick={() => handleDelete(song)}
                      className="p-1.5 rounded-md text-[#666666] hover:text-red-400 hover:bg-[#252526] transition cursor-pointer"
                      title="Delete song"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
