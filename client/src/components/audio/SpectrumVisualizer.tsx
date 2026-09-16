import React, { useEffect, useRef } from 'react';

interface Props {
  fftData: number[];
  isPlaying: boolean;
}

export const SpectrumVisualizer: React.FC<Props> = ({ fftData, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    const numBars = 48;
    const barWidth = width / numBars - 2;

    for (let i = 0; i < numBars; i++) {
      const val = isPlaying && fftData[i] ? fftData[i] : 0.05;
      const barHeight = Math.max(3, val * height);

      // Neon Gradient
      const grad = ctx.createLinearGradient(0, height, 0, height - barHeight);
      grad.addColorStop(0, '#06b6d4'); // Cyan base
      grad.addColorStop(0.6, '#a855f7'); // Purple mid
      grad.addColorStop(1, '#ec4899'); // Pink peak

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(i * (barWidth + 2), height - barHeight, barWidth, barHeight, [2, 2, 0, 0]);
      ctx.fill();
    }
  }, [fftData, isPlaying]);

  return (
    <div className="w-full h-16 bg-slate-950/60 rounded-xl border border-slate-800/80 p-2 flex items-center justify-center overflow-hidden shadow-inner">
      <canvas ref={canvasRef} width={640} height={60} className="w-full h-full" />
    </div>
  );
};
