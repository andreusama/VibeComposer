import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';
import { SECTION_TYPES, STATUS_CYCLE, saveNoteType, saveNoteText, saveNoteStatus, saveNotePosition, deleteNote } from './canvasData.js';
import { beginSave, endSave } from './saveStatus.js';
import { splitIntoLines } from '../utils/textLines.js';
import { classifyStanzaRhymes } from '../utils/rhyme.js';
import { countLineSyllables } from '../utils/syllables.js';

// Set explicitly rather than relying on the base stylesheet's 6px default,
// which wasn't reliably applying — this guarantees a small, predictable dot
// regardless of whatever was overriding it.
const HANDLE_STYLE = { width: 10, height: 10, background: '#1D1C1A', border: '2px solid #fff' };
// The chord-assignment plug is its own dedicated handle, visually distinct
// (indigo, bottom-center) from the ink-colored left/right main-thread
// connectors — sharing handles for two different meanings (note-to-note
// chaining vs. chords-to-note assignment) was exactly what made connections
// feel mixed up.
const CHORD_HANDLE_STYLE = { width: 12, height: 12, background: '#4552D6', border: '2px solid #fff' };

// Genius-style "select a piece, ask about it": textarea.value uses \n only
// (browsers normalize this, never \r\n), so plain offset math against a
// \n-split of the raw text lines up exactly with selectionStart/End — unlike
// splitIntoLines (textLines.js), which trims each line and would shift
// those offsets. Returns null for an empty/whitespace-only selection or one
// that starts outside any line (shouldn't happen, but a stale selection
// surviving a text edit is cheap to guard against).
function getSelectionLineContext(text, start, end) {
  if (start === end) return null;
  const lines = text.split('\n');
  let offset = 0;
  for (const line of lines) {
    const lineEnd = offset + line.length;
    if (start >= offset && start <= lineEnd) {
      const localStart = start - offset;
      const localEnd = Math.min(line.length, end - offset);
      const selectedText = line.slice(localStart, localEnd);
      if (!selectedText.trim()) return null;
      return { text: selectedText, before: line.slice(0, localStart), after: line.slice(localEnd) };
    }
    offset = lineEnd + 1; // +1 for the \n this split() consumed
  }
  return null;
}

