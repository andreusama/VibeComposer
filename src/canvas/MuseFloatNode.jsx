import { useState, useEffect, useCallback, useRef } from 'react';
import { NodeResizer } from '@xyflow/react';
import { loadMuseConversation, saveMuseTurn, markMuseOptionSaved } from './museData.js';
import { askMuse } from '../utils/museApi.js';
import { recordMuseTurnAndMaybeUpdateProfile } from './museProfileUpdater.js';
import { addAnnotation } from './canvasData.js';
import MuseDebugPanel from './MuseDebugPanel.jsx';
import { logDebugEvent } from './debugLog.js';

// Display-only labels — purely cosmetic, don't affect anything the model
// reads (see museApi.js's MUSE_TYPES/MUSE_ANGLES).
const TYPE_LABELS = { CONTINUITY: 'continuidad', CONTRAST: 'contraste', RESOLUTION: 'resolución' };
const ANGLE_LABELS = { raw: 'cruda', atmospheric: 'atmosférica', abstract: 'abstracta' };
const MODE_LABELS = { SURGEON: 'cirujano', ARCHITECT: 'arquitecto', SOCRATIC: 'socrática', WORD_BANK: 'banco de palabras' };

// The muse used to permanently occupy a tab in the note's side panel —
// always docked, always taking up space, whether or not you were using it.
// It's a floating node now: opened on demand (from the note itself, from
// the panel, or from a selected fragment in the textarea), positioned next
// to whatever line it's about, draggable and closable like anything else on
// the canvas. Its own conversation state lives here — the panel doesn't
// know or care whether this is open.
export default function MuseFloatNode({ id, data, selected }) {
  const {
    songId, lineId, verseText, noteFunction, museProfile, onMuseProfileUpdated,
    lyricLanguage, lyricDialect, userId, onClose, songStructure, lyricDna,
    pendingTargetVerse, onClearTargetVerse,
  } = data;

  const [conversation, setConversation] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState(null);
  const [savedOptions, setSavedOptions] = useState(new Set());
  // Dev-only observability toggle — never rendered in production builds,
  // so there's no way an end user stumbles into raw prompt text or char
  // counts. debugInfo holds the _debug object from the most recent call.
  const [debugMode, setDebugMode] = useState(false);
  const [debugInfo, setDebugInfo] = useState(null);
  // Points at whichever conversation entry is currently last, so a fresh
  // reply scrolls itself into view instead of landing below the fold in a
  // long thread — re-pointed every render via the ref callback below, not
  // tracked as its own state.
  const lastEntryRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: rows, error: loadError } = await loadMuseConversation(lineId);
      if (cancelled) return;
      if (!loadError) setConversation(rows || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [lineId]);

  useEffect(() => {
    if (conversation.length > 0) {
      lastEntryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [conversation]);

  const send = useCallback(async (rawMessage) => {
    const message = rawMessage.trim();
    if (!message || asking) return;
    setAsking(true);
    setError(null);
    try {
      const response = await askMuse({
        verseText, noteFunction, museProfile, lyricDna, userMessage: message,
        conversation: conversation.map((e) => ({ role: e.role, content: e.content, action_type: e.action, options: e.options })),
        lang: lyricLanguage, dialect: lyricDialect,
        songStructure,
        targetVerse: pendingTargetVerse || null,
        debug: debugMode,
      });
      setDebugInfo(response._debug || null);
      // Only ever set when debugMode was on for this call — pushing to the
      // global log is what lets DebugConsole show history across multiple
      // calls/floats, not just whatever the last inline panel captured.
      if (response._debug) logDebugEvent('muse', response._debug);
      const { data: rows, error: saveError } = await saveMuseTurn(songId, lineId, response.themes, message, response);
      if (saveError) { setError(saveError.message); return; }
      setConversation((c) => [...c, ...rows]);
      setDraft('');
      // The selected fragment was for this ask only — clear it so the next
      // message doesn't silently reuse a stale target.
      if (pendingTargetVerse) onClearTargetVerse?.();

      // Fire-and-forget — a slow or failed background profile refresh
      // should never hold up the turn that was just saved.
      recordMuseTurnAndMaybeUpdateProfile({ songId, existingProfile: museProfile })
        .then((result) => { if (result) onMuseProfileUpdated?.(result); });
    } catch (err) {
      setError(err.message === 'LIMIT_REACHED' ? 'daily AI limit reached — try again tomorrow' : err.message);
    } finally {
      setAsking(false);
    }
  }, [asking, verseText, noteFunction, museProfile, lyricDna, conversation, lyricLanguage, lyricDialect, songId, lineId, onMuseProfileUpdated, songStructure, pendingTargetVerse, onClearTargetVerse, debugMode]);

  const handleSend = useCallback(() => send(draft), [send, draft]);

  // Doesn't just close the float — tells the muse to go ahead and give its
  // best options with whatever context it already has, instead of leaving
  // the question hanging. Closing (✕) is the separate "never mind entirely"
  // action.
  const handleSkip = useCallback(
    () => send('Sigue sin más contexto, dame opciones con lo que ya sabes.'),
    [send]
  );

  const handleSaveOption = useCallback(async (entry, optionText, index) => {
    if (!userId) return;
    const key = `${entry.id}:${index}`;
    const body = `musa: ${optionText}`;
    const { data: annotation, error: saveError } = await addAnnotation(lineId, userId, body, null);
    if (saveError) { setError(saveError.message); return; }
    markMuseOptionSaved(entry.id, annotation.id); // bookkeeping only, UI state is local
    setSavedOptions((s) => new Set(s).add(key));
  }, [userId, lineId]);

  const lastEntry = conversation[conversation.length - 1];
  const isPendingQuestion = lastEntry?.role === 'muse' && lastEntry.action === 'SOCRATIC';

  return (
    <div className={`muse-float${selected ? ' selected' : ''}`}>
      <NodeResizer minWidth={280} minHeight={220} isVisible={selected} />

      <div className="muse-float-head">
        <div className="muse-float-head-left">
          <span className="muse-float-icon">✦</span>
          <span className="muse-float-head-label">the muse</span>
        </div>
        {import.meta.env.DEV && (
          <button
            className={`muse-float-debug-toggle nodrag${debugMode ? ' active' : ''}`}
            onClick={() => setDebugMode((v) => !v)}
            title="toggle debug telemetry (dev only)"
          >
            🔧
          </button>
        )}
        <button className="muse-float-close nodrag" onClick={() => onClose?.(id)} title="close">✕</button>
      </div>

      {/* Covers body + composer together, not the header — closing should
          still work while the muse is thinking, only the actual content
          and controls underneath are blocked. */}
      <div className="muse-float-content">
        {(loading || asking) && (
          <div className="muse-float-loading-overlay">
            <span className="muse-float-spinner" />
          </div>
        )}

        <div className="muse-float-body nodrag nowheel">
          {error && <div className="note-panel-error">{error}</div>}
          <div className="muse-thread">
            {conversation.length === 0 && (
              <p className="note-panel-empty">pídele ayuda a la musa: reemplazar un fragmento, resolver un verso, pedir dirección o un banco de rimas…</p>
            )}
            {conversation.map((entry, i) => {
              const isLast = i === conversation.length - 1;
              if (entry.role === 'user') {
                return <p ref={isLast ? lastEntryRef : null} className="muse-turn muse-turn-user" key={entry.id}>{entry.content}</p>;
              }
              return (
                <div ref={isLast ? lastEntryRef : null} className="muse-turn muse-turn-muse" key={entry.id}>
                  <div className="muse-mode-label">{MODE_LABELS[entry.action] || entry.action}</div>
                  <p className={entry.action === 'SOCRATIC' ? 'muse-question' : 'muse-answer'}>{entry.content}</p>

                  {(entry.action === 'SURGEON' || entry.action === 'ARCHITECT') && entry.options?.length > 0 && (
                    <div className="muse-options">
                      {entry.options.map((opt, j) => {
                        const saved = savedOptions.has(`${entry.id}:${j}`);
                        return (
                          <div className="muse-option-row" key={j}>
                            <div className="muse-option-main">
                              {opt.type && <span className="muse-option-type">{TYPE_LABELS[opt.type] || opt.type}</span>}
                              {opt.angle && <span className="muse-option-angle">{ANGLE_LABELS[opt.angle] || opt.angle}</span>}
                              <span className="muse-option-text">{opt.text}</span>
                            </div>
                            <button
                              className="muse-save-btn"
                              disabled={saved}
                              onClick={() => handleSaveOption(entry, opt.text, j)}
                            >
                              {saved ? 'guardado' : 'guardar'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {entry.action === 'SOCRATIC' && entry.options?.length > 0 && (
                    <div className="muse-chip-row">
                      {entry.options.map((chip, j) => (
                        <button key={j} className="muse-chip nodrag" onClick={() => send(chip)} disabled={asking}>
                          {chip}
                        </button>
                      ))}
                    </div>
                  )}

                  {entry.action === 'WORD_BANK' && entry.options?.wordGroups?.length > 0 && (
                    <div className="muse-word-bank">
                      {entry.options.wordGroups.map((group, gi) => (
                        <div className="muse-word-group" key={gi}>
                          {group.syllables != null && <span className="muse-word-group-label">{group.syllables} síl.</span>}
                          <div className="muse-word-list">
                            {(group.words || []).map((w, wi) => {
                              const key = `${entry.id}:${gi}:w${wi}`;
                              const saved = savedOptions.has(key);
                              return (
                                <button
                                  key={key}
                                  className={`muse-word-chip${saved ? ' saved' : ''} nodrag`}
                                  onClick={() => handleSaveOption(entry, w, `${gi}:w${wi}`)}
                                  title={saved ? 'guardado' : 'guardar'}
                                >
                                  {w}
                                </button>
                              );
                            })}
                            {(group.shortPhrases || []).map((p, pi) => {
                              const key = `${entry.id}:${gi}:p${pi}`;
                              const saved = savedOptions.has(key);
                              return (
                                <button
                                  key={key}
                                  className={`muse-word-chip muse-phrase-chip${saved ? ' saved' : ''} nodrag`}
                                  onClick={() => handleSaveOption(entry, p, `${gi}:p${pi}`)}
                                  title={saved ? 'guardado' : 'guardar'}
                                >
                                  {p}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {debugMode && <MuseDebugPanel debug={debugInfo} />}
        </div>

        <div className="muse-float-composer nodrag">
          {pendingTargetVerse && (
            <div className="muse-target-chip">
              <span className="muse-target-chip-text">“{pendingTargetVerse.text}”</span>
              <button className="muse-target-chip-clear" onClick={() => onClearTargetVerse?.()} title="quitar selección">✕</button>
            </div>
          )}
          <div className="note-panel-add-row">
            <input
              value={draft}
              placeholder={isPendingQuestion ? 'your answer…' : 'pídele algo a la musa…'}
              disabled={asking}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            />
            <button onClick={handleSend} disabled={asking}>{asking ? '…' : 'send'}</button>
          </div>
          {isPendingQuestion && (
            <button className="muse-skip-btn nodrag" onClick={handleSkip} disabled={asking}>skip this one</button>
          )}
          <div className="muse-float-hint">draft saves automatically — drag out anytime</div>
        </div>
      </div>
    </div>
  );
}
