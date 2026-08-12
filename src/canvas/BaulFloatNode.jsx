import { useState, useCallback, useRef } from 'react';
import { NodeResizer } from '@xyflow/react';
import { processBaulInput, readFileAsBase64, inputTypeForFile } from '../utils/baulProcessor.js';
import { saveLyricDna, insertBaulEntry } from './canvasData.js';

// The input panel for the baúl / lyric_dna pipeline — opened from the
// Inspiration Black Hole node. Same floating-node pattern as the muse
// (draggable, closable, lives on the canvas rather than docked), but its
// own thing: no conversation, just "dump material in, see the fused ADN
// come back out." lyric_dna is intentionally NOT the same store as
// muse_profile (see baulProcessor.js / schema.sql) — this only ever reads
// and writes songs.lyric_dna. lyric_dna is also the sole "vibe" source
// now — there's no separate song-level summary field anywhere.
export default function BaulFloatNode({ id, data, selected }) {
  const { songId, lyricDna, onLyricDnaUpdated, onClose, sourceBlackHoleId, onStatusChange } = data;

  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [justSaved, setJustSaved] = useState(false);
  const fileInputRef = useRef(null);

  const handleFilePick = useCallback((e) => {
    const picked = e.target.files?.[0] || null;
    e.target.value = ''; // lets picking the same file twice re-fire onChange
    if (picked && !inputTypeForFile(picked)) {
      setError('solo imágenes o PDF');
      return;
    }
    setError(null);
    setFile(picked);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (processing) return;
    const hasText = text.trim().length > 0;
    if (!hasText && !file) return;

    setProcessing(true);
    setError(null);
    setJustSaved(false);
    onStatusChange?.(sourceBlackHoleId, 'processing');
    try {
      let rawInput;
      let inputType;
      if (file) {
        const base64 = await readFileAsBase64(file);
        rawInput = { base64, mimeType: file.type };
        inputType = inputTypeForFile(file);
      } else {
        rawInput = text.trim();
        inputType = 'text';
      }

      const { adnLirico, entry } = await processBaulInput({
        currentAdnLirico: lyricDna, rawInput, inputType, sourceLabel: file?.name,
      });
      const { error: saveError } = await saveLyricDna(songId, adnLirico);
      if (saveError) {
        setError(saveError.message);
        onStatusChange?.(sourceBlackHoleId, 'error');
        setTimeout(() => onStatusChange?.(sourceBlackHoleId, undefined), 2000);
        return;
      }
      // Best-effort, never blocks the real save — see canvasData.js's
      // insertBaulEntry comment (dev-only audit log, not real product data).
      insertBaulEntry(songId, entry).catch(() => {});

      onLyricDnaUpdated?.(adnLirico);
      setText('');
      setFile(null);
      setJustSaved(true);
      onStatusChange?.(sourceBlackHoleId, 'success');
      setTimeout(() => setJustSaved(false), 1500);
      setTimeout(() => onStatusChange?.(sourceBlackHoleId, undefined), 1500);
    } catch (err) {
      setError(err.message === 'LIMIT_REACHED' ? 'daily AI limit reached — try again tomorrow' : err.message);
      onStatusChange?.(sourceBlackHoleId, 'error');
      setTimeout(() => onStatusChange?.(sourceBlackHoleId, undefined), 2000);
    } finally {
      setProcessing(false);
    }
  }, [processing, text, file, lyricDna, songId, onLyricDnaUpdated, sourceBlackHoleId, onStatusChange]);

  // A black hole, never better said: nothing that goes in ever comes back
  // out visible here, not even a summary of it. What it extracts feeds the
  // muse silently (see museApi.js's lyric_dna injection) — this panel is
  // purely an input funnel, on purpose, regardless of whether lyricDna is
  // still empty or already substantial.
  const hasAbsorbedSomething = lyricDna && (
    lyricDna.vozPropia?.estiloVocabulario
    || lyricDna.vozPropia?.imagenesHabituales?.length
    || lyricDna.versosDeReferencia?.length
  );

  return (
    <div className={`baul-float${selected ? ' selected' : ''}`}>
      <NodeResizer minWidth={280} minHeight={240} isVisible={selected} />

      <div className="baul-float-head">
        <div className="baul-float-head-left">
          <span className="baul-float-icon">✦</span>
          <span className="baul-float-head-label">inspiration black hole</span>
        </div>
        <button className="baul-float-close nodrag" onClick={() => onClose?.(id)} title="close">✕</button>
      </div>

      {/* Same pattern as the muse's float: covers body + composer, not the
          header, so closing still works mid-process but nothing else is
          clickable while a submission is being processed. */}
      <div className="baul-float-content">
        {processing && (
          <div className="baul-float-loading-overlay">
            <span className="baul-float-spinner" />
          </div>
        )}

        <div className="baul-float-body nodrag nowheel">
          {error && <div className="note-panel-error">{error}</div>}
          <p className="note-panel-empty">
            {hasAbsorbedSomething
              ? 'sigue volcando material — cuanto más le des, más afinada llega la musa. Lo que ya ha absorbido se queda dentro, no se muestra aquí.'
              : 'vuelca aquí lo que tengas — una nota de voz transcrita, un texto a las 3 AM, una foto de tu libreta, un documento — y el baúl irá destilando tu ADN lírico con cada entrada, en silencio.'}
          </p>
        </div>

        <div className="baul-float-composer nodrag">
          {file && (
            <div className="baul-file-chip">
              <span>{file.name}</span>
              <button onClick={() => setFile(null)} title="remove attachment">✕</button>
            </div>
          )}
          <div className="note-panel-add-row">
            <input
              value={text}
              placeholder="vuelca algo al baúl…"
              disabled={processing || !!file}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
            <button onClick={handleSubmit} disabled={processing || (!text.trim() && !file)}>
              {processing ? '…' : 'volcar'}
            </button>
          </div>
          <div className="baul-float-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="baul-file-input"
              onChange={handleFilePick}
            />
            <button
              className="baul-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={processing}
            >
              📎 adjuntar foto de libreta o PDF
            </button>
            {justSaved && <span className="baul-saved-hint">ADN actualizado</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
