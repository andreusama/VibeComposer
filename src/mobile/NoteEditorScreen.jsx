import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useReducer, useRef } from 'react';
import { SECTION_TYPES, SECTION_TYPE_LABELS, saveNoteText, saveNoteType, deleteNote } from '../canvas/canvasData.js';
import { splitIntoLines } from '../utils/textLines.js';
import { classifyStanzaRhymes, detectRhymeFriction, lineMeter } from '../utils/rhyme.js';
import MobileScreen from './MobileScreen.jsx';
import ToolsSheet from './ToolsSheet.jsx';
import KeyboardAccessoryBar from './KeyboardAccessoryBar.jsx';
import MusePopover from './MusePopover.jsx';
import FabMenu from './FabMenu.jsx';
import VariantChoiceSheet from './VariantChoiceSheet.jsx';
import BaulSheet from './BaulSheet.jsx';
import TempoPulse from './TempoPulse.jsx';
import NoteAudioBar from './NoteAudioBar.jsx';
import { loadNoteAudioFor, renameNoteAudio } from '../canvas/lineAudioData.js';
import { loadWordVariants, addWordVariant, updateWordVariant, deleteWordVariant, resolveVariantRange } from '../canvas/wordVariantData.js';
import LineHighlight from '../components/LineHighlight.jsx';
import WordVariantSheet from './WordVariantSheet.jsx';
import { loadLineHistory, addLineHistory, deleteLineHistory } from '../canvas/lineHistoryData.js';
import LineHistorySheet from './LineHistorySheet.jsx';
import { IcChevronLeft, IcMore, IcMuse, IcHistory, IcTrash, IcTools, IcPencil } from './icons.jsx';

// The "talk to the muse right inside the lyric" pattern from the design
// ref — always the same wake word, like addressing Alexa, so it reads
// unambiguously as a command and never gets mistaken for a real lyric line
// that happens to start with "musa" (the Spanish word for "muse" itself,
// which could plausibly open an actual verse — the trailing comma/colon is
// what disambiguates "Musa, quiero..." the command from "Musa que me
// inspira..." the lyric).
const MUSE_COMMAND_RE = /^\s*musa\s*[,:]\s*/i;

// One physical line's row: number+rhyme-letter gutter + an auto-growing
// single logical line of text (still wraps visually across more than one
// screen row, same as any textarea — "single line" here means one entry in
// the lines array, one row in the margin, not one row of pixels).
function LineRow({
  id, index, text, previewText, syllables, rhyme, friction, showSyllables, dimmed, showPlaceholder,
  variantRanges, hasHistory,
  onChange, onEnter, onBackspaceAtStart, onFocus, onBlurLine, onSelectionChange, onFrictionTap, onVariantTap, onHistoryTap, inputRef,
}) {
  // Live, not just on submit — the moment the line reads as addressing the
  // muse (the wake word + its disambiguating comma/colon typed), the row's
  // whole visual identity changes: it's no longer lyric content being
  // composed, it's a message being drafted, and the container should look
  // like it before Enter ever commits anything.
  const isMuseCommand = MUSE_COMMAND_RE.test(text);
  const localRef = useRef(null);
  // While a suggestion card is being dragged up into this line (see
  // MusePopover's vertical drag-to-preview), the row displays the
  // candidate's text instead of its real content — non-destructive, purely
  // visual, `text`/`lines` state is untouched until the drag actually
  // commits.
  const displayedText = previewText ?? text;

  // The resize-to-fit-wrapped-content trick only works if it runs every
  // time `text` produces a different wrapped height — not just on the
  // user's own onChange. Without this, a row that loads already wrapping
  // to 2+ visual lines (existing content, a variant promoted, a history
  // restore) stays clamped at the default single-line height and the
  // overflow is clipped, reading as "the second line disappeared" even
  // though the text itself was always complete. useLayoutEffect (not
  // useEffect) so the resize happens before paint — no visible flash.
  useLayoutEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [displayedText]);

  const setRefs = useCallback((el) => {
    localRef.current = el;
    inputRef(id, el);
  }, [id, inputRef]);

  const handleInput = useCallback((e) => {
    onChange(index, e.target.value);
  }, [index, onChange]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter(index, e.target.selectionStart);
    } else if (e.key === 'Backspace' && e.target.selectionStart === 0 && e.target.selectionEnd === 0) {
      // Only at a true collapsed caret at position 0 — a Backspace that's
      // actually deleting a selection should just delete the selection,
      // not jump to merging with the previous line.
      e.preventDefault();
      onBackspaceAtStart(index);
    }
  }, [index, onEnter, onBackspaceAtStart]);

  // Native selection (drag the OS handles, or shift+arrow) — `onSelect` is
  // the one event that covers both. The action bar above the keyboard
  // (LineActionBar) acts on whatever this reports; a collapsed caret clears
  // it and the bar falls back to the word under the caret.
  const handleSelect = useCallback((e) => {
    const { selectionStart, selectionEnd } = e.target;
    if (selectionStart === selectionEnd) { onSelectionChange(null); return; }
    const selected = text.slice(selectionStart, selectionEnd);
    if (!selected.trim()) { onSelectionChange(null); return; }
    onSelectionChange({
      lineIndex: index,
      text: selected,
      before: text.slice(0, selectionStart),
      after: text.slice(selectionEnd),
    });
  }, [text, index, onSelectionChange]);

  // Tapping an underlined word-variant span opens its swap sheet. A plain
  // tap moves the caret first, so selectionStart is where the tap landed.
  const handleClick = useCallback((e) => {
    if (!variantRanges?.length) return;
    const { selectionStart, selectionEnd } = e.target;
    if (selectionStart !== selectionEnd) return; // a drag-select, not a tap
    const hit = variantRanges.find((r) => selectionStart >= r.start && selectionStart < r.end);
    if (hit) onVariantTap(hit.variantId);
  }, [variantRanges, onVariantTap]);

  return (
    <div
      className={`ne-row${dimmed ? ' ne-row-dimmed' : ''}${isMuseCommand ? ' ne-row-muse' : ''}${previewText != null ? ' ne-row-preview' : ''}`}
    >
      <div className="ne-gutter">
        {/* Syllables/rhyme are lyric-craft metrics — meaningless once this
            row has switched to "message to the muse," so they're hidden
            rather than showing a stale/nonsense reading. */}
        {!isMuseCommand && showSyllables && syllables != null && <span className="ne-gutter-count">{syllables}</span>}
        {!isMuseCommand && rhyme?.letter && <span className={`ne-gutter-letter ${rhyme.type}`}>{rhyme.letter}</span>}
        {isMuseCommand && <span className="ne-gutter-muse-icon"><IcMuse size={13} /></span>}
        {/* Content-driven Socratic nudge — this line broke the stanza's
            established rhyme scheme (see rhyme.js's detectRhymeFriction).
            Purely local, no API call until tapped — no idle timer anywhere
            in this screen, the writer gets to think in silence. */}
        {!isMuseCommand && friction && (
          <button className="ne-gutter-friction" title="este verso rompe el esquema de rima — ¿preguntar a la musa?" onClick={() => onFrictionTap(index)}><IcMuse size={13} /></button>
        )}
        {!isMuseCommand && hasHistory && (
          <button className="ne-gutter-history" title="versiones anteriores de este verso" onClick={() => onHistoryTap(index)}><IcHistory size={13} /></button>
        )}
      </div>
      <div className="ne-input-wrap">
        <LineHighlight text={displayedText} ranges={variantRanges} />
        <textarea
          ref={setRefs}
          className="ne-line-input"
          rows={1}
          value={displayedText}
          readOnly={previewText != null}
          placeholder={showPlaceholder ? 'escribe el siguiente verso…' : ''}
          onChange={handleInput}
          onFocus={() => onFocus(index)}
          onSelect={handleSelect}
          onClick={handleClick}
          onBlur={() => onBlurLine(index)}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
}

