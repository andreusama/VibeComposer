import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';
import { SECTION_TYPES, STATUS_CYCLE, saveNoteType, saveNoteText, saveNoteStatus, saveNotePosition, deleteNote } from './canvasData.js';
import { beginSave, endSave } from './saveStatus.js';
import { splitIntoLines } from '../utils/textLines.js';
import { classifyStanzaRhymes, lineMeter } from '../utils/rhyme.js';
import { useUndoStack } from '../utils/useUndoStack.js';
import LineHighlight from '../components/LineHighlight.jsx';
import WordVariantSheet from '../mobile/WordVariantSheet.jsx';
import { loadWordVariants, addWordVariant, updateWordVariant, deleteWordVariant, resolveVariantRange } from './wordVariantData.js';
import { addLineHistory } from './lineHistoryData.js';

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
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineEnd = offset + line.length;
    if (start >= offset && start <= lineEnd) {
      const localStart = start - offset;
      const localEnd = Math.min(line.length, end - offset);
      const selectedText = line.slice(localStart, localEnd);
      if (!selectedText.trim()) return null;
      return { text: selectedText, before: line.slice(0, localStart), after: line.slice(localEnd), lineIndex: i };
    }
    offset = lineEnd + 1; // +1 for the \n this split() consumed
  }
  return null;
}

