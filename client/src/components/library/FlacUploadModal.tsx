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
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
        >
          <X size={20} />
        </button>

        <h3 className="text-xl font-bold text-white mb-1 font-['Outfit']">Upload Lossless Audio</h3>
        <p className="text-slate-400 text-sm mb-6">
          Drag and drop your 24-bit/16-bit FLAC or WAV files for pristine, artifact-free karaoke time-stretching.
        </p>

        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition ${
            isDragging
              ? 'border-fuchsia-500 bg-fuchsia-950/20'
              : 'border-slate-700 hover:border-slate-500 bg-slate-950/40'
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            accept=".flac,.wav,.mp3,.m4a"
            className="hidden"
          />

          <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center text-fuchsia-400 mb-4">
            <UploadCloud size={32} />
          </div>

          <p className="text-base font-semibold text-white mb-1">Click or drag lossless FLAC/WAV here</p>
          <span className="text-xs text-slate-400">Supports FLAC (recommended), WAV, MP3 up to 250MB</span>
        </div>

        {isUploading && (
          <div className="mt-4 p-3 bg-indigo-950/50 border border-indigo-800/60 rounded-xl flex items-center gap-3 text-indigo-200 text-sm animate-pulse">
            <Loader2 className="animate-spin text-indigo-400" size={18} />
            <span>Extracting metadata & saving lossless stream...</span>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-950/50 border border-red-800/60 rounded-xl flex items-center gap-3 text-red-200 text-sm">
            <AlertCircle className="text-red-400" size={18} />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mt-4 p-3 bg-emerald-950/50 border border-emerald-800/60 rounded-xl flex items-center gap-3 text-emerald-200 text-sm">
            <CheckCircle2 className="text-emerald-400" size={18} />
            <span>Uploaded: {success.title} ({success.format.toUpperCase()})</span>
          </div>
        )}
      </div>
    </div>
  );
};
