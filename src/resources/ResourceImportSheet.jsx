import { useState, useCallback, useMemo, useRef } from 'react';
import { segmentImportedText, segmentImportedImage, MAX_IMPORT_CHARS, MAX_IMPORT_IMAGE_BYTES } from './resourceImportProcessor.js';
import { readFileAsBase64 } from '../utils/baulProcessor.js';
import { createResource, setResourceFolders, RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from './resourcesData.js';
import FolderChipPicker from './FolderChipPicker.jsx';
import { IcCheck, IcPencil, IcFolder, IcImage } from '../mobile/icons.jsx';

// Paste a blob (a Notes dump, a WhatsApp "Export Chat" .txt pasted in,
// anything copied from anywhere) → Claude segments it into candidates
// (resourceImportProcessor.js) → review checklist, nothing saved until the
// artist confirms which candidates are real. Mirrors BaulSheet's
// mode-switching shape ('paste' | 'review') but this sheet never touches
// the hidden Baúl/ADN — every accepted candidate becomes an ordinary,
// visible resources row via the normal createResource path.
//
// Folder assignment is per candidate, not one shared destination for the
// whole batch — a single paste can easily mix material that belongs in
// different places (a book's notes plus one line you also want filed
// under a theme folder), so each candidate gets its own `folderIds`,
// editable alongside type/tags/origin in the same pencil-opened form.
// `folders`/`onCreateFolder` mirror ResourceEditorSheet's. This sheet owns
// writing the membership rows itself (unlike the old shared-picker
// version) since only it knows each candidate's own selection —
// onImported(pairs) reports [{resource, folderIds}, ...] so the caller
// (MobileResourcesScreen) can sync its local resources/membership state.
export default function ResourceImportSheet({ userId, folders, onCreateFolder, onImported, onClose }) {
  const [mode, setMode] = useState('paste'); // 'paste' | 'review'
  const [text, setText] = useState('');
  // A photographed page instead of pasted text — mutually exclusive with
  // `text` (same rule BaulFloatNode's own text-vs-file input already
  // follows), Claude reads the photo directly (see segmentImportedImage),
  // no separate OCR step.
  const [file, setFile] = useState(null);
  const fileInputRef = useRef(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [candidates, setCandidates] = useState([]); // [{body,type,tags,origin,folderIds}]
  const [checked, setChecked] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Which candidate is being edited in place right now, and its draft —
  // Claude's guess is a starting point, not final, so a candidate can be
  // corrected before it ever becomes a real resource (fix a garbled body,
  // a wrong type, a tag, which folder(s) it lands in).
  // {index, body, type, tags, origin, folderIds: Set} | null.
  const [editDraft, setEditDraft] = useState(null);

  const folderNameFor = useMemo(() => Object.fromEntries(folders.map((f) => [f.id, f.name])), [folders]);

  const startEdit = useCallback((i) => {
    const c = candidates[i];
    setEditDraft({ index: i, body: c.body, type: c.type, tags: c.tags.join(', '), origin: c.origin || '', folderIds: new Set(c.folderIds) });
  }, [candidates]);

  const commitEdit = useCallback(() => {
    const trimmed = editDraft.body.trim();
    if (!trimmed) return;
    setCandidates((cur) => cur.map((c, i) => (i === editDraft.index ? {
      body: trimmed,
      type: editDraft.type,
      tags: editDraft.tags.split(',').map((t) => t.trim()).filter(Boolean),
      origin: editDraft.origin.trim() || null,
      folderIds: [...editDraft.folderIds],
    } : c)));
    setEditDraft(null);
  }, [editDraft]);

  const toggleEditFolder = useCallback((id) => {
    setEditDraft((d) => {
      const next = new Set(d.folderIds);
      next.has(id) ? next.delete(id) : next.add(id);
      return { ...d, folderIds: next };
    });
  }, []);

  const handleAnalyze = useCallback(async () => {
    if ((!text.trim() && !file) || analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      const { candidates: found, truncated } = file
        ? await segmentImportedImage(file)
        : await segmentImportedText(text);
      setCandidates(found.map((c) => ({ ...c, folderIds: [] })));
      setChecked(new Set(found.map((_, i) => i))); // everything found starts checked — review is opt-out, not opt-in
      setTruncated(truncated);
      setMode('review');
    } catch (err) {
      setError(err.message === 'LIMIT_REACHED' ? 'daily AI limit reached — try again tomorrow' : err.message);
    } finally {
      setAnalyzing(false);
    }
  }, [text, file, analyzing]);

  const handleFilePick = useCallback(async (e) => {
    const picked = e.target.files?.[0] || null;
    e.target.value = ''; // lets picking the same file twice re-fire onChange
    if (!picked) return;
    if (!picked.type.startsWith('image/')) { setError('solo imágenes'); return; }
    if (picked.size > MAX_IMPORT_IMAGE_BYTES) { setError('la foto pesa más de 10 MB'); return; }
    setError(null);
    const base64 = await readFileAsBase64(picked);
    setFile({ base64, mimeType: picked.type, name: picked.name });
    setText('');
  }, []);

  const toggle = useCallback((i) => {
    setChecked((cur) => {
      const next = new Set(cur);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (saving || checked.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const toSave = candidates.filter((_, i) => checked.has(i));
      const results = await Promise.all(toSave.map(({ folderIds, ...c }) => createResource({ userId, ...c })));
      const failed = results.find((r) => r.error);
      if (failed) { setError(failed.error.message); return; }
      // Each candidate carries its own folders — file each created
      // resource into its own set, not one shared batch call.
      const pairs = results.map((r, i) => ({ resource: r.data, folderIds: toSave[i].folderIds }));
      await Promise.all(pairs.filter((p) => p.folderIds.length).map((p) => setResourceFolders(p.resource.id, p.folderIds)));
      onImported(pairs);
    } finally {
      setSaving(false);
    }
  }, [saving, checked, candidates, userId, onImported]);

  return (
    <div className="baul-sheet-scrim" onClick={saving ? undefined : onClose}>
      <div className="baul-sheet res-editor-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />
        <div className="baul-sheet-body res-editor-body">
          {mode === 'paste' ? (
            <>
              <div className="attach-title">Importar texto</div>
              <p className="attach-sub">
                Pega una nota, un fragmento de un chat exportado, cualquier texto, o adjunta una foto de
                una página o libreta — la musa buscará metáforas, refranes o frases reales dentro y
                descarta el resto. Nada se guarda todavía.
              </p>

              {file ? (
                <div className="baul-file-chip res-import-file-chip">
                  <span>{file.name}</span>
                  <button onClick={() => setFile(null)} title="quitar la foto">✕</button>
                </div>
              ) : (
                <textarea
                  className="res-body-input res-import-input"
                  value={text}
                  placeholder="pega aquí…"
                  autoFocus
                  onChange={(e) => setText(e.target.value)}
                />
              )}
              {!file && text.length > MAX_IMPORT_CHARS && (
                <p className="res-import-hint">Solo se analizarán los primeros {MAX_IMPORT_CHARS.toLocaleString('es-ES')} caracteres.</p>
              )}

              {!file && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="baul-file-input"
                    onChange={handleFilePick}
                  />
                  <button
                    className="baul-attach-btn res-import-attach-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={analyzing || !!text.trim()}
                  >
                    <IcImage size={16} /> adjuntar foto de una página
                  </button>
                </>
              )}

              {error && <p className="baul-error">{error}</p>}
              <button className="baul-note-submit res-save-btn" onClick={handleAnalyze} disabled={analyzing || (!text.trim() && !file)}>
                {analyzing ? 'analizando…' : 'Analizar'}
              </button>
            </>
          ) : (
            <>
              <div className="attach-title">{candidates.length === 0 ? 'Nada que rescatar' : `${checked.size} de ${candidates.length} seleccionados`}</div>
              {truncated && <p className="res-import-hint">El texto era muy largo — solo se analizó el principio.</p>}
              {candidates.length === 0 ? (
                <p className="attach-sub">No se encontró ninguna metáfora, refrán o frase real en el texto pegado.</p>
              ) : (
                <div className="res-import-list">
                  {candidates.map((c, i) => editDraft?.index === i ? (
                    <div key={i} className="res-import-row res-import-row-editing">
                      <textarea
                        className="res-body-input res-import-edit-body"
                        value={editDraft.body}
                        autoFocus
                        onChange={(e) => setEditDraft((d) => ({ ...d, body: e.target.value }))}
                      />
                      <div className="res-chip-row">
                        {RESOURCE_TYPES.map((t) => (
                          <button
                            key={t}
                            className={`res-chip${editDraft.type === t ? ' res-chip-active' : ''}`}
                            onClick={() => setEditDraft((d) => ({ ...d, type: d.type === t ? null : t }))}
                          >
                            {RESOURCE_TYPE_LABELS[t]}
                          </button>
                        ))}
                      </div>
                      <input
                        className="res-text-input res-import-edit-field"
                        value={editDraft.tags}
                        placeholder="etiquetas: amor, calle…"
                        onChange={(e) => setEditDraft((d) => ({ ...d, tags: e.target.value }))}
                      />
                      <input
                        className="res-text-input res-import-edit-field"
                        value={editDraft.origin}
                        placeholder="origen"
                        onChange={(e) => setEditDraft((d) => ({ ...d, origin: e.target.value }))}
                      />
                      <div className="res-field-label res-import-edit-field-label">Carpetas</div>
                      <FolderChipPicker folders={folders} selectedIds={editDraft.folderIds} onToggle={toggleEditFolder} onCreateFolder={onCreateFolder} />
                      <button className="res-import-edit-done" onClick={commitEdit} disabled={!editDraft.body.trim()}>Listo</button>
                    </div>
                  ) : (
                    // A div, not a <button>, so the edit button can be a real
                    // nested button (see ProjectRow/the chooser for the same
                    // "no interactive elements nested in a button" fix) —
                    // the main area toggles accept/reject, the pencil edits.
                    <div key={i} className={`res-import-row${checked.has(i) ? ' res-import-row-checked' : ''}`}>
                      <div className="res-import-row-main" role="button" tabIndex={0} onClick={() => toggle(i)}>
                        <span className="res-import-check">{checked.has(i) && <IcCheck size={13} />}</span>
                        <span className="res-import-row-body">
                          <span className="res-import-row-text">{c.body}</span>
                          {/* Its own line, right under the text — same
                              placement as ResourceCard's folder row, for
                              consistency between "about to save" and "already
                              saved" views. */}
                          {c.folderIds.length > 0 && (
                            <span className="res-import-row-folders">
                              {c.folderIds.map((id) => folderNameFor[id] && (
                                <span key={id} className="res-tag res-tag-folder"><IcFolder size={11} /> {folderNameFor[id]}</span>
                              ))}
                            </span>
                          )}
                          <span className="res-import-row-meta">
                            {c.type && <span className="res-card-type">{RESOURCE_TYPE_LABELS[c.type]}</span>}
                            {c.origin && <span className="res-card-origin">{c.origin}</span>}
                            {c.tags.map((t) => <span key={t} className="res-tag">{t}</span>)}
                          </span>
                        </span>
                      </div>
                      <button className="res-import-edit-btn" onClick={(e) => { e.stopPropagation(); startEdit(i); }} title="editar" aria-label="Editar este candidato">
                        <IcPencil size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {error && <p className="baul-error">{error}</p>}
              {candidates.length === 0 ? (
                <button className="baul-note-submit res-save-btn" onClick={() => { setMode('paste'); setCandidates([]); }}>Volver</button>
              ) : (
                <button className="baul-note-submit res-save-btn" onClick={handleSave} disabled={saving || checked.size === 0}>
                  {saving ? '…' : `Guardar ${checked.size}`}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
