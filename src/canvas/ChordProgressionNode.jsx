import { useState, useCallback, useRef, useEffect } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';
import { fretboardSVG } from '../components/fretboard.js';
import { playChord, playProgression } from '../audio/player.js';
import { saveProgressionContent, saveProgressionPosition, deleteChordProgression } from './canvasData.js';
import { beginSave, endSave } from './saveStatus.js';

const EMPTY_CHORD = () => ({ chord: '', function: '', feel: '', beats: 4, ukulele: [0, 0, 0, 0] });
const STRING_LABELS = ['G', 'C', 'E', 'A'];
const HANDLE_STYLE = { width: 10, height: 10, background: '#4552D6', border: '2px solid #fff' };
const TEMPO_HANDLE_STYLE = { width: 10, height: 10, background: '#B8842A', border: '2px solid #fff' };

// Below this width the node renders as a compact, read-only summary (chip
// chain of chord names); at or above it, the full per-chord editor renders.
// Crossing the line is driven entirely by the existing NodeResizer drag
// handle — there's no separate collapse/expand control, matching how a real
// index card works: small on the shelf, opened out on the desk.
const EXPANDED_MIN_WIDTH = 400;

const WAVEFORM_HEIGHTS = [8, 13, 18, 11, 22, 15, 9, 19, 16, 8, 13, 21, 11, 18, 15, 9, 22, 13, 8, 16];

// The composer already tags every chord with a roman-numeral function
// (I, vi, IV...) — lowercase means minor, uppercase means major/dominant,
// standard notation. No new data needed, just read the case.
function chordQuality(fn) {
  if (!fn) return '';
  return /^[a-z]/.test(fn) ? 'minor' : 'major';
}

