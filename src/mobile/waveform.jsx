import { useEffect, useRef } from 'react';

// Shared waveform bits for voice memos (NoteAudioBar). No charting library —
// canvas + the Web Audio API, both browser-native. The waveform is
// decorative "here's roughly the shape of this take", not a scrub view.

const WAVEFORM_BARS = 40;

// Downsamples a decoded AudioBuffer to a fixed number of peak bars.
export function extractPeaks(audioBuffer, bars = WAVEFORM_BARS) {
  const data = audioBuffer.getChannelData(0);
  const chunkSize = Math.max(1, Math.floor(data.length / bars));
  const peaks = [];
  for (let i = 0; i < bars; i++) {
    const start = i * chunkSize;
    let max = 0;
    for (let j = start; j < start + chunkSize && j < data.length; j++) {
      const abs = Math.abs(data[j]);
      if (abs > max) max = abs;
    }
    peaks.push(max);
  }
  return peaks;
}

// `progress` (0–1, optional) tints the played portion.
export function WaveformCanvas({ peaks, progress = 0, width = 160, height = 28 }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    const bars = peaks && peaks.length ? peaks : new Array(WAVEFORM_BARS).fill(0.06);
    const barWidth = width / bars.length;
    const playedX = progress * width;
    bars.forEach((p, i) => {
      const barHeight = Math.max(2, p * height);
      const x = i * barWidth;
      ctx.fillStyle = x < playedX ? 'currentColor' : 'rgba(0,0,0,0.22)';
      ctx.fillRect(x, (height - barHeight) / 2, Math.max(1, barWidth - 1.5), barHeight);
    });
  }, [peaks, progress, width, height]);
  return <canvas ref={canvasRef} className="la-waveform-canvas" width={width} height={height} />;
}
