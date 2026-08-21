import { useState, useEffect, useCallback, useRef } from 'react';
import { askMuse, getCulturalProvocation, getImageGenealogy, guessConceptFromLine } from '../utils/museApi.js';
import { saveMuseTurn, loadMuseProfile } from '../canvas/museData.js';
import { recordMuseTurnAndMaybeUpdateProfile } from '../canvas/museProfileUpdater.js';

const TYPE_LABELS = { CONTINUITY: 'continuity', CONTRAST: 'contrast', RESOLUTION: 'resolution' };

// Regeneration is capped per turn to prevent decision paralysis: the
// model's up-to-6 candidates per call (see museApi.js) are held as a local
// queue — discarding just advances to the next one, instant, no network,
// works offline — but once the whole queue is exhausted, pulling a
// genuinely fresh batch is a real API call, and only 3 of those are
// allowed per turn.
const MAX_REGENS_PER_TURN = 3;

// How far a drag has to travel before it commits — kept short on purpose,
// a full-width swipe felt like it required "extreme" effort to trigger.
const SWIPE_COMMIT_PX = 36;
const PREVIEW_COMMIT_PX = 20;

// Best-effort haptic — silently a no-op on desktop browsers / devices
// without the Vibration API, and on Android requires the VIBRATE manifest
// permission (see android/app/src/main/AndroidManifest.xml) to actually
// produce feedback once this ships as a native build.
function haptic(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported — fine */ }
}

// Tracks how much the on-screen keyboard is covering the viewport, so the
// sheet can dock flush above it instead of getting hidden underneath (design
// ref: references/bottomTabMuse.jpg — "el teclado se ancla al fondo real de
// la pantalla y el sheet se acopla justo encima"). visualViewport shrinks
// (and offsetTop can grow) exactly when the keyboard opens, on the mobile
// browsers that support it — the gap between window.innerHeight and that
// shrunk viewport IS the keyboard's height. 0 (the default, no inline
// style override) just falls back to .mp-anchored's own `bottom: 0`.
function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const gap = window.innerHeight - vv.height - vv.offsetTop;
      setInset(Math.max(0, Math.round(gap)));
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    onResize();
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
    };
  }, []);
  return inset;
}

