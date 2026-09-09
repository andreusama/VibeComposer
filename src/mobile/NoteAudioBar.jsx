import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getNoteAudioUrl, deleteNoteAudio, renameNoteAudio, MAX_AUDIOS_PER_NOTE,
} from '../canvas/lineAudioData.js';
import { WaveformCanvas, extractPeaks } from './waveform.jsx';
import AudioRecorder from './AudioRecorder.jsx';
import { IcMic, IcPlay, IcPause, IcChevronUp, IcChevronDown } from './icons.jsx';

function relativeDay(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'ahora mismo';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'ayer' : `hace ${days} días`;
}

function AudioRow({ memo, index, onDelete, onRename }) {
  const [peaks, setPeaks] = useState(null);
  const [url, setUrl] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memo.title || '');
  const audioRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    getNoteAudioUrl(memo.storage_path).then(async ({ data, error }) => {
      if (cancelled || error || !data?.signedUrl) return;
      setUrl(data.signedUrl);
      try {
        const res = await fetch(data.signedUrl);
        const arr = await res.arrayBuffer();
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const decoded = await ctx.decodeAudioData(arr);
        if (!cancelled) setPeaks(extractPeaks(decoded));
        ctx.close();
      } catch { /* waveform is decorative */ }
    });
    return () => { cancelled = true; };
  }, [memo.storage_path]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) el.pause(); else el.play();
  }, [playing]);

  const commitRename = useCallback(() => {
    setEditing(false);
    const next = draft.trim();
    if (next !== (memo.title || '')) onRename(memo.id, next);
  }, [draft, memo.id, memo.title, onRename]);

  const dur = memo.duration_seconds != null
    ? `${Math.floor(memo.duration_seconds / 60)}:${String(Math.round(memo.duration_seconds % 60)).padStart(2, '0')}`
    : '';
  const label = memo.title || `Audio ${index + 1}`;

  return (
    <div className="na-row">
      <button className="na-play" onClick={toggle} disabled={!url} aria-label={playing ? 'pausar' : 'reproducir'}>{playing ? <IcPause size={16} /> : <IcPlay size={16} />}</button>
      <div className="na-main">
        <div className="na-row-top">
          {editing ? (
            <input
              className="na-title-input"
              value={draft}
              autoFocus
              placeholder={`Audio ${index + 1}`}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); }}
            />
          ) : (
            <button className="na-title" onClick={() => { setDraft(memo.title || ''); setEditing(true); }}>{label}</button>
          )}
          <span className="na-dur">{dur}</span>
        </div>
        <div className="na-wave"><WaveformCanvas peaks={peaks} progress={progress} /></div>
        <div className="na-row-bottom">
          <span className="na-date">{relativeDay(memo.created_at)}</span>
          <button className="na-del" onClick={() => onDelete(memo)}>Borrar</button>
        </div>
      </div>
      {url && (
        <audio
          ref={audioRef}
          src={url}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setProgress(0); }}
          onTimeUpdate={(e) => {
            const { currentTime, duration } = e.currentTarget;
            if (duration) setProgress(currentTime / duration);
          }}
        />
      )}
    </div>
  );
}

// Snap-point heights (px), derived from the viewport.
function snapPoints() {
  const vh = window.innerHeight || 700;
  return {
    collapsed: 52,
    half: Math.round(vh * 0.46),
    full: Math.round(vh * 0.88),
  };
}
function nearestSnap(h, pts) {
  const entries = [pts.collapsed, pts.half, pts.full];
  return entries.reduce((a, b) => (Math.abs(b - h) < Math.abs(a - h) ? b : a));
}

