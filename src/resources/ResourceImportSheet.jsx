import { useState, useCallback, useMemo, useRef } from 'react';
import { segmentImportedText, segmentImportedImage, MAX_IMPORT_CHARS, MAX_IMPORT_IMAGE_BYTES } from './resourceImportProcessor.js';
import { readFileAsBase64 } from '../utils/baulProcessor.js';
import { createResource, setResourceFolders, RESOURCE_TYPES, RESOURCE_TYPE_LABELS, formatSourceLoc } from './resourcesData.js';
import FolderChipPicker from './FolderChipPicker.jsx';
import { IcCheck, IcPencil, IcFolder, IcImage, IcClose } from '../mobile/icons.jsx';

// Paste a blob (a Notes dump, a WhatsApp "Export Chat" .txt pasted in,
// anything copied from anywhere) → Claude segments it into candidates
// (resourceImportProcessor.js) → review checklist, nothing saved until the
// artist confirms which candidates are real. Mirrors BaulSheet's
// mode-switching shape ('paste' | 'review') but this sheet never touches
// the hidden Baúl/ADN — every accepted candidate becomes an ordinary,
// visible resources row via the normal createResource path.
//
// A third mode, 'bulk', covers the "a whole book, one photo per page"
// case: several photos analyzed one after another (each still its own
// segmentImportedImage call — see handleAnalyzeBulk's own comment for why
// this isn't batched into fewer multi-image calls), merged into the SAME
// review list 'paste'/single-photo mode produces, so accepting/editing/
// filing candidates works identically regardless of how many photos fed it.
//
// Folder assignment is per candidate, not one shared destination for the
// whole batch — a single paste can easily mix material that belongs in
// different places (a book's notes plus one line you also want filed
// under a theme folder), so each candidate gets its own `folderIds`,
// editable alongside type/tags/origin/page/line in the same pencil-opened
// form. `folders`/`onCreateFolder` mirror ResourceEditorSheet's. This sheet
// owns writing the membership rows itself (unlike the old shared-picker
// version) since only it knows each candidate's own selection —
// onImported(pairs) reports [{resource, folderIds}, ...] so the caller
// (MobileResourcesScreen) can sync its local resources/membership state.
export default function ResourceImportSheet({ userId, folders, onCreateFolder, onImported, onClose }) {
  const [mode, setMode] = useState('paste'); // 'paste' | 'bulk' | 'review'
  const [text, setText] = useState('');
  // A photographed page instead of pasted text — mutually exclusive with
  // `text` (same rule BaulFloatNode's own text-vs-file input already
  // follows), Claude reads the photo directly (see segmentImportedImage),
  // no separate OCR step.
  const [file, setFile] = useState(null);
  const [singlePhotoPage, setSinglePhotoPage] = useState('');
  const fileInputRef = useRef(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [candidates, setCandidates] = useState([]); // [{body,type,tags,origin,source_page,source_line,folderIds}]
  const [checked, setChecked] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Which candidate is being edited in place right now, and its draft —
  // Claude's guess is a starting point, not final, so a candidate can be
  // corrected before it ever becomes a real resource (fix a garbled body,
  // a wrong type, a tag, its page/line, which folder(s) it lands in).
  const [editDraft, setEditDraft] = useState(null);

  // Bulk mode's own state — a list of picked photos (each with a stable id,
  // since page overrides are keyed by it rather than array index, so
  // removing one photo never silently shifts another's typed-in page onto
  // it), a starting page that auto-numbers the rest, and progress while
  // working through them one at a time.
  const [bulkFiles, setBulkFiles] = useState([]); // [{id, base64, mimeType, name}]
  const [bulkStartPage, setBulkStartPage] = useState('');
  const [bulkPageOverrides, setBulkPageOverrides] = useState({}); // { [fileId]: string }
  const [bulkAnalyzing, setBulkAnalyzing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const bulkFileInputRef = useRef(null);

  const folderNameFor = useMemo(() => Object.fromEntries(folders.map((f) => [f.id, f.name])), [folders]);

  // Only meaningful when bulkStartPage is a plain integer — real page
  // numbering (roman numerals, "42 bis") doesn't auto-increment sanely, so
  // those cases stay blank here and get typed in per photo instead.
  const autoPageFor = useCallback((index) => {
    const start = bulkStartPage.trim();
    if (!/^\d+$/.test(start)) return '';
    return String(Number(start) + index);
  }, [bulkStartPage]);

  const startEdit = useCallback((i) => {
    const c = candidates[i];
    setEditDraft({
      index: i, body: c.body, type: c.type, tags: c.tags.join(', '), origin: c.origin || '',
      sourcePage: c.source_page || '', sourceLine: c.source_line || '', folderIds: new Set(c.folderIds),
    });
  }, [candidates]);

  const commitEdit = useCallback(() => {
    const trimmed = editDraft.body.trim();
    if (!trimmed) return;
    setCandidates((cur) => cur.map((c, i) => (i === editDraft.index ? {
      body: trimmed,
      type: editDraft.type,
      tags: editDraft.tags.split(',').map((t) => t.trim()).filter(Boolean),
      origin: editDraft.origin.trim() || null,
      source_page: editDraft.sourcePage.trim() || null,
      source_line: editDraft.sourceLine.trim() || null,
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
        ? await segmentImportedImage(file, singlePhotoPage.trim() || null)
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
  }, [text, file, singlePhotoPage, analyzing]);

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

  const handleBulkFilesPick = useCallback(async (e) => {
    const picked = [...(e.target.files || [])];
    e.target.value = ''; // lets picking overlapping files again re-fire onChange
    if (!picked.length) return;
    const valid = [];
    const rejected = [];
    picked.forEach((p) => {
      if (!p.type.startsWith('image/') || p.size > MAX_IMPORT_IMAGE_BYTES) rejected.push(p.name);
      else valid.push(p);
    });
    const withBase64 = await Promise.all(valid.map(async (p) => ({
      id: crypto.randomUUID(), base64: await readFileAsBase64(p), mimeType: p.type, name: p.name,
    })));
    setBulkFiles((cur) => [...cur, ...withBase64]);
    if (rejected.length) setError(`omitidas (no son imagen o pesan más de 10 MB): ${rejected.join(', ')}`);
  }, []);

  const removeBulkFile = useCallback((id) => {
    setBulkFiles((cur) => cur.filter((f) => f.id !== id));
    setBulkPageOverrides((cur) => { const { [id]: _drop, ...rest } = cur; return rest; });
  }, []);

  const setBulkPageOverride = useCallback((id, value) => {
    setBulkPageOverrides((cur) => ({ ...cur, [id]: value }));
  }, []);

  // One segmentImportedImage call PER photo, sequentially — not fewer
  // multi-image calls. A single call can't reliably tell you which photo
  // any one candidate came from (the model would have to echo back a photo
  // index per item, an extra failure mode for something the caller already
  // knows for free), and the vision API applies a stricter per-image size
  // limit once a request carries more than 20 images. Sequential also means
  // real, incremental progress instead of one long silent wait, and a
  // LIMIT_REACHED partway through a big batch stops cleanly with whatever
  // was already found kept, rather than losing the whole batch.
  const handleAnalyzeBulk = useCallback(async () => {
    if (bulkAnalyzing || bulkFiles.length === 0) return;
    setBulkAnalyzing(true);
    setError(null);
    setBulkProgress({ done: 0, total: bulkFiles.length });
    const found = [];
    const failed = [];
    let limitHit = false;
    let processedCount = 0; // local, not read back from state — setBulkProgress below is
                             // for the UI only and won't have landed by the time this loop reads it
    for (let i = 0; i < bulkFiles.length; i++) {
      const f = bulkFiles[i];
      const page = (bulkPageOverrides[f.id] ?? autoPageFor(i)).trim() || null;
      try {
        const { candidates } = await segmentImportedImage({ base64: f.base64, mimeType: f.mimeType }, page);
        candidates.forEach((c) => found.push({ ...c, folderIds: [] }));
      } catch (err) {
        if (err.message === 'LIMIT_REACHED') { limitHit = true; break; }
        failed.push(f.name);
      }
      processedCount = i + 1;
      setBulkProgress({ done: processedCount, total: bulkFiles.length });
    }
    setCandidates(found);
    setChecked(new Set(found.map((_, i) => i)));
    setBulkAnalyzing(false);
    const notes = [];
    if (limitHit) notes.push(`límite diario de IA alcanzado — se analizaron ${processedCount} de ${bulkFiles.length} fotos`);
    if (failed.length) notes.push(`fallaron y se omitieron: ${failed.join(', ')}`);
    setError(notes.length ? notes.join(' · ') : null);
    setMode('review');
  }, [bulkAnalyzing, bulkFiles, bulkPageOverrides, autoPageFor]);

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
          {mode === 'bulk' ? (
            <>
              <div className="attach-title">Importar varias fotos</div>
              <p className="attach-sub">
                Para páginas seguidas de un libro o libreta: elige varias fotos a la vez. La primera
                página que indiques numera el resto sola — corrígela en cualquier foto si el orden no
                es exacto. Se analizan una a una y acaban en una sola revisión, igual que una foto sola.
              </p>

              <div className="res-field-label">Página inicial (opcional)</div>
              <input
                className="res-text-input"
                value={bulkStartPage}
                placeholder="p. ej. 40 — el resto se numera sola"
                onChange={(e) => setBulkStartPage(e.target.value)}
                disabled={bulkAnalyzing}
              />

              <input
                ref={bulkFileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="baul-file-input"
                onChange={handleBulkFilesPick}
              />
              <button
                className="baul-attach-btn res-import-attach-btn"
                onClick={() => bulkFileInputRef.current?.click()}
                disabled={bulkAnalyzing}
              >
                <IcImage size={16} /> añadir fotos
              </button>

              {bulkFiles.length > 0 && (
                <div className="res-bulk-list">
                  {bulkFiles.map((f, i) => (
                    <div key={f.id} className="res-bulk-row">
                      <span className="res-bulk-row-name">{f.name}</span>
                      <input
                        className="res-text-input res-bulk-row-page"
                        value={bulkPageOverrides[f.id] ?? autoPageFor(i)}
                        placeholder="página"
                        onChange={(e) => setBulkPageOverride(f.id, e.target.value)}
                        disabled={bulkAnalyzing}
                      />
                      <button
                        className="res-import-edit-btn"
                        onClick={() => removeBulkFile(f.id)}
                        title="quitar"
                        aria-label={`Quitar ${f.name}`}
                        disabled={bulkAnalyzing}
                      >
                        <IcClose size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {bulkAnalyzing && (
                <p className="res-import-hint">analizando foto {Math.min(bulkProgress.done + 1, bulkProgress.total)} de {bulkProgress.total}…</p>
              )}
              {error && <p className="baul-error">{error}</p>}

              <button
                className="baul-note-submit res-save-btn"
                onClick={handleAnalyzeBulk}
                disabled={bulkAnalyzing || bulkFiles.length === 0}
              >
                {bulkAnalyzing ? 'analizando…' : `Analizar ${bulkFiles.length} foto${bulkFiles.length === 1 ? '' : 's'}`}
              </button>
              <button className="res-bulk-back-link" onClick={() => setMode('paste')} disabled={bulkAnalyzing}>volver</button>
            </>
          ) : mode === 'paste' ? (
            <>
              <div className="attach-title">Importar texto</div>
              <p className="attach-sub">
                Pega una nota, un fragmento de un chat exportado, cualquier texto, o adjunta una foto de
                una página o libreta — la musa buscará metáforas, refranes o frases reales dentro y
                descarta el resto. Nada se guarda todavía.
              </p>

              {file ? (
                <>
                  <div className="baul-file-chip res-import-file-chip">
                    <span>{file.name}</span>
                    <button onClick={() => setFile(null)} title="quitar la foto">✕</button>
                  </div>
                  <input
                    className="res-text-input res-import-page-input"
                    value={singlePhotoPage}
                    placeholder="página (opcional) — para volver a este punto luego"
                    onChange={(e) => setSinglePhotoPage(e.target.value)}
                  />
                </>
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
                  <button
                    className="res-bulk-link"
                    onClick={() => setMode('bulk')}
                    disabled={analyzing || !!text.trim()}
                  >
                    ¿varias fotos de un libro? importar en lote
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
                  {candidates.map((c, i) => {
                    const loc = formatSourceLoc(c.source_page, c.source_line);
                    return editDraft?.index === i ? (
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
                        <div className="res-source-loc-row res-import-edit-field">
                          <input
                            className="res-text-input res-source-loc-input"
                            value={editDraft.sourcePage}
                            placeholder="página"
                            onChange={(e) => setEditDraft((d) => ({ ...d, sourcePage: e.target.value }))}
                          />
                          <input
                            className="res-text-input res-source-loc-input"
                            value={editDraft.sourceLine}
                            placeholder="línea"
                            onChange={(e) => setEditDraft((d) => ({ ...d, sourceLine: e.target.value }))}
                          />
                        </div>
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
                              {loc && <span className="res-card-loc">{loc}</span>}
                              {c.tags.map((t) => <span key={t} className="res-tag">{t}</span>)}
                            </span>
                          </span>
                        </div>
                        <button className="res-import-edit-btn" onClick={(e) => { e.stopPropagation(); startEdit(i); }} title="editar" aria-label="Editar este candidato">
                          <IcPencil size={15} />
                        </button>
                      </div>
                    );
                  })}
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
