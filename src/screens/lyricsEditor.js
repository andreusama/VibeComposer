import { setState, enterProjectChords } from '../state/store.js';
import { supabase } from '../utils/supabaseClient.js';
import { countLineSyllables } from '../utils/syllables.js';

const SECTION_TYPES = ['verse', 'chorus', 'pre-chorus', 'bridge', 'outro', 'custom'];
const STATUS_CYCLE  = ['unresolved', 'provisional', 'closed'];

// ─── Local editor state ─────────────────────────────────────────────────────────
// Kept outside the global store on purpose: typing needs surgical DOM updates,
// not a full app-wide re-render on every keystroke (see builder.js sliders for
// the same reasoning). Structural changes (reorder, add/delete, tags, panels)
// go through renderAll(); raw typing does not.

let song           = null;
let sections       = [];     // [{ ...row, lines: [{ ...row, variants: [], annotations: [] }] }]
let currentUser    = null;
let viewMode       = 'work'; // 'work' | 'clean'
let lang           = 'es';   // 'es' | 'ca'
let onlyPending    = false;
let openVariantsFor    = null;
let openAnnotationsFor = null;
const pendingSelections = {}; // lineId -> { start, end } | undefined
const saveTimers        = {}; // lineId -> timeout id

// ─── Shell render (called once by the router) ──────────────────────────────────

export function render() {
  return `
    <div class="header">
      <h1>vibe composer</h1>
      <span class="tagline">lyrics editor</span>
    </div>
    <div class="lyrics-editor-wrap" id="lyrics-editor-root">
      <p class="loading-hint">loading song…</p>
    </div>
  `;
}

// ─── Attach (called once after the shell mounts) ───────────────────────────────

export async function attach(state) {
  if (!state.session) { setState({ screen: 'auth' }); return; }
  if (!state.activeSong) { setState({ screen: 'home' }); return; }

  currentUser = state.session.user;
  song        = state.activeSong;

  await loadSong(song.id);
}

// ─── Data load ──────────────────────────────────────────────────────────────────

async function loadSong(songId) {
  const { data: secData, error: secErr } = await supabase
    .from('sections').select('*').eq('song_id', songId).order('position');
  if (secErr) { renderError(secErr.message); return; }

  const sectionIds = secData.map((s) => s.id);
  let linesData = [];
  if (sectionIds.length) {
    const { data } = await supabase
      .from('lines').select('*').in('section_id', sectionIds).order('position');
    linesData = data || [];
  }

  const lineIds = linesData.map((l) => l.id);
  let variantsData = [], annotationsData = [];
  if (lineIds.length) {
    const [{ data: v }, { data: a }] = await Promise.all([
      supabase.from('line_variants').select('*').in('line_id', lineIds).order('position'),
      supabase.from('annotations').select('*').in('line_id', lineIds).order('created_at'),
    ]);
    variantsData = v || [];
    annotationsData = a || [];
  }

  sections = secData.map((sec) => ({
    ...sec,
    lines: linesData
      .filter((l) => l.section_id === sec.id)
      .map((line) => ({
        ...line,
        variants:    variantsData.filter((v) => v.line_id === line.id),
        annotations: annotationsData.filter((a) => a.line_id === line.id),
      })),
  }));

  if (sections.length === 0) {
    await addSection(); // give a brand-new project a starter verse to write into
    return;
  }

  renderAll();
}

function renderError(msg) {
  const root = document.getElementById('lyrics-editor-root');
  if (root) root.innerHTML = `<div class="error-banner">${escapeHtml(msg)}</div>`;
}

// ─── Full editor render ─────────────────────────────────────────────────────────

function renderAll() {
  const root = document.getElementById('lyrics-editor-root');
  if (!root) return;
  root.innerHTML = buildEditorHTML();
  wireEvents();
  root.querySelectorAll('.lyrics-line-text').forEach(autoGrow);
}

