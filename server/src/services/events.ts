import { Server as SocketIOServer } from 'socket.io';

class AppEvents {
  private io: SocketIOServer | null = null;

  setIO(io: SocketIOServer) {
    this.io = io;
  }

  emitStatusUpdate(songId: string, stage: string, progress: number, message?: string) {
    if (!this.io) return;
    this.io.emit('song:status', {
      songId,
      stage,
      progress,
      message,
      timestamp: Date.now(),
    });
  }

  emitGpuUpdate(status: { isLocked: boolean; currentTask: string | null; queueLength: number }) {
    if (!this.io) return;
    this.io.emit('gpu:status', status);
  }
}

export const appEvents = new AppEvents();
