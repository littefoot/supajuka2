import React, { useState, useRef } from 'react';
import { UploadCloud, FileAudio, CheckCircle2, AlertCircle, X, Loader2 } from 'lucide-react';
import { uploadAudioFile } from '../../services/api';
import { SongMetadata } from '../../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSongUploaded: (song: SongMetadata) => void;
}

export const FlacUploadModal: React.FC<Props> = ({ isOpen, onClose, onSongUploaded }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SongMetadata | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFile = async (file: File) => {
    setError(null);
    setSuccess(null);

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['flac', 'wav', 'mp3', 'm4a'].includes(ext || '')) {
      setError('Please upload a lossless FLAC or WAV file (or MP3/M4A).');
      return;
    }

    setIsUploading(true);
    try {
      const song = await uploadAudioFile(file);
      setSuccess(song);
      onSongUploaded(song);
      setTimeout(() => {
        setIsUploading(false);
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to upload audio file');
      setIsUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#1e1e1e] border border-[#2d2d2d] rounded-xl w-full max-w-lg p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-[#858585] hover:text-white rounded-lg hover:bg-[#252526] transition"
        >
          <X size={18} />
        </button>

        <h3 className="text-lg font-bold text-white mb-1 font-mono uppercase tracking-tight">Ingest Master Audio</h3>
        <p className="text-[#858585] text-xs font-mono mb-5">
          Drag & drop 24-bit/16-bit FLAC or WAV files for bit-perfect karaoke stem separation.
        </p>

        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition ${
            isDragging
              ? 'border-blue-500 bg-[#16202c]'
              : 'border-[#333333] hover:border-blue-500/60 bg-[#141414]'
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            accept=".flac,.wav,.mp3,.m4a"
            className="hidden"
          />

          <div className="w-14 h-14 rounded-lg bg-[#252526] border border-[#333333] flex items-center justify-center text-blue-400 mb-3 shadow-inner">
            <UploadCloud size={28} />
          </div>

          <p className="text-sm font-semibold text-white mb-1 font-mono">CLICK OR DRAG MASTER FLAC / WAV</p>
          <span className="text-[11px] text-[#858585] font-mono">Lossless FLAC recommended • WAV • MP3 up to 250MB</span>
        </div>

        {isUploading && (
          <div className="mt-4 p-3 bg-[#16202c] border border-blue-500/50 rounded-lg flex items-center gap-3 text-blue-200 text-xs font-mono animate-pulse">
            <Loader2 className="animate-spin text-blue-400" size={16} />
            <span>EXTRACTING AUDIO STREAMS & VERIFYING LOSSLESS HEADER...</span>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-950/60 border border-red-800 rounded-lg flex items-center gap-3 text-red-200 text-xs font-mono">
            <AlertCircle className="text-red-400" size={16} />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mt-4 p-3 bg-emerald-950/60 border border-emerald-800 rounded-lg flex items-center gap-3 text-emerald-200 text-xs font-mono">
            <CheckCircle2 className="text-emerald-400" size={16} />
            <span>INGEST COMPLETE: {success.title} ({success.format.toUpperCase()})</span>
          </div>
        )}
      </div>
    </div>
  );
};
