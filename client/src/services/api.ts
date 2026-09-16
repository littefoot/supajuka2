import { io, Socket } from 'socket.io-client';
import { SongMetadata, LyricResult, GpuStatus, SongStatusUpdate } from '../types';

export const socket: Socket = io(window.location.origin);

export async function uploadAudioFile(file: File): Promise<SongMetadata> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/audio/upload', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || 'Upload failed');
  }

  return res.json();
}

export async function separateStems(songId: string): Promise<{ instrumentalUrl: string; vocalsUrl: string; modelUsed: string }> {
  const res = await fetch('/api/audio/separate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Separation failed' }));
    throw new Error(err.error || 'Separation failed');
  }

  return res.json();
}

export async function transcribeLyrics(songId: string): Promise<LyricResult> {
  const res = await fetch('/api/audio/lyrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Lyrics transcription failed' }));
    throw new Error(err.error || 'Lyrics transcription failed');
  }

  return res.json();
}

export async function getLibrary(): Promise<SongMetadata[]> {
  const res = await fetch('/api/audio/library');
  if (!res.ok) throw new Error('Failed to fetch library');
  return res.json();
}

export async function deleteSongFromLibrary(id: string): Promise<boolean> {
  const res = await fetch(`/api/audio/song/${id}`, { method: 'DELETE' });
  return res.ok;
}

export async function searchYouTubeVideos(q: string) {
  const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error('YouTube search failed');
  return res.json();
}

export async function extractYouTubeVideo(item: any): Promise<SongMetadata> {
  const res = await fetch('/api/youtube/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error('YouTube extract failed');
  return res.json();
}

export async function getGpuStatus(): Promise<GpuStatus> {
  const res = await fetch('/api/audio/status');
  if (!res.ok) throw new Error('Failed to fetch GPU status');
  return res.json();
}

export async function fetchOfficialLyrics(songId: string): Promise<LyricResult> {
  const res = await fetch('/api/audio/lyrics/official', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Official lyrics alignment failed' }));
    throw new Error(err.error || 'Official lyrics alignment failed');
  }

  return res.json();
}