// A single swipeable card — deliberately only ever ONE rendered at a time
// (see the deck render below), not a fanned Tinder-style stack: a "peek of
// the next card behind" needs the front card to be fully opaque to occlude
// it, which put the outer .mp-anchored panel's own chrome and the card's
// chrome side by side as two nested pills, AND (once that was flattened to
// fix the double-chrome look) let the stacked card's text bleed straight
// through the now-transparent front card. Rendering exactly one card sidesteps
// both: nothing sits behind it to either double up the chrome or bleed through.
// Discarding just swaps the array's next entry into this same slot (handled
// by MusePopover's handleDiscard) — "gives space to the next one," a clean
// replacement, not a reveal of something that was already visible behind it.
//
// Tracks both drag axes from touchstart, locks whichever one the gesture
// actually commits to once movement clears a small threshold (standard
// mobile disambiguation — a diagonal thumb movement shouldn't flicker
// between "swiping" and "dragging up"):
//   horizontal: swipe left = discard, swipe right = accept
//   vertical (up only): drag the card up "into" the line to preview it
//   inline before committing — onPreview mirrors the live text into the
//   real line while dragging, cleared on release either way.
function SuggestionCard({ suggestion, showReplace, onDiscard, onAccept, onInsertBelow, onPreview }) {
  const [dragX, setDragX] = useState(0);
  const [dragY, setDragY] = useState(0);
  const dragging = useRef(false);
  const axis = useRef(null);
  const start = useRef({ x: 0, y: 0 });

  const reset = useCallback(() => {
    dragging.current = false;
    axis.current = null;
    setDragX(0);
    setDragY(0);
  }, []);

  const handleTouchStart = useCallback((e) => {
    dragging.current = true;
    axis.current = null;
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!dragging.current) return;
    const dx = e.touches[0].clientX - start.current.x;
    const dy = e.touches[0].clientY - start.current.y;
    if (!axis.current) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return; // not enough movement to commit to an axis yet
      axis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (axis.current === 'x') {
      setDragX(dx);
    } else if (dy < 0) {
      setDragY(dy);
      onPreview(dy < -15 ? suggestion.text : null);
    }
  }, [onPreview, suggestion.text]);

  const handleTouchEnd = useCallback(() => {
    if (!dragging.current) return;
    if (axis.current === 'x') {
      if (dragX < -SWIPE_COMMIT_PX) { haptic(15); onDiscard(); return; }
      if (dragX > SWIPE_COMMIT_PX) { haptic([10, 30, 10]); onAccept(); return; }
    } else if (axis.current === 'y') {
      onPreview(null);
      if (dragY < -PREVIEW_COMMIT_PX) { haptic([10, 30, 10]); onAccept(); return; }
    }
    reset();
  }, [dragX, dragY, onDiscard, onAccept, onPreview, reset]);

  const translate = axis.current === 'y' ? `translateY(${dragY}px)` : `translateX(${dragX}px)`;
  const dragMagnitude = Math.max(Math.abs(dragX), Math.abs(dragY));
  // Color feedback while dragging horizontally, full intensity right at the
  // commit threshold (SWIPE_COMMIT_PX, same value handleTouchEnd checks) so
  // the color finishing "filling in" lines up exactly with the point a
  // release would actually commit the swipe. Left = discard (red/--rose),
  // right = accept (green/--thread) — no color during a vertical
  // drag-to-preview, that gesture previews inline rather than committing on
  // release direction.
  const swipeIntensity = axis.current === 'x' ? Math.min(1, Math.abs(dragX) / SWIPE_COMMIT_PX) : 0;
  const swipeColor = dragX < 0 ? 'var(--rose)' : 'var(--thread)';

  return (
    <div
      className="mp-deck-card"
      style={{
        transform: translate,
        opacity: Math.max(0, 1 - dragMagnitude / 220),
        background: swipeIntensity > 0 ? `color-mix(in srgb, ${swipeColor} ${Math.round(swipeIntensity * 30)}%, var(--bg))` : undefined,
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {suggestion.type && <span className="mp-card-type">{TYPE_LABELS[suggestion.type] || suggestion.type}</span>}
      <p className="mp-card-text">{suggestion.text}</p>
      <div className="mp-card-actions">
        <button className="mp-card-btn" onClick={onDiscard}>Discard</button>
        {showReplace && <button className="mp-card-btn" onClick={onInsertBelow}>Insert below</button>}
        <button className="mp-card-btn mp-card-btn-primary" onClick={onAccept}>
          {showReplace ? 'Replace' : 'Insert below'}
        </button>
      </div>
    </div>
  );
}

// The one popover shell for all 5 muse modes (SURGEON/ARCHITECT/SOCRATIC/
// WORD_BANK/OPEN_REFERENCE) — same askMuse() call as desktop's MuseFloatNode, just a
// mobile-native, single-shot presentation instead of a persistent chat
// thread ("Zero-Chat" per the HCI spec this was built against): each mode
// renders straight from the latest askMuse response, no visible scrolling
// history.
//
// Presentation: a bottom-docked sheet over a dimming scrim (design ref:
// references/bottomTabMuse.jpg), not anchored directly under the verse
// line — the line itself is marked instead (.ne-row-muse-origin, driven by
// NoteEditorScreen's museOrigin/originIsReal), and the sheet quotes it
// again in its own .mp-quote-box, so "which line" reads from two places at
// once without the sheet needing to track that line's on-screen position.
// useKeyboardInset docks the sheet flush above the keyboard once an input
// inside it (the SOCRATIC reply composer, or a concept/genealogy ask form)
// gains focus. SURGEON/ARCHITECT render as a swipeable card deck, SOCRATIC
// as a question + chips + free-reply banner, WORD_BANK as a scrollable pill
// grid — all inside the same sheet shell.
//
// Two ways in:
// 1. Selection callout (Rhyme / Concept / Genealogía / Ask muse pills) —
//    targetVerse is a real {text, before, after} fragment.
//    - Rhyme AND Concept both pass forceMode: 'WORD_BANK', since a
//      dedicated UI element already unambiguously means "give me real
//      words" — leaving that to the model's free interpretation (the
//      original version of this popover) was exactly the "why buttons if
//      they both just re-interpret" gap this fixes. Concept asks for words
//      related to the selection BY MEANING (the concept-filter WORD_BANK
//      path — see museApi.js's filterWordBankByConcept), not by rhyme.
//    - Genealogía calls getImageGenealogy directly — a client-forced
//      action, not an askMuse turn at all (same reasoning as ángulo
//      cultural below), since the UI already decided what's being asked.
//    Concept and Genealogía SHARE one confirm/ask step (conceptStage —
//    "¿buscamos palabras relacionadas con X?" / "¿genealogía cultural de
//    X?") before either ever fires: a real report showed that auto-firing
//    on a raw selection with no chance to correct it made the guessed
//    concept unreviewable. Tapping "Es otro concepto" drops to the "ask"
//    sub-state (a plain text input) for typing a different one. Ask muse
//    leaves the mode open (SURGEON/ARCHITECT/SOCRATIC, model's call), same
//    as desktop.
// 2. The inline "Musa, ..." wake-word line, or a tap on the friction nudge
//    (NoteEditorScreen) — targetVerse is null and seedMessage carries the
//    intent verbatim.
export default function MusePopover({
  mode, targetVerse, seedMessage, verseText, noteFunction, lyricDna,
  lyricLanguage, lyricDialect, songStructure, songId, sectionId,
  originIsReal = true,
  onClose, onReplace, onInsertBelow, onPreviewText = () => {},
}) {
  // Concept AND genealogy modes (creativity proposals #3 and "genealogía de
  // la imagen") don't auto-fire on mount — both need a confirm/ask step
  // first (see conceptStage below), so they start in the confirm/ask UI,
  // not the loading spinner every other mode shows immediately.
  const [loading, setLoading] = useState(mode !== 'concept' && mode !== 'genealogy');
  const [error, setError] = useState(null);
  // Shared by BOTH concept and genealogy modes — same confirm-a-concept-
  // first UX either way, just a different action fires once confirmed (see
  // handleConceptConfirm below). 'confirm' when there's a selection to
  // confirm as-is (the concept/idea IS the selected text, no guessing
  // needed, just a review step), 'ask' when the user rejected the guess
  // ("Es otro concepto") and needs to type a different one, 'sent' once the
  // actual action has fired (hides this block either way). Initialized once
  // at mount from targetVerse — stable for this popover's whole life, same
  // reasoning as firstTurnRef below.
  const [conceptStage, setConceptStage] = useState(() => (targetVerse ? 'confirm' : 'ask'));
  const [conceptDraft, setConceptDraft] = useState(() => targetVerse?.text || '');
  // Genealogía de la imagen — its own result state, separate from
  // provocation's: unlike ángulo cultural (ONE frame/tropo), this returns
  // SEVERAL distinct references at once (see getImageGenealogy).
  // genealogyResult can be null, {references}, or {needsClarification} —
  // same elided-subject case as provocation above.
  const [genealogyLoading, setGenealogyLoading] = useState(false);
  const [genealogyResult, setGenealogyResult] = useState(null);
  const [genealogyAttempted, setGenealogyAttempted] = useState(false);
  const [genealogyClarificationDraft, setGenealogyClarificationDraft] = useState('');
  const genealogyHistoryRef = useRef([]);
  const [response, setResponse] = useState(null);
  const [conversation, setConversation] = useState([]);
  // One linear queue of the model's up-to-6 candidates — only queue[0] is
  // ever shown (see the single-card rendering below); discarding just drops
  // the front and the next one takes its place, no network call, until the
  // whole queue is exhausted. Only then does a real regenerate happen, up
  // to MAX_REGENS_PER_TURN times.
  const [queue, setQueue] = useState([]);
  const regenCount = useRef(0);
  // LOCAL profile — what THIS block (the open note) is about, loaded once
  // per sectionId, same reasoning as MuseFloatNode's own blockProfile
  // state on desktop. Zero-Chat means no visible thread, but the
  // underlying block-scoped memory is the same either way. Whole-song
  // context comes from songStructure (real raw text), not a separate
  // stored field.
  const [blockProfile, setBlockProfile] = useState('');
  // Both targetVerse and forceMode only apply to the turn that actually
  // opened this popover — a SOCRATIC follow-up chip is a fresh message
  // about whatever the model just asked, not a re-statement of the
  // original selection, and WORD_BANK has no chip-based follow-up defined
  // here anyway (forceMode would just be dead weight past turn one).
  const firstTurnRef = useRef(true);
  // session_angles_history — rhyme words and cultural frames the Cultural
  // Resonance Engine has already surfaced for this popover's session (see
  // museApi.js's buildCulturalResonance), so a swipe-left regenerate never
  // hands back the same mandatory word or refrán/tropo twice. Reset
  // naturally on every fresh open, since this whole component remounts
  // then (NoteEditorScreen only ever renders one at a time).
  const angleHistoryRef = useRef({ words: [], frames: [] });
  // Creativity proposal #4 — a cultural angle to react to, offered as a
  // static affordance on any SOCRATIC turn (not something the model has to
  // remember to propose as a chip). null distinguishes "never tried yet"
  // from "tried and genuinely found nothing" (provocationAttempted).
  // Cleared on every fresh `send` so a stale angle from a previous SOCRATIC
  // turn never lingers under a new question.
  // provocation can be null, {frame, tropo}, or {needsClarification} — the
  // elided-subject case (see museApi.js's SUBJECT_RESOLUTION_INSTRUCTION):
  // rather than guess who/what a line's implicit subject is, the model can
  // ask, and handleCulturalProvocationClarify re-runs with the artist's own
  // answer. null distinguishes "never tried yet" from "tried and genuinely
  // found nothing" (provocationAttempted). Cleared on every fresh `send` so
  // a stale angle from a previous SOCRATIC turn never lingers under a new
  // question.
  const [provocation, setProvocation] = useState(null);
  const [provocationLoading, setProvocationLoading] = useState(false);
  const [provocationAttempted, setProvocationAttempted] = useState(false);
  // 'idle' (button not pressed yet) | 'confirm' (showing the free guess,
  // guessConceptFromLine) | 'ask' (no guess, or user said "that's not it" —
  // free-text input). Never fires getCulturalProvocation until the concept
  // is confirmed/typed — see handleCulturalProvocationStart below.
  const [provocationStage, setProvocationStage] = useState('idle');
  const [provocationConceptDraft, setProvocationConceptDraft] = useState('');
  const [provocationClarificationDraft, setProvocationClarificationDraft] = useState('');
  // SOCRATIC's free-typed reply (design ref: references/bottomTabMuse.jpg)
  // — sits alongside the model's own chips as the open-ended fallback for
  // whenever none of them are actually the answer.
  const [replyDraft, setReplyDraft] = useState('');

  useEffect(() => {
    if (!sectionId) return;
    let cancelled = false;
    loadMuseProfile(sectionId).then(({ data }) => { if (!cancelled) setBlockProfile(data?.summary || ''); });
    return () => { cancelled = true; };
  }, [sectionId]);

  const send = useCallback(async (message, { isRegen = false } = {}) => {
    setLoading(true);
    setError(null);
    setProvocation(null);
    setProvocationAttempted(false);
    setProvocationStage('idle');
    try {
      const isFirstTurn = firstTurnRef.current;
      const res = await askMuse({
        verseText, noteFunction, blockProfile, lyricDna, userMessage: message,
        conversation,
        lang: lyricLanguage, dialect: lyricDialect,
        songStructure,
        targetVerse: isFirstTurn ? targetVerse : null,
        // 'concept' (SelectionCallout's "Concept" pill, creativity proposal
        // #3) is also forced straight to WORD_BANK — same reasoning as
        // 'rhyme': a dedicated UI element already unambiguously means "find
        // real words related to this," no need to leave it to the model's
        // own mode judgment. The concept text itself travels as the
        // userMessage (see the seed below); parseWordBank/queryWordBank
        // handle a concept with no rhyme just fine (see museApi.js).
        forceMode: isFirstTurn && (mode === 'rhyme' || mode === 'concept') ? 'WORD_BANK' : null,
        // No debug/inline-panel concept on mobile — but every real call
        // still lands in the debug log automatically (see askMuse), same
        // as desktop, so it shows up in MuseEyeScreen's history too.
        meta: { songId, nodeLabel: noteFunction },
        excludeRhymeWords: angleHistoryRef.current.words,
        excludeCulturalFrames: angleHistoryRef.current.frames,
      });
      firstTurnRef.current = false;
      if (res.culturalResonance?.enabled) {
        const { mandatoryWord, culturalFrame } = res.culturalResonance;
        if (mandatoryWord && !angleHistoryRef.current.words.includes(mandatoryWord)) {
          angleHistoryRef.current.words.push(mandatoryWord);
        }
        if (culturalFrame && !angleHistoryRef.current.frames.includes(culturalFrame)) {
          angleHistoryRef.current.frames.push(culturalFrame);
        }
      }
      setResponse(res);
      setQueue(res.action_type === 'SURGEON' || res.action_type === 'ARCHITECT' ? (res.suggestions || []) : []);
      if (!isRegen) regenCount.current = 0;
      const optionsForHistory = res.action_type === 'WORD_BANK' ? res.wordBank
        : res.action_type === 'SOCRATIC' ? res.question?.options
        : res.suggestions;
      setConversation((c) => [
        ...c,
        { role: 'user', content: message },
        { role: 'muse', content: res.message, action_type: res.action_type, options: optionsForHistory },
      ]);
      if (songId && sectionId) {
        saveMuseTurn(songId, sectionId, message, res);
        recordMuseTurnAndMaybeUpdateProfile({ songId, sectionId, existingBlockProfile: blockProfile })
          .then((result) => { if (result != null) setBlockProfile(result); });
      }
    } catch (err) {
      setError(err.message === 'LIMIT_REACHED' ? 'daily AI limit reached — try again tomorrow' : err.message);
    } finally {
      setLoading(false);
    }
  }, [verseText, noteFunction, blockProfile, lyricDna, conversation, lyricLanguage, lyricDialect, songStructure, targetVerse, mode, songId, sectionId]);

  useEffect(() => {
    // Concept AND genealogy modes need a confirm/ask step first
    // (conceptStage, rendered below) — see handleConceptConfirm for where
    // the actual action fires once the user's confirmed or typed a concept.
    if (mode === 'concept' || mode === 'genealogy') return;
    const seed = seedMessage || (mode === 'rhyme'
      ? `palabras que rimen con "${targetVerse.text}"`
      : `ayúdame con este fragmento: "${targetVerse.text}"`);
    send(seed);
    // Only ever runs once, on open — every later call in this popover's
    // life is a deliberate follow-up (a SOCRATIC chip, a re-fetch), not a
    // re-seed from mode/targetVerse (which don't change while it's open).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The current card leaving — swipe or button, same path either way. Just
  // drops the front of the queue (instant, offline-safe, no network call)
  // until it's actually empty; only then does a real regenerate happen,
  // capped at MAX_REGENS_PER_TURN.
  const handleDiscard = useCallback(() => {
    setQueue((cur) => {
      const next = cur.slice(1);
      if (next.length === 0 && regenCount.current < MAX_REGENS_PER_TURN) {
        regenCount.current += 1;
        send('Dame otras 3 opciones distintas a las anteriores.', { isRegen: true });
      }
      return next;
    });
  }, [send]);

  const handleAccept = useCallback((text) => {
    if (targetVerse) onReplace(text); else onInsertBelow(text);
    onClose();
  }, [targetVerse, onReplace, onInsertBelow, onClose]);

  const handleInsertBelowExplicit = useCallback((text) => {
    onInsertBelow(text);
    onClose();
  }, [onInsertBelow, onClose]);

  const handleChip = useCallback((chip) => send(chip), [send]);

  const handleReplySubmit = useCallback((e) => {
    e.preventDefault();
    const text = replyDraft.trim();
    if (!text) return;
    setReplyDraft('');
    send(text);
  }, [replyDraft, send]);

  // Concept mode's confirm/ask step (creativity proposal #3) — never fires
  // the actual WORD_BANK request (or, in genealogy mode, the actual
  // getImageGenealogy call) until the user's reviewed or typed the concept
  // themselves, per the reported issue that auto-firing on a raw selection
  // gave no chance to catch a wrong guess before spending a call.
  //
  // "Genealogía de la imagen" — its own dedicated feature (deliberately
  // NOT folded into SOCRATIC, unlike the espejo temático): a direct,
  // client-forced call, same reasoning as ángulo cultural — this isn't a
  // new model turn deciding a mode, the UI action already decided it.
  const runGenealogy = useCallback(async (concept, clarification = null) => {
    setConceptStage('sent');
    setGenealogyLoading(true);
    try {
      const result = await getImageGenealogy({
        concept, clarification, verseText, targetVerse, lyricDna, lang: lyricLanguage,
        excludeReferences: genealogyHistoryRef.current,
      });
      setGenealogyResult(result);
      setGenealogyAttempted(true);
      if (result?.references) {
        result.references.forEach((r) => {
          if (!genealogyHistoryRef.current.includes(r.title)) genealogyHistoryRef.current.push(r.title);
        });
      }
    } finally {
      setGenealogyLoading(false);
    }
  }, [verseText, targetVerse, lyricDna, lyricLanguage]);

  const handleGenealogyClarificationChange = useCallback((e) => setGenealogyClarificationDraft(e.target.value), []);
  const handleGenealogyClarify = useCallback((e) => {
    e.preventDefault();
    if (!genealogyClarificationDraft.trim()) return;
    runGenealogy(conceptDraft, genealogyClarificationDraft.trim());
  }, [conceptDraft, genealogyClarificationDraft, runGenealogy]);

  const handleConceptConfirm = useCallback(() => {
    if (mode === 'genealogy') { runGenealogy(conceptDraft); return; }
    send(`dame palabras que tengan que ver con "${conceptDraft}"`);
  }, [mode, conceptDraft, send, runGenealogy]);

  const handleConceptChange = useCallback(() => setConceptStage('ask'), []);
  const handleConceptDraftChange = useCallback((e) => setConceptDraft(e.target.value), []);

  const handleConceptSubmit = useCallback((e) => {
    e.preventDefault();
    if (!conceptDraft.trim()) return;
    if (mode === 'genealogy') { runGenealogy(conceptDraft.trim()); return; }
    send(`dame palabras que tengan que ver con "${conceptDraft.trim()}"`);
  }, [mode, conceptDraft, send, runGenealogy]);

  // Creativity proposal #4 — direct call to getCulturalProvocation, NOT a
  // trip back through send()/askMuse: this is a client-forced action, not a
  // new model turn that has to first decide what mode to answer in.
  // Never fires on the first tap anymore — guessConceptFromLine's guess (or
  // a blank ask if there's nothing to guess from) has to be confirmed or
  // corrected first (provocationStage), same reasoning as the concept-mode
  // flow above: a real reported bug came from firing on an unconfirmed
  // guess with no chance to correct it.
  const handleCulturalProvocationStart = useCallback(() => {
    const guess = guessConceptFromLine({ verseText, targetVerse });
    setProvocationConceptDraft(guess || '');
    setProvocationStage(guess ? 'confirm' : 'ask');
  }, [verseText, targetVerse]);

  const handleCulturalProvocationChange = useCallback(() => setProvocationStage('ask'), []);
  const handleCulturalProvocationDraftChange = useCallback((e) => setProvocationConceptDraft(e.target.value), []);

  // Shared by the confirm chip, the ask form's submit, AND "otro ángulo"
  // (which re-runs with the SAME already-confirmed concept — a new angle on
  // the same topic, not a re-ask). Excludes frames already shown this
  // session (angleHistoryRef, same list buildCulturalResonance feeds) so a
  // regenerate never repeats a tropo already surfaced.
  const handleCulturalProvocationRun = useCallback(async (concept, clarification = null) => {
    setProvocationStage('idle');
    setProvocationLoading(true);
    try {
      const result = await getCulturalProvocation({
        concept, clarification, verseText, targetVerse, lyricDna, lang: lyricLanguage,
        excludeFrames: angleHistoryRef.current.frames,
      });
      setProvocation(result);
      setProvocationAttempted(true);
      if (result?.frame && !angleHistoryRef.current.frames.includes(result.frame)) {
        angleHistoryRef.current.frames.push(result.frame);
      }
    } finally {
      setProvocationLoading(false);
    }
  }, [verseText, targetVerse, lyricDna, lyricLanguage]);

  const handleCulturalProvocationSubmit = useCallback((e) => {
    e.preventDefault();
    if (!provocationConceptDraft.trim()) return;
    handleCulturalProvocationRun(provocationConceptDraft.trim());
  }, [provocationConceptDraft, handleCulturalProvocationRun]);

  // Elided-subject clarification (see museApi.js's
  // SUBJECT_RESOLUTION_INSTRUCTION) — re-runs with the SAME confirmed
  // concept plus the artist's own answer about who/what the real subject is.
  const handleCulturalProvocationClarificationChange = useCallback(
    (e) => setProvocationClarificationDraft(e.target.value), []
  );
  const handleCulturalProvocationClarify = useCallback((e) => {
    e.preventDefault();
    if (!provocationClarificationDraft.trim()) return;
    handleCulturalProvocationRun(provocationConceptDraft, provocationClarificationDraft.trim());
  }, [provocationConceptDraft, provocationClarificationDraft, handleCulturalProvocationRun]);

  const handleWordPick = useCallback((word) => {
    if (targetVerse) onReplace(word); else onInsertBelow(word);
    onClose();
  }, [targetVerse, onReplace, onInsertBelow, onClose]);

  const keyboardInset = useKeyboardInset();

  return (
    <>
      {/* Dims the note behind the sheet — catches an outside tap to close
          too. */}
      <div className="mp-scrim" onClick={onClose} />
      <div
        className="mp-anchored"
        style={keyboardInset > 0 ? { bottom: keyboardInset } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mp-grabber" />
        <div className="mp-head">
          <span className="mp-eyebrow">+ the muse</span>
          <button className="mp-close" onClick={onClose} title="close">✕</button>
        </div>
        {/* Only when there's a genuine line/fragment behind this turn — e.g.
            a typed "Musa, ..." command has no real targetVerse (see
            NoteEditorScreen's originIsReal), and quoting one back would
            visually claim a reference that isn't real. Same amber-soft +
            #EAD9B8 treatment as .ne-row-muse-origin on the line itself. */}
        {originIsReal && targetVerse && (
          <p className="mp-quote-box">&quot;{targetVerse.text}&quot;</p>
        )}

        {/* Concept AND genealogy modes' shared confirm/ask step — renders
            BEFORE anything askMuse-related, since neither send() nor
            runGenealogy has been called yet until the concept is confirmed
            or typed. See handleConceptConfirm/handleConceptSubmit. */}
        {(mode === 'concept' || mode === 'genealogy') && conceptStage !== 'sent' && (
          <div className="mp-banner">
            {conceptStage === 'confirm' ? (
              <>
                <p className="mp-question">
                  {mode === 'genealogy'
                    ? <>¿Genealogía cultural de &quot;{conceptDraft}&quot;?</>
                    : <>¿Buscamos palabras relacionadas con &quot;{conceptDraft}&quot;?</>}
                </p>
                <div className="mp-chips">
                  <button className="mp-chip" onClick={handleConceptConfirm}>Sí, esa{mode === 'concept' ? 's' : ''}</button>
                  <button className="mp-chip" onClick={handleConceptChange}>Es otro concepto</button>
                </div>
              </>
            ) : (
              <form className="mp-concept-ask" onSubmit={handleConceptSubmit}>
                <p className="mp-question">
                  {mode === 'genealogy' ? '¿Sobre qué imagen o idea quieres genealogía cultural?' : '¿Sobre qué concepto quieres palabras?'}
                </p>
                <input
                  className="mp-concept-input"
                  type="text"
                  value={conceptDraft}
                  onChange={handleConceptDraftChange}
                  placeholder={mode === 'genealogy' ? 'p. ej. volver a casa, el exilio…' : 'p. ej. volar, el mar, ruptura…'}
                  autoFocus
                />
                <button className="mp-chip" type="submit" disabled={!conceptDraft.trim()}>Buscar</button>
              </form>
            )}
          </div>
        )}

        {/* Genealogía de la imagen's result — several distinct real
            references at once (unlike ángulo cultural's single frame/tropo),
            see getImageGenealogy. "otras referencias" regenerates excluding
            titles already shown this session (genealogyHistoryRef). */}
        {mode === 'genealogy' && conceptStage === 'sent' && (
          <div className="mp-genealogy">
            {genealogyLoading && (
              <div className="mp-loading"><span className="mp-spinner" /></div>
            )}
            {!genealogyLoading && genealogyAttempted && !genealogyResult && (
              <p className="mp-provocation-empty">
                no encontré referencias culturales claras para &quot;{conceptDraft}&quot;
              </p>
            )}
            {/* Elided-subject clarification (museApi.js's
                SUBJECT_RESOLUTION_INSTRUCTION) — same as ángulo cultural's. */}
            {!genealogyLoading && genealogyResult?.needsClarification && (
              <form className="mp-concept-ask" onSubmit={handleGenealogyClarify}>
                <p className="mp-question">{genealogyResult.needsClarification}</p>
                <input
                  className="mp-concept-input"
                  type="text"
                  value={genealogyClarificationDraft}
                  onChange={handleGenealogyClarificationChange}
                  placeholder="p. ej. el miedo"
                  autoFocus
                />
                <button className="mp-chip" type="submit" disabled={!genealogyClarificationDraft.trim()}>Aclarar</button>
              </form>
            )}
            {!genealogyLoading && genealogyResult?.references && (
              <>
                {genealogyResult.references.map((ref, i) => (
                  <div className="mp-genealogy-ref" key={i}>
                    <p className="mp-genealogy-title">
                      {ref.title}{ref.source ? <span className="mp-genealogy-source"> — {ref.source}</span> : null}
                    </p>
                    <p className="mp-genealogy-connection">{ref.connection}</p>
                  </div>
                ))}
                <button className="mp-chip" onClick={() => runGenealogy(conceptDraft)} disabled={genealogyLoading}>
                  otras referencias
                </button>
              </>
            )}
          </div>
        )}

        {loading && (
          <div className="mp-loading"><span className="mp-spinner" /></div>
        )}
        {error && <p className="mp-error">{error}</p>}

        {!loading && !error && response?.action_type === 'SOCRATIC' && (
          <div className="mp-banner">
            <p className="mp-question">{response.question?.text}</p>
            <div className="mp-chips">
              {(response.question?.options || []).slice(0, 3).map((opt, i) => (
                <button key={i} className="mp-chip" onClick={() => handleChip(opt)}>{opt}</button>
              ))}
            </div>
            {/* Open-ended fallback for whenever none of the chips above are
                actually the answer (design ref: references/bottomTabMuse.jpg). */}
            <form className="mp-reply-form" onSubmit={handleReplySubmit}>
              <input
                className="mp-reply-input"
                type="text"
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                placeholder="tu respuesta…"
              />
              <button className="mp-reply-send" type="submit" disabled={!replyDraft.trim()}>Send</button>
            </form>
            {/* Creativity proposal #4 — always available on any SOCRATIC
                turn, not something the model has to remember to offer as
                one of its own dynamic chips. Never fires on the first tap —
                guesses (or asks for) the concept first, see
                handleCulturalProvocationStart. */}
            {provocationStage === 'idle' && !provocationAttempted && !provocationLoading && (
              <button className="mp-chip mp-chip-cultural" onClick={handleCulturalProvocationStart}>
                ✧ ángulo cultural
              </button>
            )}
            {provocationStage === 'confirm' && (
              <div className="mp-provocation-ask">
                <p className="mp-question">¿Un ángulo cultural sobre &quot;{provocationConceptDraft}&quot;?</p>
                <div className="mp-chips">
                  <button className="mp-chip" onClick={() => handleCulturalProvocationRun(provocationConceptDraft)}>Sí, ese</button>
                  <button className="mp-chip" onClick={handleCulturalProvocationChange}>Es otro concepto</button>
                </div>
              </div>
            )}
            {provocationStage === 'ask' && (
              <form className="mp-concept-ask" onSubmit={handleCulturalProvocationSubmit}>
                <p className="mp-question">¿Sobre qué concepto quieres un ángulo cultural?</p>
                <input
                  className="mp-concept-input"
                  type="text"
                  value={provocationConceptDraft}
                  onChange={handleCulturalProvocationDraftChange}
                  placeholder="p. ej. la ausencia, el orgullo…"
                  autoFocus
                />
                <button className="mp-chip" type="submit" disabled={!provocationConceptDraft.trim()}>Buscar</button>
              </form>
            )}
            {provocationLoading && <p className="mp-provocation-loading">buscando un ángulo…</p>}
            {!provocationLoading && provocationAttempted && !provocation && (
              <p className="mp-provocation-empty">
                no encontré un ángulo cultural claro para &quot;{provocationConceptDraft}&quot; — prueba con otro concepto
              </p>
            )}
            {/* Elided-subject clarification (museApi.js's
                SUBJECT_RESOLUTION_INSTRUCTION) — the model asked instead of
                guessing who/what the line's real subject is. */}
            {!provocationLoading && provocation?.needsClarification && (
              <form className="mp-concept-ask" onSubmit={handleCulturalProvocationClarify}>
                <p className="mp-question">{provocation.needsClarification}</p>
                <input
                  className="mp-concept-input"
                  type="text"
                  value={provocationClarificationDraft}
                  onChange={handleCulturalProvocationClarificationChange}
                  placeholder="p. ej. el miedo"
                  autoFocus
                />
                <button className="mp-chip" type="submit" disabled={!provocationClarificationDraft.trim()}>Aclarar</button>
              </form>
            )}
            {!provocationLoading && provocation?.frame && (
              <div className="mp-provocation">
                <p className="mp-provocation-frame">
                  {provocation.frame}{provocation.tropo ? ` — ${provocation.tropo}` : ''}
                </p>
                <p className="mp-provocation-hint">reacciona a esto, no lo copies</p>
                <button
                  className="mp-chip"
                  onClick={() => handleCulturalProvocationRun(provocationConceptDraft)}
                  disabled={provocationLoading}
                >
                  otro ángulo
                </button>
              </div>
            )}
          </div>
        )}

        {/* OPEN_REFERENCE never got a render branch when the mode shipped —
            the response saved and loaded fine, but with no case matching
            'OPEN_REFERENCE' the popover just showed nothing. Same plain
            text treatment as SOCRATIC's banner (no chips/options either
            way: an answer has nothing to pick from, and a decline's
            redirect is meant to be read, not tapped). */}
        {!loading && !error && response?.action_type === 'OPEN_REFERENCE' && (
          <div className="mp-banner">
            <p className="mp-answer">{response.message}</p>
          </div>
        )}

        {!loading && !error && (response?.action_type === 'SURGEON' || response?.action_type === 'ARCHITECT') && (
          <div className="mp-deck">
            {queue.length === 0 && <p className="mp-deck-empty">No more options this turn — try editing the line directly.</p>}
            {/* Exactly one card, always — see SuggestionCard's comment for
                why. `key` on the suggestion's own text forces a clean
                remount (fresh drag state, no leftover transform) the
                instant a discard/accept swaps in the next one. */}
            {queue[0] && (
              <SuggestionCard
                key={queue[0].text}
                suggestion={queue[0]}
                showReplace={!!targetVerse}
                onDiscard={handleDiscard}
                onAccept={() => handleAccept(queue[0].text)}
                onInsertBelow={() => handleInsertBelowExplicit(queue[0].text)}
                onPreview={onPreviewText}
              />
            )}
          </div>
        )}

        {!loading && !error && response?.action_type === 'WORD_BANK' && (
          <div className="mp-wordbank">
            {response.wordBank?.conceptMatched === false && (
              <p className="mp-wb-note">
                ninguna encajó de verdad con &quot;{response.wordBank.concept}&quot; — aquí tienes el resto
              </p>
            )}
            {(response.wordBank?.wordGroups || []).map((g, gi) => (
              <div className="mp-wb-group" key={gi}>
                {g.syllables != null && <span className="mp-wb-label">{g.syllables} syl.</span>}
                <div className="mp-wb-row">
                  {(g.words || []).map((w, wi) => (
                    <button key={wi} className="mp-wb-pill" onClick={() => handleWordPick(w)}>{w}</button>
                  ))}
                  {(g.shortPhrases || []).map((p, pi) => (
                    <button key={pi} className="mp-wb-pill mp-wb-phrase" onClick={() => handleWordPick(p)}>{p}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
