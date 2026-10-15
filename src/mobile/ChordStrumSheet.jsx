import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StrumPattern from './StrumPattern.jsx';
import LineDragPill from './LineDragPill.jsx';
import useLongPressDrag from './useLongPressDrag.js';
import useLineDragDrop from './useLineDragDrop.js';
import { IcChord, IcStrumDown, IcStrumUp, IcTrash, IcPlus, IcRegenerate } from './icons.jsx';
import {
  createStrokeSegmenter, deriveBpm, arrowSizeFor,
  BPM_MIN, BPM_MAX,
} from '../utils/strum.js';

// ─── Acordes & Rasgueo ─────────────────────────────────────────────────────
// Reached from the new chord button in KeyboardAccessoryBar (immediately
// right of the mic). Two things live in here because they are the same
// decision made with two hands: WHICH chord (left hand) and HOW it's struck
// (right hand). Two segmented tabs rather than two separate sheets — a
// second entry point in an already-full accessory bar would buy nothing, and
// you routinely want both in one sitting.
//
// The drag-and-drop gesture is NOT a new one: useLongPressDrag.js (the
// hold-then-lift timing) and useLineDragDrop.js (the live drag + drop) are
// shared with ResourcePickerSheet's identical gesture, not cloned under
// chord-specific names — along with that sheet's own CSS classes
// (.res-picker-scrim-dragging / -sheet-shrunk / -drag-hint / -drag-pill).
// What IS different is where the drop lands: a resource drops onto a whole
// LINE, a chord has to land on a specific WORD, so the drop resolves a
// character offset first (see NoteEditorScreen's handleDropChord →
// offsetFromPoint → wordRangeAt) — that part is genuinely chord-specific
// and stays here/in NoteEditorScreen, not in the shared hooks.
//
// The swipe-left-to-reveal half of ResourcePickerSheet's vocabulary is
// deliberately NOT reused: it exists there because a resource row is a
// full-width list item with somewhere to slide to. A chord chip in a wrapped
// grid has neither, so a chip has exactly two gestures — tap to attach at
// the caret/selection, long-press to drag onto a word.

// Common open chords first, because that is what someone reaching for this
// on a phone with a guitar in their lap is almost always after; sevenths
// after, because they are the next thing you actually want and are tedious
// to type. Anything beyond this is the free-text tile at the end of
// Séptimas (CustomChordTile below) — the palette is a shortcut, never the
// vocabulary limit (chord_name is free text in the DB for exactly this
// reason).
//
// Menores in root-note order (Cm Dm Em F#m Gm Am Bm), not alphabetical —
// 2026-10-09 redesign: each minor has to land in the SAME column as its
// major (Mayores is C D E F G A B), so the grid reads as "here's the minor
// of the chord above it" at a glance, which alphabetical order didn't give.
//
// Séptimas is 11 chords, not 12 — Dsus4 dropped to make the group's own
// 6-column grid land on exactly 2 full rows with the CustomChordTile "+" as
// the 12th cell and zero orphans (acordes_picker_redesign.html's own count);
// still reachable like any other chord via that same "+" tile.
const PALETTE = [
  { label: 'Mayores', variant: 'major', chords: ['C', 'D', 'E', 'F', 'G', 'A', 'B'] },
  { label: 'Menores', variant: 'minor', chords: ['Cm', 'Dm', 'Em', 'F#m', 'Gm', 'Am', 'Bm'] },
  { label: 'Séptimas y color', variant: 'seventh', chords: ['A7', 'B7', 'C7', 'D7', 'E7', 'G7', 'Am7', 'Dm7', 'Em7', 'Cmaj7', 'Fmaj7'] },
];

