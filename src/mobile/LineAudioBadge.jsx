import { useState, useCallback, useRef, useEffect } from 'react';
import { getLineAudioUrl } from '../canvas/lineAudioData.js';

const WAVEFORM_BARS = 32;

// Downsamples an AudioBuffer to a fixed number of peak bars — good enough
// for a glanceable "here's roughly the shape of this take," not a
// production waveform view. No charting library: canvas + Web Audio API,
// both browser-native.
function extractPeaks(audioBuffer, bars = WAVEFORM_BARS) {
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

function WaveformCanvas({ peaks }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    const barWidth = width / peaks.length;
    ctx.fillStyle = 'currentColor';
    peaks.forEach((p, i) => {
      const barHeight = Math.max(2, p * height);
      ctx.fillRect(i * barWidth, (height - barHeight) / 2, Math.max(1, barWidth - 1), barHeight);
    });
  }, [peaks]);
  return <canvas ref={canvasRef} className="la-waveform-canvas" width={128} height={28} />;
}

function MemoRow({ memo }) {
  const [peaks, setPeaks] = useState(null);
  const [signedUrl, setSignedUrl] = useState(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);

  // Lazy — only decode/fetch once this row actually mounts (the popover is
  // open), not for every memo on the line just because the badge rendered.
  useEffect(() => {
    let cancelled = false;
    getLineAudioUrl(memo.storage_path).then(async ({ data, error }) => {
      if (cancelled || error || !data?.signedUrl) return;
      setSignedUrl(data.signedUrl);
      try {
        const res = await fetch(data.signedUrl);
        const arrayBuffer = await res.arrayBuffer();
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        if (!cancelled) setPeaks(extractPeaks(audioBuffer));
        ctx.close();
      } catch { /* waveform is decorative — a missing one just shows flat bars */ }
    });
    return () => { cancelled = true; };
  }, [memo.storage_path]);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); } else { el.play(); }
  }, [playing]);

  const duration = memo.duration_seconds != null
    ? `${Math.floor(memo.duration_seconds / 60)}:${String(Math.round(memo.duration_seconds % 60)).padStart(2, '0')}`
    : '';

  return (
    <div className="la-row">
      <button className="la-play-btn" onClick={togglePlay} disabled={!signedUrl}>{playing ? '⏸' : '▶'}</button>
      <WaveformCanvas peaks={peaks} />
      <span className="la-duration">{duration}</span>
      {signedUrl && (
        <audio
          ref={audioRef}
          src={signedUrl}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      )}
    </div>
  );
}

// Gutter icon shown on a line with one or more attached voice memos
// (hummed melodies, rhythmic phrasing, vocal hooks — recorded via the
// long-press gesture, see AudioRecorderSheet). Tapping opens a small
// anchored player, same non-modal "scrim + panel" presentation as
// MusePopover, not a full-screen modal for something this lightweight.
export default function LineAudioBadge({ memos }) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);

  const handleOpen = useCallback((e) => {
    e.stopPropagation();
    setAnchorRect(e.currentTarget.getBoundingClientRect());
    setOpen(true);
  }, []);

  // Anchored from the RIGHT (right: distance from viewport's right edge to
  // the badge's own right edge), not the left — the badge lives in the
  // right-side .ne-audio-slot (see NoteEditorScreen.jsx), so anchoring the
  // panel's LEFT edge to the badge's position pushed a 220px-wide panel
  // straight off the right edge of the screen, mostly hidden. Opening
  // leftward from the badge keeps it on-screen regardless of how close to
  // the edge the badge itself sits.
  const style = anchorRect ? { top: anchorRect.bottom + 6, right: Math.max(8, window.innerWidth - anchorRect.right) } : {};

  return (
    <>
      <button className="ne-audio-badge" title={`${memos.length} voice memo${memos.length === 1 ? '' : 's'}`} onClick={handleOpen}>
        <span className="ne-audio-badge-dot">{memos.length > 1 ? memos.length : ''}</span>
      </button>
      {open && (
        <>
          <div className="mp-scrim" onClick={() => setOpen(false)} />
          <div className="la-player" style={style} onClick={(e) => e.stopPropagation()}>
            {memos.map((m) => <MemoRow memo={m} key={m.id} />)}
          </div>
        </>
      )}
    </>
  );
}