function buildEditorHTML() {
  return `
    <div class="lyrics-toolbar">
      <input id="song-title" class="lyrics-title-input" value="${escapeHtml(song.title)}" placeholder="untitled" />
      <div class="lyrics-toolbar-right">
        <button class="lyrics-toolbar-btn ${lang === 'es' ? 'active' : ''}" id="lang-es">ES</button>
        <button class="lyrics-toolbar-btn ${lang === 'ca' ? 'active' : ''}" id="lang-ca">CA</button>
        <button class="lyrics-toolbar-btn ${onlyPending ? 'active' : ''}" id="filter-pending">only pending</button>
        <button class="lyrics-toolbar-btn" id="view-toggle">${viewMode === 'work' ? 'clean view' : 'work view'}</button>
        <button class="ghost-btn" id="btn-chords">🎵 chords</button>
        <button class="ghost-btn" id="btn-back-home">← projects</button>
      </div>
    </div>

    <div class="lyrics-sections ${viewMode === 'clean' ? 'lyrics-clean' : ''}" id="lyrics-sections">
      ${sections.map(renderSection).join('')}
    </div>

    <button class="ghost-btn lyrics-add-section" id="btn-add-section">+ add section</button>
  `;
}

function renderSection(section) {
  const lines = section.lines.filter((l) => !onlyPending || l.status !== 'closed');
  return `
    <div class="lyrics-section lyrics-section-${section.type}" data-section-id="${section.id}" draggable="true">
      <div class="lyrics-section-head">
        <span class="lyrics-drag-handle" title="drag to reorder">⠿</span>
        <select class="lyrics-section-type" data-section-id="${section.id}">
          ${SECTION_TYPES.map((t) => `<option value="${t}" ${t === section.type ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        ${section.type === 'custom' ? `
          <input class="lyrics-custom-label" data-section-id="${section.id}"
                 value="${escapeHtml(section.custom_label || '')}" placeholder="label…" />
        ` : ''}
        <button class="lyrics-delete-section" data-section-id="${section.id}" title="delete section">✕</button>
      </div>

      <div class="lyrics-lines" data-section-id="${section.id}">
        ${lines.map(renderLine).join('')}
      </div>

      <button class="ghost-btn lyrics-add-line" data-section-id="${section.id}">+ line</button>
    </div>
  `;
}

function renderLine(line) {
  const syl = countLineSyllables(line.text, lang);
  return `
    <div class="lyrics-line" data-line-id="${line.id}" draggable="true">
      <span class="lyrics-drag-handle" title="drag to reorder">⠿</span>
      <div class="lyrics-line-main">
        <textarea class="lyrics-line-text" data-line-id="${line.id}" rows="1">${escapeHtml(line.text)}</textarea>
        <div class="lyrics-line-meta">
          <span class="lyrics-syllable-count" id="syl-${line.id}">${syl} syl</span>
          <button class="lyrics-status-pill lyrics-status-${line.status}" data-line-id="${line.id}">${line.status}</button>
          <button class="lyrics-variant-toggle" data-line-id="${line.id}">variants ${line.variants.length ? `(${line.variants.length})` : ''}</button>
          <button class="lyrics-annotation-toggle" data-line-id="${line.id}">💬${line.annotations.length ? ` ${line.annotations.length}` : ''}</button>
          <button class="lyrics-delete-line" data-line-id="${line.id}" title="delete line">✕</button>
        </div>
      </div>
      ${openVariantsFor === line.id ? renderVariantsPanel(line) : ''}
      ${openAnnotationsFor === line.id ? renderAnnotationsPanel(line) : ''}
    </div>
  `;
}

function renderVariantsPanel(line) {
  return `
    <div class="lyrics-variants-panel">
      ${line.variants.map((v) => `
        <div class="lyrics-variant-row">
          <span class="lyrics-variant-text">${escapeHtml(v.text)}</span>
          <button class="lyrics-variant-use" data-line-id="${line.id}" data-variant-id="${v.id}">use</button>
          <button class="lyrics-variant-delete" data-variant-id="${v.id}" data-line-id="${line.id}">✕</button>
        </div>
      `).join('')}
      <div class="lyrics-variant-add">
        <input class="lyrics-variant-input" data-line-id="${line.id}" placeholder="alternate wording…" />
        <button class="lyrics-variant-save" data-line-id="${line.id}">add</button>
      </div>
    </div>
  `;
}

function renderAnnotationsPanel(line) {
  const sel = pendingSelections[line.id];
  const anchorHint = sel
    ? `commenting on: "${escapeHtml(line.text.slice(sel.start, sel.end))}"`
    : 'commenting on the whole line';

  return `
    <div class="lyrics-annotations-panel">
      ${line.annotations.map((a) => `
        <div class="lyrics-annotation-row ${a.resolved ? 'resolved' : ''}">
          ${a.start_offset != null ? `<div class="lyrics-annotation-anchor">"${escapeHtml(line.text.slice(a.start_offset, a.end_offset))}"</div>` : ''}
          <div class="lyrics-annotation-body">${escapeHtml(a.body)}</div>
          <div class="lyrics-annotation-actions">
            <button class="lyrics-annotation-resolve" data-annotation-id="${a.id}" data-line-id="${line.id}">${a.resolved ? 'reopen' : 'resolve'}</button>
            <button class="lyrics-annotation-delete" data-annotation-id="${a.id}" data-line-id="${line.id}">✕</button>
          </div>
        </div>
      `).join('')}
      <div class="lyrics-annotation-hint">${anchorHint}</div>
      <div class="lyrics-annotation-add">
        <input class="lyrics-annotation-input" data-line-id="${line.id}" placeholder="note about this line…" />
        <button class="lyrics-annotation-save" data-line-id="${line.id}">add</button>
      </div>
    </div>
  `;
}

// ─── Event wiring ────────────────────────────────────────────────────────────────

function wireEvents() {
  document.getElementById('btn-back-home').addEventListener('click', () => {
    setState({ screen: 'home' });
  });

  document.getElementById('btn-chords').addEventListener('click', () => {
    enterProjectChords(song);
  });

  document.getElementById('song-title').addEventListener('blur', async (e) => {
    song.title = e.target.value.trim() || 'untitled';
    await supabase.from('songs').update({ title: song.title }).eq('id', song.id);
  });

  document.getElementById('lang-es').addEventListener('click', () => { lang = 'es'; renderAll(); });
  document.getElementById('lang-ca').addEventListener('click', () => { lang = 'ca'; renderAll(); });
  document.getElementById('filter-pending').addEventListener('click', () => { onlyPending = !onlyPending; renderAll(); });
  document.getElementById('view-toggle').addEventListener('click', () => {
    viewMode = viewMode === 'work' ? 'clean' : 'work';
    renderAll();
  });
  document.getElementById('btn-add-section').addEventListener('click', () => addSection());

  document.querySelectorAll('.lyrics-section').forEach((el) => wireSection(el));
}

function wireSection(sectionEl) {
  const sectionId = sectionEl.dataset.sectionId;
  const section   = sections.find((s) => s.id === sectionId);

  sectionEl.addEventListener('dragstart', (e) => {
    if (!e.target.classList.contains('lyrics-drag-handle')) { e.preventDefault(); return; }
    dragSectionId = sectionId;
    e.stopPropagation();
  });

  sectionEl.querySelector('.lyrics-section-type').addEventListener('change', async (e) => {
    section.type = e.target.value;
    await supabase.from('sections').update({ type: section.type }).eq('id', sectionId);
    renderAll();
  });

  const customLabel = sectionEl.querySelector('.lyrics-custom-label');
  if (customLabel) {
    customLabel.addEventListener('blur', async (e) => {
      section.custom_label = e.target.value;
      await supabase.from('sections').update({ custom_label: section.custom_label }).eq('id', sectionId);
    });
  }

  sectionEl.querySelector('.lyrics-delete-section').addEventListener('click', () => deleteSection(sectionId));
  sectionEl.querySelector('.lyrics-add-line').addEventListener('click', () => addLine(sectionId));

  const linesEl = sectionEl.querySelector('.lyrics-lines');
  linesEl.addEventListener('dragover', (e) => e.preventDefault());
  linesEl.addEventListener('drop', (e) => {
    e.preventDefault();
    const targetEl = e.target.closest('.lyrics-line');
    if (!targetEl || !dragLineId) return;
    moveLine(dragLineId, targetEl.dataset.lineId, sectionId);
    dragLineId = null;
  });

  sectionEl.querySelectorAll('.lyrics-line').forEach((lineEl) => wireLine(lineEl, section));
}

let dragLineId    = null;
let dragSectionId = null;

// dragend always fires (drop succeeded, drop missed its target, or Escape was
// pressed) — without this reset, a drag that misses its target leaves stale
// drag state around to misfire on the next, unrelated drag.
document.addEventListener('dragend', () => { dragLineId = null; dragSectionId = null; });

document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  const container = e.target.closest('#lyrics-sections');
  if (!container || !dragSectionId) return;
  const targetSection = e.target.closest('.lyrics-section');
  if (!targetSection || targetSection.dataset.sectionId === dragSectionId) { dragSectionId = null; return; }
  moveSection(dragSectionId, targetSection.dataset.sectionId);
  dragSectionId = null;
});

function wireLine(lineEl, section) {
  const lineId = lineEl.dataset.lineId;
  const line   = section.lines.find((l) => l.id === lineId);

  lineEl.addEventListener('dragstart', (e) => {
    if (!e.target.classList.contains('lyrics-drag-handle')) { e.preventDefault(); return; }
    dragLineId = lineId;
    e.stopPropagation();
  });

  const textarea = lineEl.querySelector('.lyrics-line-text');
  textarea.addEventListener('input', () => {
    line.text = textarea.value;
    autoGrow(textarea);
    const sylEl = document.getElementById(`syl-${lineId}`);
    if (sylEl) sylEl.textContent = `${countLineSyllables(line.text, lang)} syl`;
    scheduleLineSave(lineId, line.text);
  });

  lineEl.querySelector('.lyrics-status-pill').addEventListener('click', () => cycleStatus(lineId, section));
  lineEl.querySelector('.lyrics-delete-line').addEventListener('click', () => deleteLine(lineId, section));

  lineEl.querySelector('.lyrics-variant-toggle').addEventListener('click', () => {
    openVariantsFor    = openVariantsFor === lineId ? null : lineId;
    openAnnotationsFor = null;
    renderAll();
  });

  lineEl.querySelector('.lyrics-annotation-toggle').addEventListener('click', () => {
    const start = textarea.selectionStart, end = textarea.selectionEnd;
    pendingSelections[lineId] = (start !== end) ? { start, end } : undefined;
    openAnnotationsFor = openAnnotationsFor === lineId ? null : lineId;
    openVariantsFor    = null;
    renderAll();
  });

  const variantSave = lineEl.querySelector('.lyrics-variant-save');
  if (variantSave) {
    variantSave.addEventListener('click', () => {
      const input = lineEl.querySelector('.lyrics-variant-input');
      const text  = input.value.trim();
      if (text) addVariant(lineId, text, section);
    });
  }
  lineEl.querySelectorAll('.lyrics-variant-use').forEach((btn) => {
    btn.addEventListener('click', () => useVariant(lineId, btn.dataset.variantId, section));
  });
  lineEl.querySelectorAll('.lyrics-variant-delete').forEach((btn) => {
    btn.addEventListener('click', () => deleteVariant(lineId, btn.dataset.variantId, section));
  });

  const annotationSave = lineEl.querySelector('.lyrics-annotation-save');
  if (annotationSave) {
    annotationSave.addEventListener('click', () => {
      const input = lineEl.querySelector('.lyrics-annotation-input');
      const body  = input.value.trim();
      if (body) addAnnotation(lineId, body, section);
    });
  }
  lineEl.querySelectorAll('.lyrics-annotation-resolve').forEach((btn) => {
    btn.addEventListener('click', () => toggleAnnotationResolved(btn.dataset.annotationId, section));
  });
  lineEl.querySelectorAll('.lyrics-annotation-delete').forEach((btn) => {
    btn.addEventListener('click', () => deleteAnnotation(btn.dataset.annotationId, lineId, section));
  });
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

// ─── Mutations ──────────────────────────────────────────────────────────────────

function scheduleLineSave(lineId, text) {
  clearTimeout(saveTimers[lineId]);
  saveTimers[lineId] = setTimeout(async () => {
    await supabase.from('lines').update({ text }).eq('id', lineId);
  }, 700);
}

async function cycleStatus(lineId, section) {
  const line = section.lines.find((l) => l.id === lineId);
  line.status = STATUS_CYCLE[(STATUS_CYCLE.indexOf(line.status) + 1) % STATUS_CYCLE.length];
  await supabase.from('lines').update({ status: line.status }).eq('id', lineId);
  renderAll();
}

async function addSection(type = 'verse') {
  const position = sections.length;
  const { data, error } = await supabase
    .from('sections').insert({ song_id: song.id, type, position }).select().single();
  if (error) { renderError(error.message); return; }

  const newSection = { ...data, lines: [] };
  sections.push(newSection);

  const { data: lineData } = await supabase
    .from('lines').insert({ section_id: newSection.id, position: 0, text: '' }).select().single();
  if (lineData) newSection.lines.push({ ...lineData, variants: [], annotations: [] });

  renderAll();
}

async function deleteSection(sectionId) {
  if (!confirm('Delete this whole section?')) return;
  await supabase.from('sections').delete().eq('id', sectionId);
  sections = sections.filter((s) => s.id !== sectionId);
  renderAll();
}

async function addLine(sectionId) {
  const section  = sections.find((s) => s.id === sectionId);
  const position = section.lines.length;
  const { data, error } = await supabase
    .from('lines').insert({ section_id: sectionId, position, text: '' }).select().single();
  if (error) { renderError(error.message); return; }
  section.lines.push({ ...data, variants: [], annotations: [] });
  renderAll();
}

async function deleteLine(lineId, section) {
  if (!confirm('Delete this line?')) return;
  await supabase.from('lines').delete().eq('id', lineId);
  section.lines = section.lines.filter((l) => l.id !== lineId);
  renderAll();
}

async function persistPositions(items, table) {
  await Promise.all(items.map((item, i) => supabase.from(table).update({ position: i }).eq('id', item.id)));
}

function moveLine(fromId, toId, sectionId) {
  const section  = sections.find((s) => s.id === sectionId);
  const fromIdx  = section.lines.findIndex((l) => l.id === fromId);
  const toIdx    = section.lines.findIndex((l) => l.id === toId);
  if (fromIdx === -1 || toIdx === -1) return;

  const [item] = section.lines.splice(fromIdx, 1);
  section.lines.splice(toIdx, 0, item);
  persistPositions(section.lines, 'lines');
  renderAll();
}

function moveSection(fromId, toId) {
  const fromIdx = sections.findIndex((s) => s.id === fromId);
  const toIdx   = sections.findIndex((s) => s.id === toId);
  if (fromIdx === -1 || toIdx === -1) return;

  const [item] = sections.splice(fromIdx, 1);
  sections.splice(toIdx, 0, item);
  persistPositions(sections, 'sections');
  renderAll();
}

async function addVariant(lineId, text, section) {
  const line = section.lines.find((l) => l.id === lineId);
  const { data, error } = await supabase
    .from('line_variants')
    .insert({ line_id: lineId, text, position: line.variants.length })
    .select().single();
  if (error) { renderError(error.message); return; }
  line.variants.push(data);
  renderAll();
}

async function deleteVariant(lineId, variantId, section) {
  const line = section.lines.find((l) => l.id === lineId);
  await supabase.from('line_variants').delete().eq('id', variantId);
  line.variants = line.variants.filter((v) => v.id !== variantId);
  renderAll();
}

async function useVariant(lineId, variantId, section) {
  const line    = section.lines.find((l) => l.id === lineId);
  const variant = line.variants.find((v) => v.id === variantId);
  if (!variant) return;
  const oldText = line.text;

  line.text     = variant.text;
  line.variants = line.variants.filter((v) => v.id !== variantId);

  await supabase.from('lines').update({ text: variant.text }).eq('id', lineId);
  await supabase.from('line_variants').delete().eq('id', variantId);

  if (oldText.trim()) {
    const { data } = await supabase
      .from('line_variants')
      .insert({ line_id: lineId, text: oldText, position: line.variants.length })
      .select().single();
    if (data) line.variants.push(data);
  }
  renderAll();
}

async function addAnnotation(lineId, body, section) {
  const line = section.lines.find((l) => l.id === lineId);
  const sel  = pendingSelections[lineId];
  const { data, error } = await supabase
    .from('annotations')
    .insert({
      line_id:      lineId,
      author_id:    currentUser.id,
      start_offset: sel ? sel.start : null,
      end_offset:   sel ? sel.end : null,
      body,
    })
    .select().single();
  if (error) { renderError(error.message); return; }
  line.annotations.push(data);
  delete pendingSelections[lineId];
  renderAll();
}

async function toggleAnnotationResolved(annotationId, section) {
  const line = section.lines.find((l) => l.annotations.some((a) => a.id === annotationId));
  const ann  = line.annotations.find((a) => a.id === annotationId);
  ann.resolved = !ann.resolved;
  await supabase.from('annotations').update({ resolved: ann.resolved }).eq('id', annotationId);
  renderAll();
}

async function deleteAnnotation(annotationId, lineId, section) {
  const line = section.lines.find((l) => l.id === lineId);
  await supabase.from('annotations').delete().eq('id', annotationId);
  line.annotations = line.annotations.filter((a) => a.id !== annotationId);
  renderAll();
}

// ─── Utils ──────────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