export default function TextNoteNode({ id, data, selected }) {
  const { note, onDeleted, onOpenPanel, onOpenMuse, onTextChange, onTypeChange, chordSummary, lyricLanguage, lyricDialect } = data;
  const [type, setType] = useState(note.type);
  const [customLabel, setCustomLabel] = useState(note.custom_label || '');
  const [text, setText] = useState(note.lines?.[0]?.text || '');
  const [status, setStatus] = useState(note.lines?.[0]?.status || 'provisional');
  // The fragment currently selected in the textarea, if any — ephemeral,
  // never saved; just feeds the "ask the muse about this ↗" affordance
  // below the text. See MuseFloatNode's pendingTargetVerse for where it
  // ends up once the user acts on it.
  const [selection, setSelection] = useState(null);
  const saveTimer = useRef(null);
  const lineId = note.lines?.[0]?.id;
  const textareaRef = useRef(null);
  const syllableStripRef = useRef(null);
  const rhymeStripRef = useRef(null);

  // Recomputed straight from the current text/language/dialect on every
  // render — cheap (one note's worth of lines), no need to debounce a pure
  // client-side read the way the actual Supabase save is debounced below.
  const rhymeLines = useMemo(
    () => classifyStanzaRhymes(splitIntoLines(text), lyricLanguage || 'es', lyricDialect || 'central'),
    [text, lyricLanguage, lyricDialect]
  );

  const syllableCounts = useMemo(
    () => splitIntoLines(text).map((line) => (line ? countLineSyllables(line, lyricLanguage || 'es') : null)),
    [text, lyricLanguage]
  );

  // Both gutters are separate scrollable columns next to the textarea (it
  // can't host inline React content), so their scroll position has to be
  // mirrored by hand to stay lined up with the text once a note has more
  // lines than fit in view — the classic line-number-gutter trick.
  const handleTextareaScroll = useCallback(() => {
    if (!textareaRef.current) return;
    const { scrollTop } = textareaRef.current;
    if (syllableStripRef.current) syllableStripRef.current.scrollTop = scrollTop;
    if (rhymeStripRef.current) rhymeStripRef.current.scrollTop = scrollTop;
  }, []);

  // Resync from the canonical copy only when something OUTSIDE this note
  // changed its text (promoting a variant, restoring a history entry) —
  // signaled by textVersion bumping. Ordinary re-renders (including the echo
  // of our own onTextChange mirror) don't bump it, so mid-keystroke typing
  // is never clobbered by this.
  useEffect(() => {
    setText(note.lines?.[0]?.text || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.textVersion]);

  // Type/label don't have a "mid-keystroke" race the way free text does —
  // a dropdown pick is atomic — so this can just always mirror the prop
  // directly, no version-bump indirection needed. Without this, a type
  // change made from the side panel (which edits the same note.type prop
  // through the exact same onTypeChange mirror as this node's own select)
  // would only ever show up here after a remount, since useState's
  // initial value is only read once.
  useEffect(() => {
    setType(note.type);
    setCustomLabel(note.custom_label || '');
  }, [note.type, note.custom_label]);

  const handleTextChange = useCallback((e) => {
    const val = e.target.value;
    setText(val);
    setSelection(null); // any prior selection's offsets are stale the moment the text changes
    onTextChange?.(id, val);
    // Every reschedule closes out the save it's replacing so the toolbar's
    // pending count doesn't grow forever while someone keeps typing.
    if (saveTimer.current) endSave();
    clearTimeout(saveTimer.current);
    beginSave();
    saveTimer.current = setTimeout(async () => {
      // finally, not a trailing call — a rejected save (network hiccup,
      // Supabase throwing rather than resolving with {error}) would
      // otherwise skip endSave() entirely, leaving the toolbar's "saving…"
      // indicator stuck on forever with no way to clear itself.
      try {
        if (lineId) await saveNoteText(lineId, val);
      } finally {
        endSave();
      }
    }, 500);
  }, [lineId, id, onTextChange]);

  const handleTypeChange = useCallback((e) => {
    const val = e.target.value;
    setType(val);
    const label = val === 'custom' ? customLabel : null;
    saveNoteType(id, val, label);
    onTypeChange?.(id, val, label);
  }, [id, customLabel, onTypeChange]);

  const handleCustomLabelBlur = useCallback(() => {
    saveNoteType(id, type, customLabel);
    onTypeChange?.(id, type, customLabel);
  }, [id, type, customLabel, onTypeChange]);

  const handleCycleStatus = useCallback((e) => {
    e.stopPropagation();
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(status) + 1) % STATUS_CYCLE.length];
    setStatus(next);
    if (lineId) saveNoteStatus(lineId, next);
  }, [status, lineId]);

  const handleDelete = useCallback(async (e) => {
    e.stopPropagation();
    if (!confirm('Delete this note?')) return;
    await deleteNote(id);
    onDeleted?.(id);
  }, [id, onDeleted]);

  const handleResizeEnd = useCallback((_evt, params) => {
    saveNotePosition(id, { x: params.x, y: params.y }, params.width, params.height);
  }, [id]);

  // Fires on mouse-drag selection AND shift+arrow keyboard selection (the
  // one native event that covers both) — recomputed from the live text/
  // offsets on every change rather than trying to patch the previous value.
  const handleTextSelect = useCallback((e) => {
    const { selectionStart, selectionEnd } = e.target;
    setSelection(getSelectionLineContext(text, selectionStart, selectionEnd));
  }, [text]);

  const handleAskAboutSelection = useCallback((e) => {
    e.stopPropagation();
    if (!selection) return;
    onOpenMuse?.(note, selection);
    setSelection(null);
  }, [selection, onOpenMuse, note]);

  return (
    <div className={`canvas-note${selected ? ' selected' : ''}`}>
      <NodeResizer minWidth={200} minHeight={140} isVisible={selected} onResizeEnd={handleResizeEnd} />
      <Handle type="target" position={Position.Left} id="left" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} id="right" style={HANDLE_STYLE} />
      <Handle type="target" position={Position.Bottom} id="chord" style={CHORD_HANDLE_STYLE} title="plug a chord progression in here" />

      <div className="canvas-note-head">
        <select value={type} onChange={handleTypeChange} className="canvas-note-type nodrag">
          {SECTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {type === 'custom' && (
          <input
            className="canvas-note-custom-label nodrag"
            value={customLabel}
            placeholder="label…"
            onChange={(e) => setCustomLabel(e.target.value)}
            onBlur={handleCustomLabelBlur}
          />
        )}
        <button
          className={`canvas-note-status-dot nodrag ${status}`}
          onClick={handleCycleStatus}
          title={`status: ${status} (click to change)`}
        />
        <button
          className="canvas-note-muse nodrag"
          onClick={(e) => { e.stopPropagation(); onOpenMuse?.(note); }}
          title="ask the muse"
        >✦</button>
        <button
          className="canvas-note-details nodrag"
          onClick={(e) => { e.stopPropagation(); onOpenPanel?.(id); }}
          title="variants, notes, history, tools"
        >☰</button>
        <button className="canvas-note-delete nodrag" onClick={handleDelete} title="delete note">✕</button>
      </div>

      {chordSummary && <div className="canvas-note-chords">{chordSummary}</div>}

      <div className="canvas-note-text-row">
        <textarea
          ref={textareaRef}
          className="canvas-note-text nodrag nowheel"
          value={text}
          onChange={handleTextChange}
          onScroll={handleTextareaScroll}
          onSelect={handleTextSelect}
          onBlur={() => setSelection(null)}
          placeholder="write…"
        />
        {/* Genius-style fragment targeting: select a piece of a line, ask the
            muse specifically about it (SURGEON mode gets an exact target
            instead of inferring one). Anchored to a corner of the text area
            rather than tracking the caret position — simple and predictable,
            no text-mirror-div needed for a first pass. */}
        {selection && (
          <button
            className="canvas-note-ask-selection nodrag"
            onMouseDown={(e) => e.preventDefault()} // keep the textarea selection from collapsing on click
            onClick={handleAskAboutSelection}
            title={`preguntar a la musa sobre: "${selection.text}"`}
          >
            ✦ preguntar sobre esto
          </button>
        )}
        <div className="canvas-note-syllable-strip nodrag" ref={syllableStripRef}>
          {syllableCounts.map((count, i) => (
            <div className="syllable-badge" key={i}>{count ?? ''}</div>
          ))}
        </div>
        {/* Uppercase = consonant rhyme, lowercase = assonant, a dot = no
            match yet — one row per physical line, kept in lockstep with the
            textarea above via handleTextareaScroll. */}
        <div className="canvas-note-rhyme-strip nodrag" ref={rhymeStripRef}>
          {rhymeLines.map((r, i) => (
            <div
              className={`rhyme-badge${r.letter ? ` ${r.type}` : ' empty'}`}
              key={i}
              title={r.internalRhymeWords.size ? 'also rhymes internally within this line' : undefined}
            >
              {r.letter ?? '·'}
              {r.internalRhymeWords.size > 0 && <span className="rhyme-badge-internal-dot" />}
            </div>
          ))}
        </div>
      </div>

      <div className="canvas-note-foot">
        <span>{note.variantCount || 0} variant{note.variantCount === 1 ? '' : 's'}</span>
        <span>{note.annotationCount || 0} note{note.annotationCount === 1 ? '' : 's'}</span>
      </div>
    </div>
  );
}