// Absolute character offset in `text` where physical line `lineIndex` starts.
function lineStartOffset(text, lineIndex) {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < lineIndex && i < lines.length; i++) offset += lines[i].length + 1;
  return offset;
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
  const [wordVariants, setWordVariants] = useState([]);
  const [wordVariantSheet, setWordVariantSheet] = useState(null); // { variantId } | { draft }
  const saveTimer = useRef(null);
  const lineId = note.lines?.[0]?.id;
  const textareaRef = useRef(null);
  const overlayRef = useRef(null);
  const syllableStripRef = useRef(null);
  const rhymeStripRef = useRef(null);
  const undo = useUndoStack();
  // splitIntoLines snapshot taken when the textarea gained focus — diffed on
  // blur to log per-line history (line_history).
  const focusBaselineRef = useRef(null);

  // Recomputed straight from the current text/language/dialect on every
  // render — cheap (one note's worth of lines), no need to debounce a pure
  // client-side read the way the actual Supabase save is debounced below.
  const rhymeLines = useMemo(
    () => classifyStanzaRhymes(splitIntoLines(text), lyricLanguage || 'es', lyricDialect || 'central'),
    [text, lyricLanguage, lyricDialect]
  );

  const syllableCounts = useMemo(
    () => splitIntoLines(text).map((line) => (line ? lineMeter(line, lyricLanguage || 'es', lyricDialect || 'central') : null)),
    [text, lyricLanguage, lyricDialect]
  );

  useEffect(() => {
    let cancelled = false;
    if (note.id) loadWordVariants(note.id).then(({ data }) => { if (!cancelled) setWordVariants(data || []); });
    undo.reset();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  // Word-variant underline spans as ABSOLUTE offsets over the whole text —
  // resolved per physical line, then shifted by that line's start offset.
  // `text.split('\n')` (not splitIntoLines) so offsets match selectionStart.
  const variantRanges = useMemo(() => {
    const rawLines = text.split('\n');
    const out = [];
    wordVariants.forEach((v) => {
      const line = rawLines[v.line_index];
      if (line == null) return;
      const local = resolveVariantRange(v, line);
      if (!local) return;
      const base = lineStartOffset(text, v.line_index);
      out.push({ start: base + local.start, end: base + local.end, variantId: v.id });
    });
    return out;
  }, [wordVariants, text]);

  // Both gutters are separate scrollable columns next to the textarea (it
  // can't host inline React content), so their scroll position has to be
  // mirrored by hand to stay lined up with the text once a note has more
  // lines than fit in view — the classic line-number-gutter trick.
  const handleTextareaScroll = useCallback(() => {
    if (!textareaRef.current) return;
    const { scrollTop, scrollLeft } = textareaRef.current;
    if (syllableStripRef.current) syllableStripRef.current.scrollTop = scrollTop;
    if (rhymeStripRef.current) rhymeStripRef.current.scrollTop = scrollTop;
    if (overlayRef.current) overlayRef.current.scrollTo(scrollLeft, scrollTop);
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

  // Commit a new text value from anywhere (typing, undo/redo, a variant
  // swap): mirror to the parent + schedule the debounced Supabase save.
  const commitText = useCallback((val) => {
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

  const handleTextChange = useCallback((e) => {
    undo.snapshot(text, { coalesce: true });
    commitText(e.target.value);
  }, [undo, text, commitText]);

  // Ctrl/Cmd+Z undo, +Shift (or Ctrl+Y) redo — the textarea's own native
  // undo history is wiped by every controlled-value swap, so we run our own.
  const handleTextKeyDown = useCallback((e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      const prev = undo.undo(text);
      if (prev !== undefined) { e.preventDefault(); commitText(prev); }
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      const next = undo.redo(text);
      if (next !== undefined) { e.preventDefault(); commitText(next); }
    }
  }, [undo, text, commitText]);

  const handleTextFocus = useCallback(() => {
    focusBaselineRef.current = text.split('\n');
  }, [text]);

  const handleTextBlur = useCallback(() => {
    setSelection(null);
    const baseline = focusBaselineRef.current;
    focusBaselineRef.current = null;
    if (!baseline) return;
    const current = text.split('\n');
    if (current.length !== baseline.length) return; // structural change — too ambiguous to log per line
    current.forEach((line, i) => {
      if (line !== baseline[i] && baseline[i].trim() && note.id) {
        addLineHistory(note.id, i, baseline[i]);
      }
    });
  }, [text, note.id]);

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

  // ─── Word-variant alternatives ────────────────────────────────────────────
  const handleAddVariantFromSelection = useCallback((e) => {
    e.stopPropagation();
    if (!selection || selection.lineIndex == null) return;
    setWordVariantSheet({ draft: { lineIndex: selection.lineIndex, before: selection.before, text: selection.text } });
    setSelection(null);
  }, [selection]);

  const handleTextClick = useCallback((e) => {
    if (!variantRanges.length) return;
    const pos = e.target.selectionStart;
    const hit = variantRanges.find((r) => pos >= r.start && pos < r.end);
    if (hit) setWordVariantSheet({ variantId: hit.variantId });
  }, [variantRanges]);

  const handleCreateWordVariant = useCallback(async (draft, options) => {
    const { data, error } = await addWordVariant(note.id, draft.lineIndex, options, draft.before, 0);
    if (!error && data) setWordVariants((cur) => [...cur, data]);
    setWordVariantSheet(null);
  }, [note.id]);

  const handleSaveWordVariant = useCallback(async (variant, nextOptions, nextActiveIndex) => {
    const rawLines = text.split('\n');
    const line = rawLines[variant.line_index] ?? '';
    const range = resolveVariantRange(variant, line);
    const nextActive = nextOptions[nextActiveIndex] ?? '';
    if (range && nextActive && line.slice(range.start, range.end) !== nextActive) {
      undo.snapshot(text);
      if (note.id) addLineHistory(note.id, variant.line_index, line);
      rawLines[variant.line_index] = line.slice(0, range.start) + nextActive + line.slice(range.end);
      commitText(rawLines.join('\n'));
    }
    const { data } = await updateWordVariant(variant.id, { options: nextOptions, active_index: nextActiveIndex });
    setWordVariants((cur) => cur.map((v) => (v.id === variant.id ? (data || { ...v, options: nextOptions, active_index: nextActiveIndex }) : v)));
    setWordVariantSheet(null);
  }, [text, undo, commitText, note.id]);

  const handleDeleteWordVariant = useCallback(async (variant) => {
    await deleteWordVariant(variant.id);
    setWordVariants((cur) => cur.filter((v) => v.id !== variant.id));
    setWordVariantSheet(null);
  }, []);

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
        <div className="canvas-note-text-wrap">
          <LineHighlight ref={overlayRef} text={text} ranges={variantRanges} className="canvas-note-highlight" />
          <textarea
            ref={textareaRef}
            className="canvas-note-text nodrag nowheel"
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleTextKeyDown}
            onScroll={handleTextareaScroll}
            onSelect={handleTextSelect}
            onClick={handleTextClick}
            onFocus={handleTextFocus}
            onBlur={handleTextBlur}
            placeholder="write…"
          />
        </div>
        {/* Genius-style fragment targeting: select a piece of a line, ask the
            muse specifically about it (SURGEON mode gets an exact target
            instead of inferring one). Anchored to a corner of the text area
            rather than tracking the caret position — simple and predictable,
            no text-mirror-div needed for a first pass. */}
        {selection && (
          <div className="canvas-note-sel-actions nodrag">
            <button
              className="canvas-note-ask-selection"
              onMouseDown={(e) => e.preventDefault()} // keep the textarea selection from collapsing on click
              onClick={handleAskAboutSelection}
              title={`preguntar a la musa sobre: "${selection.text}"`}
            >
              ✦ preguntar sobre esto
            </button>
            <button
              className="canvas-note-ask-selection"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleAddVariantFromSelection}
              title={`alternativa para: "${selection.text}"`}
            >
              ✎ alternativa
            </button>
          </div>
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

      {wordVariantSheet && (
        <WordVariantSheet
          variant={wordVariantSheet.variantId ? wordVariants.find((v) => v.id === wordVariantSheet.variantId) : null}
          draft={wordVariantSheet.draft || null}
          onClose={() => setWordVariantSheet(null)}
          onCreate={handleCreateWordVariant}
          onSave={handleSaveWordVariant}
          onDelete={handleDeleteWordVariant}
        />
      )}
    </div>
  );
}
