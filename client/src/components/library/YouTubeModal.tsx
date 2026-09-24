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
      <div className="bg-[#1e1e1e] border border-[#2d2d2d] rounded-xl w-full max-w-2xl p-6 shadow-2xl relative max-h-[85vh] flex flex-col">
        <button onClick={onClose} className="absolute top-4 right-4 p-2 text-[#858585] hover:text-white rounded-lg hover:bg-[#252526] transition">
          <X size={18} />
        </button>

        <h3 className="text-lg font-bold text-white mb-1 font-mono uppercase tracking-tight">Extract Audio via YouTube</h3>
        <p className="text-[#858585] text-xs font-mono mb-4">Downloads audio stream and transcodes to 24-bit lossless FLAC.</p>

        <form onSubmit={handleSearch} className="flex gap-2 mb-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search song title or artist..."
            className="flex-1 bg-[#141414] border border-[#2d2d2d] rounded-lg px-4 py-2 text-white text-xs font-mono focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={isSearching}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-mono text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer border border-blue-500/40"
          >
            {isSearching ? <Loader2 className="animate-spin" size={14} /> : <Search size={14} />}
            <span>SEARCH</span>
          </button>
        </form>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
          {results.map((item) => (
            <div key={item.id} className="p-3 bg-[#161616] rounded-lg border border-[#282828] flex items-center justify-between gap-4">
              <img src={item.thumbnail} alt="" className="w-16 h-12 object-cover rounded border border-[#2d2d2d] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-white truncate font-mono">{item.title}</p>
                <p className="text-[11px] text-[#858585] font-mono">{item.channel}</p>
              </div>
              <button
                disabled={downloadingId === item.id}
                onClick={() => handleDownload(item)}
                className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono font-semibold flex items-center gap-1.5 transition flex-shrink-0 cursor-pointer border border-blue-500/40"
              >
                {downloadingId === item.id ? <Loader2 className="animate-spin" size={13} /> : <Download size={13} />}
                <span>EXTRACT FLAC</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
