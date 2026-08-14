import { useState, useEffect, useCallback, useRef } from 'react';
import { saveLyricDna } from './canvasData.js';

// Prefix that marks a song as a disposable test song, not real work — a
// plain title convention rather than a new songs.is_mock column, so there's
// no migration to run and it's visible immediately in the projects list.
export const MOCK_SONG_PREFIX = '🧪 ';

export function isMockSong(song) {
  return Boolean(song?.title?.startsWith(MOCK_SONG_PREFIX));
}

// Dev-only, mock-song-only panel on the canvas — direct read/write access
// to lyric_dna. Everything ELSE about a song (notes, structure, tempo,
// language/dialect) is already directly editable through the normal
// canvas UI; lyric_dna is the actual gap, since in production it only
// ever gets set indirectly (via the Baúl's AI extraction) — there was no
// way to just paste in an exact test value without burning a real API
// call. "Vibe" (literal vs. metaphorical/abstract, atmosphere) is
// intentionally left entirely to lyric_dna + the muse's own live reading
// of the real song text — there's no separate song-level field for it to
// edit here. The LOCAL per-block profile isn't editable here either — it's
// scoped to one note, and this panel has no "which note" picker; it lives
// inside MuseFloatNode itself instead (open a muse float, use its thread).
export default function MockPlayground({ songId, lyricDna, onLyricDnaUpdated, noteCount }) {
  const [open, setOpen] = useState(false);
  const [dnaText, setDnaText] = useState('');
  const [dnaError, setDnaError] = useState(null);
  const [savedFlash, setSavedFlash] = useState(null);

  // Free-floating, not anchored to a corner — null until the first drag,
  // at which point it switches from the default bottom-right CSS position
  // to explicit left/top pixel coordinates that follow the cursor.
  const [pos, setPos] = useState(null);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef(null);
  const dragState = useRef(null);

  const handleDragMove = useCallback((e) => {
    const d = dragState.current;
    if (!d) return;
    setPos({ x: d.origX + (e.clientX - d.startX), y: d.origY + (e.clientY - d.startY) });
  }, []);

  const handleDragEnd = useCallback(() => {
    dragState.current = null;
    setDragging(false);
    window.removeEventListener('mousemove', handleDragMove);
    window.removeEventListener('mouseup', handleDragEnd);
  }, [handleDragMove]);

  const handleDragStart = useCallback((e) => {
    if (e.target.closest('.mockpg-close')) return; // let the close button work normally
    const rect = panelRef.current.getBoundingClientRect();
    dragState.current = {
      startX: e.clientX, startY: e.clientY,
      origX: pos?.x ?? rect.left, origY: pos?.y ?? rect.top,
    };
    setDragging(true);
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
  }, [pos, handleDragMove, handleDragEnd]);

  // Belt-and-suspenders cleanup if the panel unmounts mid-drag (e.g. the
  // song switches out from under it) — listeners on window would otherwise
  // outlive the component.
  useEffect(() => () => {
    window.removeEventListener('mousemove', handleDragMove);
    window.removeEventListener('mouseup', handleDragEnd);
  }, [handleDragMove, handleDragEnd]);

  useEffect(() => { setDnaText(JSON.stringify(lyricDna || {}, null, 2)); }, [lyricDna]);

  const flash = useCallback((which) => {
    setSavedFlash(which);
    setTimeout(() => setSavedFlash(null), 1200);
  }, []);

  const handleSaveDna = useCallback(async () => {
    let parsed;
    try { parsed = JSON.parse(dnaText); } catch (e) { setDnaError(e.message); return; }
    setDnaError(null);
    const { error } = await saveLyricDna(songId, parsed);
    if (error) { setDnaError(error.message); return; }
    onLyricDnaUpdated?.(parsed);
    flash('dna');
  }, [songId, dnaText, onLyricDnaUpdated, flash]);

  if (!open) {
    return <button className="mockpg-toggle" onClick={() => setOpen(true)} title="mock song playground">🧪 playground</button>;
  }

  return (
    <div
      className={`mockpg-panel${dragging ? ' dragging' : ''}`}
      ref={panelRef}
      style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
    >
      <div className="mockpg-head" onMouseDown={handleDragStart} title="drag to move">
        <span className="mockpg-title">🧪 mock playground</span>
        <button className="mockpg-close" onClick={() => setOpen(false)} title="collapse">✕</button>
      </div>
      <div className="mockpg-summary">{noteCount} note{noteCount === 1 ? '' : 's'} on this song · tempo/language/structure already editable via the normal canvas UI</div>

      <div className="mockpg-field">
        <div className="mockpg-field-label">lyric_dna {savedFlash === 'dna' && <span className="mockpg-saved">✓ saved</span>}</div>
        <textarea className="mockpg-textarea" rows={7} value={dnaText} onChange={(e) => setDnaText(e.target.value)} spellCheck={false} />
        {dnaError && <div className="mockpg-error">⚠ {dnaError}</div>}
        <button className="mockpg-save" onClick={handleSaveDna}>save lyric_dna</button>
      </div>
    </div>
  );
}