// One draggable chord chip. Tap → attach where the caret/selection was;
// long-press → lift it and drag it onto a word.
//
// `variant` is purely visual (major/minor/seventh — see .cs-chip's own CSS
// for the relief each gets) — the PALETTE's own `variant` field, never the
// chord's own identity. A chip built from CustomChordTile's free-text entry
// has no variant of its own; it renders with the base (major) relief, since
// it sits in the same row as the other fixed chips once typed.
//
// The chip's job ends at "a long-press happened, here's the chord and
// where it started" — it does NOT track the rest of the drag (see
// useLongPressDrag.js). It used to (a native touchmove listener on the
// chip itself, finishing the drag from the chip's own onTouchEnd), which
// worked in every test here because testing never kept one real finger
// down across the state change that follows onDragStart: the moment a drag
// begins, the PARENT sheet used to swap its whole rendered content (shrink
// to a strip, the chip grid — including this chip — unmounted). A touch
// sequence whose origin element left the DOM stopped being delivered to
// it; on a real device this read as "drag picks up, then the sheet just
// freezes" (reported 2026-10-08). Moving the live drag to document-level
// listeners (useLineDragDrop.js) looked like the fix but wasn't the whole
// one — a touch's move/end are bound to whatever element was hit at
// touchstart for the gesture's whole lifetime, and once THAT element is
// detached from the document it has no path up to `document` for those
// listeners to catch either (reconfirmed on a real phone via BrowserStack
// as "it worked after I re-tapped it", 2026-10-15, then root-caused via
// Playwright CDP touch events the same day). The actual fix is that the
// chip grid no longer unmounts during a drag at all — see
// .res-picker-sheet-content in style.css and this file's own render: the
// strip renders alongside the grid, not instead of it, and only the
// shrunk sheet's overflow:hidden hides the grid visually.
function ChordChip({ name, variant = 'major', onPick, onDragStart }) {
  const lp = useLongPressDrag({ onDragStart });

  return (
    <button
      className={`cs-chip cs-chip-${variant}${lp.pressed ? ' pressed' : ''}`}
      onTouchStart={(e) => { const t = e.touches[0]; lp.start(t.clientX, t.clientY, name); }}
      onTouchMove={(e) => { const t = e.touches[0]; lp.move(t.clientX, t.clientY); }}
      onTouchEnd={lp.end}
      onTouchCancel={lp.end}
      onClick={() => { if (!lp.moved()) onPick(name); }}
    >{name}</button>
  );
}

// The "+" tile ending the Séptimas grid — replaces the old always-visible
// free-text input row. Tap to reveal the entry (G/B, F#m7b5, Badd9…) right
// where the tile was; the chord it creates attaches exactly like a tap on
// any other chip (onPick), it just isn't a permanent addition to the
// palette grid — typing a one-off slash chord shouldn't grow the grid
// everyone else sees.
function CustomChordTile({ open, value, onOpen, onChange, onSubmit }) {
  if (!open) {
    return (
      <button className="cs-chip cs-chip-custom" onClick={onOpen} aria-label="otro acorde">
        <IcPlus size={16} />
      </button>
    );
  }
  return (
    <input
      autoFocus
      className="cs-custom-input"
      value={value}
      placeholder="G/B, F#m7b5…"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } }}
      onBlur={onSubmit}
    />
  );
}

