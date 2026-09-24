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
    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-[#252526] border border-[#333333] text-[11px] font-mono shadow-sm">
      <Cpu size={13} className={status.isLocked ? 'text-amber-400 animate-pulse' : 'text-emerald-400'} />
      <span className="text-[#858585]">RTX 4050:</span>
      {status.isLocked ? (
        <span className="text-amber-300 font-semibold truncate max-w-[130px]">
          {status.currentTask || 'BUSY'}
        </span>
      ) : (
        <span className="text-emerald-400 font-semibold">IDLE</span>
      )}
    </div>
  );
};
