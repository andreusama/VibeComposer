import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useReducer, useRef } from 'react';
import { SECTION_TYPES, saveNoteText, saveNoteType, deleteNote } from '../canvas/canvasData.js';
import { splitIntoLines } from '../utils/textLines.js';
import { classifyStanzaRhymes, detectRhymeFriction, lineMeter } from '../utils/rhyme.js';
import MobileScreen from './MobileScreen.jsx';
import ToolsSheet from './ToolsSheet.jsx';
import SelectionCallout from './SelectionCallout.jsx';
import LineRangeCallout from './LineRangeCallout.jsx';
import MusePopover from './MusePopover.jsx';
import FabMenu from './FabMenu.jsx';
import VariantChoiceSheet from './VariantChoiceSheet.jsx';
import BaulSheet from './BaulSheet.jsx';
import TempoPulse from './TempoPulse.jsx';
import AudioRecorderSheet from './AudioRecorderSheet.jsx';
import LineAudioBadge from './LineAudioBadge.jsx';
import { loadLineAudioFor } from '../canvas/lineAudioData.js';
import { loadWordVariants, addWordVariant, updateWordVariant, deleteWordVariant, resolveVariantRange } from '../canvas/wordVariantData.js';
import LineHighlight from '../components/LineHighlight.jsx';
import WordVariantSheet from './WordVariantSheet.jsx';
import { loadLineHistory, addLineHistory, deleteLineHistory } from '../canvas/lineHistoryData.js';
import LineHistorySheet from './LineHistorySheet.jsx';

// Long-press duration to open the voice-memo recorder (gutter) or select a
// word (the line's own text, see handleTextTouchStart below) — fast enough
// to feel deliberate-but-quick ("hold to act," not "hold to reveal a hidden
// menu"), slower than any normal tap/scroll gesture would ever register as.
// Shared by both gestures, and deliberately faster than iOS's own ~500ms+
// text-interaction gesture (loupe/selection) so ours reliably wins the race.
const LONG_PRESS_MS = 400;
const LONG_PRESS_MOVE_TOLERANCE = 10;

