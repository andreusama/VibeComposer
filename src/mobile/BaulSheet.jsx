import { useState, useCallback, useRef } from 'react';
import { processBaulInput, readFileAsBase64, inputTypeForFile, emptyAdnLirico } from '../utils/baulProcessor.js';
import { saveLyricDna, insertBaulEntry, clearBaulEntries } from '../canvas/canvasData.js';
import { IcMuse, IcCheck, IcNote, IcMic, IcImage, IcPaperclip, IcTrash, IcChevronLeft } from './icons.jsx';

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
          <div className="baul-hero"><span className="baul-hero-spark"><IcMuse size={26} /></span></div>

          {mode === 'note' ? (
            <>
              <button className="ts-back baul-note-back" onClick={() => setMode('menu')}><IcChevronLeft size={16} /> volver</button>
              <div className="attach-title">Escribir un apunte</div>
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
                {processing ? '…' : 'Añadir al baúl'}
              </button>
            </>
          ) : (
            <>
              <div className="attach-title">Añadir inspiración</div>
              <p className="attach-sub">Nada se pierde — todo lo que añades se vuelve contexto para lo que escribas después.</p>
              {justSaved && <p className="baul-saved-hint"><IcCheck size={14} /> absorbido</p>}
              {error && <p className="baul-error">{error}</p>}

              <button className="attach-option" onClick={() => setMode('note')} disabled={processing}>
                <span className="aic aic-thread"><IcNote size={18} /></span>
                <span className="tt">Escribir un apunte</span>
              </button>
              <button className="attach-option" disabled title="próximamente — necesita voz-a-texto">
                <span className="aic aic-chord"><IcMic size={18} /></span>
                <span className="tt">Grabar una nota de voz</span>
              </button>
              <button className="attach-option" onClick={() => photoInputRef.current?.click()} disabled={processing}>
                <span className="aic aic-amber"><IcImage size={18} /></span>
                <span className="tt">Elegir una foto</span>
              </button>
              <button className="attach-option" onClick={() => fileInputRef.current?.click()} disabled={processing}>
                <span className="aic aic-graphite"><IcPaperclip size={18} /></span>
                <span className="tt">Importar un archivo</span>
              </button>
              <input ref={photoInputRef} type="file" accept="image/*" className="baul-file-input" onChange={handleFilePick} />
              <input ref={fileInputRef} type="file" accept="application/pdf" className="baul-file-input" onChange={handleFilePick} />

              <div className="divider-row"><div className="line" /><div className="label">danger zone</div><div className="line" /></div>

              <button className="clear-option" onClick={() => setMode('confirmClear')} disabled={processing}>
                <span className="aic"><span className="clear-icon"><IcTrash size={18} /></span></span>
                <span className="clear-option-body">
                  <span className="tt">Vaciar el baúl</span>
                  <span className="ss">empezar de cero — borra todo lo añadido</span>
                </span>
              </button>
            </>
          )}
        </div>

        {mode === 'confirmClear' && (
          <div className="confirm-sheet">
            <div className="confirm-card">
              <div className="confirm-text">
                <div className="tt">¿Vaciar el baúl?</div>
                <div className="ss">Elimina todos los apuntes, notas de voz, fotos y archivos que hayas añadido — la musa también los olvida. No se puede deshacer.</div>
              </div>
              <button className="confirm-btn destructive" onClick={handleClear} disabled={processing}>
                {processing ? '…' : 'Vaciar todo'}
              </button>
            </div>
            <button className="confirm-cancel" onClick={() => setMode('menu')}>Cancelar</button>
          </div>
        )}
      </div>
    </div>
  );
}
