import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { SECTION_TYPES, saveNoteText, saveNoteType, deleteNote } from '../canvas/canvasData.js';
import { splitIntoLines } from '../utils/textLines.js';
import { classifyStanzaRhymes, detectRhymeFriction } from '../utils/rhyme.js';
import { countLineSyllables } from '../utils/syllables.js';
import MobileScreen from './MobileScreen.jsx';
import ToolsSheet from './ToolsSheet.jsx';
import SelectionCallout from './SelectionCallout.jsx';
import MusePopover from './MusePopover.jsx';
import FabMenu from './FabMenu.jsx';
import VariantChoiceSheet from './VariantChoiceSheet.jsx';
import BaulSheet from './BaulSheet.jsx';
import TempoPulse from './TempoPulse.jsx';
import AudioRecorderSheet from './AudioRecorderSheet.jsx';
import LineAudioBadge from './LineAudioBadge.jsx';
import { loadLineAudioFor } from '../canvas/lineAudioData.js';

// Long-press duration to open the voice-memo recorder — fast enough to
// feel deliberate-but-quick (this is "hold to talk," not "hold to reveal a
// hidden menu"), slower than any normal tap/scroll gesture would ever
// register as. See LineRow's onTouchStart/Move/End below.
const LONG_PRESS_MS = 400;
const LONG_PRESS_MOVE_TOLERANCE = 10;

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
  id, index, text, previewText, syllables, rhyme, friction, audioMemos, showSyllables, dimmed, showPlaceholder,
  onChange, onEnter, onBackspaceAtStart, onFocus, onBlurLine, onSelectionChange, onFrictionTap, onLongPress, inputRef,
}) {
  // Live, not just on submit — the moment the line reads as addressing the
  // muse (the wake word + its disambiguating comma/colon typed), the row's
  // whole visual identity changes: it's no longer lyric content being
  // composed, it's a message being drafted, and the container should look
  // like it before Enter ever commits anything.
  const isMuseCommand = MUSE_COMMAND_RE.test(text);
  const localRef = useRef(null);
  // Long-press-to-record — timer lives on the ROW, not the textarea, so it
  // doesn't fight the textarea's own native touch handling (tap-to-focus,
  // caret placement, drag-select); a move past a small tolerance or an
  // early release just cancels the pending timer, same disambiguation
  // shape as MusePopover's card gestures.
  const holdTimerRef = useRef(null);
  const holdStartRef = useRef({ x: 0, y: 0 });

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
  }, []);

  const handleRowTouchStart = useCallback((e) => {
    if (!e.touches || e.touches.length !== 1) return;
    holdStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    clearHoldTimer();
    holdTimerRef.current = setTimeout(() => onLongPress(index), LONG_PRESS_MS);
  }, [index, onLongPress, clearHoldTimer]);

  const handleRowTouchMove = useCallback((e) => {
    if (!holdTimerRef.current || !e.touches) return;
    const dx = e.touches[0].clientX - holdStartRef.current.x;
    const dy = e.touches[0].clientY - holdStartRef.current.y;
    if (Math.abs(dx) > LONG_PRESS_MOVE_TOLERANCE || Math.abs(dy) > LONG_PRESS_MOVE_TOLERANCE) clearHoldTimer();
  }, [clearHoldTimer]);

  useEffect(() => clearHoldTimer, [clearHoldTimer]);
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

  // Fires on drag-select and shift+arrow selection — the SelectionCallout's
  // entry point. Each row is already exactly one logical line, so unlike
  // desktop's TextNoteNode (one textarea holding the whole multi-line note)
  // there's no need to work out which physical line a selection fell in.
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
      rect: e.target.getBoundingClientRect(),
    });
  }, [text, index, onSelectionChange]);

  return (
    <div
      className={`ne-row${dimmed ? ' ne-row-dimmed' : ''}${isMuseCommand ? ' ne-row-muse' : ''}${previewText != null ? ' ne-row-preview' : ''}`}
      onTouchStart={handleRowTouchStart}
      onTouchMove={handleRowTouchMove}
      onTouchEnd={clearHoldTimer}
      onTouchCancel={clearHoldTimer}
    >
      <div className="ne-gutter">
        {/* Syllables/rhyme are lyric-craft metrics — meaningless once this
            row has switched to "message to the muse," so they're hidden
            rather than showing a stale/nonsense reading. */}
        {!isMuseCommand && showSyllables && syllables != null && <span className="ne-gutter-count">{syllables}</span>}
        {!isMuseCommand && rhyme?.letter && <span className={`ne-gutter-letter ${rhyme.type}`}>{rhyme.letter}</span>}
        {isMuseCommand && <span className="ne-gutter-muse-icon">✦</span>}
        {/* Content-driven Socratic nudge — this line broke the stanza's
            established rhyme scheme (see rhyme.js's detectRhymeFriction).
            Purely local, no API call until tapped — no idle timer anywhere
            in this screen, the writer gets to think in silence. */}
        {!isMuseCommand && friction && (
          <button className="ne-gutter-friction" title="this line breaks the rhyme scheme — ask the muse?" onClick={() => onFrictionTap(index)}>✦</button>
        )}
        {!isMuseCommand && audioMemos?.length > 0 && <LineAudioBadge memos={audioMemos} />}
      </div>
      <textarea
        ref={setRefs}
        className="ne-line-input"
        rows={1}
        value={displayedText}
        readOnly={previewText != null}
        placeholder={showPlaceholder ? 'write the next line…' : ''}
        onChange={handleInput}
        onFocus={() => onFocus(index)}
        onSelect={handleSelect}
        onBlur={() => onBlurLine(index)}
        onKeyDown={handleKeyDown}
      />
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
  // The live text selection inside whichever row currently has one — drives
  // SelectionCallout. Separate from `activePopover` below: the callout
  // disappears the instant a popover opens (see openPopover), it doesn't
  // need to survive alongside it.
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
  // Which line index is currently being recorded — opens AudioRecorderSheet
  // for that line. null when the sheet is closed.
  const [recordingIndex, setRecordingIndex] = useState(null);
  // All voice memos for this whole block (one query, see loadLineAudioFor),
  // grouped by line_index below for the per-row badge — line_index is a
  // position snapshot, not a stable id, see line_audio's schema comment.
  const [audioBySection, setAudioBySection] = useState([]);
  const saveTimer = useRef(null);
  // Keyed by line id, not array index — see toLineObjects for why.
  const rowRefs = useRef({});
  // Where to place focus/caret after a structural edit (Enter-split,
  // Backspace-merge) actually commits — can't focus synchronously in the
  // same handler, the new/merged row doesn't exist in the DOM yet.
  const pendingFocusRef = useRef(null);

  useEffect(() => {
    setLines(ensureTrailingEmpty(toLineObjects(splitIntoLines(note.lines?.[0]?.text || ''))));
    setType(note.type);
    setCustomLabel(note.custom_label || '');
  }, [note.id]);

  useEffect(() => {
    let cancelled = false;
    loadLineAudioFor(note.id).then(({ data }) => { if (!cancelled) setAudioBySection(data || []); });
    return () => { cancelled = true; };
  }, [note.id]);

  const audioByLineIndex = useMemo(() => {
    const map = {};
    audioBySection.forEach((memo) => {
      (map[memo.line_index] ??= []).push(memo);
    });
    return map;
  }, [audioBySection]);

  const handleLongPress = useCallback((index) => {
    if (MUSE_COMMAND_RE.test(lines[index]?.text || '')) return; // a message being drafted, not a lyric line to voice-memo
    setRecordingIndex(index);
  }, [lines]);

  const handleAudioSaved = useCallback((memo) => {
    if (memo) setAudioBySection((cur) => [...cur, memo]);
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
  const rhymeLines = useMemo(
    () => classifyStanzaRhymes(lineTexts, lyricLanguage || 'es', lyricDialect || 'central'),
    [lineTexts, lyricLanguage, lyricDialect]
  );
  const syllableCounts = useMemo(
    () => lineTexts.map((l) => (l ? countLineSyllables(l, lyricLanguage || 'es') : null)),
    [lineTexts, lyricLanguage]
  );

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
  const handleLineChange = useCallback((index, value) => {
    const next = [...lines];
    next[index] = { ...next[index], text: value };
    setLines(ensureTrailingEmpty(next));
    persist(next);
  }, [lines, persist]);

  // MusePopover anchors directly under whichever line a turn is about —
  // measured once at open time (same "static snapshot" approach
  // SelectionCallout already uses for its own pill), not live-tracked.
  const getLineRect = useCallback((index) => {
    const id = lines[index]?.id;
    const el = id ? rowRefs.current[id] : null;
    return el ? el.getBoundingClientRect() : null;
  }, [lines]);

  // Shared by onBlur (loses focus) and onFrictionTap's caller — a line is
  // "complete" enough to re-check its rhyme fit against the rest of the
  // stanza once the user has actually stepped away from it.
  const handleBlurLine = useCallback(() => {
    setSelection(null);
    pendingFrictionCheckRef.current = true;
  }, []);

  // Real editor behavior: Enter splits the line at the caret into two,
  // moving whatever was after the caret down to a new line, caret at its
  // start — not just "move focus to the next row" (the earlier, simplified
  // version of this screen). Checked first: a line starting with the
  // "Musa" wake word (design ref, 2026-08-10) is a command, not lyric
  // content, so Enter there opens the muse instead of splitting.
  const handleEnter = useCallback((index, caretPos) => {
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
        setActivePopover({ mode: 'ask', targetVerse: null, lineIndex: anchorLineIndex, seedMessage: message, anchorRect });
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
  }, [lines, persist, getLineRect]);

  // The other half of Enter's symmetry: Backspace at the very start of a
  // line (collapsed caret, not deleting a selection) merges it into the
  // end of the previous line and removes this row — including from the
  // trailing placeholder itself, which is exactly "undo the Enter that
  // created it" and lands the caret back where that Enter was pressed.
  const handleBackspaceAtStart = useCallback((index) => {
    if (index === 0) return;
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
  }, [lines, persist]);

  // Inserting a whole new line (not splitting an existing one) — used by
  // the muse popover's "Insert below" action, same splice shape as
  // handleEnter but without touching the line it's inserted after.
  const handleInsertLineAfter = useCallback((index, text) => {
    const next = [...lines];
    next.splice(index + 1, 0, { id: crypto.randomUUID(), text });
    setLines(ensureTrailingEmpty(next));
    persist(next);
  }, [lines, persist]);

  const openPopover = useCallback((mode) => {
    if (!selection) return;
    setActivePopover({
      mode,
      targetVerse: { text: selection.text, before: selection.before, after: selection.after },
      lineIndex: selection.lineIndex,
      anchorRect: selection.rect,
    });
    setSelection(null);
  }, [selection]);

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
      seedMessage: 'esta línea no encaja con el esquema de rima del bloque — ¿alguna idea?',
      anchorRect: getLineRect(index),
    });
  }, [getLineRect]);

  const handlePopoverReplace = useCallback((newText) => {
    if (!activePopover?.targetVerse) return;
    const { targetVerse, lineIndex } = activePopover;
    handleLineChange(lineIndex, targetVerse.before + newText + targetVerse.after);
  }, [activePopover, handleLineChange]);

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
    if (!confirm('Delete this note?')) return;
    await deleteNote(note.id);
    onDeleted?.(note.id);
  }, [note.id, onDeleted]);

  const currentText = lineTexts.join('\n');

  return (
    <MobileScreen className="ne-screen">
      <div className="ne-header">
        <button className="ne-back" onClick={onClose} title="back">‹</button>
        <select value={type} onChange={handleTypeChange} className="canvas-note-type">
          {SECTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {type === 'custom' && (
          <input
            className="ne-custom-label"
            value={customLabel}
            placeholder="label…"
            onChange={(e) => setCustomLabel(e.target.value)}
            onBlur={() => saveNoteType(note.id, type, customLabel)}
          />
        )}
        <TempoPulse bpm={bpm} />
        <button className="ne-menu" onClick={handleDelete} title="delete note">···</button>
        <button className="ne-done" onClick={onClose}>Done</button>
      </div>

      <div className="ne-body">
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
            audioMemos={audioByLineIndex[i]}
            showSyllables={syllableCountOn}
            showPlaceholder={i === lines.length - 1}
            dimmed={focusModeOn && focusedIndex !== null && focusedIndex !== i}
            onChange={handleLineChange}
            onEnter={handleEnter}
            onBackspaceAtStart={handleBackspaceAtStart}
            onFocus={setFocusedIndex}
            onBlurLine={handleBlurLine}
            onSelectionChange={setSelection}
            onFrictionTap={handleFrictionTap}
            onLongPress={handleLongPress}
            inputRef={(id, el) => {
              if (el) rowRefs.current[id] = el;
              else delete rowRefs.current[id];
            }}
          />
        ))}
      </div>

      {selection && (
        <SelectionCallout
          rect={selection.rect}
          onRhyme={() => openPopover('rhyme')}
          onConcept={() => openPopover('concept')}
          onAskMuse={() => openPopover('ask')}
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
          onClose={handlePopoverClose}
          onReplace={handlePopoverReplace}
          onInsertBelow={handlePopoverInsertBelow}
          onPreviewText={handlePopoverPreviewText}
        />
      )}

      {recordingIndex != null && (
        <AudioRecorderSheet
          sectionId={note.id}
          songId={songId}
          lineIndex={recordingIndex}
          onClose={() => setRecordingIndex(null)}
          onSaved={handleAudioSaved}
        />
      )}

      {/* Replaces the old fixed chords/muse/tools bar — muse already lives
          as a contextual action on text selection (SelectionCallout) and
          the inline "Musa," wake word, chords already lives inside the
          Tools drawer ("Assign chords" row), so neither needed its own
          icon here anymore. "Variant" only shows up here, never on the
          song-thread FAB — creating a variant only makes sense from
          inside an existing note. */}
      <FabMenu
        pills={[
          { label: 'Baúl de la inspiración', icon: '✦', dark: true, onClick: () => setBaulOpen(true) },
          { label: 'Tools', icon: '☰', iconVariant: 'chord', onClick: () => setToolsOpen(true) },
          { label: 'Variant', icon: '✎', iconVariant: 'thread', onClick: () => setVariantSheetOpen(true) },
        ]}
      />

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
