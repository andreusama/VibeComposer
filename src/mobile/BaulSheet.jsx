import { useState, useCallback, useRef } from 'react';
import { processBaulInput, readFileAsBase64, inputTypeForFile, emptyAdnLirico } from '../utils/baulProcessor.js';
import { saveLyricDna, insertBaulEntry, clearBaulEntries } from '../canvas/canvasData.js';

// The mobile "tap to attach" entry point (design ref, 2026-08-11 mockup) —
// same processBaulInput/saveLyricDna calls desktop's BaulFloatNode uses,
// a modal sheet instead of a draggable float, since there's no canvas to
// float over on mobile. Never shows what it extracted (see the "black box"
// note on hasAbsorbedSomething in BaulFloatNode) — this sheet only ever
// shows *that* something was absorbed, never *what*.
export default function BaulSheet({ songId, lyricDna, onLyricDnaUpdated, onClose }) {
  const [mode, setMode] = useState('menu'); // 'menu' | 'note' | 'confirmClear'
  const [noteText, setNoteText] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [justSaved, setJustSaved] = useState(false);
  const photoInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const absorb = useCallback(async (rawInput, inputType, sourceLabel) => {
    setProcessing(true);
    setError(null);
    try {
      const { adnLirico, entry } = await processBaulInput({ currentAdnLirico: lyricDna, rawInput, inputType, sourceLabel });
      const { error: saveError } = await saveLyricDna(songId, adnLirico);
      if (saveError) { setError(saveError.message); return; }
      // Best-effort, never blocks the real save — see canvasData.js's
      // insertBaulEntry comment (dev-only audit log, not real product data).
      insertBaulEntry(songId, entry).catch(() => {});
      onLyricDnaUpdated?.(adnLirico);
      setMode('menu');
      setNoteText('');
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    } catch (err) {
      setError(err.message === 'LIMIT_REACHED' ? 'daily AI limit reached — try again tomorrow' : err.message);
    } finally {
      setProcessing(false);
    }
  }, [lyricDna, songId, onLyricDnaUpdated]);

  const handleSubmitNote = useCallback(() => {
    const text = noteText.trim();
    if (!text || processing) return;
    absorb(text, 'text');
  }, [noteText, processing, absorb]);

  const handleFilePick = useCallback(async (e) => {
    const file = e.target.files?.[0] || null;
    e.target.value = ''; // lets picking the same file twice re-fire onChange
    if (!file) return;
    const inputType = inputTypeForFile(file);
    if (!inputType) { setError('only images or PDF'); return; }
    const base64 = await readFileAsBase64(file);
    absorb({ base64, mimeType: file.type }, inputType, file.name);
  }, [absorb]);

  const handleClear = useCallback(async () => {
    setProcessing(true);
    try {
      const { error: saveError } = await saveLyricDna(songId, emptyAdnLirico());
      if (saveError) { setError(saveError.message); return; }
      clearBaulEntries(songId).catch(() => {});
      onLyricDnaUpdated?.(emptyAdnLirico());
      onClose();
    } finally {
      setProcessing(false);
    }
  }, [songId, onLyricDnaUpdated, onClose]);

  return (
    <div className="baul-sheet-scrim" onClick={mode === 'confirmClear' ? undefined : onClose}>
      <div className="baul-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />

        <div className={`baul-sheet-body${mode === 'confirmClear' ? ' baul-sheet-body-dimmed' : ''}`}>
          <div className="baul-hero"><span className="baul-hero-spark">✦</span></div>

          {mode === 'note' ? (
            <>
              <button className="ts-back baul-note-back" onClick={() => setMode('menu')}>‹ back</button>
              <div className="attach-title">Write a note</div>
              <textarea
                className="baul-note-input"
                value={noteText}
                placeholder="vuelca algo al baúl…"
                disabled={processing}
                onChange={(e) => setNoteText(e.target.value)}
                autoFocus
              />
              {error && <p className="baul-error">{error}</p>}
              <button className="baul-note-submit" onClick={handleSubmitNote} disabled={processing || !noteText.trim()}>
                {processing ? '…' : 'Add to baúl'}
              </button>
            </>
          ) : (
            <>
              <div className="attach-title">Add inspiration</div>
              <p className="attach-sub">Nothing is lost — everything you add becomes context for what you write next.</p>
              {justSaved && <p className="baul-saved-hint">✓ absorbed</p>}
              {error && <p className="baul-error">{error}</p>}

              <button className="attach-option" onClick={() => setMode('note')} disabled={processing}>
                <span className="aic aic-thread">☰</span>
                <span className="tt">Write a note</span>
              </button>
              <button className="attach-option" disabled title="coming soon — needs speech-to-text, not built yet">
                <span className="aic aic-chord">♫</span>
                <span className="tt">Record a voice memo</span>
              </button>
              <button className="attach-option" onClick={() => photoInputRef.current?.click()} disabled={processing}>
                <span className="aic aic-amber">▣</span>
                <span className="tt">Choose a photo</span>
              </button>
              <button className="attach-option" onClick={() => fileInputRef.current?.click()} disabled={processing}>
                <span className="aic aic-graphite">▤</span>
                <span className="tt">Import a file</span>
              </button>
              <input ref={photoInputRef} type="file" accept="image/*" className="baul-file-input" onChange={handleFilePick} />
              <input ref={fileInputRef} type="file" accept="application/pdf" className="baul-file-input" onChange={handleFilePick} />

              <div className="divider-row"><div className="line" /><div className="label">danger zone</div><div className="line" /></div>

              <button className="clear-option" onClick={() => setMode('confirmClear')} disabled={processing}>
                <span className="aic"><span className="clear-icon">🗑</span></span>
                <span className="clear-option-body">
                  <span className="tt">Clear the baúl</span>
                  <span className="ss">start from zero — removes everything added so far</span>
                </span>
              </button>
            </>
          )}
        </div>

        {mode === 'confirmClear' && (
          <div className="confirm-sheet">
            <div className="confirm-card">
              <div className="confirm-text">
                <div className="tt">Clear the baúl?</div>
                <div className="ss">This removes every note, voice memo, photo, and file you've added — the muse forgets them too. This can't be undone.</div>
              </div>
              <button className="confirm-btn destructive" onClick={handleClear} disabled={processing}>
                {processing ? '…' : 'Clear everything'}
              </button>
            </div>
            <button className="confirm-cancel" onClick={() => setMode('menu')}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
