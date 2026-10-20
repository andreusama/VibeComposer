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
import ResourcePickerSheet from '../resources/ResourcePickerSheet.jsx';
import LineChordStrip from '../components/LineChordStrip.jsx';
import ChordStrumSheet from './ChordStrumSheet.jsx';
import TempoStrumCard from './TempoStrumCard.jsx';
import { loadLineChords, addLineChord, updateLineChord, deleteLineChord } from '../canvas/lineChordData.js';
import { loadStrumPattern, saveStrumPattern, deleteStrumPattern } from '../canvas/strumPatternData.js';
import { lineIndexFromPoint } from '../utils/lineHitTest.js';
import useLineDragDrop from './useLineDragDrop.js';
import LineDragPill from './LineDragPill.jsx';
import { IcChevronLeft, IcMuse, IcHistory, IcTrash, IcPencil, IcTools } from './icons.jsx';

// The "talk to the muse right inside the lyric" pattern from the design
// ref — always the same wake word, like addressing Alexa, so it reads
// unambiguously as a command and never gets mistaken for a real lyric line
// that happens to start with "musa" (the Spanish word for "muse" itself,
// which could plausibly open an actual verse — the trailing comma/colon is
// what disambiguates "Musa, quiero..." the command from "Musa que me
// inspira..." the lyric).
const MUSE_COMMAND_RE = /^\s*musa\s*[,:]\s*/i;

// A dropped resource's top/bottom sliver of a row reads as "between
// verses" (a brand new line), the middle as "into this line" (appended to
// its end) — see handleDropResourceOnLine and resourceDragPreview, which
// both resolve through the same resolveResourceDropTarget so the live
// preview can never show one outcome and commit a different one.
const RESOURCE_EDGE_FRACTION = 0.3;

// Long-press-to-copy timing — same hold-without-much-movement convention
// ProjectRow.jsx uses for its own long-press, just a touch longer here
// since it competes with the OS's own native long-press-to-select on a
// real <textarea>: firing distinctly before that (typically ~500ms on
// mobile browsers) is what makes this read as "one deliberate action"
// instead of a selection UI flickering in first.
const LONG_PRESS_COPY_MS = 420;
const LONG_PRESS_COPY_SLOP = 10;

