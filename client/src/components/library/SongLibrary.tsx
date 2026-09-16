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
}

export const SongLibrary: React.FC<Props> = ({
  songs,
  onSelectSong,
  onRefreshLibrary,
  onOpenUpload,
  onOpenLyricEditor,
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
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white font-['Outfit']">Karaoke Library</h2>
          <p className="text-slate-400 text-sm">Bit-perfect FLAC audio and vocal stem separations</p>
        </div>
        <button
          onClick={onOpenUpload}
          className="px-4 py-2.5 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-semibold flex items-center gap-2 shadow-lg shadow-fuchsia-600/30 transition cursor-pointer"
        >
          <span>Upload FLAC</span>
        </button>
      </div>

      {songs.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/50 border border-slate-800 rounded-2xl p-8">
          <Disc size={48} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-300 font-semibold mb-1">Your library is empty</p>
          <p className="text-slate-500 text-xs mb-4">Upload a high-fidelity FLAC or search YouTube to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {songs.map((song) => (
            <div
              key={song.id}
              className="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between hover:border-slate-700 transition shadow-xl"
            >
              <div className="flex gap-4 items-start">
                <div className="w-16 h-16 rounded-xl bg-slate-800 flex-shrink-0 overflow-hidden relative border border-slate-700">
                  {song.coverArtUrl ? (
                    <img src={song.coverArtUrl} alt={song.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-500">
                      <Music size={24} />
                    </div>
                  )}
                  <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono font-bold text-cyan-300 uppercase">
                    {song.format}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <h4 className="text-base font-bold text-white truncate font-['Outfit']">{song.title}</h4>
                  <p className="text-xs text-slate-400 truncate">{song.artist}</p>

                  <div className="flex items-center gap-2 mt-2">
                    {song.isSeparated ? (
                      <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-[10px] font-semibold text-emerald-300">
                        Stems Ready
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400">
                        Original
                      </span>
                    )}

                    {song.hasLyrics && (
                      <span className="px-2 py-0.5 rounded bg-fuchsia-950 border border-fuchsia-800 text-[10px] font-semibold text-fuchsia-300">
                        Lyrics Ready
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-800/60 justify-between">
                <button
                  onClick={() => onSelectSong(song)}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Play size={14} /> Play
                </button>

                <div className="flex items-center gap-1">
                  {!song.isSeparated && (
                    <button
                      disabled={busyId === song.id}
                      onClick={() => handleSeparate(song)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1 transition cursor-pointer"
                      title="Run Mel-Band RoFormer stem separation"
                    >
                      <Sparkles size={13} className="text-cyan-400" />
                      <span>Separate</span>
                    </button>
                  )}

                  {!song.hasLyrics ? (
                    <button
                      disabled={busyId === song.id}
                      onClick={() => handleTranscribe(song)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1 transition cursor-pointer"
                      title="Transcribe lyrics with Faster-Whisper + VAD"
                    >
                      <FileText size={13} className="text-fuchsia-400" />
                      <span>Lyrics</span>
                    </button>
                  ) : (
                    <>
                      <button
                        disabled={busyId === song.id}
                        onClick={() => handleOfficialLyrics(song)}
                        className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1 transition cursor-pointer"
                        title="Align with official Gemini / LRCLIB lyrics"
                      >
                        <Wand2 size={12} className="text-amber-400" />
                        <span className="hidden sm:inline">Official</span>
                      </button>

                      {onOpenLyricEditor && (
                        <button
                          onClick={() => onOpenLyricEditor(song)}
                          className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1 transition cursor-pointer"
                          title="Open Lyric & Timing Editor"
                        >
                          <Edit3 size={12} className="text-fuchsia-400" />
                          <span className="hidden sm:inline">Edit</span>
                        </button>
                      )}
                    </>
                  )}

                  <button
                    onClick={() => handleDelete(song)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-slate-800 transition cursor-pointer"
                    title="Delete song"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