// Each line carries a stable id (not just its array index) because Enter/
// Backspace now insert and remove entries in the *middle* of the array, not
// just append at the end — with `key={index}`, React would reconcile the
// row that used to be "line 3" onto whatever is now at index 3 after a
// split, which can hand focus/cursor position to the wrong row. An id born
// once per line and carried along survives the splice correctly.
function toLineObjects(strings) {
  return strings.map((text) => ({ id: crypto.randomUUID(), text }));
}

// Invariant this screen maintains at all times: `lines` always ends with
// exactly one empty entry — that's both "somewhere to keep typing" (the
// mockup's "write the next line…" row) and the thing that made an earlier
// version of this screen buggy, when a separate placeholder component
// appended whatever was typed as a brand-new array entry on every
// keystroke instead of editing one line in place. Folding the "next line"
// slot into the same array, edited by the same handlers every other line
// uses, removes that whole special case.
function ensureTrailingEmpty(arr) {
  return arr.length && arr[arr.length - 1].text === '' ? arr : [...arr, { id: crypto.randomUUID(), text: '' }];
}

export default function NoteEditorScreen({
  note, userId, lyricLanguage, lyricDialect, chordSummary, bpm,
  songId, lyricDna, songStructure, onLyricDnaUpdated,
  onClose, onTextChange, onTypeChange, onDeleted, onCreateVariant,
}) {
  const lineId = note.lines?.[0]?.id;
  const [type, setType] = useState(note.type);
  const [customLabel, setCustomLabel] = useState(note.custom_label || '');
  const [lines, setLines] = useState(() => ensureTrailingEmpty(toLineObjects(splitIntoLines(note.lines?.[0]?.text || ''))));
  const [syllableCountOn, setSyllableCountOn] = useState(true);
  const [focusModeOn, setFocusModeOn] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [variantSheetOpen, setVariantSheetOpen] = useState(false);
  const [baulOpen, setBaulOpen] = useState(false);
  const [noteMenuOpen, setNoteMenuOpen] = useState(false);
  // The live native text selection inside whichever row currently has one —
  // drives the Rima/Alternativa buttons in KeyboardAccessoryBar (disabled without one).
  const [selection, setSelection] = useState(null);
  // { mode: 'rhyme'|'ask', targetVerse: {text,before,after}, lineIndex } or
  // null — only ever opened from a real selection (see openPopover); the
  // toolbar's own "muse" icon is still a disabled stub, not wired to this.
  const [activePopover, setActivePopover] = useState(null);
  // { lineIndex, text } while a suggestion card is being dragged up into a
  // line (MusePopover's vertical drag-to-preview) — cleared on release
  // either way. Only the matching LineRow ever sees a non-null previewText.
  const [previewOverride, setPreviewOverride] = useState(null);
  // Which lines currently break the stanza's established rhyme scheme
  // (see rhyme.js's detectRhymeFriction) — recomputed on a line-complete
  // signal (blur, Enter-split, Backspace-merge), never on every keystroke,
  // via pendingFrictionCheckRef below.
  const [frictionFlags, setFrictionFlags] = useState([]);
  const pendingFrictionCheckRef = useRef(false);
  // Every voice memo for this note (one query), oldest first — drives the
  // "🎙 Àudios" bar at the bottom of the editor (NoteAudioBar).
  const [audioBySection, setAudioBySection] = useState([]);
  // True while a take is being recorded — the audio sheet collapses to just
  // a floating red stop button so the verse stays fully visible; hide the
  // FAB too, nothing else matters mid-take.
  const [audioRecording, setAudioRecording] = useState(false);
  // All word-variant rows for this block (one query, see loadWordVariants).
  // { variant, open: boolean } sheet state lives in wordVariantSheet below.
  const [wordVariants, setWordVariants] = useState([]);
  const [wordVariantSheet, setWordVariantSheet] = useState(null); // { variantId } | { draft: {lineIndex, before, text} }
  // Per-physical-line version log (line_history). `lineHistorySheet` = the
  // line index currently open in LineHistorySheet, or null.
  const [lineHistory, setLineHistory] = useState([]);
  const [lineHistorySheet, setLineHistorySheet] = useState(null);
  // Text a line held when it last gained focus — compared on blur to decide
  // whether the previous wording is worth logging to line_history.
  const focusBaselineRef = useRef({});
  // Multi-step session undo/redo — snapshots of the whole `lines` array.
  // Refs (not state) so pushing one mid-handler never schedules a render
  // race; a tick reducer re-renders just the header buttons' enabled state.
  const undoRef = useRef({ undo: [], redo: [] });
  const [, bumpUndoTick] = useReducer((n) => n + 1, 0);
  const typingCoalesceRef = useRef(null);
  const saveTimer = useRef(null);
  // Keyed by line id, not array index — see toLineObjects for why.
  const rowRefs = useRef({});
  // Where to place focus/caret after a structural edit (Enter-split,
  // Backspace-merge) actually commits — can't focus synchronously in the
  // same handler, the new/merged row doesn't exist in the DOM yet.
  const pendingFocusRef = useRef(null);
  // iOS Safari clears the textarea's selection and fires `blur` the instant
  // you tap the keyboard accessory bar — BEFORE the button's click lands,
  // and `onMouseDown` preventDefault (a desktop-only guarantee) doesn't stop
  // it there. So the blur teardown (drop `selection`, hide the bar) is
  // deferred one beat; a bar action fires inside that window and cancels it
  // (runBarAction), a real blur lets it run.
  const blurCleanupRef = useRef(null);

  useEffect(() => {
    setLines(ensureTrailingEmpty(toLineObjects(splitIntoLines(note.lines?.[0]?.text || ''))));
    setType(note.type);
    setCustomLabel(note.custom_label || '');
  }, [note.id]);

  useEffect(() => {
    let cancelled = false;
    loadNoteAudioFor(note.id).then(({ data }) => { if (!cancelled) setAudioBySection(data || []); });
    loadWordVariants(note.id).then(({ data }) => { if (!cancelled) setWordVariants(data || []); });
    loadLineHistory(note.id).then(({ data }) => { if (!cancelled) setLineHistory(data || []); });
    undoRef.current = { undo: [], redo: [] };
    focusBaselineRef.current = {};
    return () => { cancelled = true; };
  }, [note.id]);

  const handleAudioRecorded = useCallback((memo) => {
    if (memo) setAudioBySection((cur) => [...cur, memo]);
  }, []);
  const handleAudioDeleted = useCallback((id) => {
    setAudioBySection((cur) => cur.filter((m) => m.id !== id));
  }, []);
  const handleAudioRenamed = useCallback((id, title) => {
    renameNoteAudio(id, title);
    setAudioBySection((cur) => cur.map((m) => (m.id === id ? { ...m, title: title || null } : m)));
  }, []);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    const el = rowRefs.current[pending.id];
    if (el) {
      el.focus();
      el.setSelectionRange(pending.caret, pending.caret);
    }
  }, [lines]);

  const lineTexts = useMemo(() => lines.map((l) => l.text), [lines]);
  // A line addressed to the muse ("Musa, …") is a QUESTION, not lyric content:
  // it must not count toward the syllable meter or the rhyme scheme, and the
  // muse must not be shown it as part of "the verse so far". Blanked (not
  // dropped) here so the results stay index-aligned with `lines` for the gutter.
  const lyricLineTexts = useMemo(
    () => lineTexts.map((t) => (MUSE_COMMAND_RE.test(t) ? '' : t)),
    [lineTexts]
  );
  const rhymeLines = useMemo(
    () => classifyStanzaRhymes(lyricLineTexts, lyricLanguage || 'es', lyricDialect || 'central'),
    [lyricLineTexts, lyricLanguage, lyricDialect]
  );
  const syllableCounts = useMemo(
    () => lyricLineTexts.map((l) => (l ? lineMeter(l, lyricLanguage || 'es', lyricDialect || 'central') : null)),
    [lyricLineTexts, lyricLanguage, lyricDialect]
  );

  // Word-variant underline spans, re-resolved against the live line text on
  // every edit (a variant whose active wording no longer appears in the line
  // is simply not drawn — "detached", still listed in its sheet).
  const variantRangesByLine = useMemo(() => {
    const map = {};
    wordVariants.forEach((v) => {
      const text = lineTexts[v.line_index];
      if (text == null) return;
      const range = resolveVariantRange(v, text);
      if (range) (map[v.line_index] ??= []).push({ ...range, variantId: v.id });
    });
    return map;
  }, [wordVariants, lineTexts]);

  const lineHistoryByIndex = useMemo(() => {
    const map = {};
    lineHistory.forEach((h) => { (map[h.line_index] ??= []).push(h); });
    return map;
  }, [lineHistory]);

  // Only acts when a line-complete signal (blur/Enter/Backspace, see
  // pendingFrictionCheckRef's setters below) actually happened — rhymeLines
  // itself recomputes on every keystroke, but that alone must not flip the
  // gutter nudge on and off while the user is still mid-line.
  useEffect(() => {
    if (!pendingFrictionCheckRef.current) return;
    pendingFrictionCheckRef.current = false;
    setFrictionFlags(rhymeLines.map((_, i) => detectRhymeFriction(rhymeLines, i)));
  }, [rhymeLines]);

  // The trailing empty line (see ensureTrailingEmpty) is a local editing
  // affordance, not real content — stripped before it ever reaches the
  // parent's card-preview mirror or the DB, so saved text never picks up a
  // dangling newline from just having opened the editor.
  const persist = useCallback((nextLines) => {
    const content = nextLines[nextLines.length - 1].text === '' ? nextLines.slice(0, -1) : nextLines;
    const joined = content.map((l) => l.text).join('\n');
    onTextChange?.(note.id, joined);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (lineId) saveNoteText(lineId, joined);
    }, 500);
  }, [note.id, lineId, onTextChange]);

  // `persist` calls the parent's onTextChange, which sets state on
  // SongThreadScreen — that can never happen from inside a setLines
  // *updater function* (React may invoke updaters during a render pass,
  // which is exactly the "setState while rendering a different component"
  // warning). Computing `next` from the current `lines` closure and calling
  // setLines/persist as separate, ordinary statements avoids that; this is
  // a plain event handler, not a rapid-fire concurrent update, so reading
  // `lines` directly (not the functional-updater form) is safe here.
  // ─── Session undo / redo ──────────────────────────────────────────────────
  // Snapshot the CURRENT lines array before a mutation. `coalesce` groups a
  // burst of keystrokes into one step (~phrase granularity) instead of one
  // step per character.
  const pushUndo = useCallback((snapshot, { coalesce = false } = {}) => {
    if (coalesce) {
      if (typingCoalesceRef.current) {
        clearTimeout(typingCoalesceRef.current);
        typingCoalesceRef.current = setTimeout(() => { typingCoalesceRef.current = null; }, 600);
        return;
      }
      typingCoalesceRef.current = setTimeout(() => { typingCoalesceRef.current = null; }, 600);
    }
    const { undo } = undoRef.current;
    undo.push(snapshot);
    if (undo.length > 100) undo.shift();
    undoRef.current.redo = [];
    bumpUndoTick();
  }, []);

  const applyRestoredLines = useCallback((restored) => {
    setLines(ensureTrailingEmpty(restored));
    persist(restored);
    setSelection(null);
  }, [persist]);

  const handleUndo = useCallback(() => {
    const { undo, redo } = undoRef.current;
    if (!undo.length) return;
    redo.push(lines);
    applyRestoredLines(undo.pop());
    bumpUndoTick();
  }, [lines, applyRestoredLines]);

  const handleRedo = useCallback(() => {
    const { undo, redo } = undoRef.current;
    if (!redo.length) return;
    undo.push(lines);
    applyRestoredLines(redo.pop());
    bumpUndoTick();
  }, [lines, applyRestoredLines]);

  // ─── Per-line history capture ─────────────────────────────────────────────
  // Append `prevText` as the previous wording of physical line `lineIndex`,
  // unless it's blank or already the newest logged wording there.
  const logLineHistory = useCallback((lineIndex, prevText) => {
    const trimmed = (prevText || '').trim();
    if (!trimmed) return;
    const newest = lineHistory.find((h) => h.line_index === lineIndex);
    if (newest && newest.text === prevText) return;
    addLineHistory(note.id, lineIndex, prevText).then(({ data }) => {
      if (data) setLineHistory((cur) => [data, ...cur]);
    });
  }, [lineHistory, note.id]);

  const handleLineChange = useCallback((index, value) => {
    pushUndo(lines, { coalesce: true });
    const next = [...lines];
    next[index] = { ...next[index], text: value };
    setLines(ensureTrailingEmpty(next));
    persist(next);
  }, [lines, persist, pushUndo]);

  // MusePopover anchors directly under whichever line a turn is about —
  // measured once at open time (same "static snapshot" approach
  // SelectionCallout already uses for its own pill), not live-tracked.
  const getLineRect = useCallback((index) => {
    const id = lines[index]?.id;
    const el = id ? rowRefs.current[id] : null;
    return el ? el.getBoundingClientRect() : null;
  }, [lines]);

  // Cancels the deferred blur teardown — called by every keyboard-bar action
  // (via runBarAction) and by a refocus, both of which mean "that blur was
  // just the field handing off, don't tear anything down."
  const cancelBlurCleanup = useCallback(() => {
    clearTimeout(blurCleanupRef.current);
    blurCleanupRef.current = null;
  }, []);

  const runBarAction = useCallback((fn) => { cancelBlurCleanup(); fn(); }, [cancelBlurCleanup]);

  // Shared by onBlur (loses focus) and onFrictionTap's caller — a line is
  // "complete" enough to re-check its rhyme fit against the rest of the
  // stanza once the user has actually stepped away from it.
  const handleBlurLine = useCallback((index) => {
    // Defer dropping `selection` / hiding the bar: on iOS the blur beats the
    // accessory-bar button's click, and clearing `selection` here would make
    // Rima/Alternativa/Musa no-op (openPopover bails on !selection). If a bar
    // action fires it calls cancelBlurCleanup; otherwise this runs and the
    // bar goes away with the keyboard as before.
    clearTimeout(blurCleanupRef.current);
    blurCleanupRef.current = setTimeout(() => {
      blurCleanupRef.current = null;
      setSelection(null);
      setFocusedIndex((cur) => (cur === index ? null : cur));
    }, 300);
    pendingFrictionCheckRef.current = true;
    const line = lines[index];
    if (line) {
      const baseline = focusBaselineRef.current[line.id];
      if (baseline != null && baseline !== line.text) logLineHistory(index, baseline);
      focusBaselineRef.current[line.id] = line.text;
    }
  }, [lines, logLineHistory]);

  const handleRowFocus = useCallback((index) => {
    cancelBlurCleanup();
    setFocusedIndex(index);
    const line = lines[index];
    if (line && focusBaselineRef.current[line.id] == null) focusBaselineRef.current[line.id] = line.text;
  }, [lines, cancelBlurCleanup]);

  // Real editor behavior: Enter splits the line at the caret into two,
  // moving whatever was after the caret down to a new line, caret at its
  // start — not just "move focus to the next row" (the earlier, simplified
  // version of this screen). Checked first: a line starting with the
  // "Musa" wake word (design ref, 2026-08-10) is a command, not lyric
  // content, so Enter there opens the muse instead of splitting.
  const handleEnter = useCallback((index, caretPos) => {
    pushUndo(lines);
    const line = lines[index];
    const command = line.text.match(MUSE_COMMAND_RE);
    if (command) {
      const message = line.text.slice(command[0].length).trim();
      if (message) {
        const anchorLineIndex = Math.max(0, index - 1);
        const anchorRect = getLineRect(anchorLineIndex);
        const next = [...lines];
        next.splice(index, 1); // the command line was never lyric content
        setLines(ensureTrailingEmpty(next));
        persist(next);
        // originIsReal: false — anchorLineIndex (index - 1) is a pure
        // positioning fallback ("put the popover somewhere sensible on
        // screen"), not a genuine claim that this turn is ABOUT that line.
        // A typed "Musa, ..." command on an empty/blank line often has
        // nothing to do with whatever happens to sit physically above it —
        // highlighting that line and pointing at it (see LineRow's
        // museOrigin / MusePopover's pointer) would visually lie about what
        // the question actually references. lineIndex itself stays set
        // (still needed functionally — it's where "insert below" lands a
        // reply), only the visual origin treatment is gated off.
        setActivePopover({ mode: 'ask', targetVerse: null, lineIndex: anchorLineIndex, originIsReal: false, seedMessage: message, anchorRect });
        return;
      }
    }
    const before = line.text.slice(0, caretPos);
    const after = line.text.slice(caretPos);
    const next = [...lines];
    next[index] = { ...line, text: before };
    const newLine = { id: crypto.randomUUID(), text: after };
    next.splice(index + 1, 0, newLine);
    setLines(ensureTrailingEmpty(next));
    persist(next);
    pendingFocusRef.current = { id: newLine.id, caret: 0 };
    pendingFrictionCheckRef.current = true;
  }, [lines, persist, getLineRect, pushUndo]);

  // The other half of Enter's symmetry: Backspace at the very start of a
  // line (collapsed caret, not deleting a selection) merges it into the
  // end of the previous line and removes this row — including from the
  // trailing placeholder itself, which is exactly "undo the Enter that
  // created it" and lands the caret back where that Enter was pressed.
  const handleBackspaceAtStart = useCallback((index) => {
    if (index === 0) return;
    pushUndo(lines);
    const prev = lines[index - 1];
    const cur = lines[index];
    const caret = prev.text.length;
    const next = [...lines];
    next[index - 1] = { ...prev, text: prev.text + cur.text };
    next.splice(index, 1);
    setLines(ensureTrailingEmpty(next));
    persist(next);
    pendingFocusRef.current = { id: prev.id, caret };
    pendingFrictionCheckRef.current = true;
  }, [lines, persist, pushUndo]);

  // Inserting a whole new line (not splitting an existing one) — used by
  // the muse popover's "Insert below" action, same splice shape as
  // handleEnter but without touching the line it's inserted after.
  const handleInsertLineAfter = useCallback((index, text) => {
    pushUndo(lines);
    const next = [...lines];
    next.splice(index + 1, 0, { id: crypto.randomUUID(), text });
    setLines(ensureTrailingEmpty(next));
    persist(next);
  }, [lines, persist, pushUndo]);

  // KeyboardAccessoryBar → Rima. Only enabled with a real text selection.
  const openPopover = useCallback((mode) => {
    if (!selection) return;
    setActivePopover({
      mode,
      targetVerse: { text: selection.text, before: selection.before, after: selection.after },
      lineIndex: selection.lineIndex,
      originIsReal: true,
      anchorRect: getLineRect(selection.lineIndex),
    });
    setSelection(null);
    setFocusedIndex(null); // the popover owns the screen now; keyboard's gone
  }, [selection, getLineRect]);

  // KeyboardAccessoryBar → Musa. With a selection it goes in as the muse's
  // context (targetVerse); without one the turn is about the whole note.
  const handleAskMuse = useCallback(() => {
    const idx = selection?.lineIndex ?? focusedIndex ?? 0;
    setActivePopover({
      mode: 'ask',
      targetVerse: selection ? { text: selection.text, before: selection.before, after: selection.after } : null,
      lineIndex: idx,
      originIsReal: !!selection,
      anchorRect: getLineRect(idx),
    });
    setSelection(null);
    setFocusedIndex(null);
  }, [selection, focusedIndex, getLineRect]);

  // ─── Word-variant alternatives ────────────────────────────────────────────
  // KeyboardAccessoryBar → Alternativa. Attaches an alternative wording to
  // the current selection (one word or a phrase).
  const handleAddVariantFromSelection = useCallback(() => {
    const target = selection;
    if (!target || !target.text.trim()) return;
    setWordVariantSheet({ draft: { lineIndex: target.lineIndex, before: target.before, text: target.text } });
    setSelection(null);
    setFocusedIndex(null);
  }, [selection]);

  // KeyboardAccessoryBar → Ángulo cultural. Opens the muse straight into the
  // cultural-provocation flow (a refrán / trope / archetype to react to),
  // with the selected phrase as the concept. Only reachable with a
  // selection — it used to be a stray chip under every SOCRATIC answer.
  const handleCultureFromSelection = useCallback(() => {
    if (!selection) return;
    setActivePopover({
      mode: 'provocation',
      targetVerse: { text: selection.text, before: selection.before, after: selection.after },
      lineIndex: selection.lineIndex,
      originIsReal: true,
      anchorRect: getLineRect(selection.lineIndex),
    });
    setSelection(null);
    setFocusedIndex(null);
  }, [selection, getLineRect]);

  const handleVariantTap = useCallback((variantId) => {
    setWordVariantSheet({ variantId });
  }, []);

  const handleCreateWordVariant = useCallback(async (draft, options) => {
    const { data, error } = await addWordVariant(note.id, draft.lineIndex, options, draft.before, 0);
    if (!error && data) setWordVariants((cur) => [...cur, data]);
    setWordVariantSheet(null);
  }, [note.id]);

  // Swap which wording sits in the line. `nextOptions` may also carry edits
  // to the options list itself (rename/add/remove from the manage sheet).
  const handleSaveWordVariant = useCallback(async (variant, nextOptions, nextActiveIndex) => {
    const lineText = lines[variant.line_index]?.text ?? '';
    const range = resolveVariantRange(variant, lineText);
    const nextActive = nextOptions[nextActiveIndex] ?? '';
    if (range && nextActive && lineText.slice(range.start, range.end) !== nextActive) {
      pushUndo(lines);
      logLineHistory(variant.line_index, lineText);
      const nextText = lineText.slice(0, range.start) + nextActive + lineText.slice(range.end);
      const next = [...lines];
      next[variant.line_index] = { ...next[variant.line_index], text: nextText };
      setLines(ensureTrailingEmpty(next));
      persist(next);
    }
    const { data } = await updateWordVariant(variant.id, { options: nextOptions, active_index: nextActiveIndex });
    setWordVariants((cur) => cur.map((v) => (v.id === variant.id ? (data || { ...v, options: nextOptions, active_index: nextActiveIndex }) : v)));
    setWordVariantSheet(null);
  }, [lines, persist, pushUndo, logLineHistory]);

  const handleDeleteWordVariant = useCallback(async (variant) => {
    await deleteWordVariant(variant.id);
    setWordVariants((cur) => cur.filter((v) => v.id !== variant.id));
    setWordVariantSheet(null);
  }, []);

  // ─── Per-line history sheet ───────────────────────────────────────────────
  const handleHistoryTap = useCallback((index) => setLineHistorySheet(index), []);

  // Restore mirrors canvasData.restoreVersion: log what we're about to
  // overwrite, then swap the old wording back in.
  const handleRestoreLineHistory = useCallback((index, entry) => {
    const current = lines[index]?.text ?? '';
    if (current === entry.text) { setLineHistorySheet(null); return; }
    pushUndo(lines);
    logLineHistory(index, current);
    const next = [...lines];
    next[index] = { ...next[index], text: entry.text };
    setLines(ensureTrailingEmpty(next));
    persist(next);
    setLineHistorySheet(null);
  }, [lines, persist, pushUndo, logLineHistory]);

  const handleDeleteLineHistoryEntry = useCallback(async (entry) => {
    await deleteLineHistory(entry.id);
    setLineHistory((cur) => cur.filter((h) => h.id !== entry.id));
  }, []);

  // The friction nudge's tap target (LineRow's gutter icon) — content-
  // driven Socratic entry, see rhyme.js's detectRhymeFriction. No forced
  // mode: left to the model's own judgment same as any other "ask" turn,
  // just seeded with the concrete observation so it doesn't have to
  // re-derive it.
  const handleFrictionTap = useCallback((index) => {
    setActivePopover({
      mode: 'ask',
      targetVerse: null,
      lineIndex: index,
      originIsReal: true, // the exact line whose rhyme broke — genuine reference even without a text selection
      seedMessage: 'este verso no encaja con el esquema de rima de la parte — ¿alguna idea?',
      anchorRect: getLineRect(index),
    });
  }, [getLineRect]);

  // Accepting a muse suggestion force-overwrites the textarea's controlled
  // value with no real keystroke behind it — which silently clears the
  // browser's own undo stack for that field (shake-to-undo/Ctrl+Z do
  // nothing afterward), and unlike desktop's promoteVariant/restoreVersion
  // (canvasData.js), nothing here snapshots to section_versions first. A
  // few real lines of the artist's own writing could vanish with no way
  // back. Apple HIG's "Selection and input" is explicit that custom edit
  // commands need undo/redo support — this is the minimal real version of
  // that: a plain in-memory "last replacement," restorable for a few
  // seconds via a snackbar, no new table/round trip needed.
  const [lastReplacement, setLastReplacement] = useState(null); // {lineIndex, previousText}
  const undoTimerRef = useRef(null);

  useEffect(() => () => { clearTimeout(undoTimerRef.current); clearTimeout(blurCleanupRef.current); }, []);

  const handlePopoverReplace = useCallback((newText) => {
    if (!activePopover?.targetVerse) return;
    const { targetVerse, lineIndex } = activePopover;
    const previousText = lines[lineIndex]?.text ?? '';
    pushUndo(lines);
    logLineHistory(lineIndex, previousText);
    const nextLines = [...lines];
    nextLines[lineIndex] = { ...nextLines[lineIndex], text: targetVerse.before + newText + targetVerse.after };
    setLines(ensureTrailingEmpty(nextLines));
    persist(nextLines);
    clearTimeout(undoTimerRef.current);
    setLastReplacement({ lineIndex, previousText });
    undoTimerRef.current = setTimeout(() => setLastReplacement(null), 6000);
  }, [activePopover, handleLineChange, lines, persist, pushUndo, logLineHistory]);

  const handleUndoReplace = useCallback(() => {
    if (!lastReplacement) return;
    clearTimeout(undoTimerRef.current);
    handleLineChange(lastReplacement.lineIndex, lastReplacement.previousText);
    setLastReplacement(null);
  }, [lastReplacement, handleLineChange]);

  const handlePopoverInsertBelow = useCallback((newText) => {
    if (!activePopover) return;
    handleInsertLineAfter(activePopover.lineIndex, newText);
  }, [activePopover, handleInsertLineAfter]);

  const handlePopoverPreviewText = useCallback((text) => {
    setPreviewOverride(text != null && activePopover ? { lineIndex: activePopover.lineIndex, text } : null);
  }, [activePopover]);

  const handlePopoverClose = useCallback(() => {
    setActivePopover(null);
    setPreviewOverride(null);
  }, []);

  const handleTypeChange = useCallback((e) => {
    const val = e.target.value;
    setType(val);
    const label = val === 'custom' ? customLabel : null;
    saveNoteType(note.id, val, label);
    onTypeChange?.(note.id, val, label);
  }, [note.id, customLabel, onTypeChange]);

  const handleDelete = useCallback(async () => {
    if (!confirm('¿Eliminar esta parte?')) return;
    await deleteNote(note.id);
    onDeleted?.(note.id);
  }, [note.id, onDeleted]);

  // What the muse (and the whole-verse tools) sees as "the verse" — muse
  // command lines stripped out entirely, they're not part of the lyric.
  const currentText = lineTexts.filter((t) => !MUSE_COMMAND_RE.test(t)).join('\n');

  // Single source of truth for "some full-width bottom surface is open" — the
  // muse sheet, the "···" menu, Tools, Baúl, Variant, word-variant or
  // line-history sheet. The keyboard bar, the FAB and the audio bar all check
  // this so nothing ever stacks over an open sheet.
  const anyOverlayOpen = Boolean(
    activePopover || noteMenuOpen || toolsOpen || baulOpen || variantSheetOpen
    || wordVariantSheet || lineHistorySheet != null,
  );

  return (
    <MobileScreen className="ne-screen">
      <div className="ne-body">
        <div className="ne-header">
          <button className="ne-back" onClick={onClose} title="volver"><IcChevronLeft size={24} /></button>
          <select value={type} onChange={handleTypeChange} className="ne-type-select">
            {SECTION_TYPES.map((t) => <option key={t} value={t}>{SECTION_TYPE_LABELS[t] || t}</option>)}
          </select>
          {type === 'custom' && (
            <input
              className="ne-custom-label"
              value={customLabel}
              placeholder="etiqueta…"
              onChange={(e) => setCustomLabel(e.target.value)}
              onBlur={() => saveNoteType(note.id, type, customLabel)}
            />
          )}
          <TempoPulse bpm={bpm} />
          <button className="ne-menu-btn" onClick={() => setNoteMenuOpen(true)} title="más"><IcMore size={20} /></button>
          <button className="ne-done" onClick={onClose}>Hecho</button>
        </div>

        <div className="ne-sheet">
        {lines.map((line, i) => (
          <LineRow
            key={line.id}
            id={line.id}
            index={i}
            text={line.text}
            previewText={previewOverride?.lineIndex === i ? previewOverride.text : null}
            syllables={syllableCounts[i]}
            rhyme={rhymeLines[i]}
            friction={frictionFlags[i]}
            showSyllables={syllableCountOn}
            showPlaceholder={i === lines.length - 1}
            dimmed={focusModeOn && focusedIndex !== null && focusedIndex !== i}
            variantRanges={variantRangesByLine[i]}
            hasHistory={lineHistoryByIndex[i]?.length > 0}
            onChange={handleLineChange}
            onEnter={handleEnter}
            onBackspaceAtStart={handleBackspaceAtStart}
            onFocus={handleRowFocus}
            onBlurLine={handleBlurLine}
            onSelectionChange={setSelection}
            onFrictionTap={handleFrictionTap}
            onVariantTap={handleVariantTap}
            onHistoryTap={handleHistoryTap}
            inputRef={(id, el) => {
              if (el) rowRefs.current[id] = el;
              else delete rowRefs.current[id];
            }}
          />
        ))}
        </div>
      </div>

      {/* The one bar docked above the keyboard while editing a line. Rima
          and Alternativa go disabled when there's no text selection. */}
      {focusedIndex != null && !anyOverlayOpen && (
        <KeyboardAccessoryBar
          syllablesOn={syllableCountOn}
          hasSelection={!!selection}
          canUndo={undoRef.current.undo.length > 0}
          canRedo={undoRef.current.redo.length > 0}
          onToggleSyllables={() => runBarAction(() => setSyllableCountOn((v) => !v))}
          onMuse={() => runBarAction(handleAskMuse)}
          onRhyme={() => runBarAction(() => openPopover('rhyme'))}
          onAlternative={() => runBarAction(handleAddVariantFromSelection)}
          onCulture={() => runBarAction(handleCultureFromSelection)}
          onUndo={() => runBarAction(handleUndo)}
          onRedo={() => runBarAction(handleRedo)}
        />
      )}

      {activePopover && (
        <MusePopover
          mode={activePopover.mode}
          targetVerse={activePopover.targetVerse}
          seedMessage={activePopover.seedMessage}
          verseText={currentText}
          noteFunction={customLabel || type}
          lyricDna={lyricDna}
          lyricLanguage={lyricLanguage}
          lyricDialect={lyricDialect}
          songStructure={songStructure}
          songId={songId}
          sectionId={note.id}
          anchorRect={activePopover.anchorRect}
          originIsReal={Boolean(activePopover.originIsReal)}
          onClose={handlePopoverClose}
          onReplace={handlePopoverReplace}
          onInsertBelow={handlePopoverInsertBelow}
          onPreviewText={handlePopoverPreviewText}
        />
      )}

      {lastReplacement && !anyOverlayOpen && (
        <div className="ne-undo-toast">
          <span>Verso reemplazado</span>
          <button onClick={handleUndoReplace}>Deshacer</button>
        </div>
      )}

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

      {lineHistorySheet != null && (
        <LineHistorySheet
          entries={lineHistoryByIndex[lineHistorySheet] || []}
          currentText={lines[lineHistorySheet]?.text ?? ''}
          onRestore={(entry) => handleRestoreLineHistory(lineHistorySheet, entry)}
          onDelete={handleDeleteLineHistoryEntry}
          onClose={() => setLineHistorySheet(null)}
        />
      )}

      {noteMenuOpen && (
        <div className="ts-backdrop" onClick={() => setNoteMenuOpen(false)}>
          <div className="ts-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ts-grabber" />
            <button
              className="ts-row ts-row-danger"
              onClick={() => { setNoteMenuOpen(false); handleDelete(); }}
            >
              <span className="ts-row-icon"><IcTrash size={20} /></span>
              <div className="ts-row-main">
                <div className="ts-row-label">Eliminar esta parte</div>
                <div className="ts-row-sublabel">no se puede deshacer</div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* FAB (Baúl / Herramientas / Variante). Hidden while a word is
          selected (focused single-purpose moment), while recording, or while
          any bottom sheet owns the space (anyOverlayOpen). */}
      {!selection && !audioRecording && !anyOverlayOpen && (
        <FabMenu
          pills={[
            { label: 'Baúl de la inspiración', icon: <IcMuse size={18} />, dark: true, onClick: () => setBaulOpen(true) },
            { label: 'Herramientas', icon: <IcTools size={18} />, iconVariant: 'chord', onClick: () => setToolsOpen(true) },
            { label: 'Variante', icon: <IcPencil size={18} />, iconVariant: 'thread', onClick: () => setVariantSheetOpen(true) },
          ]}
        />
      )}

      {/* Always-present voice-memo affordance (see NoteAudioBar). Kept
          mounted while recording (it becomes the floating red stop button);
          hidden while a selection is active or any other bottom sheet is
          open, so it never stacks over another surface. */}
      {(audioRecording || (!selection && !anyOverlayOpen)) && (
        <NoteAudioBar
          sectionId={note.id}
          songId={songId}
          memos={audioBySection}
          onRecorded={handleAudioRecorded}
          onDeleted={handleAudioDeleted}
          onRenamed={handleAudioRenamed}
          onRecordingChange={setAudioRecording}
        />
      )}

      {variantSheetOpen && (
        <VariantChoiceSheet
          onClose={() => setVariantSheetOpen(false)}
          onChoose={(startWithCurrentText) => {
            setVariantSheetOpen(false);
            onCreateVariant?.(startWithCurrentText);
          }}
        />
      )}

      {baulOpen && (
        <BaulSheet
          songId={songId}
          lyricDna={lyricDna}
          onLyricDnaUpdated={onLyricDnaUpdated}
          onClose={() => setBaulOpen(false)}
        />
      )}

      <ToolsSheet
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        lineId={lineId}
        userId={userId}
        noteText={currentText}
        chordSummary={chordSummary}
        syllableCountOn={syllableCountOn}
        onToggleSyllableCount={() => setSyllableCountOn((v) => !v)}
        focusModeOn={focusModeOn}
        onToggleFocusMode={() => setFocusModeOn((v) => !v)}
      />
    </MobileScreen>
  );
}
