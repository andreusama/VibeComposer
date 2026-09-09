import { useState, useEffect, useCallback } from 'react';
import { findRepeatedWords } from '../utils/repeatedWords.js';
import {
  loadNoteDetail, addVariant, updateVariantText, deleteVariant, promoteVariant,
  addAnnotation, updateAnnotation, deleteAnnotation, restoreVersion, deleteHistoryVersion,
  SECTION_TYPES, saveNoteType, saveNoteText,
} from './canvasData.js';
import { loadLineHistory, addLineHistory, deleteLineHistory } from './lineHistoryData.js';

const CATEGORY_LABELS = { duda: 'duda', idea: 'idea', referencia: 'referencia' };

export default function NoteSidePanel({
  note, userId, allNoteTexts, onClose, onTextUpdated, onOpenMuse, onTypeChange,
}) {
  const lineId = note.lines?.[0]?.id;
  const currentText = note.lines?.[0]?.text || '';

  // note.type is bound straight from the prop, no local state needed — the
  // node itself is the source of truth, and CanvasScreen already mirrors a
  // type change back into the same `nodes` state this panel's `note` prop
  // is read from, so picking a new type here re-renders this select too.
  const handleTypeChange = useCallback((e) => {
    const val = e.target.value;
    const label = val === 'custom' ? note.custom_label : null;
    saveNoteType(note.id, val, label);
    onTypeChange?.(note.id, val, label);
  }, [note.id, note.custom_label, onTypeChange]);

  const [variants, setVariants] = useState([]);
  const [annotations, setAnnotations] = useState([]);
  const [history, setHistory] = useState([]);
  const [lineHistory, setLineHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [newVariant, setNewVariant] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newNoteCategory, setNewNoteCategory] = useState('');
  const [repeatResults, setRepeatResults] = useState(null);

  const [activeTab, setActiveTab] = useState('variants');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [{ variants, annotations, history, error }, { data: lineHist }] = await Promise.all([
        loadNoteDetail(note.id, lineId),
        loadLineHistory(note.id),
      ]);
      if (cancelled) return;
      if (error) { setError(error.message); setLoading(false); return; }
      setVariants(variants);
      setAnnotations(annotations);
      setHistory(history);
      setLineHistory(lineHist || []);
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

  // Restore one PHYSICAL LINE to an earlier wording — logs what it's about to
  // overwrite (same append-only contract as handleRestore above), swaps that
  // one line in the block text, saves, and mirrors to the canvas.
  const handleRestoreLine = useCallback(async (entry) => {
    const lines = currentText.split('\n');
    if (lines[entry.line_index] === entry.text) return;
    const prev = lines[entry.line_index] ?? '';
    lines[entry.line_index] = entry.text;
    const joined = lines.join('\n');
    if (lineId) await saveNoteText(lineId, joined);
    const { data } = await addLineHistory(note.id, entry.line_index, prev);
    if (data) setLineHistory((h) => [data, ...h]);
    onTextUpdated(note.id, joined);
  }, [currentText, lineId, note.id, onTextUpdated]);

  const handleDeleteLineHistory = useCallback(async (id) => {
    const { error } = await deleteLineHistory(id);
    if (error) { setError(error.message); return; }
    setLineHistory((h) => h.filter((v) => v.id !== id));
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

  return (
    <div className="note-panel">
      <div className="note-panel-head">
        <select value={note.type} onChange={handleTypeChange} className="canvas-note-type note-panel-type-select">
          {SECTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {note.custom_label && <span className="note-panel-custom-label">{note.custom_label}</span>}
        <button className="note-panel-close" onClick={onClose}>✕</button>
      </div>

      {/* The muse lives as its own floating node on the canvas now, not a
          tab here — this just opens (or re-focuses) the one for this note. */}
      <button className="note-panel-open-muse" onClick={() => onOpenMuse?.(note)}>
        <span className="note-panel-open-muse-icon">✦</span>
        <span className="note-panel-open-muse-label">ask the muse</span>
        <span className="note-panel-open-muse-arrow">›</span>
      </button>

      <div className="note-panel-tabs">
        <button
          className={`note-panel-tab${activeTab === 'variants' ? ' active' : ''}`}
          onClick={() => setActiveTab('variants')}
        >
          variants <span className="note-panel-tab-count">{variants.length}</span>
        </button>
        <button
          className={`note-panel-tab${activeTab === 'notes' ? ' active' : ''}`}
          onClick={() => setActiveTab('notes')}
        >
          notes <span className="note-panel-tab-count">{annotations.length}</span>
        </button>
        <button
          className={`note-panel-tab${activeTab === 'history' ? ' active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          history <span className="note-panel-tab-count">{history.length + lineHistory.length}</span>
        </button>
      </div>

      {error && <div className="note-panel-error">{error}</div>}

      {loading ? (
        <div className="note-panel-loading">loading…</div>
      ) : (
        <>
          <div className="note-panel-body">

            {activeTab === 'variants' && (
              <div className="note-group-card">
                {variants.length === 0 && <p className="note-panel-empty">no alternates yet — the version on the canvas is your only one</p>}
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
                  <button onClick={handleAddVariant}>+</button>
                </div>
              </div>
            )}

            {activeTab === 'notes' && (
              <div className="note-group-card">
                {annotations.length === 0 && <p className="note-panel-empty">no notes yet</p>}
                {annotations.map((a) => (
                  <div className={`note-annotation-row${a.resolved ? ' resolved' : ''}`} key={a.id}>
                    <span className={`note-annotation-dot${a.category ? ` ${a.category}` : ''}`} />
                    <div className="note-annotation-main">
                      {a.category && <span className="note-annotation-category">{CATEGORY_LABELS[a.category]}</span>}
                      <p className="note-annotation-body">{a.body}</p>
                      <div className="note-annotation-actions">
                        <button onClick={() => handleToggleResolved(a)}>{a.resolved ? 'reopen' : 'resolve'}</button>
                        <button onClick={() => handleDeleteAnnotation(a.id)}>✕</button>
                      </div>
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
                      <option value="duda">duda</option>
                      <option value="idea">idea</option>
                      <option value="referencia">referencia</option>
                    </select>
                    <button onClick={handleAddAnnotation}>+ add</button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'history' && (
              <div className="note-group-card">
                {history.length === 0 && lineHistory.length === 0 && (
                  <p className="note-panel-empty">no previous versions</p>
                )}

                {lineHistory.length > 0 && (
                  <>
                    <p className="note-panel-subhead">line by line</p>
                    {Object.entries(
                      lineHistory.reduce((acc, e) => { (acc[e.line_index] ??= []).push(e); return acc; }, {})
                    ).sort((a, b) => Number(a[0]) - Number(b[0])).map(([lineIndex, entries]) => (
                      <div className="note-line-history-group" key={lineIndex}>
                        <p className="note-line-history-current">
                          <span className="note-line-history-num">L{Number(lineIndex) + 1}</span>
                          {currentText.split('\n')[Number(lineIndex)] || <em>(empty)</em>}
                        </p>
                        {entries.map((e) => (
                          <div className="note-history-row" key={e.id}>
                            <p className="note-history-text">{e.text || <em>(empty)</em>}</p>
                            <div className="note-history-meta">
                              <span>{new Date(e.created_at).toLocaleString()}</span>
                              <div className="note-history-buttons">
                                <button onClick={() => handleRestoreLine(e)}>restore</button>
                                <button className="note-history-delete" onClick={() => handleDeleteLineHistory(e.id)}>delete</button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </>
                )}

                {history.length > 0 && (
                  <>
                    <p className="note-panel-subhead">whole block</p>
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
                  </>
                )}
              </div>
            )}

          </div>

          {/* Pinned regardless of which tab is open — a whole-lyric tool,
              not something scoped to one category of note content, so it
              doesn't belong inside the tab switching above it. Syllable
              counts used to live here too; they're on the canvas note's own
              gutter now, so showing them a second time here would just be
              a second, out-of-sync copy. */}
          <div className="note-panel-tools-bar">
            <div>
              <div className="note-panel-tools-label">check repeated words</div>
              <div className="note-panel-tools-sublabel">across the whole lyric</div>
            </div>
            <button className="note-panel-run-btn" onClick={handleCheckRepeats}>run</button>
          </div>
          {repeatResults && (
            <div className="note-panel-tools-results">
              {repeatResults.length === 0 ? (
                <p className="note-panel-empty">no repeats found across the lyric</p>
              ) : (
                <ul className="note-repeats-list">
                  {repeatResults.map((r) => (
                    <li key={r.word}><strong>{r.word}</strong> × {r.count}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
