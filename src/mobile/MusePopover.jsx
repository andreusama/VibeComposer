import { useState, useEffect, useCallback, useRef } from 'react';
import { askMuse } from '../utils/museApi.js';
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

// Positions the anchored panel directly under the verse line it's about,
// same "measure once at open time" approach SelectionCallout already uses
// for its pill — not a live-tracked anchor, so it doesn't fight scrolling
// mid-interaction. Falls back to placing the panel ABOVE the line if there
// isn't room below in the current viewport.
function anchorStyle(anchorRect, estimatedHeight = 260) {
  if (!anchorRect) return {};
  const fitsBelow = anchorRect.bottom + estimatedHeight + 12 <= window.innerHeight;
  return fitsBelow
    ? { top: anchorRect.bottom + 8, left: anchorRect.left, width: anchorRect.width }
    : { bottom: window.innerHeight - anchorRect.top + 8, left: anchorRect.left, width: anchorRect.width };
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

// The one popover shell for all 4 muse modes (SURGEON/ARCHITECT/SOCRATIC/
// WORD_BANK) — same askMuse() call as desktop's MuseFloatNode, just a
// mobile-native, single-shot presentation instead of a persistent chat
// thread ("Zero-Chat" per the HCI spec this was built against): each mode
// renders straight from the latest askMuse response, no visible scrolling
// history.
//
// Presentation: anchored directly under the verse line the turn is about
// (anchorStyle above) instead of a centered, dimming backdrop modal — an
// invisible full-screen "scrim" still catches an outside tap to close, but
// nothing visually blocks the rest of the screen. SURGEON/ARCHITECT render
// as a swipeable card deck, SOCRATIC as a single-line question + chips
// banner, WORD_BANK as a scrollable pill grid — all anchored the same way.
//
// Two ways in:
// 1. Selection callout (Rhyme / Ask muse pills) — targetVerse is a real
//    {text, before, after} fragment. Rhyme passes forceMode: 'WORD_BANK',
//    since a dedicated UI element already unambiguously means "give me
//    rhymes" — leaving that to the model's free interpretation (the
//    original version of this popover) was exactly the "why two buttons if
//    they both just re-interpret" gap this fixes. Ask muse leaves the mode
//    open (SURGEON/ARCHITECT/SOCRATIC, model's call), same as desktop.
// 2. The inline "Musa, ..." wake-word line, or a tap on the friction nudge
//    (NoteEditorScreen) — targetVerse is null and seedMessage carries the
//    intent verbatim (the user's own typed question, or a note about the
//    rhyme break that just occurred).
export default function MusePopover({
  mode, targetVerse, seedMessage, verseText, noteFunction, lyricDna,
  lyricLanguage, lyricDialect, songStructure, songId, sectionId, anchorRect,
  onClose, onReplace, onInsertBelow, onPreviewText = () => {},
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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

  useEffect(() => {
    if (!sectionId) return;
    let cancelled = false;
    loadMuseProfile(sectionId).then(({ data }) => { if (!cancelled) setBlockProfile(data?.summary || ''); });
    return () => { cancelled = true; };
  }, [sectionId]);

  const send = useCallback(async (message, { isRegen = false } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const isFirstTurn = firstTurnRef.current;
      const res = await askMuse({
        verseText, noteFunction, blockProfile, lyricDna, userMessage: message,
        conversation,
        lang: lyricLanguage, dialect: lyricDialect,
        songStructure,
        targetVerse: isFirstTurn ? targetVerse : null,
        forceMode: isFirstTurn && mode === 'rhyme' ? 'WORD_BANK' : null,
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

  const handleWordPick = useCallback((word) => {
    if (targetVerse) onReplace(word); else onInsertBelow(word);
    onClose();
  }, [targetVerse, onReplace, onInsertBelow, onClose]);

  const style = anchorStyle(anchorRect);

  return (
    <>
      {/* Invisible — unlike the old centered modal, nothing here dims or
          blocks the rest of the screen; this only exists to catch an
          outside tap and close. */}
      <div className="mp-scrim" onClick={onClose} />
      <div className="mp-anchored" style={style} onClick={(e) => e.stopPropagation()}>
        <div className="mp-head">
          <span className="mp-head-target">{targetVerse ? `“${targetVerse.text}”` : 'the muse'}</span>
          <button className="mp-close" onClick={onClose} title="close">✕</button>
        </div>

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
