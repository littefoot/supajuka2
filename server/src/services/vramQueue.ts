import { appEvents } from './events.js';

type Task<T> = () => Promise<T>;

interface QueueItem {
  name: string;
  run: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (err: any) => void;
}

/**
 * Sequential Task Queue designed for RTX 4050 6GB VRAM.
 * Enforces strictly 1 active GPU operation at a time, preventing OOM.
 */
class VramQueue {
  private queue: QueueItem[] = [];
  private isProcessing = false;
  private currentTask: string | null = null;

  async run<T>(taskName: string, task: Task<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        name: taskName,
        run: task,
        resolve,
        reject,
      });
      this.broadcast();
      this.processNext();
    });
  }

  private async processNext() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const item = this.queue.shift()!;
    this.currentTask = item.name;
    this.broadcast();

    console.log(`🎮 [VRAM Queue] Starting: ${item.name} (${this.queue.length} in queue)`);

    try {
      const result = await item.run();
      item.resolve(result);
    } catch (err) {
      console.error(`❌ [VRAM Queue] Error in ${item.name}:`, err);
      item.reject(err);
    } finally {
      this.isProcessing = false;
      this.currentTask = null;
      this.broadcast();
      this.processNext();
    }
  }

  private broadcast() {
    appEvents.emitGpuUpdate({
      isLocked: this.isProcessing,
      currentTask: this.currentTask,
      queueLength: this.queue.length,
    });
  }

  getStatus() {
    return {
      isLocked: this.isProcessing,
      currentTask: this.currentTask,
      queueLength: this.queue.length,
    };
  }
}

export const vramQueue = new VramQueue();
