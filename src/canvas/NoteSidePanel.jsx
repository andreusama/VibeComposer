import { useState, useEffect, useCallback } from 'react';
import { countLineSyllables } from '../utils/syllables.js';
import { findRepeatedWords } from '../utils/repeatedWords.js';
import {
  loadNoteDetail, addVariant, updateVariantText, deleteVariant, promoteVariant,
  addAnnotation, updateAnnotation, deleteAnnotation, restoreVersion, deleteHistoryVersion,
} from './canvasData.js';

const CATEGORY_LABELS = { duda: '❓ duda', idea: '💡 idea', referencia: '🔗 referencia' };

export default function NoteSidePanel({ note, userId, allNoteTexts, onClose, onTextUpdated }) {
  const lineId = note.lines?.[0]?.id;
  const currentText = note.lines?.[0]?.text || '';

  const [variants, setVariants] = useState([]);
  const [annotations, setAnnotations] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [newVariant, setNewVariant] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newNoteCategory, setNewNoteCategory] = useState('');
  const [lang, setLang] = useState('es');
  const [repeatResults, setRepeatResults] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { variants, annotations, history, error } = await loadNoteDetail(note.id, lineId);
      if (cancelled) return;
      if (error) { setError(error.message); setLoading(false); return; }
      setVariants(variants);
      setAnnotations(annotations);
      setHistory(history);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [note.id, lineId]);

  const handleAddVariant = useCallback(async () => {
    const text = newVariant.trim();
    if (!text) return;
    const { data, error } = await addVariant(lineId, text, variants.length);
    if (error) { setError(error.message); return; }
    setVariants((v) => [...v, data]);
    setNewVariant('');
  }, [newVariant, lineId, variants.length]);

  const handleVariantTextChange = useCallback((id, text) => {
    setVariants((v) => v.map((item) => (item.id === id ? { ...item, text } : item)));
  }, []);

  const handleVariantBlur = useCallback((variant) => {
    updateVariantText(variant.id, variant.text);
  }, []);

  const handleDeleteVariant = useCallback(async (id) => {
    await deleteVariant(id);
    setVariants((v) => v.filter((item) => item.id !== id));
  }, []);

  const handlePromote = useCallback(async (variant) => {
    const { error } = await promoteVariant(note.id, lineId, variant, currentText);
    if (error) { setError(error.message); return; }
    setVariants((v) => v.filter((item) => item.id !== variant.id));
    setHistory((h) => [{ id: crypto.randomUUID(), snapshot: [{ line_id: lineId, text: currentText }], created_at: new Date().toISOString() }, ...h]);
    onTextUpdated(note.id, variant.text);
  }, [note.id, lineId, currentText, onTextUpdated]);

  const handleRestore = useCallback(async (version) => {
    const { error } = await restoreVersion(note.id, lineId, version, currentText);
    if (error) { setError(error.message); return; }
    const restoredText = version.snapshot?.[0]?.text ?? '';
    setHistory((h) => [{ id: crypto.randomUUID(), snapshot: [{ line_id: lineId, text: currentText }], created_at: new Date().toISOString() }, ...h]);
    onTextUpdated(note.id, restoredText);
  }, [note.id, lineId, currentText, onTextUpdated]);

  const handleDeleteHistory = useCallback(async (id) => {
    if (!confirm('Delete this version permanently? This can\'t be undone.')) return;
    const { error } = await deleteHistoryVersion(id);
    if (error) { setError(error.message); return; }
    setHistory((h) => h.filter((v) => v.id !== id));
  }, []);

  const handleAddAnnotation = useCallback(async () => {
    const body = newNote.trim();
    if (!body || !userId) return;
    const { data, error } = await addAnnotation(lineId, userId, body, newNoteCategory);
    if (error) { setError(error.message); return; }
    setAnnotations((a) => [...a, data]);
    setNewNote('');
    setNewNoteCategory('');
  }, [newNote, newNoteCategory, lineId, userId]);

  const handleDeleteAnnotation = useCallback(async (id) => {
    await deleteAnnotation(id);
    setAnnotations((a) => a.filter((item) => item.id !== id));
  }, []);

  const handleToggleResolved = useCallback(async (ann) => {
    const resolved = !ann.resolved;
    await updateAnnotation(ann.id, { resolved });
    setAnnotations((a) => a.map((item) => (item.id === ann.id ? { ...item, resolved } : item)));
  }, []);

  const handleCheckRepeats = useCallback(() => {
    setRepeatResults(findRepeatedWords(allNoteTexts));
  }, [allNoteTexts]);

  const syllables = countLineSyllables(currentText, lang);

  return (
    <div className="note-panel">
      <div className="note-panel-head">
        <span className="note-panel-title">{note.type}{note.custom_label ? ` · ${note.custom_label}` : ''}</span>
        <button className="note-panel-close" onClick={onClose}>✕</button>
      </div>

      {error && <div className="note-panel-error">{error}</div>}

      {loading ? (
        <div className="note-panel-loading">loading…</div>
      ) : (
        <div className="note-panel-body">

          <section className="note-panel-section">
            <h4>Variantes</h4>
            {variants.length === 0 && <p className="note-panel-empty">no alternates yet</p>}
            {variants.map((v) => (
              <div className="note-variant-row" key={v.id}>
                <textarea
                  className="note-variant-text"
                  value={v.text}
                  onChange={(e) => handleVariantTextChange(v.id, e.target.value)}
                  onBlur={() => handleVariantBlur(v)}
                />
                <div className="note-variant-actions">
                  <button onClick={() => handlePromote(v)} title="make this the active text">use ⇧</button>
                  <button onClick={() => handleDeleteVariant(v.id)} title="delete variant">✕</button>
                </div>
              </div>
            ))}
            <div className="note-panel-add-row">
              <input
                value={newVariant}
                placeholder="alternate wording…"
                onChange={(e) => setNewVariant(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddVariant()}
              />
              <button onClick={handleAddVariant}>+ add</button>
            </div>
          </section>

          <section className="note-panel-section">
            <h4>Apuntes</h4>
            {annotations.length === 0 && <p className="note-panel-empty">no notes yet</p>}
            {annotations.map((a) => (
              <div className={`note-annotation-row${a.resolved ? ' resolved' : ''}`} key={a.id}>
                {a.category && <span className="note-annotation-category">{CATEGORY_LABELS[a.category]}</span>}
                <p className="note-annotation-body">{a.body}</p>
                <div className="note-annotation-actions">
                  <button onClick={() => handleToggleResolved(a)}>{a.resolved ? 'reopen' : 'resolve'}</button>
                  <button onClick={() => handleDeleteAnnotation(a.id)}>✕</button>
                </div>
              </div>
            ))}
            <div className="note-panel-add-col">
              <textarea
                className="note-annotation-input"
                value={newNote}
                placeholder="a doubt, an idea, a reference…"
                onChange={(e) => setNewNote(e.target.value)}
              />
              <div className="note-panel-add-row">
                <select value={newNoteCategory} onChange={(e) => setNewNoteCategory(e.target.value)}>
                  <option value="">no category</option>
                  <option value="duda">❓ duda</option>
                  <option value="idea">💡 idea</option>
                  <option value="referencia">🔗 referencia</option>
                </select>
                <button onClick={handleAddAnnotation}>+ add</button>
              </div>
            </div>
          </section>

          <section className="note-panel-section">
            <h4>Historial</h4>
            {history.length === 0 && <p className="note-panel-empty">no previous versions</p>}
            {history.map((v) => (
              <div className="note-history-row" key={v.id}>
                <p className="note-history-text">{v.snapshot?.[0]?.text}</p>
                <div className="note-history-meta">
                  <span>{new Date(v.created_at).toLocaleString()}</span>
                  <div className="note-history-buttons">
                    <button onClick={() => handleRestore(v)}>restore</button>
                    <button className="note-history-delete" onClick={() => handleDeleteHistory(v.id)}>delete</button>
                  </div>
                </div>
              </div>
            ))}
          </section>

          <section className="note-panel-section">
            <h4>Herramientas</h4>
            <div className="note-tool-row">
              <span className="note-syllable-count">{syllables} syllables</span>
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                <option value="es">ES</option>
                <option value="ca">CA</option>
              </select>
            </div>
            <button className="note-check-repeats-btn" onClick={handleCheckRepeats}>revisar repeticiones</button>
            {repeatResults && (
              repeatResults.length === 0 ? (
                <p className="note-panel-empty">no repeats found across the lyric</p>
              ) : (
                <ul className="note-repeats-list">
                  {repeatResults.map((r) => (
                    <li key={r.word}><strong>{r.word}</strong> × {r.count}</li>
                  ))}
                </ul>
              )
            )}
          </section>

        </div>
      )}
    </div>
  );
}