// One physical line's row: number+rhyme-letter gutter + an auto-growing
// single logical line of text (still wraps visually across more than one
// screen row, same as any textarea — "single line" here means one entry in
// the lines array, one row in the margin, not one row of pixels).
function LineRow({
  id, index, text, previewText, syllables, rhyme, friction, dimmed, showPlaceholder,
  variantRanges, chords, hasHistory, justCopied, dropTarget,
  onChange, onEnter, onBackspaceAtStart, onPasteLines, onFocus, onBlurLine, onSelectionChange, onFrictionTap, onVariantTap, onHistoryTap, onLongPressCopy, onRemoveChord, onMoveChordStart, inputRef,
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
  //
  // Also re-runs on chords.length: a line gaining its first chord flips on
  // .ne-row-has-chords (style.css), which bumps this same textarea's own
  // line-height/padding-top to make room for the pill above the text —
  // changing scrollHeight exactly like a text edit would, but without
  // touching `displayedText`. Keyed on the count (not the array) since a
  // chord's own span/position moving never changes how tall the row needs
  // to be, only whether it has ≥1 at all; a new dependency array identity
  // on every unrelated render would just re-measure for nothing. Without
  // this, the textarea's inline style.height stays pinned at its pre-chord
  // value — real CSS, stale inline height always wins — and the pill ends
  // up fighting the glyphs for the same too-short row. Reported 2026-10-09.
  useLayoutEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [displayedText, chords?.length]);

  const setRefs = useCallback((el) => {
    localRef.current = el;
    inputRef(id, el);
  }, [id, inputRef]);

  const handleInput = useCallback((e) => {
    onChange(index, e.target.value);
  }, [index, onChange]);

  // A plain single-line paste needs nothing special — the native paste
  // already lands correctly in a <textarea> value, same as typing. But
  // this is a ONE-ROW-PER-VERSE-LINE editor (rows={1}; `lines` is the
  // real source of truth, not the textarea's own value), and a paste that
  // carries embedded newlines (copying several lyric lines, or a whole
  // verse, from Notes/a lyrics site/another part of this app) would
  // otherwise land as ONE row whose value just happens to contain raw \n
  // characters — syllables/rhyme/chords for that "line" then get computed
  // against the whole multi-line blob as if it were a single verse line,
  // and the gutter shows one syllable count for all of it (reported
  // 2026-10-20). Intercepted here and handed to onPasteLines, which does
  // the actual line-array splice (same shape handleEnter already uses to
  // split one line into two, generalized to N).
  const handlePaste = useCallback((e) => {
    const pasted = e.clipboardData?.getData('text/plain');
    if (!pasted || !pasted.includes('\n')) return; // nothing embedded — let the native paste happen
    e.preventDefault();
    onPasteLines(index, e.target.selectionStart, e.target.selectionEnd, pasted);
  }, [index, onPasteLines]);

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

  // Long-press the verse to copy its whole text — scoped to .ne-input-wrap
  // (the textarea's own wrapper, not the gutter's icon buttons) so it reads
  // as "hold the verse itself," and deliberately never calls
  // preventDefault() on touchstart — doing so would also block the
  // textarea's normal tap-to-focus/tap-to-place-caret, which this must not
  // touch. Best-effort against the native long-press-to-select that mobile
  // browsers already run on a real <textarea>: firing first (see
  // LONG_PRESS_COPY_MS) and collapsing whatever selection may have started
  // is the mitigation, not a guarantee — genuinely device-dependent.
  const pressTimerRef = useRef(null);
  const pressStartRef = useRef({ x: 0, y: 0 });
  const clearPressTimer = useCallback(() => { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }, []);
  useEffect(() => clearPressTimer, [clearPressTimer]);

  const handleWrapTouchStart = useCallback((e) => {
    const t = e.touches[0];
    pressStartRef.current = { x: t.clientX, y: t.clientY };
    clearPressTimer();
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      onLongPressCopy(index);
      const el = localRef.current;
      if (el) { const pos = el.selectionStart ?? displayedText.length; el.setSelectionRange(pos, pos); }
    }, LONG_PRESS_COPY_MS);
  }, [index, onLongPressCopy, displayedText, clearPressTimer]);

  const handleWrapTouchMove = useCallback((e) => {
    if (!pressTimerRef.current) return;
    const t = e.touches[0];
    if (Math.hypot(t.clientX - pressStartRef.current.x, t.clientY - pressStartRef.current.y) > LONG_PRESS_COPY_SLOP) clearPressTimer();
  }, [clearPressTimer]);

  return (
    <div
      className={`ne-row${dimmed ? ' ne-row-dimmed' : ''}${isMuseCommand ? ' ne-row-muse' : ''}${previewText != null ? ' ne-row-preview' : ''}${justCopied ? ' ne-row-copied' : ''}${dropTarget ? ' ne-row-drop-target' : ''}${chords?.length ? ' ne-row-has-chords' : ''}`}
      data-line-index={index}
    >
      <div className="ne-gutter">
        {/* Syllables/rhyme are lyric-craft metrics — meaningless once this
            row has switched to "message to the muse," so they're hidden
            rather than showing a stale/nonsense reading. */}
        {!isMuseCommand && syllables != null && <span className="ne-gutter-count">{syllables}</span>}
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
      <div
        className="ne-input-wrap"
        onTouchStart={handleWrapTouchStart}
        onTouchMove={handleWrapTouchMove}
        onTouchEnd={clearPressTimer}
        onTouchCancel={clearPressTimer}
      >
        <LineHighlight text={displayedText} ranges={variantRanges} />
        {/* Chord symbols aligned above the exact words they're strummed on,
            plus the transparent text mirror the chord drag-and-drop
            resolves a drop's character offset against — rendered for every
            line, chorded or not, because an empty line is exactly the one
            you're about to drop the first chord onto. */}
        <LineChordStrip text={displayedText} chords={chords} onRemove={onRemoveChord} onMoveStart={onMoveChordStart} />
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
          onPaste={handlePaste}
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
  // Latest text SongThreadScreen knows about for this note, kept fresh by
  // its realtime subscription (see useLiveSongSync.js) — only ever adopted
  // when it's a genuine remote change and it's safe to (see the effect
  // below), never a prop this component treats as its real source of truth
  // the way `note` itself is.
  liveText,
}) {
  const lineId = note.lines?.[0]?.id;
  const [type, setType] = useState(note.type);
  const [customLabel, setCustomLabel] = useState(note.custom_label || '');
  const [lines, setLines] = useState(() => ensureTrailingEmpty(toLineObjects(splitIntoLines(note.lines?.[0]?.text || ''))));
  const [focusModeOn, setFocusModeOn] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [variantSheetOpen, setVariantSheetOpen] = useState(false);
  const [baulOpen, setBaulOpen] = useState(false);
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
  // A captured selection snapshot ({lineIndex, before, text, after}) while
  // the Recursos picker is open — same "static snapshot at open time"
  // approach as openPopover/handleCultureFromSelection, since `selection`
  // itself gets cleared the moment the sheet opens (see handleOpenResourcePicker).
  const [resourcePicker, setResourcePicker] = useState(null);
  // Which line a dragged resource OR chord is currently hovering over (see
  // ResourcePickerSheet's / ChordStrumSheet's long-press-drag) — drives
  // LineRow's own dropTarget highlight. null outside of an active drag.
  const [dropTargetIndex, setDropTargetIndex] = useState(null);
  // The live point of an in-flight resource drag — { x, y, resource } |
  // null — ResourcePickerSheet owns the drag itself (useLineDragDrop.js
  // lives inside it, not here), so this is what its onDragHoverLine prop
  // (now handed the raw point too, not just a line index) feeds
  // resourceDragPreview below. Same "the parent can't see a child's own
  // hook state, so the hook hands it the raw point instead" reasoning
  // chordMoveDrag's own comment gives for why THAT one lives in
  // NoteEditorScreen directly — a resource drag can't, since it starts
  // inside the sheet's own palette, not a pill already in this tree.
  const [resourceDragHover, setResourceDragHover] = useState(null);
  // True for a drag's WHOLE duration, unlike dropTargetIndex above (which
  // is null both "no drag" and "mid-drag but between lines right now" —
  // not distinguishable from it alone). Drives ne-sheet-drag-active, which
  // turns off pointer-events on every <textarea> while true: a real
  // mobile browser's native text-selection handling can otherwise claim
  // an in-progress drag touch the instant it crosses one, and no amount
  // of this app's own preventDefault() can undo that once it happens —
  // reported 2026-10-09 as the drag visibly freezing mid-gesture.
  const [externalDragActive, setExternalDragActive] = useState(false);
  // Every chord attached to a word range anywhere in this block (one query,
  // see loadLineChords). Keyed in the DB by (line_id, line_index); the span
  // itself is re-resolved from anchor_text against the live text on every
  // render (chordsByLine below), never trusted from the stored offsets.
  const [lineChords, setLineChords] = useState([]);
  // This section's recorded right-hand strum pattern (one row per section)
  // — { bpm, pattern } or null.
  const [strum, setStrum] = useState(null);
  // A captured selection/caret snapshot ({lineIndex, start, end}) while the
  // Acordes y rasgueo sheet is open, or an empty object when it was opened
  // with nothing focused (the strum recorder needs no target). Same "static
  // snapshot at open time" approach as openPopover / handleOpenResourcePicker,
  // since `selection` is cleared the moment the sheet opens.
  const [chordSheet, setChordSheet] = useState(null);
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
  // One-shot: set by the accessory bar's audio button, read (and cleared)
  // the render NoteAudioBar actually mounts, so it opens straight to the
  // half-height take list instead of the usual collapsed handle — a normal
  // blur (tapping away) still lands on collapsed as before.
  const audioBarOpenIntentRef = useRef(false);

  useEffect(() => {
    setLines(ensureTrailingEmpty(toLineObjects(splitIntoLines(note.lines?.[0]?.text || ''))));
    setType(note.type);
    setCustomLabel(note.custom_label || '');
    lastSavedTextRef.current = note.lines?.[0]?.text || '';
    pendingSaveRef.current = false;
  }, [note.id]);

  useEffect(() => {
    let cancelled = false;
    loadNoteAudioFor(note.id).then(({ data }) => { if (!cancelled) setAudioBySection(data || []); });
    loadWordVariants(note.id).then(({ data }) => { if (!cancelled) setWordVariants(data || []); });
    loadLineHistory(note.id).then(({ data }) => { if (!cancelled) setLineHistory(data || []); });
    loadStrumPattern(note.id).then(({ data }) => { if (!cancelled) setStrum(data || null); });
    undoRef.current = { undo: [], redo: [] };
    focusBaselineRef.current = {};
    return () => { cancelled = true; };
  }, [note.id]);

  // Chords hang off the block's `lines` row, not off the section, so they
  // load on lineId rather than note.id — and a brand-new note has no lines
  // row yet, in which case there is simply nothing to attach a chord to.
  useEffect(() => {
    if (!lineId) { setLineChords([]); return undefined; }
    let cancelled = false;
    loadLineChords(lineId).then(({ data }) => { if (!cancelled) setLineChords(data || []); });
    return () => { cancelled = true; };
  }, [lineId]);

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

  // Chord pills per physical line, sorted by each chord's own `position` —
  // a plain integer rank among the other chords on its line, not a word
  // anchor (2026-10-16 redesign: chords belong to the VERSE, not to any
  // particular word — see chordAnchor.js's own header). `computeChordSpans`
  // (called from LineChordStrip) trusts this array's order completely and
  // does not re-sort, so this is the one place that order gets decided.
  const chordsByLine = useMemo(() => {
    const map = {};
    lineChords.forEach((c) => {
      if (lineTexts[c.line_index] == null) return; // the line itself no longer exists
      (map[c.line_index] ??= []).push({ id: c.id, chordName: c.chord_name, position: c.position });
    });
    Object.values(map).forEach((arr) => arr.sort((a, b) => a.position - b.position));
    return map;
  }, [lineChords, lineTexts]);

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
  // Tracks what WE last wrote (vs. what the server has) so a realtime echo
  // of our own save never gets mistaken for a collaborator's edit, and
  // whether a local edit is still debouncing — both read by the live-merge
  // effect further down, which must never clobber text out from under an
  // in-flight local save.
  const lastSavedTextRef = useRef(note.lines?.[0]?.text || '');
  const pendingSaveRef = useRef(false);

  const persist = useCallback((nextLines) => {
    const content = nextLines[nextLines.length - 1].text === '' ? nextLines.slice(0, -1) : nextLines;
    const joined = content.map((l) => l.text).join('\n');
    onTextChange?.(note.id, joined);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingSaveRef.current = true;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      if (lineId) saveNoteText(lineId, joined);
      lastSavedTextRef.current = joined;
      pendingSaveRef.current = false;
    }, 500);
  }, [note.id, lineId, onTextChange]);

  // A collaborator's edit to this exact note, picked up live. Only ever
  // adopted when it's safe: not our own write echoing back, nobody's
  // actively focused in a line here, and no local edit is still mid-save —
  // otherwise this would yank text out from under an active keystroke,
  // which no amount of "but it's more current" justifies.
  useEffect(() => {
    if (liveText == null || liveText === lastSavedTextRef.current) return;
    if (focusedIndex !== null || pendingSaveRef.current) return;
    lastSavedTextRef.current = liveText;
    setLines(ensureTrailingEmpty(toLineObjects(splitIntoLines(liveText))));
  }, [liveText, focusedIndex]);

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

  // KeyboardAccessoryBar → audio icon: the common case is finishing a verse
  // and wanting to hum/record it right away, without a separate tap-away
  // first. Unlike runBarAction's other handlers, this one *wants* the real
  // blur to happen (it's what hides the bar and lets NoteAudioBar mount) —
  // it just also flags that mount to open expanded instead of collapsed.
  const handleOpenAudioBar = useCallback(() => {
    audioBarOpenIntentRef.current = true;
    const line = focusedIndex != null ? lines[focusedIndex] : null;
    const el = line ? rowRefs.current[line.id] : null;
    if (el) el.blur(); else { setSelection(null); setFocusedIndex(null); }
  }, [focusedIndex, lines]);

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

  // LineRow's own handlePaste → a paste that carries embedded newlines.
  // Same splice shape handleEnter already uses to split one line into two
  // at the caret, generalized to N: the text before the selection and the
  // PASTE's own first line merge into the original row, the paste's last
  // line merges with whatever was after the selection (so pasting midway
  // through a line properly keeps both halves instead of orphaning one),
  // and everything the paste carried in between becomes brand-new rows.
  // splitIntoLines (textLines.js) is what strips \r and trims stray
  // leading/trailing whitespace off each pasted line — the same function
  // this screen's own initial load already trusts for "what counts as one
  // line", so a paste and a freshly-loaded note are held to one standard,
  // not two. A selection gets replaced, not just a collapsed caret grown.
  const handlePasteLines = useCallback((index, selectionStart, selectionEnd, pastedText) => {
    const parts = splitIntoLines(pastedText);
    if (parts.length <= 1) return; // nothing to split — shouldn't reach here, but a no-op is the safe fallback
    pushUndo(lines);
    const line = lines[index];
    const before = line.text.slice(0, selectionStart);
    const after = line.text.slice(selectionEnd);
    const next = [...lines];
    next[index] = { ...line, text: before + parts[0] };
    const inserted = parts.slice(1, -1).map((partText) => ({ id: crypto.randomUUID(), text: partText }));
    const lastPart = parts[parts.length - 1];
    const lastLine = { id: crypto.randomUUID(), text: lastPart + after };
    next.splice(index + 1, 0, ...inserted, lastLine);
    setLines(ensureTrailingEmpty(next));
    persist(next);
    pendingFocusRef.current = { id: lastLine.id, caret: lastPart.length };
    pendingFrictionCheckRef.current = true;
  }, [lines, persist, pushUndo]);

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

  // KeyboardAccessoryBar → Recursos. Unlike Rima/Alternativa/Ángulo
  // cultural, this doesn't need a selected phrase to act on — a resource is
  // a saved line you're bringing IN, not an operation on something already
  // there. With a selection it replaces it (unchanged); with just a caret
  // it reads the live position straight off the focused textarea (still
  // mounted/focused here, kept alive by the bar's own onMouseDown
  // preventDefault — same trick handleEnter's caller relies on) and inserts
  // there instead. handleInsertResource's before+resource.body+after join
  // already handles both shapes identically; nothing there needed to change.
  const handleOpenResourcePicker = useCallback(() => {
    if (selection) {
      setResourcePicker({ ...selection });
      setSelection(null);
      setFocusedIndex(null);
      return;
    }
    if (focusedIndex == null) return;
    const line = lines[focusedIndex];
    const el = rowRefs.current[line?.id];
    const caret = el ? el.selectionStart : (line?.text.length ?? 0);
    const text = line?.text ?? '';
    setResourcePicker({ lineIndex: focusedIndex, text: '', before: text.slice(0, caret), after: text.slice(caret) });
    setFocusedIndex(null);
  }, [selection, focusedIndex, lines]);

  // Replaces the captured selection with the resource's own text — same
  // pushUndo + logLineHistory + direct mutation shape as
  // handleSaveWordVariant, since this is a one-shot programmatic edit, not
  // continuous typing (handleLineChange's coalescing is for the latter).
  //
  // Same focus-restoring close as closeChordSheet (see its own comment for
  // the full reasoning) — handleOpenResourcePicker nulls focusedIndex on
  // the same "opening the sheet also blurs the textarea" assumption, which
  // a long-press-and-drag breaks the same way. `overrideLineIndex` is for
  // handleDropResourceOnLine: a drop can land on a different line (or a
  // brand-new one) than the line the sheet was opened from.
  const closeResourcePicker = useCallback((overrideLineIndex) => {
    const targetLineIndex = overrideLineIndex ?? resourcePicker?.lineIndex;
    setResourcePicker(null);
    setDropTargetIndex(null);
    if (targetLineIndex == null || !lines[targetLineIndex]) return;
    setFocusedIndex(targetLineIndex);
    rowRefs.current[lines[targetLineIndex].id]?.focus();
  }, [resourcePicker, lines]);

  const handleInsertResource = useCallback((resource) => {
    const target = resourcePicker;
    if (!target) return;
    const lineText = lines[target.lineIndex]?.text ?? '';
    pushUndo(lines);
    logLineHistory(target.lineIndex, lineText);
    const nextText = `${target.before}${resource.body}${target.after}`;
    const next = [...lines];
    next[target.lineIndex] = { ...next[target.lineIndex], text: nextText };
    setLines(ensureTrailingEmpty(next));
    persist(next);
    closeResourcePicker();
  }, [resourcePicker, lines, persist, pushUndo, logLineHistory, closeResourcePicker]);

  // Where exactly within a row's own bounds a point falls decides what a
  // resource drop there means: the top/bottom sliver reads as "between
  // verses" (a brand new line of its own, same splice handleInsertLineAfter
  // already uses for the muse popover's "Insert below"), the middle as
  // "into this line" (appended to its end — there's no sub-line caret to
  // resolve from a touch drop the way there is from a real text cursor, so
  // "into" always means the end, never a guessed mid-line position). Shared
  // by handleDropResourceOnLine (the actual commit) and resourceDragPreview
  // (the live preview below) so the two can never disagree about what a
  // given point means — also returns `rect`, which the preview needs to
  // know where on screen to draw the ghost line and handleDropResourceOnLine
  // doesn't, but computing it twice would risk the two reading two
  // different layouts if a frame lands between them.
  const resolveResourceDropTarget = useCallback((x, y) => {
    const lineIndex = lineIndexFromPoint(x, y);
    if (lineIndex == null || !lines[lineIndex]) return null;
    const rowEl = document.querySelector(`[data-line-index="${lineIndex}"]`);
    const rect = rowEl?.getBoundingClientRect();
    const frac = rect && rect.height ? (y - rect.top) / rect.height : 0.5;
    if (frac < RESOURCE_EDGE_FRACTION) return { mode: 'before', lineIndex, rect };
    if (frac > 1 - RESOURCE_EDGE_FRACTION) return { mode: 'after', lineIndex, rect };
    return { mode: 'into', lineIndex, rect };
  }, [lines]);

  // ResourcePickerSheet's long-press-and-drag (via useLineDragDrop.js) →
  // dropped somewhere over the editor. Closes the sheet on every successful
  // outcome (into a line, or a new line before/after) rather than letting
  // it revert to its full list — same "you just placed it, let the lyric
  // have the screen" reasoning as handleDropChord's own close. A miss
  // (dropped nowhere valid) leaves the sheet open as-is.
  const handleDropResourceOnLine = useCallback((x, y, resource) => {
    setDropTargetIndex(null);
    const target = resolveResourceDropTarget(x, y);
    if (!target) return;

    if (target.mode === 'before') { handleInsertLineAfter(target.lineIndex - 1, resource.body); closeResourcePicker(target.lineIndex); return; }
    if (target.mode === 'after') { handleInsertLineAfter(target.lineIndex, resource.body); closeResourcePicker(target.lineIndex); return; }

    const line = lines[target.lineIndex];
    const current = line.text;
    pushUndo(lines);
    logLineHistory(target.lineIndex, current);
    const next = [...lines];
    const joined = current && !/\s$/.test(current) ? `${current} ${resource.body}` : `${current}${resource.body}`;
    next[target.lineIndex] = { ...next[target.lineIndex], text: joined };
    setLines(ensureTrailingEmpty(next));
    persist(next);
    closeResourcePicker(target.lineIndex);
  }, [lines, persist, pushUndo, logLineHistory, handleInsertLineAfter, resolveResourceDropTarget, closeResourcePicker]);

  // ResourcePickerSheet's onDragHoverLine (now carrying the live point and
  // payload — see useLineDragDrop.js) — captures both the row highlight
  // (unchanged) and the raw point resourceDragPreview below resolves into
  // "before / after / into" every tick, not just on release.
  const handleResourceDragHover = useCallback((lineIndex, x, y, resource) => {
    setDropTargetIndex(lineIndex);
    setResourceDragHover(lineIndex == null ? null : { x, y, resource });
  }, []);

  // What a resource drop would do if it ended right now — the exact same
  // resolveResourceDropTarget the real drop commits through, so the ghost
  // line / text preview below can never show an outcome the drop itself
  // wouldn't also produce.
  const resourceDragPreview = useMemo(() => {
    if (!resourceDragHover) return null;
    const { x, y, resource } = resourceDragHover;
    const target = resolveResourceDropTarget(x, y);
    if (!target) return null;
    if (target.mode !== 'into') return { ...target, resource };
    // Same join rule handleDropResourceOnLine's own 'into' branch commits —
    // computed once here so LineRow's previewText (below) and the eventual
    // commit can never read two different joins off the same current text.
    const current = lines[target.lineIndex]?.text ?? '';
    const previewText = current && !/\s$/.test(current) ? `${current} ${resource.body}` : `${current}${resource.body}`;
    return { ...target, resource, previewText };
  }, [resourceDragHover, resolveResourceDropTarget, lines]);

  // ─── Chords, line-level ───────────────────────────────────────────────────
  // KeyboardAccessoryBar → Acordes y rasgueo. Like Recursos (and unlike
  // Rima/Alternativa), it needs no selection to be useful: the strum
  // recorder is section-level, and tapping a chord with no selection just
  // appends it to whatever line is focused — there's no word to attach it
  // to anymore (2026-10-16 — see chordAnchor.js's own header for why).
  const handleOpenChordSheet = useCallback(() => {
    if (selection) {
      setChordSheet({ lineIndex: selection.lineIndex });
    } else if (focusedIndex != null) {
      setChordSheet({ lineIndex: focusedIndex });
    } else {
      setChordSheet({}); // strum-only entry — nowhere to put a chord, and that's fine
    }
    setSelection(null);
    setFocusedIndex(null);
  }, [selection, focusedIndex]);

  // Every path that ends the chord sheet (a tap-placed chord, a
  // drag-dropped one, or the sheet's own cancel) funnels through here so
  // focus comes back exactly once, the same way regardless of which one
  // fired. handleOpenChordSheet nulls focusedIndex on the assumption that
  // opening the sheet also blurs the textarea — true for a genuine tap on
  // the chord icon, but NOT for picking a chord via long-press-and-drag: a
  // long-press that resolves into a drag never synthesizes a click/focus-
  // steal on the chip in the first place (confirmed via Playwright — no
  // 'blur' ever fires on the textarea across an entire drag), so DOM focus
  // never actually leaves it, and a browser never re-fires 'focus' on an
  // element that's already the activeElement. Without restoring it here,
  // re-tapping the SAME still-focused line after a drag-drop did nothing at
  // all: focusedIndex stayed stuck at null (KeyboardAccessoryBar's own
  // mount condition), so "Acordes y rasgueo" never came back until the
  // person happened to tap some OTHER element first to force a real
  // blur/focus pair — reported 2026-10-16. Setting focusedIndex directly
  // (not relying on the native event) fixes it whether or not DOM focus
  // actually moved; calling .focus() on top keeps real DOM focus in sync
  // for whichever case it did. `overrideLineIndex` is for the drag case: a
  // dropped chord can land on a different line than the one the sheet was
  // opened from (it was opened off whatever line was focused BEFORE the
  // drag started), and the line that should end up focused afterward is
  // the one the chord actually landed on, not the stale open-time one.
  const closeChordSheet = useCallback((overrideLineIndex) => {
    const targetLineIndex = overrideLineIndex ?? chordSheet?.lineIndex;
    setChordSheet(null);
    setDropTargetIndex(null);
    if (targetLineIndex == null || !lines[targetLineIndex]) return;
    setFocusedIndex(targetLineIndex);
    rowRefs.current[lines[targetLineIndex].id]?.focus();
  }, [chordSheet, lines]);

  // Renames a chord already on a line — dropping onto, or switching the
  // palette to, a slot that already holds one overrides it rather than
  // stacking a second symbol there. The only one of the three chord writes
  // (insert / replace / renumber-after-removal) that never touches
  // `position`.
  const replaceChordName = useCallback(async (chordId, chordName) => {
    const existing = lineChords.find((c) => c.id === chordId);
    if (!existing || existing.chord_name === chordName) return;
    const { data } = await updateLineChord(chordId, { chord_name: chordName });
    setLineChords((cur) => cur.map((c) => (c.id === chordId ? (data || { ...c, chord_name: chordName }) : c)));
  }, [lineChords]);

  // Adds a brand-new chord at `index` within lineIndex's own sequence,
  // shifting every chord already at or past that index one slot to the
  // right and renumbering them — a line rarely holds more than a handful
  // of chords, so renumbering the lot on every change is simpler to reason
  // about (and far easier to verify) than maintaining gapped ranks for a
  // sequence this short.
  const insertChordAt = useCallback(async (lineIndex, index, chordName) => {
    const onLine = chordsByLine[lineIndex] || [];
    const at = Math.max(0, Math.min(index, onLine.length));
    const shifted = onLine.slice(at);
    const { data, error } = await addLineChord(lineId, lineIndex, { chordName, position: at });
    if (error || !data) return;
    if (shifted.length) await Promise.all(shifted.map((c) => updateLineChord(c.id, { position: c.position + 1 })));
    setLineChords((cur) => [
      ...cur.map((c) => (
        c.line_index === lineIndex && shifted.some((s) => s.id === c.id) ? { ...c, position: c.position + 1 } : c
      )),
      data,
    ]);
  }, [lineId, chordsByLine]);

  // Closes the gap left on a line after one of its chords is gone (removed
  // outright, or moved off to a different line) — every chord that was
  // after it shifts down by one so positions stay a clean 0..N-1 run.
  const closeChordGap = useCallback(async (lineIndex, removedPosition) => {
    const after = (chordsByLine[lineIndex] || []).filter((c) => c.position > removedPosition);
    if (!after.length) return;
    setLineChords((cur) => cur.map((c) => (
      c.line_index === lineIndex && c.position > removedPosition ? { ...c, position: c.position - 1 } : c
    )));
    await Promise.all(after.map((c) => updateLineChord(c.id, { position: c.position - 1 })));
  }, [chordsByLine]);

  const handlePickChord = useCallback((chordName) => {
    const target = chordSheet;
    if (!target || target.lineIndex == null) return;
    const name = (chordName || '').trim();
    if (!name || !lineId) return;
    // A tap has no drop point to resolve a slot from — it always appends,
    // which is also just "stack one more chord on this verse" in its
    // plainest form.
    insertChordAt(target.lineIndex, (chordsByLine[target.lineIndex] || []).length, name);
    closeChordSheet();
  }, [chordSheet, lineId, chordsByLine, insertChordAt, closeChordSheet]);

  // What a drop at this viewport point means for the line underneath it —
  // shared by a brand-new chord from the palette (handleDropChord) and an
  // existing pill being repositioned (handleMoveChordDrop), same as
  // resolveWordAtPoint used to be shared by both before this redesign.
  // Two outcomes, decided by what's actually under the finger rather than
  // by an invisible word boundary in the text:
  //  - landed on an existing pill → 'replace' that one (an override, same
  //    as switching the palette to a slot that already has a chord);
  //  - landed anywhere else on the line's own lyric → 'insert' at whatever
  //    position its x falls at among the chords already there, the same
  //    left-to-right fraction of the line's width computeChordSpans
  //    already lays them out across, so "drop near the middle of the
  //    verse" resolves to the same place it's drawn.
  // Hit-tests the REAL rendered pills (:not(.lc-pill-preview) — the
  // move-drag's own phantom is never a valid replace target), not a
  // character offset into the text: a chord has no idea what word, if any,
  // it's sitting over any more, so "did I land on an existing chord" can
  // only be answered by the chord's own rendered element.
  //
  // `excludeChordId` is for repositioning an already-placed chord
  // (chordMovePreview/handleMoveChordDrop): the instant the drag starts,
  // the pointer is still directly over the pill being dragged, which used
  // to resolve this to "replace the chord under the finger" — itself.
  // previewChordsByLine had ALREADY filtered that chord out of the array
  // by the time it tried to act on that, so the "replace" could never find
  // a match and silently dropped the phantom instead of rendering it —
  // which orphaned the dragged pill's own DOM node exactly like the
  // sheet-unmount bug fixed earlier, just from a different cause: nothing
  // in the new render carried its key any more, so React tore it down,
  // and the touch sequence (bound to that now-detached node) died with it.
  // Excluding the dragged chord's own pill from the hit-test means the
  // drag can never self-target — it always resolves to 'insert' at
  // wherever it currently sits among its (real) neighbours instead,
  // which is what a drag that hasn't moved yet should mean anyway.
  const resolveChordDropOnLine = useCallback((x, y, excludeChordId) => {
    const lineIndex = lineIndexFromPoint(x, y);
    if (lineIndex == null) return null;
    const text = lines[lineIndex]?.text ?? '';
    if (!text.trim()) return null; // an empty line has nothing to hold a chord
    const rowEl = document.querySelector(`[data-line-index="${lineIndex}"]`);
    const hitPill = rowEl
      ? Array.from(rowEl.querySelectorAll('.lc-pill:not(.lc-pill-preview)')).find((el) => {
        if (excludeChordId != null && el.dataset.chordId === String(excludeChordId)) return false;
        const r = el.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      })
      : null;
    if (hitPill) return { lineIndex, mode: 'replace', chordId: hitPill.dataset.chordId };

    const mirror = rowEl?.querySelector('.lc-mirror');
    const rect = mirror?.getBoundingClientRect();
    const count = (chordsByLine[lineIndex] || []).filter((c) => c.id !== excludeChordId).length;
    if (!rect || !rect.width) return { lineIndex, mode: 'insert', index: count };
    const frac = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    return { lineIndex, mode: 'insert', index: Math.round(frac * count) };
  }, [lines, chordsByLine]);

  // ChordStrumSheet's long-press-and-drag (via useLineDragDrop.js) →
  // dropped somewhere over the editor. Closes the sheet on a successful
  // drop rather than letting it revert to its full view (the
  // drag-collapsed strip un-collapsing back to the chip grid, per the
  // sheet's own drag mechanics) — same reasoning as handlePickChord's own
  // close: you just placed it, the lyric is what you want to see next, not
  // the palette again. A miss (no line under the point) leaves the sheet
  // as-is — nothing happened, so nothing closes.
  const handleDropChord = useCallback((x, y, chordName) => {
    setDropTargetIndex(null);
    const target = resolveChordDropOnLine(x, y);
    if (!target) return;
    const name = (chordName || '').trim();
    if (!name) return;
    if (target.mode === 'replace') replaceChordName(target.chordId, name);
    else insertChordAt(target.lineIndex, target.index, name);
    closeChordSheet(target.lineIndex);
  }, [resolveChordDropOnLine, replaceChordName, insertChordAt, closeChordSheet]);

  const handleRemoveChord = useCallback(async (id) => {
    const removed = lineChords.find((c) => c.id === id);
    setLineChords((cur) => cur.filter((c) => c.id !== id));
    await deleteLineChord(id);
    if (removed) await closeChordGap(removed.line_index, removed.position);
  }, [lineChords, closeChordGap]);

  // Reorganizing an already-placed chord: long-press a pill (LineChordStrip's
  // own ChordPillView, via useLongPressDrag) and drag it onto a new spot —
  // same line, reordered, or a different line entirely, resolved through
  // the exact same resolveChordDropOnLine a brand-new chord from the
  // palette uses (it has no idea the chord it's resolving a drop for
  // already existed somewhere else). Dropped onto another chord's pill,
  // it overrides that one exactly like a fresh chord would — the dragged
  // chord is consumed into whichever slot it landed on, not duplicated.
  const moveChordTo = useCallback(async (chordId, target) => {
    if (!target) return; // dropped nowhere valid — leave it exactly where it was
    const dragged = lineChords.find((c) => c.id === chordId);
    if (!dragged) return;

    if (target.mode === 'replace') {
      if (target.chordId === chordId) return; // dropped back on itself
      await replaceChordName(target.chordId, dragged.chord_name);
      setLineChords((cur) => cur.filter((c) => c.id !== chordId));
      await deleteLineChord(chordId);
      await closeChordGap(dragged.line_index, dragged.position);
      return;
    }

    const fromLine = dragged.line_index;
    const toLine = target.lineIndex;

    if (fromLine === toLine) {
      const onLine = (chordsByLine[toLine] || []).filter((c) => c.id !== chordId);
      const at = Math.max(0, Math.min(target.index, onLine.length));
      const reordered = [...onLine.slice(0, at), dragged, ...onLine.slice(at)];
      setLineChords((cur) => cur.map((c) => {
        const i = reordered.findIndex((r) => r.id === c.id);
        return i === -1 ? c : { ...c, position: i };
      }));
      await Promise.all(reordered.map((c, i) => (c.position === i ? null : updateLineChord(c.id, { position: i }))));
      return;
    }

    // A different line: close the gap on the old one, make room on the new
    // one, then give the chord itself its new line + position.
    const toOnLine = chordsByLine[toLine] || [];
    const at = Math.max(0, Math.min(target.index, toOnLine.length));
    const toReordered = [...toOnLine.slice(0, at), dragged, ...toOnLine.slice(at)];
    setLineChords((cur) => cur.map((c) => {
      if (c.id === chordId) return { ...c, line_index: toLine, position: at };
      const ti = toReordered.findIndex((r) => r.id === c.id);
      if (ti !== -1) return { ...c, position: ti };
      return c;
    }));
    await updateLineChord(chordId, { line_index: toLine, position: at });
    await Promise.all(toReordered.map((c, i) => (c.id !== chordId && c.position !== i ? updateLineChord(c.id, { position: i }) : null)));
    await closeChordGap(fromLine, dragged.position);
  }, [lineChords, chordsByLine, replaceChordName, closeChordGap]);

  // The drop half of a pill drag — resolveChordDropOnLine above, same as a
  // brand-new chord from the palette. `payload` is { id, chordName } — the
  // name is only for the floating pill's own label while it's in flight,
  // the move itself only needs id.
  const handleMoveChordDrop = useCallback((x, y, payload) => {
    setDropTargetIndex(null);
    moveChordTo(payload.id, resolveChordDropOnLine(x, y, payload.id));
  }, [resolveChordDropOnLine, moveChordTo]);

  // Owns the live drag itself (document-level listeners, hover, the
  // floating pill) exactly like ChordStrumSheet/ResourcePickerSheet do via
  // the same hook — except there's no sheet here to shrink: the drag starts
  // straight from a pill already sitting in the lyric, so NoteEditorScreen
  // is the drag's whole lifetime, not a sheet it opens.
  const { drag: chordMoveDrag, beginDrag: handleChordMoveStart } = useLineDragDrop({
    onDragHoverLine: setDropTargetIndex,
    onDragActiveChange: setExternalDragActive,
    onDrop: handleMoveChordDrop,
  });

  // While an existing pill is mid-drag, where would it land right now? Same
  // resolveChordDropOnLine handleMoveChordDrop uses to actually commit the
  // move — this is the identical lookup, just run on every hover tick
  // instead of once on release, purely to drive the phantom-pill preview
  // below (previewChordsByLine).
  const chordMovePreview = useMemo(() => {
    if (!chordMoveDrag) return null;
    return resolveChordDropOnLine(chordMoveDrag.x, chordMoveDrag.y, chordMoveDrag.payload.id);
  }, [chordMoveDrag, resolveChordDropOnLine]);

  // The sequence every OTHER chord on the origin and destination lines
  // would settle into if the drag ended right now — without touching real
  // state until it actually does (handleMoveChordDrop). Pulls the dragged
  // chord out of wherever chordsByLine currently has it and splices a
  // phantom copy (`preview: true`) in at chordMovePreview's resolved spot,
  // same id, so LineChordStrip's own key={c.id}/placement machinery reads
  // it as the SAME pill continuing to move rather than one disappearing
  // and a different one appearing — same "preview, don't mutate real
  // state" shape previewOverride above already uses for a dragged Muse
  // suggestion. A preview landing in 'replace' mode takes over the target
  // pill's own array slot (so it inherits that slot's position rather than
  // jumping to the end) instead of removing it outright — the target chord
  // is still really there until the drop commits, this is only what it
  // would look like if it didn't survive.
  //
  // The phantom MUST appear somewhere on every single render for as long
  // as chordMoveDrag is truthy, even hovering nowhere valid (between
  // lines, off any row, or — the very first tick, before any real
  // movement — still directly over the pill's own original spot, which
  // resolveChordDropOnLine now deliberately can't resolve to "replace
  // itself" either). This used to just omit the phantom in that case
  // ("informative on its own: this chord has been picked up"), which
  // reads fine visually but is NOT fine structurally: the live touch
  // sequence is bound to whatever DOM node React rendered for this
  // chord's key on the PREVIOUS tick, and a render that drops every
  // element carrying that key unmounts it — severing the sequence for
  // good, the exact same class of bug fixed for ChordStrumSheet/
  // ResourcePickerSheet, just triggered by a different path (reported
  // again 2026-10-16 as "the drag stops until you get it again"). Falling
  // back to the dragged chord's own last real line/position keeps a
  // matching key alive on every tick regardless of where the finger is.
  const previewChordsByLine = useMemo(() => {
    if (!chordMoveDrag) return chordsByLine;
    const draggedId = chordMoveDrag.payload.id;
    const dragged = lineChords.find((c) => c.id === draggedId);
    const map = {};
    Object.entries(chordsByLine).forEach(([lineIndex, arr]) => {
      const kept = arr.filter((c) => c.id !== draggedId);
      if (kept.length) map[lineIndex] = kept;
    });
    const phantom = { id: draggedId, chordName: chordMoveDrag.payload.chordName, preview: true };
    if (chordMovePreview) {
      const { lineIndex, mode, index, chordId } = chordMovePreview;
      const target = map[lineIndex] || [];
      if (mode === 'replace') {
        map[lineIndex] = target.map((c) => (c.id === chordId ? phantom : c));
      } else {
        const at = Math.max(0, Math.min(index, target.length));
        map[lineIndex] = [...target.slice(0, at), phantom, ...target.slice(at)];
      }
    } else if (dragged) {
      const line = map[dragged.line_index] || [];
      const at = Math.max(0, Math.min(dragged.position, line.length));
      map[dragged.line_index] = [...line.slice(0, at), phantom, ...line.slice(at)];
    }
    return map;
  }, [chordMoveDrag, chordMovePreview, chordsByLine, lineChords]);

  // ─── Strum pattern ────────────────────────────────────────────────────────
  const handleSaveStrum = useCallback(async (bpmValue, pattern) => {
    // Optimistic: the strip should show the pattern the moment Guardar is
    // tapped, not a round trip later — a save that fails leaves the local
    // copy, which is the same tradeoff every other write on this screen makes.
    setStrum((cur) => ({ ...(cur || {}), section_id: note.id, bpm: bpmValue, pattern }));
    const { data } = await saveStrumPattern(note.id, bpmValue, pattern);
    if (data) setStrum(data);
  }, [note.id]);

  const handleDeleteStrum = useCallback(async () => {
    setStrum(null);
    await deleteStrumPattern(note.id);
  }, [note.id]);

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

  // LineRow's long-press-the-verse gesture. Silently no-ops on an empty
  // line (nothing to copy) or if the Clipboard API isn't available in this
  // context — same defensive style as MuseEyeScreen's own clipboard write,
  // the only other place this app touches it.
  const handleLongPressCopy = useCallback((index) => {
    const text = lines[index]?.text?.trim();
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => {
      navigator.vibrate?.(12);
      setCopyToast(true);
      clearTimeout(copyToastTimerRef.current);
      copyToastTimerRef.current = setTimeout(() => setCopyToast(false), 1400);
      // Deliberately no requestAnimationFrame-based "clear then re-set" dance
      // here to force the keyframe animation to restart on a same-line
      // re-copy — rAF is throttled/suspended in backgrounded or inactive
      // tabs (confirmed while testing this: it silently never fired at
      // all), which would make the flash randomly not show rather than
      // just not replaying cleanly on the rare back-to-back-same-line case.
      setCopiedIndex(index);
      clearTimeout(copiedFlashTimerRef.current);
      copiedFlashTimerRef.current = setTimeout(() => setCopiedIndex(null), 650);
    }).catch(() => {});
  }, [lines]);

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
  // "Copiado" toast + a brief flash on the row itself, after a
  // long-press-the-verse copy (see handleLongPressCopy). Two signals on
  // purpose — a bottom toast alone is easy to miss since a long-press
  // keeps your eyes on the line, not the bottom of the screen; the flash
  // is the one that actually answers "did that work?" where you're
  // already looking.
  const [copyToast, setCopyToast] = useState(false);
  const copyToastTimerRef = useRef(null);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const copiedFlashTimerRef = useRef(null);

  useEffect(() => () => {
    clearTimeout(undoTimerRef.current);
    clearTimeout(blurCleanupRef.current);
    clearTimeout(copyToastTimerRef.current);
    clearTimeout(copiedFlashTimerRef.current);
  }, []);

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
    activePopover || toolsOpen || baulOpen || variantSheetOpen
    || wordVariantSheet || lineHistorySheet != null || resourcePicker || chordSheet,
  );

  // Consumed exactly once, on the render where NoteAudioBar actually mounts
  // (any earlier render — e.g. still inside the 300ms blur grace period —
  // leaves it armed) so the audio-icon's request to open expanded survives
  // until there's really a mount to apply it to, and never leaks into the
  // next ordinary tap-away.
  const audioBarVisible = audioRecording || (focusedIndex == null && !anyOverlayOpen);
  const audioBarStartExpanded = audioBarVisible && audioBarOpenIntentRef.current;
  if (audioBarVisible) audioBarOpenIntentRef.current = false;

  return (
    <MobileScreen className="ne-screen">
      <div className="ne-body">
        {/* Dims during any chord/resource drag (externalDragActive) — the
            whole point of collapsing the sheet to a strip is that the
            lyric becomes the thing being looked at, and a full-strength
            header competing for attention above it undercuts that. */}
        <div className={`ne-header${externalDragActive ? ' ne-header-drag-dim' : ''}`}>
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
          <button className="ne-done" onClick={onClose}>Hecho</button>
        </div>

        {/* The recorded right-hand strum for this whole section, surfaced
            right under the header — above the lyric sheet, not inside it,
            because it belongs to the section rather than to any one line
            (unlike the chord pills, which sit on their own words). Tapping
            it reopens the recorder on the Rasgueo tab. Hidden entirely when
            nothing has been recorded: an empty "no strum yet" row would be
            permanent chrome earning nothing. */}
        {strum?.pattern?.length > 0 && (
          <TempoStrumCard bpm={strum.bpm} strumPattern={strum.pattern} onClick={() => setChordSheet({ tab: 'strum' })} />
        )}

        <div className={`ne-sheet${externalDragActive ? ' ne-sheet-drag-active' : ''}`}>
        {lines.map((line, i) => (
          <LineRow
            key={line.id}
            id={line.id}
            index={i}
            text={line.text}
            previewText={
              previewOverride?.lineIndex === i ? previewOverride.text
                : (resourceDragPreview?.mode === 'into' && resourceDragPreview.lineIndex === i ? resourceDragPreview.previewText : null)
            }
            syllables={syllableCounts[i]}
            rhyme={rhymeLines[i]}
            friction={frictionFlags[i]}
            showPlaceholder={i === lines.length - 1}
            dimmed={focusModeOn && focusedIndex !== null && focusedIndex !== i}
            variantRanges={variantRangesByLine[i]}
            chords={previewChordsByLine[i]}
            hasHistory={lineHistoryByIndex[i]?.length > 0}
            onChange={handleLineChange}
            onEnter={handleEnter}
            onPasteLines={handlePasteLines}
            onBackspaceAtStart={handleBackspaceAtStart}
            onFocus={handleRowFocus}
            onBlurLine={handleBlurLine}
            onSelectionChange={setSelection}
            onFrictionTap={handleFrictionTap}
            onVariantTap={handleVariantTap}
            onHistoryTap={handleHistoryTap}
            onLongPressCopy={handleLongPressCopy}
            onRemoveChord={handleRemoveChord}
            onMoveChordStart={handleChordMoveStart}
            justCopied={copiedIndex === i}
            dropTarget={dropTargetIndex === i}
            inputRef={(id, el) => {
              if (el) rowRefs.current[id] = el;
              else delete rowRefs.current[id];
            }}
          />
        ))}
        </div>
      </div>

      {/* The one bar docked above the keyboard while editing a line. Rima
          and Alternativa go disabled when there's no text selection;
          Recursos doesn't need one (see handleOpenResourcePicker). */}
      {focusedIndex != null && !anyOverlayOpen && (
        <KeyboardAccessoryBar
          hasSelection={!!selection}
          canUndo={undoRef.current.undo.length > 0}
          canRedo={undoRef.current.redo.length > 0}
          onMuse={() => runBarAction(handleAskMuse)}
          onRhyme={() => runBarAction(() => openPopover('rhyme'))}
          onAlternative={() => runBarAction(handleAddVariantFromSelection)}
          onCulture={() => runBarAction(handleCultureFromSelection)}
          onResource={() => runBarAction(handleOpenResourcePicker)}
          onUndo={() => runBarAction(handleUndo)}
          onRedo={() => runBarAction(handleRedo)}
          onAudio={handleOpenAudioBar}
          onChord={() => runBarAction(handleOpenChordSheet)}
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

      {copyToast && !lastReplacement && !anyOverlayOpen && (
        <div className="ne-undo-toast"><span>Copiado</span></div>
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

      {resourcePicker && (
        <ResourcePickerSheet
          userId={userId}
          onInsert={handleInsertResource}
          onClose={() => closeResourcePicker()}
          onDragHoverLine={handleResourceDragHover}
          onDropOnLine={handleDropResourceOnLine}
          onDragActiveChange={setExternalDragActive}
        />
      )}

      {/* "Between verses" half of the resource drag preview — no existing
          line to borrow previewText from (there isn't one yet), so unlike
          the "into this line" half this is its own floating ghost row,
          positioned off resourceDragPreview's own captured rect rather than
          spliced into the real lines array: inserting a phantom entry there
          would shift every OTHER per-line array (syllableCounts, rhymeLines,
          chordsByLine, …) out of alignment with it for the length of the
          drag, for a view nothing is actually that array. */}
      {resourceDragPreview && resourceDragPreview.mode !== 'into' && resourceDragPreview.rect && (
        <div
          className="resource-line-preview"
          style={{
            top: resourceDragPreview.mode === 'before' ? resourceDragPreview.rect.top : resourceDragPreview.rect.bottom,
            left: resourceDragPreview.rect.left,
            width: resourceDragPreview.rect.width,
          }}
        >
          {resourceDragPreview.resource.body}
        </div>
      )}

      {chordSheet && (
        <ChordStrumSheet
          initialTab={chordSheet.tab || 'chords'}
          savedPattern={strum?.pattern || []}
          savedBpm={strum?.bpm}
          onPickChord={handlePickChord}
          onSavePattern={handleSaveStrum}
          onDeletePattern={handleDeleteStrum}
          onDragHoverLine={setDropTargetIndex}
          onDropChord={handleDropChord}
          onDragActiveChange={setExternalDragActive}
          onClose={() => closeChordSheet()}
        />
      )}

      {/* An already-placed chord being dragged to a new word — no sheet to
          shrink here (the drag starts straight from the pill, not from a
          palette), just the same hint + floating pill vocabulary every
          other line-drag uses (LineDragPill.jsx, .res-picker-drag-hint).
          The target itself is just the line highlight every line-drag
          already gets (dropTargetIndex → LineRow's .ne-row-drop-target) —
          no separate per-word box; a chord is assigned to the verse, not a
          word (see resolveWordAtPoint's own comment on why the anchor
          still needs one without that being shown as the drag target). */}
      {chordMoveDrag && (
        <>
          <p className="res-picker-drag-hint chord-move-hint">Suelta sobre la palabra donde cambia el acorde</p>
          <LineDragPill x={chordMoveDrag.x} y={chordMoveDrag.y} className="cs-drag-pill">
            {chordMoveDrag.payload.chordName}
          </LineDragPill>
        </>
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

      {/* FAB (Baúl / Variante / Herramientas / Eliminar). Hidden while a
          word is selected (focused single-purpose moment), while
          recording, or while any bottom sheet owns the space
          (anyOverlayOpen). The syllable toggle moved to
          KeyboardAccessoryBar, but ToolsSheet still owns whole-verse
          comments, Focus Mode and the per-note repeated-words check, so it
          keeps its own entry point here. "Eliminar esta parte" used to be
          its own "···" menu in the header (a whole button, backdrop and
          sheet for exactly one action) — folded in here instead so there's
          one less tappable thing in the header; handleDelete still runs
          its own confirm() before anything happens. */}
      {!selection && !audioRecording && !anyOverlayOpen && (
        <FabMenu
          pills={[
            { label: 'Baúl de la inspiración', icon: <IcMuse size={18} />, dark: true, onClick: () => setBaulOpen(true) },
            { label: 'Variante', icon: <IcPencil size={18} />, iconVariant: 'thread', onClick: () => setVariantSheetOpen(true) },
            { label: 'Herramientas', icon: <IcTools size={18} />, onClick: () => setToolsOpen(true) },
            { label: 'Eliminar esta parte', icon: <IcTrash size={18} />, danger: true, onClick: handleDelete },
          ]}
        />
      )}

      {/* Always-present voice-memo affordance (see NoteAudioBar). Kept
          mounted while recording (it becomes the floating red stop button);
          hidden whenever KeyboardAccessoryBar owns the bottom edge (any line
          focused, not just while text is actually selected — a caret with
          no selection still leaves the accessory bar up) or any other
          bottom sheet is open, so it never stacks under/over another
          fixed-bottom surface. */}
      {audioBarVisible && (
        <NoteAudioBar
          sectionId={note.id}
          songId={songId}
          memos={audioBySection}
          startExpanded={audioBarStartExpanded}
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
        focusModeOn={focusModeOn}
        onToggleFocusMode={() => setFocusModeOn((v) => !v)}
      />
    </MobileScreen>
  );
}