// ─── the strum pad ────────────────────────────────────────────────────────
// A tall touch surface the artist actually strums on: one vertical swipe =
// one continuous touch, many strokes — no lift between them, the way a
// real strumming hand plays (createStrokeSegmenter, utils/strum.js, has
// the actual "is this still the same stroke" judgment; this component
// just wires touch events to it). Direction is the sign of each
// displacement, intensity comes from its velocity, and the time each
// stroke landed is what the tempo is read off afterwards — no metronome to
// follow, no tempo to dial in first, the gesture is the input, including
// its timing. A touch that never swipes at all resolves to a single MUTE
// on release (the segmenter's own end()) — a tap of the strumming hand
// against the strings, not a failed stroke.
function StrumPad({ recording, onStroke, children }) {
  const padRef = useRef(null);
  // One segmenter instance per mounted pad, reset at the start of every
  // touch (not recreated — it owns no per-touch state until start() is
  // called, so reuse is free).
  const segmenterRef = useRef(null);
  if (!segmenterRef.current) segmenterRef.current = createStrokeSegmenter();
  const [preview, setPreview] = useState(null); // { direction, intensity } | null — the in-progress segment only, never a mute (that's only ever known at release)

  // Shared by every path that can finish a stroke (touchmove's own
  // mid-gesture commits, touchend's final one) — one vibration policy, one
  // call into onStroke, regardless of which of those fired it.
  const emit = useCallback((stroke) => {
    if (!stroke) return;
    navigator.vibrate?.(stroke.direction === 'mute' ? 15 : Math.round(6 + stroke.intensity * 18));
    onStroke(stroke, Date.now());
  }, [onStroke]);

  useEffect(() => {
    const el = padRef.current;
    if (!el) return undefined;
    // Non-passive: a vertical swipe on a pad inside a scrollable sheet is
    // otherwise eaten as a scroll, and a strum that scrolls the sheet is
    // not a strum. touch-action:none in CSS handles the same thing for
    // browsers that honour it; this covers the ones that don't.
    const move = (e) => {
      e.preventDefault();
      const t = e.touches[0];
      const now = Date.now();
      // A stroke can finish mid-gesture now (the finger reversed past
      // STROKE_REVERSAL_PX without lifting) — emit it the instant the
      // segmenter says so, then keep tracking the NEXT one from the same
      // touch.
      emit(segmenterRef.current.move(t.clientY, now));
      setPreview(segmenterRef.current.preview(t.clientY, now));
    };
    el.addEventListener('touchmove', move, { passive: false });
    return () => el.removeEventListener('touchmove', move);
  }, [emit]);

  const handleStart = useCallback((e) => {
    const t = e.touches[0];
    segmenterRef.current.start(t.clientY, Date.now());
    setPreview(null);
  }, []);

  const handleEnd = useCallback((e) => {
    setPreview(null);
    const t = e.changedTouches[0];
    emit(segmenterRef.current.end(t.clientY, Date.now()));
  }, [emit]);

  const handleCancel = useCallback(() => {
    segmenterRef.current.cancel();
    setPreview(null);
  }, []);

  const PreviewArrow = preview?.direction === 'up' ? IcStrumUp : IcStrumDown;

  return (
    <div
      ref={padRef}
      className={`cs-pad${recording ? ' cs-pad-live' : ''}`}
      onTouchStart={handleStart}
      onTouchEnd={handleEnd}
      onTouchCancel={handleCancel}
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
  // Whether the Séptimas group's "+" tile is currently showing its text
  // entry in place of the tile — see CustomChordTile above.
  const [customOpen, setCustomOpen] = useState(false);

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
  // The live drag (document-level move/end listeners, hover, drop) is
  // identical to ResourcePickerSheet's own — see useLineDragDrop.js. Only
  // what a drop actually RESOLVES TO differs: a chord needs the raw point
  // (NoteEditorScreen's handleDropChord turns it into a character offset
  // inside a specific word), where a resource only needs the line.
  const { drag, beginDrag: handleDragStart } = useLineDragDrop({
    onDragHoverLine,
    onDragActiveChange,
    onDrop: onDropChord,
  });

  // Submits on Enter AND on blur (CustomChordTile's own onBlur) — tapping
  // anywhere else is as much "done typing" as pressing Enter is, and the
  // tile has nowhere else to go back to being a "+" otherwise. An empty
  // field just closes the tile without attaching anything, same as typing
  // nothing into the old always-visible input and tapping away from it.
  const handleAddCustom = useCallback(() => {
    const name = custom.trim();
    setCustom('');
    setCustomOpen(false);
    if (name) onPickChord?.(name);
  }, [custom, onPickChord]);

  const padHint = useMemo(() => {
    if (recording) return strokes.length ? 'rasguea…' : 'rasguea arriba y abajo con el dedo';
    if (strokes.length) return 'pulsa Rehacer para grabar otra vez';
    return 'pulsa Grabar y rasguea aquí';
  }, [recording, strokes.length]);

  // Tempo's own +/- steppers — same clamp onBlur already applies, just
  // reachable without the keyboard. 1 BPM per tap: a stepper is for fine
  // correction once the recorded tempo is close, not for dialling one in
  // from scratch (that's what typing the number directly is for).
  const bumpTempo = useCallback((delta) => {
    setBpm((b) => Math.max(BPM_MIN, Math.min(BPM_MAX, (Number(b) || 90) + delta)));
    setBpmDerived(false);
    setDirty(true);
  }, []);

  return (
    <div className={`baul-sheet-scrim${drag ? ' res-picker-scrim-dragging' : ''}`} onClick={drag ? undefined : onClose}>
      {/* Slides fully off-screen for a drag's duration (.res-picker-sheet-dragging,
          style.css) — was a 56px peeking strip showing the other chips, but
          that sliver ate exactly the lyric-area room a precise drop needs
          most, and the chip being dragged already has its own floating pill
          (LineDragPill below) following the finger, so the strip bought
          nothing. The content underneath stays mounted throughout (a
          transform doesn't detach it) — see .res-picker-sheet-content's own
          comment in style.css for why that still matters even though
          nothing in here is visible mid-drag. */}
      <div className={`baul-sheet cs-sheet${drag ? ' res-picker-sheet-dragging' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />

        <div className={`res-picker-sheet-content${drag ? ' res-picker-drag-hidden' : ''}`}>
            <div className="cs-head">
              <div className="attach-title">Acordes y rasgueo</div>
              <div className="cs-tabs">
                <button className={`cs-tab${tab === 'chords' ? ' cs-tab-active' : ''}`} onClick={() => setTab('chords')}>
                  <IcChord size={14} /> Acorde
                </button>
                <button className={`cs-tab${tab === 'strum' ? ' cs-tab-active' : ''}`} onClick={() => setTab('strum')}>
                  <IcStrumDown size={14} /> Rasgueo
                </button>
              </div>
            </div>

            {tab === 'chords' ? (
              <div className="cs-body">
                <div className="cs-chords-head">
                  <span className="cs-chords-title">Acordes</span>
                  <span className="cs-chords-drag-hint"><span className="cs-chords-drag-arrow">→</span> arrastra a la letra</span>
                </div>

                {PALETTE.map((group) => (
                  <div className="cs-group" key={group.label}>
                    <div className="cs-group-head">
                      <span className="cs-group-label">{group.label}</span>
                      <span className="cs-group-rule" />
                    </div>
                    <div className={`cs-chip-grid cs-chip-grid-${group.variant}`}>
                      {group.chords.map((name) => (
                        <ChordChip
                          key={name}
                          name={name}
                          variant={group.variant}
                          onPick={onPickChord}
                          onDragStart={handleDragStart}
                        />
                      ))}
                      {/* Lives inside Séptimas y color's own grid, as its
                          12th/last cell — see CustomChordTile's own comment
                          on why it isn't a permanent palette addition. */}
                      {group.variant === 'seventh' && (
                        <CustomChordTile
                          open={customOpen}
                          value={custom}
                          onOpen={() => setCustomOpen(true)}
                          onChange={setCustom}
                          onSubmit={handleAddCustom}
                        />
                      )}
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
                  {/* The circle+icon framing is the mockup's reposo state
                      (a pattern already recorded, "pulsa Rehacer..."); applied
                      to the other idle sub-state (nothing recorded yet,
                      "pulsa Grabar...") too rather than leaving it bare,
                      since both are the SAME "not currently recording" mode
                      and the up-arrow reads as generic strum iconography,
                      not a literal instruction either hint text already
                      carries. The active-recording state keeps its current
                      plain-text treatment — open question, see PR/task notes. */}
                  {recording ? (
                    <span className="cs-pad-hint">{padHint}</span>
                  ) : (
                    <div className="cs-pad-idle">
                      <span className="cs-pad-icon"><IcStrumUp size={16} /></span>
                      <span className="cs-pad-hint">{padHint}</span>
                    </div>
                  )}
                </StrumPad>

                {/* No empty-state message here on purpose: padHint (above,
                    inside the pad itself) already says "pulsa Grabar y
                    rasguea aquí" when there's nothing recorded yet, so a
                    second "aún no hay golpes grabados" directly under it
                    would be the same fact twice. The whole block — eyebrow
                    included — simply isn't there until a pattern exists,
                    same as TempoStrumCard's own Rasgueo block. The
                    pattern-stepping "visual metronome" playback (an
                    activeIndex this once passed to the old StrumArrows) was
                    cut, not just hidden, until tracking "which stroke we're
                    in" is actually wanted again — see git history for the
                    removed togglePlayback/playIndex machinery if it comes
                    back. */}
                {strokes.length > 0 && (
                  <div className="cs-pattern">
                    <span className="cs-group-label">Patrón grabado</span>
                    <StrumPattern pattern={strokes} />
                  </div>
                )}

                {/* Same card material as .cs-pattern above (paper, hairline,
                    14px radius) — the two read as one family of "recorded
                    facts about this take", not a card and a bare form row. */}
                <div className="cs-tempo">
                  <div className="cs-tempo-info">
                    <label className="cs-group-label" htmlFor="cs-bpm">Tempo</label>
                    <div className="cs-tempo-row">
                      {/* Reuses .ne-ts-dot's own tempo-pulse-beat keyframe
                          (TempoStrumCard.jsx) — one "pulses at the actual
                          rhythm" animation, not a second copy of it. */}
                      <span className="cs-tempo-dot" style={{ animationDuration: `${60000 / (Number(bpm) || 90)}ms` }} />
                      {/* Auto-derived from the real gaps between the strokes
                          just performed, then freely editable — same "the
                          system suggests, the human can always correct it"
                          rule as the muse's suggestions and word variants. */}
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
                      <span className="cs-tempo-unit">bpm</span>
                    </div>
                    {bpmDerived && <span className="cs-tempo-auto">de tu rasgueo</span>}
                  </div>
                  <div className="cs-tempo-steppers">
                    <button type="button" className="cs-tempo-step" onClick={() => bumpTempo(1)} aria-label="subir tempo">+</button>
                    <button type="button" className="cs-tempo-step" onClick={() => bumpTempo(-1)} aria-label="bajar tempo">−</button>
                  </div>
                </div>

                <div className="cs-controls">
                  {recording ? (
                    <button className="cs-btn cs-btn-stop" onClick={stopRecording}>Parar</button>
                  ) : (
                    <button className="cs-btn cs-btn-secondary" onClick={startRecording}>
                      {/* Refresh icon only for "Rehacer" (a pattern already
                          exists to redo) — "Grabar" (first take) has nothing
                          to refresh, so it keeps the plain label. Open
                          question territory alongside the pad's own active-
                          recording state; see task notes. */}
                      {strokes.length > 0 && <IcRegenerate size={14} />}
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
        </div>
      </div>

      {drag && <LineDragPill x={drag.x} y={drag.y} className="cs-drag-pill">{drag.payload}</LineDragPill>}
    </div>
  );
}
