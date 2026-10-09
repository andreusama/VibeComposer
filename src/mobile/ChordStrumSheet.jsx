import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StrumArrows from './StrumArrows.jsx';
import { IcChord, IcStrumDown, IcStrumUp, IcTrash, IcPlus } from './icons.jsx';
import {
  classifyStroke, deriveBpm, arrowSizeFor,
  BPM_MIN, BPM_MAX, ARROW_MIN, ARROW_MAX,
} from '../utils/strum.js';

// ─── Acordes & Rasgueo ─────────────────────────────────────────────────────
// Reached from the new chord button in KeyboardAccessoryBar (immediately
// right of the mic). Two things live in here because they are the same
// decision made with two hands: WHICH chord (left hand) and HOW it's struck
// (right hand). Two segmented tabs rather than two separate sheets — a
// second entry point in an already-full accessory bar would buy nothing, and
// you routinely want both in one sitting.
//
// The drag-and-drop gesture is NOT a new one: the constants and the
// technique below are ResourcePickerSheet's, deliberately unchanged
// (LONG_PRESS_MS/LONG_PRESS_SLOP, the non-passive native touchmove listener,
// the shrink-the-sheet/fade-the-scrim behaviour, cross-tree hit-testing via
// elementFromPoint), and it reuses that sheet's own CSS classes
// (.res-picker-scrim-dragging / -sheet-shrunk / -drag-hint / -drag-pill)
// rather than cloning them under chord-specific names. What IS new is where
// the drop lands: a resource drops onto a whole LINE, a chord has to land on
// a specific WORD, so the drop resolves a character offset first (see
// NoteEditorScreen's handleDropChord → offsetFromPoint → wordRangeAt).
//
// The swipe-left-to-reveal half of ResourcePickerSheet's vocabulary is
// deliberately NOT reused: it exists there because a resource row is a
// full-width list item with somewhere to slide to. A chord chip in a wrapped
// grid has neither, so a chip has exactly two gestures — tap to attach at
// the caret/selection, long-press to drag onto a word.
const LONG_PRESS_MS = 380;
const LONG_PRESS_SLOP = 8;

// Common open chords first, because that is what someone reaching for this
// on a phone with a guitar in their lap is almost always after; sevenths
// after, because they are the next thing you actually want and are tedious
// to type. Anything beyond this is the free-text field at the top — the
// palette is a shortcut, never the vocabulary limit (chord_name is free text
// in the DB for exactly this reason).
const PALETTE = [
  { label: 'Mayores', chords: ['C', 'D', 'E', 'F', 'G', 'A', 'B'] },
  { label: 'Menores', chords: ['Am', 'Bm', 'Cm', 'Dm', 'Em', 'F#m', 'Gm'] },
  { label: 'Séptimas y color', chords: ['A7', 'B7', 'C7', 'D7', 'E7', 'G7', 'Am7', 'Dm7', 'Em7', 'Cmaj7', 'Fmaj7', 'Dsus4'] },
];

