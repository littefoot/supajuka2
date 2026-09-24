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
      const val = isPlaying && fftData[i] ? fftData[i] : 0.04;
      const barHeight = Math.max(2, val * height);

      // Professional Console VU Meter Gradient (Antigravity Blue -> Emerald -> Amber Peak)
      const grad = ctx.createLinearGradient(0, height, 0, height - barHeight);
      grad.addColorStop(0, '#007acc');   // Antigravity Blue base
      grad.addColorStop(0.65, '#10b981'); // Emerald green body
      grad.addColorStop(1, '#fbbf24');    // Studio amber/gold peak warning

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(i * (barWidth + 2), height - barHeight, barWidth, barHeight, [1, 1, 0, 0]);
      ctx.fill();
    }
  }, [fftData, isPlaying]);

  return (
    <div className="w-full h-full flex items-center justify-center overflow-hidden">
      <canvas ref={canvasRef} width={640} height={32} className="w-full h-full" />
    </div>
  );
};
