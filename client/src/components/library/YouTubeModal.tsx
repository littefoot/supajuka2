import React, { useState } from 'react';
import { Search, Download, X, Loader2 } from 'lucide-react';
import { searchYouTubeVideos, extractYouTubeVideo } from '../../services/api';
import { SongMetadata } from '../../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onExtracted: (song: SongMetadata) => void;
}

export const YouTubeModal: React.FC<Props> = ({ isOpen, onClose, onExtracted }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setIsSearching(true);
    try {
      const data = await searchYouTubeVideos(query);
      setResults(data);
    } catch (e: any) {
      alert(`Search failed: ${e.message}`);
    } finally {
      setIsSearching(false);
    }
  };

  const handleDownload = async (item: any) => {
    setDownloadingId(item.id);
    try {
      const song = await extractYouTubeVideo(item);
      onExtracted(song);
      onClose();
    } catch (e: any) {
      alert(`Download failed: ${e.message}`);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 shadow-2xl relative max-h-[85vh] flex flex-col">
        <button onClick={onClose} className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800">
          <X size={20} />
        </button>

        <h3 className="text-xl font-bold text-white mb-1 font-['Outfit']">Search YouTube (Extract to FLAC)</h3>
        <p className="text-slate-400 text-xs mb-4">Downloads audio stream and converts to lossless FLAC for artifact-free processing.</p>

        <form onSubmit={handleSearch} className="flex gap-2 mb-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search song title or artist..."
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-fuchsia-500"
          />
          <button
            type="submit"
            disabled={isSearching}
            className="px-5 py-2.5 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-semibold flex items-center gap-2 text-sm transition"
          >
            {isSearching ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
            <span>Search</span>
          </button>
        </form>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
          {results.map((item) => (
            <div key={item.id} className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 flex items-center justify-between gap-4">
              <img src={item.thumbnail} alt="" className="w-16 h-12 object-cover rounded-lg border border-slate-800 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate font-['Outfit']">{item.title}</p>
                <p className="text-xs text-slate-400">{item.channel}</p>
              </div>
              <button
                disabled={downloadingId === item.id}
                onClick={() => handleDownload(item)}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition flex-shrink-0"
              >
                {downloadingId === item.id ? <Loader2 className="animate-spin" size={14} /> : <Download size={14} />}
                <span>Extract FLAC</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