// The always-present "🎙 Audios" bottom sheet: a collapsed handle strip you
// drag up (or tap) to expand into the take list + recorder, and drag/tap
// back down to collapse — same interaction as an iOS bottom sheet. Voice
// memos belong to the whole note (see lineAudioData.js); this replaced the
// old undiscoverable long-press-the-gutter gesture and the per-line badges.
export default function NoteAudioBar({ sectionId, songId, memos, onRecorded, onDeleted, onRenamed, onRecordingChange }) {
  const [pts, setPts] = useState(snapPoints);
  const [height, setHeight] = useState(pts.collapsed);
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState(false);
  const dragRef = useRef(null); // { startY, startHeight, moved }
  const atCap = memos.length >= MAX_AUDIOS_PER_NOTE;
  const expanded = height > pts.collapsed + 8;

  useEffect(() => {
    const onResize = () => {
      const next = snapPoints();
      setPts(next);
      setHeight((h) => (h <= 60 ? next.collapsed : Math.min(h, next.full)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const snapTo = useCallback((h) => setHeight(nearestSnap(h, pts)), [pts]);

  const onPointerDown = useCallback((e) => {
    dragRef.current = { startY: e.clientY, startHeight: height, moved: false };
    setDragging(true);
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* non-capturable pointer — fine */ }
  }, [height]);

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = d.startY - e.clientY; // up = grow
    if (Math.abs(dy) > 4) d.moved = true;
    const next = Math.max(pts.collapsed, Math.min(pts.full, d.startHeight + dy));
    setHeight(next);
  }, [pts]);

  const onPointerUp = useCallback((e) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* was never captured — fine */ }
    if (!d) return;
    if (!d.moved) {
      // a tap on the handle toggles collapsed <-> half
      setHeight(height > pts.collapsed + 8 ? pts.collapsed : pts.half);
    } else {
      snapTo(height);
    }
  }, [height, pts, snapTo]);

  const collapse = useCallback(() => setHeight(pts.collapsed), [pts]);

  useEffect(() => { onRecordingChange?.(recording); }, [recording, onRecordingChange]);

  // Recording collapses the sheet entirely — the musician has to SEE the
  // verse while they sing it. All that's left on screen is the floating red
  // stop button (AudioRecorder).
  const startRecording = useCallback(() => {
    setRecording(true);
    setHeight(pts.collapsed);
  }, [pts]);

  const finishRecording = useCallback((memo) => {
    setRecording(false);
    if (memo) { onRecorded(memo); setHeight(pts.half); } // land back in the list to hear it
  }, [onRecorded, pts]);

  const handleDelete = useCallback(async (memo) => {
    await deleteNoteAudio(memo.id, memo.storage_path);
    onDeleted(memo.id);
  }, [onDeleted]);

  const scrimOpacity = Math.max(0, Math.min(0.38, ((height - pts.collapsed) / (pts.full - pts.collapsed)) * 0.42));

  // Recording: sheet is gone, only the floating red stop button remains so
  // the verse stays fully visible.
  if (recording) {
    return (
      <AudioRecorder
        sectionId={sectionId}
        songId={songId}
        onCancel={() => setRecording(false)}
        onSaved={finishRecording}
      />
    );
  }

  return (
    <>
      {expanded && (
        <div className="na-scrim" style={{ opacity: scrimOpacity }} onClick={collapse} />
      )}
      <div
        className={`na-sheet2${dragging ? ' dragging' : ''}`}
        style={{ height }}
      >
        <div
          className="na-grab-zone"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="ts-grabber" />
          <div className="na-head">
            <span className="na-bar-icon"><IcMic size={17} /></span>
            <span className="na-head-title">
              {memos.length === 0 ? 'Graba un audio' : `Audios · ${memos.length}`}
            </span>
            <span className="na-head-chevron">{expanded ? <IcChevronDown size={14} /> : <IcChevronUp size={14} />}</span>
          </div>
        </div>

        <div className="na-scroll">
          <button className="na-record" disabled={atCap} onClick={startRecording}>
            <span className="na-record-dot" /> {atCap ? `Límite de ${MAX_AUDIOS_PER_NOTE} audios` : 'Grabar'}
          </button>
          {atCap && <p className="na-cap-hint">Borra algún audio para grabar más.</p>}

          {memos.length === 0 ? (
            <p className="ts-empty">aún no hay audios — tararea una melodía o una idea</p>
          ) : (
            <div className="na-list">
              {memos.map((m, i) => (
                <AudioRow key={m.id} memo={m} index={i} onDelete={handleDelete} onRename={onRenamed} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