// One draggable chord chip. Tap → attach where the caret/selection was;
// long-press → lift it and drag it onto a word.
//
// The chip's job ends at "a long-press happened, here's the chord and
// where it started" — it does NOT track the rest of the drag. It used to
// (a native touchmove listener on the chip itself, finishing the drag from
// the chip's own onTouchEnd), which worked in every test here because
// testing never kept one real finger down across the state change that
// follows onDragStart: the moment a drag begins, the PARENT sheet swaps
// its whole rendered content (shrinks to a strip, the chip grid —
// including this chip — unmounts). A touch sequence whose origin element
// just left the DOM stops being delivered to it; on a real device this
// read as "drag picks up, then the sheet just freezes" (reported
// 2026-10-08, same bug, same fix, as ResourcePickerSheet.jsx's identical
// history — see its own comment). ChordStrumSheet now owns the live drag
// via document-level listeners from the moment onDragStart fires.
function ChordChip({ name, onPick, onDragStart }) {
  const [pressed, setPressed] = useState(false);
  const startRef = useRef({ x: 0, y: 0, moved: false });
  const pressTimerRef = useRef(null);

  const clearPressTimer = () => { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; };
  useEffect(() => () => clearPressTimer(), []);

  const onTouchStart = useCallback((e) => {
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY, moved: false };
    setPressed(true);
    clearPressTimer();
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      startRef.current.moved = true; // whatever follows is never a tap
      setPressed(false);
      navigator.vibrate?.(12);
      onDragStart(name, startRef.current.x, startRef.current.y);
    }, LONG_PRESS_MS);
  }, [name, onDragStart]);

  const onTouchMove = useCallback((e) => {
    const t = e.touches[0];
    if (Math.hypot(t.clientX - startRef.current.x, t.clientY - startRef.current.y) > LONG_PRESS_SLOP) {
      clearPressTimer();
      setPressed(false);
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    clearPressTimer();
    setPressed(false);
  }, []);

  const onTouchCancel = useCallback(() => {
    clearPressTimer();
    setPressed(false);
  }, []);

  return (
    <button
      className={`cs-chip${pressed ? ' pressed' : ''}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      onClick={() => { if (!startRef.current.moved) onPick(name); }}
    >{name}</button>
  );
}

// ─── the strum pad ────────────────────────────────────────────────────────
// A tall touch surface the artist actually strums on: one vertical swipe =
// one stroke. Direction is the sign of the displacement, intensity comes
// from the swipe's velocity (see utils/strum.js), and the time each stroke
// landed is what the tempo is read off afterwards. No metronome to follow,
// no tempo to dial in first — the gesture is the input, including its
// timing.
function StrumPad({ recording, onStroke, children }) {
  const padRef = useRef(null);
  // { y, t } of the live touch, plus a running preview so the pad reacts
  // under the finger instead of only at the end of the gesture.
  const touchRef = useRef(null);
  const [preview, setPreview] = useState(null); // { direction, intensity }

  useEffect(() => {
    const el = padRef.current;
    if (!el) return undefined;
    // Non-passive: a vertical swipe on a pad inside a scrollable sheet is
    // otherwise eaten as a scroll, and a strum that scrolls the sheet is
    // not a strum. touch-action:none in CSS handles the same thing for
    // browsers that honour it; this covers the ones that don't.
    const move = (e) => {
      const start = touchRef.current;
      if (!start) return;
      e.preventDefault();
      const t = e.touches[0];
      const dy = t.clientY - start.y;
      const stroke = classifyStroke(dy, Date.now() - start.t);
      setPreview(stroke);
    };
    el.addEventListener('touchmove', move, { passive: false });
    return () => el.removeEventListener('touchmove', move);
  }, []);

  const handleStart = useCallback((e) => {
    const t = e.touches[0];
    touchRef.current = { y: t.clientY, t: Date.now() };
    setPreview(null);
  }, []);

  const handleEnd = useCallback((e) => {
    const start = touchRef.current;
    touchRef.current = null;
    setPreview(null);
    if (!start) return;
    const t = e.changedTouches[0];
    const stroke = classifyStroke(t.clientY - start.y, Date.now() - start.t);
    if (stroke) {
      navigator.vibrate?.(Math.round(6 + stroke.intensity * 18));
      onStroke(stroke, Date.now());
    }
  }, [onStroke]);

  const PreviewArrow = preview?.direction === 'up' ? IcStrumUp : IcStrumDown;

  return (
    <div
      ref={padRef}
      className={`cs-pad${recording ? ' cs-pad-live' : ''}`}
      onTouchStart={handleStart}
      onTouchEnd={handleEnd}
      onTouchCancel={() => { touchRef.current = null; setPreview(null); }}
    >
      {preview
        ? <span className="cs-pad-preview"><PreviewArrow size={arrowSizeFor(preview.intensity, 28, 72)} /></span>
        : children}
    </div>
  );
}

export default function ChordStrumSheet({
  initialTab = 'chords', savedPattern, savedBpm,
  onPickChord, onSavePattern, onDeletePattern,
  onDragHoverLine, onDropChord, onDragActiveChange, onClose,
}) {
  const [tab, setTab] = useState(initialTab);
  const [custom, setCustom] = useState('');
  // { name, x, y } while a long-press has lifted a chord to drag it onto a
  // word; null the rest of the time. x/y are viewport coordinates, used both
  // to position the floating pill and (by the parent, via elementFromPoint +
  // offsetFromPoint) to resolve which WORD of which line is underneath — the
  // drop target lives in a different component tree, so a DOM query is what
  // bridges them.
  const [drag, setDrag] = useState(null);

  // ─── recorder state ───────────────────────────────────────────────────
  const [recording, setRecording] = useState(false);
  const [strokes, setStrokes] = useState(() => savedPattern || []);
  // Wall-clock ms of each recorded stroke — never persisted, only used to
  // derive the tempo at the end of a take.
  const timesRef = useRef([]);
  const [bpm, setBpm] = useState(() => savedBpm || 90);
  // true once a take has been stopped, so the UI can say "this tempo came
  // from your hand" instead of silently showing the old/default one.
  const [bpmDerived, setBpmDerived] = useState(false);
  const [dirty, setDirty] = useState(false);

  const handleStroke = useCallback((stroke, at) => {
    if (!recording) return;
    timesRef.current = [...timesRef.current, at];
    setStrokes((cur) => [...cur, stroke]);
    setDirty(true);
  }, [recording]);

  const startRecording = useCallback(() => {
    timesRef.current = [];
    setStrokes([]);
    setBpmDerived(false);
    setRecording(true);
    setDirty(true);
  }, []);

  const stopRecording = useCallback(() => {
    setRecording(false);
    const derived = deriveBpm(timesRef.current);
    if (derived != null) { setBpm(derived); setBpmDerived(true); }
  }, []);

  const handleSave = useCallback(() => {
    setRecording(false);
    onSavePattern?.(bpm, strokes);
    setDirty(false);
  }, [bpm, strokes, onSavePattern]);

  const handleDeleteSaved = useCallback(() => {
    setRecording(false);
    setStrokes([]);
    timesRef.current = [];
    setBpmDerived(false);
    setDirty(false);
    onDeletePattern?.();
  }, [onDeletePattern]);

  // ─── chord drag ───────────────────────────────────────────────────────
  // dragRef mirrors `drag`, read synchronously inside the document-level
  // listener below — attached once (empty deps), so it must never act on a
  // stale closure over `drag` from whatever render set it up.
  const dragRef = useRef(null);

  const handleDragStart = useCallback((name, x, y) => {
    const next = { name, x, y };
    dragRef.current = next;
    setDrag(next);
    // Lets NoteEditorScreen disable pointer-events on its <textarea>s for
    // the drag's whole duration, not just while a specific line is
    // hovered (see its own comment on ne-sheet-drag-active) — a mobile
    // browser's native text-selection handling can otherwise claim an
    // in-progress touch the instant it crosses a textarea, which no
    // preventDefault() from this component's own listeners can undo once
    // it happens. Reported 2026-10-09 as "drag freezes mid-gesture".
    onDragActiveChange?.(true);
  }, [onDragActiveChange]);

  const endDrag = useCallback((x, y) => {
    const name = dragRef.current?.name;
    if (x != null && y != null && name) onDropChord?.(x, y, name);
    onDragHoverLine?.(null);
    onDragActiveChange?.(false);
    dragRef.current = null;
    setDrag(null);
  }, [onDragHoverLine, onDropChord, onDragActiveChange]);

  // Owns the live drag from the sheet's own root, which is the one thing
  // in this tree guaranteed to stay mounted for the drag's whole duration
  // (unlike the chip that started it — see ChordChip's own comment).
  useEffect(() => {
    const handleMove = (e) => {
      if (!dragRef.current) return;
      e.preventDefault();
      const t = e.touches[0];
      if (!t) return;
      const next = { ...dragRef.current, x: t.clientX, y: t.clientY };
      dragRef.current = next;
      setDrag(next);
      const lineEl = document.elementFromPoint(t.clientX, t.clientY)?.closest('[data-line-index]');
      onDragHoverLine?.(lineEl ? Number(lineEl.dataset.lineIndex) : null);
    };
    const handleEnd = (e) => {
      if (!dragRef.current) return;
      const t = e.changedTouches[0];
      endDrag(t?.clientX ?? null, t?.clientY ?? null);
    };
    const handleCancel = () => {
      if (dragRef.current) endDrag(null, null);
    };
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
    document.addEventListener('touchcancel', handleCancel);
    return () => {
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
      document.removeEventListener('touchcancel', handleCancel);
    };
  }, [endDrag, onDragHoverLine]);

  const handleAddCustom = useCallback(() => {
    const name = custom.trim();
    if (!name) return;
    setCustom('');
    onPickChord?.(name);
  }, [custom, onPickChord]);

  const padHint = useMemo(() => {
    if (recording) return strokes.length ? 'rasguea…' : 'rasguea arriba y abajo con el dedo';
    if (strokes.length) return 'pulsa Rehacer para grabar otra vez';
    return 'pulsa Grabar y rasguea aquí';
  }, [recording, strokes.length]);

  return (
    <div className={`baul-sheet-scrim${drag ? ' res-picker-scrim-dragging' : ''}`} onClick={drag ? undefined : onClose}>
      <div className={`baul-sheet cs-sheet${drag ? ' res-picker-sheet-shrunk' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />

        {drag ? (
          <p className="res-picker-drag-hint">Suelta sobre la palabra donde cambia el acorde</p>
        ) : (
          <>
            <div className="cs-head">
              <div className="attach-title">Acordes y rasgueo</div>
              <div className="cs-tabs">
                <button className={`cs-tab${tab === 'chords' ? ' cs-tab-active' : ''}`} onClick={() => setTab('chords')}>
                  <IcChord size={16} /> Acorde
                </button>
                <button className={`cs-tab${tab === 'strum' ? ' cs-tab-active' : ''}`} onClick={() => setTab('strum')}>
                  <IcStrumDown size={16} /> Rasgueo
                </button>
              </div>
            </div>

            {tab === 'chords' ? (
              <div className="cs-body">
                <p className="cs-hint">
                  Toca un acorde para ponerlo donde tienes el cursor, o mantén pulsado y arrástralo
                  hasta la palabra exacta donde cambia.
                </p>

                <div className="cs-custom">
                  <input
                    className="cs-custom-input"
                    value={custom}
                    placeholder="otro acorde… (G/B, F#m7b5, Badd9)"
                    onChange={(e) => setCustom(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCustom(); } }}
                  />
                  <button className="cs-custom-add" onClick={handleAddCustom} disabled={!custom.trim()}>
                    <IcPlus size={16} /> Añadir
                  </button>
                </div>

                {PALETTE.map((group) => (
                  <div className="cs-group" key={group.label}>
                    <div className="cs-group-label">{group.label}</div>
                    <div className="cs-chip-grid">
                      {group.chords.map((name) => (
                        <ChordChip
                          key={name}
                          name={name}
                          onPick={onPickChord}
                          onDragStart={handleDragStart}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="cs-body">
                <p className="cs-hint">
                  Rasguea con el dedo sobre el panel: cada movimiento arriba o abajo es un golpe, y
                  cuanto más rápido lo hagas, más fuerte queda grabado. El tempo sale de tu propio ritmo.
                </p>

                <StrumPad recording={recording} onStroke={handleStroke}>
                  <span className="cs-pad-hint">{padHint}</span>
                </StrumPad>

                <div className="cs-pattern">
                  {/* No activeIndex on StrumArrows below — kept in its neutral,
                      non-highlighted state for now. The pattern-stepping
                      "visual metronome" playback was cut (not just hidden)
                      until tracking "which stroke we're in" is actually
                      wanted again; see git history for the removed
                      togglePlayback/playIndex machinery if it comes back. */}
                  {strokes.length ? (
                    <StrumArrows pattern={strokes} min={ARROW_MIN} max={ARROW_MAX} />
                  ) : (
                    <span className="cs-pattern-empty">aún no hay golpes grabados</span>
                  )}
                </div>

                <div className="cs-tempo">
                  <label className="cs-tempo-label" htmlFor="cs-bpm">Tempo</label>
                  {/* Auto-derived from the real gaps between the strokes just
                      performed, then freely editable — same "the system
                      suggests, the human can always correct it" rule as the
                      muse's suggestions and word variants. */}
                  <input
                    id="cs-bpm"
                    className="cs-tempo-input"
                    type="number"
                    inputMode="numeric"
                    min={BPM_MIN}
                    max={BPM_MAX}
                    value={bpm}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setBpm(Number.isFinite(n) ? n : bpm);
                      setBpmDerived(false);
                      setDirty(true);
                    }}
                    onBlur={() => setBpm((b) => Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(Number(b) || 90))))}
                  />
                  <span className="cs-tempo-unit">BPM</span>
                  {bpmDerived && <span className="cs-tempo-auto">de tu rasgueo</span>}
                </div>

                <div className="cs-controls">
                  {recording ? (
                    <button className="cs-btn cs-btn-stop" onClick={stopRecording}>Parar</button>
                  ) : (
                    <button className="cs-btn cs-btn-rec" onClick={startRecording}>
                      {strokes.length ? 'Rehacer' : 'Grabar'}
                    </button>
                  )}
                  <button className="cs-btn cs-btn-primary" onClick={handleSave} disabled={!strokes.length || !dirty}>
                    Guardar
                  </button>
                  {savedPattern?.length > 0 && (
                    <button className="cs-btn cs-btn-danger" onClick={handleDeleteSaved} title="borrar el rasgueo de esta parte">
                      <IcTrash size={16} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {drag && (
        <div className="res-picker-drag-pill cs-drag-pill" style={{ left: drag.x, top: drag.y }}>
          {drag.name}
        </div>
      )}
    </div>
  );
}