export default function ChordProgressionNode({ id, data, selected, width }) {
  const { progression: cp, onDeleted, onArrange, bpm } = data;
  const [title, setTitle] = useState(cp.title);
  const [key, setKey] = useState(cp.key || '');
  const [chords, setChords] = useState(cp.progression?.length ? cp.progression : [EMPTY_CHORD()]);
  const saveTimer = useRef(null);
  const dragIndexRef = useRef(null);
  const [shiftHeld, setShiftHeld] = useState(false);

  const isExpanded = (width ?? cp.canvas_width ?? 260) >= EXPANDED_MIN_WIDTH;
  const hasChords = chords.some((c) => c.chord?.trim());

  // React Flow's NodeResizer only takes a static keepAspectRatio prop, no
  // built-in "hold a modifier key to lock" behavior — this fills that gap
  // for the fretboard diagrams, where a squashed/stretched resize actually
  // distorts the content instead of just reflowing it. Only listens while
  // the resize handles are actually on screen (selected), so idle nodes
  // aren't each carrying their own window listener for no reason.
  useEffect(() => {
    if (!selected) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Shift') setShiftHeld(true); };
    const onKeyUp = (e) => { if (e.key === 'Shift') setShiftHeld(false); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      setShiftHeld(false);
    };
  }, [selected]);

  const scheduleSave = useCallback((nextTitle, nextKey, nextChords) => {
    if (saveTimer.current) endSave();
    clearTimeout(saveTimer.current);
    beginSave();
    saveTimer.current = setTimeout(async () => {
      const { error } = await saveProgressionContent(id, { title: nextTitle, key: nextKey, progression: nextChords });
      // This save has no error UI of its own (unlike the note panel) — without
      // at least a console log, a rejected write (stale session, RLS edge
      // case) fails completely silently and the next reload just looks like
      // the typed edits never happened.
      if (error) console.error('chord progression save failed:', error);
      endSave();
    }, 500);
  }, [id]);

  const updateChordName = (idx, value) => {
    const next = chords.map((c, i) => (i === idx ? { ...c, chord: value } : c));
    setChords(next);
    scheduleSave(title, key, next);
  };

  const updateFret = (idx, stringIdx, value) => {
    // -1 is the only valid "below zero" fret — it's the muted-string sentinel
    // fretboardSVG understands. Anything lower than that has no meaning and
    // was rendering a dot above the nut, outside the diagram entirely.
    const fret = value === '' ? 0 : Math.max(-1, Number(value) || 0);
    const next = chords.map((c, i) =>
      i === idx ? { ...c, ukulele: c.ukulele.map((f, si) => (si === stringIdx ? fret : f)) } : c
    );
    setChords(next);
    scheduleSave(title, key, next);
  };

  const updateBeats = (idx, value) => {
    const beats = Math.max(1, Number(value) || 1);
    const next = chords.map((c, i) => (i === idx ? { ...c, beats } : c));
    setChords(next);
    scheduleSave(title, key, next);
  };

  const addChord = () => {
    const next = [...chords, EMPTY_CHORD()];
    setChords(next);
    scheduleSave(title, key, next);
  };

  const removeChord = (idx) => {
    const next = chords.filter((_, i) => i !== idx);
    setChords(next);
    scheduleSave(title, key, next);
  };

  const commitMeta = () => scheduleSave(title, key, chords);

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!confirm('Delete this progression?')) return;
    await deleteChordProgression(id);
    onDeleted?.(id);
  };

  const handleArrangeClick = (e) => {
    e.stopPropagation();
    onArrange?.({ title, key, progression: chords, vibeMeta: cp.vibe_meta });
  };

  const handleResizeEnd = (_evt, params) => {
    saveProgressionPosition(id, { x: params.x, y: params.y }, params.width, params.height);
  };

  const handlePlayAll = () => {
    const playable = chords.filter((c) => c.chord.trim());
    // bpm is undefined unless a tempo node is actually plugged in — playProgression
    // falls back to its own fixed pacing in that case, so an unplugged progression
    // sounds exactly as it always has.
    if (playable.length) playProgression(playable, 'medium', bpm);
  };

  const handlePlayOne = (ch) => {
    if (ch.chord.trim()) playChord(ch.ukulele, 'medium');
  };

  const handleDragStart = (idx) => (e) => {
    dragIndexRef.current = idx;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => e.preventDefault();

  const handleDrop = (idx) => (e) => {
    e.preventDefault();
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    if (from === null || from === idx) return;
    const next = [...chords];
    const [moved] = next.splice(from, 1);
    next.splice(idx, 0, moved);
    setChords(next);
    scheduleSave(title, key, next);
  };

  return (
    <div className={`canvas-cp${selected ? ' selected' : ''} ${isExpanded ? 'cp-expanded' : 'cp-collapsed'}`}>
      <NodeResizer minWidth={220} minHeight={140} isVisible={selected} keepAspectRatio={shiftHeld} onResizeEnd={handleResizeEnd} />
      {/* The assign output only makes sense plugged into a text note's "chord"
          handle — no left/right main-thread-style handles here on purpose.
          The tempo input is the one other thing a chord progression accepts:
          a bpm number from a tempo node, read by handlePlayAll above. */}
      <Handle type="source" position={Position.Right} id="assign" style={HANDLE_STYLE} title="drag to a note's chord plug" />
      <Handle type="target" position={Position.Top} id="tempo-in" style={TEMPO_HANDLE_STYLE} title="drag a tempo node in here" />

      {isExpanded ? (
        <>
          <div className="cp-head">
            <div className="cp-head-left">
              <input
                className="cp-title nodrag"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={commitMeta}
              />
              <input
                className="cp-key-badge nodrag"
                value={key}
                placeholder="key"
                onChange={(e) => setKey(e.target.value)}
                onBlur={commitMeta}
              />
              {bpm && <span className="cp-tempo-badge" title="tempo, from the plugged-in tempo node">{bpm} bpm</span>}
            </div>
            <button className="cp-icon-btn nodrag" onClick={handleArrangeClick} title="arrange into a full song structure">♫</button>
            <button className="cp-icon-btn nodrag" onClick={handleDelete} title="delete progression">✕</button>
          </div>

          <div className="cp-rows nodrag nowheel">
            {chords.map((ch, i) => (
              <div
                className="cp-row"
                key={i}
                onDragOver={handleDragOver}
                onDrop={handleDrop(i)}
              >
                {/* draggable lives on the handle alone — making the whole row a
                    native drag source made the browser swallow ordinary clicks
                    on the buttons/inputs inside it (a click that moves the
                    mouse even a pixel or two reads as "drag start" instead). */}
                <div
                  className="cp-drag-handle"
                  draggable
                  onDragStart={handleDragStart(i)}
                  title="drag to reorder"
                >
                  <span /><span /><span /><span /><span /><span />
                </div>
                <div className="cp-index">{String(i + 1).padStart(2, '0')}</div>
                <div className="cp-chord-block">
                  <input
                    className="cp-chord-name"
                    value={ch.chord}
                    placeholder="Am"
                    onChange={(e) => updateChordName(i, e.target.value)}
                    onBlur={commitMeta}
                  />
                  {ch.function && <div className="cp-chord-sub">{ch.function} · {chordQuality(ch.function)}</div>}
                </div>
                <div className="cp-frets nodrag">
                  {STRING_LABELS.map((label, si) => (
                    <input
                      key={label}
                      className="cp-fret"
                      type="number"
                      min="-1"
                      title={`${label} string (fret, -1 = muted)`}
                      value={ch.ukulele[si]}
                      onChange={(e) => updateFret(i, si, e.target.value)}
                      onBlur={commitMeta}
                    />
                  ))}
                </div>
                <div
                  className="cp-diagram"
                  dangerouslySetInnerHTML={{ __html: fretboardSVG(ch.ukulele, '#4552D6') }}
                />
                <div className="cp-row-right">
                  <input
                    className="cp-beats-pill"
                    type="number"
                    min="1"
                    title="beats"
                    value={ch.beats ?? 4}
                    onChange={(e) => updateBeats(i, e.target.value)}
                    onBlur={commitMeta}
                  />
                  <button className="cp-play-chord" onClick={() => handlePlayOne(ch)} title="play chord">▶</button>
                  <button className="cp-remove-chord" onClick={() => removeChord(i)} title="remove chord">✕</button>
                </div>
              </div>
            ))}
            <button className="cp-add-chord nodrag" onClick={addChord}>+ chord</button>
          </div>

          <div className="cp-transport">
            <button className="cp-transport-play nodrag" onClick={handlePlayAll} title="play progression">▶</button>
            <div className="cp-waveform">
              {WAVEFORM_HEIGHTS.map((h, i) => (
                <span key={i} className="cp-waveform-bar" style={{ height: `${h}px` }} />
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="cp-collapsed-head">
            <span className="cp-collapsed-title">{title || 'untitled'}</span>
            {key && <span className="cp-key-badge cp-key-badge-sm">{key}</span>}
            {bpm && <span className="cp-tempo-badge cp-tempo-badge-sm">{bpm}</span>}
          </div>
          <div className="cp-chip-row nodrag nowheel">
            {chords.map((ch, i) => (
              <span className="cp-chip" key={i}>{ch.chord || '–'}</span>
            ))}
          </div>
          {!hasChords && (
            // There's no chord-entry UI down here at all — that only exists
            // in the expanded editor — so an empty progression (still just
            // dashes above) needs to say so explicitly, or it looks stuck.
            <span className="cp-collapsed-hint">resize ↘ to expand and write chords</span>
          )}
          <div className="cp-collapsed-foot">
            <span>{chords.length} chord{chords.length === 1 ? '' : 's'}</span>
            <span className="cp-collapsed-dot" title="chord progression" />
          </div>
        </>
      )}
    </div>
  );
}