// A word, for long-press-to-select purposes: anything that isn't whitespace
// or sentence punctuation — deliberately NOT an [a-zA-Z] allowlist, so
// accented letters and apostrophes (Catalan/Spanish lyrics: "anem", "d'octubre",
// "l'aire") count as part of a word instead of splitting it.
const WORD_CHAR_RE = /[^\s.,;:!?¿¡()«»"“”—–\-]/;

// Expands a raw character index out to the word it falls inside (or null if
// it lands on whitespace/punctuation with nothing to grab). Used by the
// text long-press below — charIndexFromPoint only needs to get "close
// enough" to the intended word, since this snaps to real word boundaries.
function wordBoundsAtIndex(text, index) {
  if (!text.length) return null;
  let i = Math.min(Math.max(index, 0), text.length - 1);
  if (!WORD_CHAR_RE.test(text[i] || '') && WORD_CHAR_RE.test(text[i - 1] || '')) i -= 1;
  if (!WORD_CHAR_RE.test(text[i] || '')) return null;
  let start = i;
  let end = i + 1;
  while (start > 0 && WORD_CHAR_RE.test(text[start - 1])) start -= 1;
  while (end < text.length && WORD_CHAR_RE.test(text[end])) end += 1;
  return { start, end };
}

// Textareas don't expose a "point → character offset" API the way
// contenteditable's caretRangeFromPoint does, and a line can wrap across
// multiple visual rows (see LineRow's auto-grow below), so a flat
// x/averageCharWidth estimate breaks the moment a line wraps and drifts on
// this app's proportional serif font regardless. Mirrors the line into an
// offscreen div with identical box/font metrics (one span per character) and
// picks whichever span's box center is closest to the touch point — one
// layout pass, a few dozen spans at most for a lyric line, only run once per
// long-press (not per frame).
function charIndexFromPoint(textarea, clientX, clientY) {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  mirror.style.cssText = `position: absolute; top: 0; left: -9999px; visibility: hidden;
    white-space: pre-wrap; word-wrap: break-word; box-sizing: ${style.boxSizing};
    width: ${style.width}; padding: ${style.padding}; border: ${style.borderWidth} solid transparent;
    font: ${style.font}; letter-spacing: ${style.letterSpacing};`;
  const text = textarea.value;
  const spans = [];
  for (const ch of text) {
    const span = document.createElement('span');
    span.textContent = ch; // pre-wrap on the mirror keeps a lone space's width intact
    mirror.appendChild(span);
    spans.push(span);
  }
  document.body.appendChild(mirror);
  const taRect = textarea.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const touchX = clientX - taRect.left;
  const touchY = clientY - taRect.top;
  let best = text.length;
  let bestDist = Infinity;
  spans.forEach((span, i) => {
    const r = span.getBoundingClientRect();
    const dx = (r.left - mirrorRect.left + r.width / 2) - touchX;
    const dy = (r.top - mirrorRect.top + r.height / 2) - touchY;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) { bestDist = dist; best = i; }
  });
  document.body.removeChild(mirror);
  return best;
}

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
  id, index, text, previewText, syllables, rhyme, friction, audioMemos, showSyllables, dimmed, showPlaceholder, museOrigin,
  lineSelected, variantRanges, hasHistory,
  onChange, onEnter, onBackspaceAtStart, onFocus, onBlurLine, onSelectionChange, onFrictionTap, onLongPress, onGutterTap, onVariantTap, onHistoryTap, inputRef,
}) {
  // Live, not just on submit — the moment the line reads as addressing the
  // muse (the wake word + its disambiguating comma/colon typed), the row's
  // whole visual identity changes: it's no longer lyric content being
  // composed, it's a message being drafted, and the container should look
  // like it before Enter ever commits anything.
  const isMuseCommand = MUSE_COMMAND_RE.test(text);
  const localRef = useRef(null);
  // Long-press-to-record — the timer only arms for a touch that starts on
  // the GUTTER, not the textarea. It used to live on the whole row, but
  // touch events bubble: a hold directly on the line's text also reached
  // this handler, colliding with the text's own long-press (see
  // handleTextTouchStart below) — both fired off the same touch. Scoping
  // this one to the gutter keeps them apart; the gutter already hosts every
  // other line-level action (syllable count, rhyme badge, friction nudge,
  // audio badge), so "hold the margin to record" fits the same pattern.
  const holdTimerRef = useRef(null);
  const holdStartRef = useRef({ x: 0, y: 0 });

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
  }, []);

  const handleRowTouchStart = useCallback((e) => {
    if (!e.touches || e.touches.length !== 1) return;
    if (e.target.closest?.('.ne-line-input')) return; // the text has its own long-press handler (handleTextTouchStart)
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

  // Hold a word to select it, then DRAG to extend the selection across more
  // words — the entry point into Rhyme/Concept/Genealogía/Ask muse/Alternativa.
  // This never touches the textarea's REAL selection: charIndexFromPoint/
  // wordBoundsAtIndex (top of file) work the words out straight from the touch
  // point, so iOS/Android never raise their native Copy/Look-Up edit menu over
  // it — the whole reason for not relying on the OS's own drag-to-select, which
  // works fine for one word but fights this app's pill bar the moment it's a
  // multi-word range. The move/end handlers are attached natively (non-passive)
  // so they can preventDefault the browser's own selection + the keyboard.
  const textHoldTimerRef = useRef(null);
  const textHoldStartRef = useRef({ x: 0, y: 0 });
  const textMovedRef = useRef(false);
  // { active, anchor: {start,end} } — set once the long-press fires, drives
  // the drag-to-extend below.
  const synthSelRef = useRef({ active: false, anchor: null });
  // Latest render values, so the native listeners (bound once) always read
  // current props without re-binding on every keystroke.
  const liveRef = useRef({});
  liveRef.current = { text, index, variantRanges, onSelectionChange, onVariantTap };

  const clearTextHoldTimer = useCallback(() => {
    if (textHoldTimerRef.current) { clearTimeout(textHoldTimerRef.current); textHoldTimerRef.current = null; }
  }, []);

  const selectWordSpan = useCallback((el, aStart, aEnd) => {
    const { text: t, index: i } = liveRef.current;
    const start = Math.max(0, Math.min(aStart, aEnd));
    const end = Math.min(t.length, Math.max(aStart, aEnd));
    if (end <= start) return;
    liveRef.current.onSelectionChange({
      lineIndex: i,
      text: t.slice(start, end),
      before: t.slice(0, start),
      after: t.slice(end),
      rect: el.getBoundingClientRect(),
    });
  }, []);

  const handleTextTouchStart = useCallback((e) => {
    if (!e.touches || e.touches.length !== 1) return;
    const { clientX, clientY } = e.touches[0];
    textHoldStartRef.current = { x: clientX, y: clientY };
    textMovedRef.current = false;
    synthSelRef.current = { active: false, anchor: null };
    clearTextHoldTimer();
    textHoldTimerRef.current = setTimeout(() => {
      const el = localRef.current;
      if (!el) return;
      const charIndex = charIndexFromPoint(el, clientX, clientY);
      const bounds = wordBoundsAtIndex(liveRef.current.text, charIndex);
      if (!bounds) return;
      synthSelRef.current = { active: true, anchor: bounds };
      // Kill the OS's own text-selection UI for the duration of the drag —
      // with the field unselectable there is nothing for iOS/Android to raise
      // a Copy/Look-Up menu about. Restored on touchend/cancel.
      el.style.webkitUserSelect = 'none';
      el.style.userSelect = 'none';
      try { navigator.vibrate?.(8); } catch { /* unsupported — fine */ }
      selectWordSpan(el, bounds.start, bounds.end);
    }, LONG_PRESS_MS);
  }, [clearTextHoldTimer, selectWordSpan]);

  // React's onTouchMove is passive — used only to disambiguate an early drag
  // (a scroll) from a hold BEFORE the long-press fires. Once synthetic select
  // is active, the native listener below owns the gesture.
  const handleTextTouchMove = useCallback((e) => {
    if (synthSelRef.current.active || !e.touches) return;
    const dx = e.touches[0].clientX - textHoldStartRef.current.x;
    const dy = e.touches[0].clientY - textHoldStartRef.current.y;
    if (Math.abs(dx) > LONG_PRESS_MOVE_TOLERANCE || Math.abs(dy) > LONG_PRESS_MOVE_TOLERANCE) {
      textMovedRef.current = true;
      clearTextHoldTimer();
    }
  }, [clearTextHoldTimer]);

  useEffect(() => {
    const el = localRef.current;
    if (!el) return undefined;

    const onMove = (e) => {
      if (!synthSelRef.current.active) return;
      e.preventDefault(); // stop the browser growing its own selection / scrolling
      const t = e.touches?.[0];
      if (!t) return;
      const idx = charIndexFromPoint(el, t.clientX, t.clientY);
      const { text: txt } = liveRef.current;
      const b = wordBoundsAtIndex(txt, idx) || { start: idx, end: idx };
      const a = synthSelRef.current.anchor;
      selectWordSpan(el, Math.min(a.start, b.start), Math.max(a.end, b.end));
    };

    const onEnd = (e) => {
      if (synthSelRef.current.active) {
        synthSelRef.current.active = false;
        el.style.webkitUserSelect = '';
        el.style.userSelect = '';
        e.preventDefault();   // don't focus the field / raise the keyboard / native menu
        el.blur?.();
        return;
      }
      if (textMovedRef.current) return;
      // Quick tap inside a word-variant underline → open the swap sheet.
      const ranges = liveRef.current.variantRanges;
      if (!ranges?.length) return;
      const ct = e.changedTouches?.[0];
      if (!ct) return;
      const idx = charIndexFromPoint(el, ct.clientX, ct.clientY);
      const hit = ranges.find((r) => idx >= r.start && idx < r.end);
      if (hit) { e.preventDefault(); liveRef.current.onVariantTap(hit.variantId); }
    };

    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: false });
    return () => {
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, [selectWordSpan]);

  useEffect(() => clearTextHoldTimer, [clearTextHoldTimer]);

  return (
    <div
      className={`ne-row${dimmed ? ' ne-row-dimmed' : ''}${isMuseCommand ? ' ne-row-muse' : ''}${previewText != null ? ' ne-row-preview' : ''}${museOrigin ? ' ne-row-muse-origin' : ''}${lineSelected ? ' ne-row-line-selected' : ''}`}
      onTouchStart={handleRowTouchStart}
      onTouchMove={handleRowTouchMove}
      onTouchEnd={clearHoldTimer}
      onTouchCancel={clearHoldTimer}
    >
      {/* Tapping the gutter (the number/letter margin — not the friction
          nudge button inside it) toggles this line into the multi-line
          selection range: the one thing a phone can't do natively across
          the per-line textareas. A quick tap only — the same touch held
          for LONG_PRESS_MS still arms the voice-memo recorder (see
          handleRowTouchStart), these don't collide. */}
      <div
        className="ne-gutter"
        onClick={(e) => {
          if (e.target.closest('.ne-gutter-friction') || e.target.closest('.ne-gutter-history')) return;
          onGutterTap(index);
        }}
      >
        {/* Syllables/rhyme are lyric-craft metrics — meaningless once this
            row has switched to "message to the muse," so they're hidden
            rather than showing a stale/nonsense reading. */}
        {lineSelected && <span className="ne-gutter-check">✓</span>}
        {!lineSelected && !isMuseCommand && showSyllables && syllables != null && <span className="ne-gutter-count">{syllables}</span>}
        {!lineSelected && !isMuseCommand && rhyme?.letter && <span className={`ne-gutter-letter ${rhyme.type}`}>{rhyme.letter}</span>}
        {!lineSelected && isMuseCommand && <span className="ne-gutter-muse-icon">✦</span>}
        {/* Content-driven Socratic nudge — this line broke the stanza's
            established rhyme scheme (see rhyme.js's detectRhymeFriction).
            Purely local, no API call until tapped — no idle timer anywhere
            in this screen, the writer gets to think in silence. */}
        {!lineSelected && !isMuseCommand && friction && (
          <button className="ne-gutter-friction" title="this line breaks the rhyme scheme — ask the muse?" onClick={() => onFrictionTap(index)}>✦</button>
        )}
        {!lineSelected && !isMuseCommand && hasHistory && (
          <button className="ne-gutter-history" title="earlier versions of this line" onClick={() => onHistoryTap(index)}>⟲</button>
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
          placeholder={showPlaceholder ? 'write the next line…' : ''}
          onChange={handleInput}
          onFocus={() => onFocus(index)}
          onSelect={handleSelect}
          onBlur={() => onBlurLine(index)}
          onKeyDown={handleKeyDown}
          onTouchStart={handleTextTouchStart}
          onTouchMove={handleTextTouchMove}
          // touchend is handled by the non-passive native listener in the
          // effect above (synthetic-selection finalize / variant-tap) — it
          // needs preventDefault, which a React passive handler can't do.
          onTouchCancel={() => {
            clearTextHoldTimer();
            synthSelRef.current = { active: false, anchor: null };
            const el = localRef.current;
            if (el) { el.style.webkitUserSelect = ''; el.style.userSelect = ''; }
          }}
          // Defense in depth against iOS's native Select/Copy/Look Up bubble
          // (see handleTextTouchStart's comment) — some iOS versions fire
          // `contextmenu` for the same long-press that would raise it.
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
      {/* Reserved on every row, same fixed width whether or not this line
          has a memo — so recording (or deleting) one never shifts the
          textarea's own width side to side. Right side, not the left
          gutter: the gutter is lyric-craft metrics (syllables/rhyme),
          audio is a different, unrelated kind of attachment. */}
      <div className="ne-audio-slot">
        {!isMuseCommand && audioMemos?.length > 0 && <LineAudioBadge memos={audioMemos} />}
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
  // The live text selection inside whichever row currently has one — drives
  // SelectionCallout. Separate from `activePopover` below: the callout
  // disappears the instant a popover opens (see openPopover), it doesn't
  // need to survive alongside it.
  const [selection, setSelection] = useState(null);
  // Contiguous, inclusive range of physical line indices tapped in the
  // gutter — the mobile-only "select more than one line at once" affordance
  // (a phone can't drag-select across the per-line textareas the way
  // desktop's single textarea allows). null when no range is active.
  const [lineRange, setLineRange] = useState(null);
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

  useEffect(() => {
    setLines(ensureTrailingEmpty(toLineObjects(splitIntoLines(note.lines?.[0]?.text || ''))));
    setType(note.type);
    setCustomLabel(note.custom_label || '');
  }, [note.id]);

  useEffect(() => {
    let cancelled = false;
    loadLineAudioFor(note.id).then(({ data }) => { if (!cancelled) setAudioBySection(data || []); });
    loadWordVariants(note.id).then(({ data }) => { if (!cancelled) setWordVariants(data || []); });
    loadLineHistory(note.id).then(({ data }) => { if (!cancelled) setLineHistory(data || []); });
    undoRef.current = { undo: [], redo: [] };
    focusBaselineRef.current = {};
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
    setLineRange(null);
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

  // Shared by onBlur (loses focus) and onFrictionTap's caller — a line is
  // "complete" enough to re-check its rhyme fit against the rest of the
  // stanza once the user has actually stepped away from it.
  const handleBlurLine = useCallback((index) => {
    setSelection(null);
    pendingFrictionCheckRef.current = true;
    const line = lines[index];
    if (line) {
      const baseline = focusBaselineRef.current[line.id];
      if (baseline != null && baseline !== line.text) logLineHistory(index, baseline);
      focusBaselineRef.current[line.id] = line.text;
    }
  }, [lines, logLineHistory]);

  const handleRowFocus = useCallback((index) => {
    setFocusedIndex(index);
    setLineRange(null);
    const line = lines[index];
    if (line && focusBaselineRef.current[line.id] == null) focusBaselineRef.current[line.id] = line.text;
  }, [lines]);

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

  const openPopover = useCallback((mode) => {
    if (!selection) return;
    setActivePopover({
      mode,
      targetVerse: { text: selection.text, before: selection.before, after: selection.after },
      lineIndex: selection.lineIndex,
      originIsReal: true, // a real selected fragment on this exact line — genuine reference
      // Re-measured now, not selection.rect (captured back when the drag-
      // select itself happened) — a selection near the bottom/edge of the
      // screen often triggers the browser's own scroll-into-view or
      // keyboard-avoidance adjustment, which can still be settling at
      // select time. Using that stale rect anchored the popover to wherever
      // the line USED to be, not where it actually ended up — the "muse
      // points somewhere else" bug. getLineRect reads the line's real
      // current position, same fresh-measurement approach handleFrictionTap
      // already uses for the same reason.
      anchorRect: getLineRect(selection.lineIndex) ?? selection.rect,
    });
    setSelection(null);
  }, [selection, getLineRect]);

  // Tap a line's gutter to add it to the selection range. Contiguous and
  // inclusive: the first tap seeds a one-line range, a tap outside it
  // stretches whichever end is nearer, a tap back inside collapses to that
  // single line (and a second tap on a lone selected line clears it).
  const handleGutterTap = useCallback((index) => {
    setSelection(null);
    document.activeElement?.blur?.(); // don't let the keyboard cover the range bar
    setLineRange((cur) => {
      if (!cur) return { start: index, end: index };
      if (index >= cur.start && index <= cur.end) {
        return cur.start === cur.end ? null : { start: index, end: index };
      }
      return index < cur.start ? { start: index, end: cur.end } : { start: cur.start, end: index };
    });
  }, []);

  const openLineRangePopover = useCallback((mode) => {
    if (!lineRange) return;
    const { start, end } = lineRange;
    const text = lines.slice(start, end + 1).map((l) => l.text).join('\n');
    setActivePopover({
      mode,
      targetVerse: { text, before: '', after: '' },
      lineIndex: start,
      lineRange: { start, end }, // handlePopoverReplace swaps the whole span, not one line
      originIsReal: true,
      anchorRect: getLineRect(start),
    });
    setLineRange(null);
  }, [lineRange, lines, getLineRect]);

  // ─── Word-variant alternatives ────────────────────────────────────────────
  // Open the sheet to attach an alternative wording to the current selection.
  const handleAddVariantFromSelection = useCallback(() => {
    if (!selection) return;
    setWordVariantSheet({ draft: { lineIndex: selection.lineIndex, before: selection.before, text: selection.text } });
    setSelection(null);
  }, [selection]);

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
      seedMessage: 'esta línea no encaja con el esquema de rima del bloque — ¿alguna idea?',
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

  useEffect(() => () => clearTimeout(undoTimerRef.current), []);

  const handlePopoverReplace = useCallback((newText) => {
    if (!activePopover?.targetVerse) return;
    const { targetVerse, lineIndex, lineRange: range } = activePopover;

    // A multi-line selection (gutter-tapped range) — swap the whole span of
    // rows for however many lines the replacement text has.
    if (range) {
      pushUndo(lines);
      for (let i = range.start; i <= range.end; i++) logLineHistory(i, lines[i]?.text ?? '');
      const next = [...lines];
      const replacement = newText.split('\n').map((t) => ({ id: crypto.randomUUID(), text: t }));
      next.splice(range.start, range.end - range.start + 1, ...replacement);
      setLines(ensureTrailingEmpty(next));
      persist(next);
      return;
    }

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
    if (!confirm('Delete this note?')) return;
    await deleteNote(note.id);
    onDeleted?.(note.id);
  }, [note.id, onDeleted]);

  // What the muse (and the whole-verse tools) sees as "the verse" — muse
  // command lines stripped out entirely, they're not part of the lyric.
  const currentText = lineTexts.filter((t) => !MUSE_COMMAND_RE.test(t)).join('\n');

  return (
    <MobileScreen className="ne-screen">
      <div className="ne-body">
        <div className="ne-header glass">
          <button className="ne-back" onClick={onClose} title="back">‹</button>
          <select value={type} onChange={handleTypeChange} className="ne-type-select">
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
          <button
            className="ne-undo-btn"
            onClick={handleUndo}
            disabled={!undoRef.current.undo.length}
            title="undo"
          >↩︎</button>
          <button
            className="ne-undo-btn"
            onClick={handleRedo}
            disabled={!undoRef.current.redo.length}
            title="redo"
          >↪︎</button>
          <button className="ne-delete" onClick={handleDelete} title="delete note">🗑</button>
          <button className="ne-done" onClick={onClose}>Done</button>
        </div>

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
            museOrigin={Boolean(activePopover?.originIsReal) && activePopover?.lineIndex === i}
            lineSelected={lineRange != null && i >= lineRange.start && i <= lineRange.end}
            variantRanges={variantRangesByLine[i]}
            hasHistory={lineHistoryByIndex[i]?.length > 0}
            onChange={handleLineChange}
            onEnter={handleEnter}
            onBackspaceAtStart={handleBackspaceAtStart}
            onFocus={handleRowFocus}
            onBlurLine={handleBlurLine}
            onSelectionChange={setSelection}
            onFrictionTap={handleFrictionTap}
            onLongPress={handleLongPress}
            onGutterTap={handleGutterTap}
            onVariantTap={handleVariantTap}
            onHistoryTap={handleHistoryTap}
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
          onGenealogy={() => openPopover('genealogy')}
          onAskMuse={() => openPopover('ask')}
          onAlternative={handleAddVariantFromSelection}
        />
      )}

      {lineRange && !activePopover && (
        <LineRangeCallout
          count={lineRange.end - lineRange.start + 1}
          onAskMuse={() => openLineRangePopover('ask')}
          onClear={() => setLineRange(null)}
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

      {recordingIndex != null && (
        <AudioRecorderSheet
          sectionId={note.id}
          songId={songId}
          lineIndex={recordingIndex}
          onClose={() => setRecordingIndex(null)}
          onSaved={handleAudioSaved}
        />
      )}

      {lastReplacement && (
        <div className="ne-undo-toast">
          <span>Line replaced</span>
          <button onClick={handleUndoReplace}>Undo</button>
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

      {/* Replaces the old fixed chords/muse/tools bar — muse already lives
          as a contextual action on text selection (SelectionCallout) and
          the inline "Musa," wake word, chords already lives inside the
          Tools drawer ("Assign chords" row), so neither needed its own
          icon here anymore. "Variant" only shows up here, never on the
          song-thread FAB — creating a variant only makes sense from
          inside an existing note. */}
      {/* Hidden while a selection is active — selecting a word is meant to
          be a focused, single-purpose moment (see SelectionCallout), and
          the FAB has nothing to do with it. Also frees the bottom-right
          corner so the callout bar can just be a clean, symmetric floating
          card instead of carving out a gap to avoid overlapping it. Same
          reasoning for the Muse sheet (activePopover): it's a full-width
          bottom dock now (design ref: references/bottomTabMuse.jpg), not a
          small card anchored under a line, so it sits directly behind the
          FAB's bottom-right corner — and .fab-menu-btn's z-index:62 was
          deliberately set above the sheet's z-index:61 for the OLD
          line-anchored popover, which rarely overlapped it. Left onscreen,
          the "+" pokes through the sheet's own content and makes it hard
          to read. */}
      {!selection && !activePopover && !lineRange && (
        <FabMenu
          pills={[
            { label: 'Baúl de la inspiración', icon: '✦', dark: true, onClick: () => setBaulOpen(true) },
            { label: 'Tools', icon: '☰', iconVariant: 'chord', onClick: () => setToolsOpen(true) },
            { label: 'Variant', icon: '✎', iconVariant: 'thread', onClick: () => setVariantSheetOpen(true) },
          ]}
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
