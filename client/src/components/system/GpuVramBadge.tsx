import React, { useEffect, useState } from 'react';
import { Cpu } from 'lucide-react';
import { socket, getGpuStatus } from '../../services/api';
import { GpuStatus } from '../../types';

export const GpuVramBadge: React.FC = () => {
  const [status, setStatus] = useState<GpuStatus>({
    isLocked: false,
    currentTask: null,
    queueLength: 0,
  });

  useEffect(() => {
    getGpuStatus().then(setStatus).catch(() => {});

    socket.on('gpu:status', (data: GpuStatus) => {
      setStatus(data);
    });

    return () => {
      socket.off('gpu:status');
    };
  }, []);

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-mono shadow-sm">
      <Cpu size={14} className={status.isLocked ? 'text-amber-400 animate-pulse' : 'text-emerald-400'} />
      <span className="text-slate-400">RTX 4050 6GB:</span>
      {status.isLocked ? (
        <span className="text-amber-300 font-semibold truncate max-w-[140px]">
          {status.currentTask || 'Active'}
        </span>
      ) : (
        <span className="text-emerald-400 font-medium">Idle</span>
      )}
    </div>
  );
};
