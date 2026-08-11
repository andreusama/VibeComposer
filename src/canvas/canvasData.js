// ─── Canvas data layer ──────────────────────────────────────────────────────────
// All Supabase reads/writes for canvas mode. A "note" is a `sections` row;
// its text lives in one `lines` row (canvas notes keep it simple — one line
// per note — variants/annotations UI for canvas notes is a later pass).

import { supabase } from '../utils/supabaseClient.js';

export const SECTION_TYPES = ['verse', 'chorus', 'pre-chorus', 'bridge', 'outro', 'custom'];
export const STATUS_CYCLE = ['unresolved', 'provisional', 'closed'];

export function saveSongTitle(id, title) {
  return supabase.from('songs').update({ title }).eq('id', id);
}

// language and dialect always move together — the DB constraint only
// allows (es, central) or (ca, oriental|occidental), so switching language
// without also picking a valid dialect for it would fail the write.
export function saveSongLyricSettings(id, language, dialect) {
  return supabase.from('songs').update({ lyric_language: language, lyric_dialect: dialect }).eq('id', id);
}

export async function loadCanvasData(songId) {
  const [{ data: sections, error: sectionsError }, { data: progressions, error: progError }, { data: links, error: linksError }] =
    await Promise.all([
      supabase.from('sections')
        .select('*, lines(*)')
        .eq('song_id', songId)
        .order('position', { foreignTable: 'lines' }),
      supabase.from('chord_progressions').select('*').eq('song_id', songId),
      supabase.from('note_links').select('*').eq('song_id', songId).eq('type', 'main-thread').order('position'),
    ]);

  const error = sectionsError || progError || linksError;
  if (error) return { notes: [], progressions: [], links: [], error };

  // Counts only — the actual variants/annotations lists load lazily when the
  // side panel opens for a specific note, but the node card itself wants to
  // show "3 variants · 2 notes" without a per-note round trip.
  const lineIds = (sections || []).map((s) => s.lines?.[0]?.id).filter(Boolean);
  const variantCounts = {};
  const annotationCounts = {};
  if (lineIds.length) {
    const [{ data: variants }, { data: annotations }] = await Promise.all([
      supabase.from('line_variants').select('line_id').in('line_id', lineIds),
      supabase.from('annotations').select('line_id').in('line_id', lineIds),
    ]);
    (variants || []).forEach((v) => { variantCounts[v.line_id] = (variantCounts[v.line_id] || 0) + 1; });
    (annotations || []).forEach((a) => { annotationCounts[a.line_id] = (annotationCounts[a.line_id] || 0) + 1; });
  }

  const notes = (sections || []).map((s) => ({
    ...s,
    variantCount: variantCounts[s.lines?.[0]?.id] || 0,
    annotationCount: annotationCounts[s.lines?.[0]?.id] || 0,
  }));

  return { notes, progressions: progressions || [], links: links || [], error: null };
}

// `threadIndex`/`text` are mobile-only extras (see migration_mobile_thread_index.sql)
// — desktop callers just omit them and get the exact same behavior as
// before. `text` lets a variant start with a copy of its origin note's
// text instead of always creating blank.
export async function createNote(songId, { x, y }, { threadIndex, text = '', type = 'verse', customLabel } = {}) {
  const { data: section, error } = await supabase
    .from('sections')
    .insert({
      song_id: songId, type, custom_label: customLabel ?? null, canvas_x: x, canvas_y: y,
      ...(threadIndex != null ? { thread_index: threadIndex } : {}),
    })
    .select().single();
  if (error) return { error };

  const { data: line, error: lineError } = await supabase
    .from('lines').insert({ section_id: section.id, position: 0, text }).select().single();
  if (lineError) return { error: lineError };

  return { note: { ...section, lines: [line] } };
}

export async function saveNoteThreadIndex(noteId, threadIndex) {
  return supabase.from('sections').update({ thread_index: threadIndex }).eq('id', noteId);
}

export async function deleteNote(noteId) {
  return supabase.from('sections').delete().eq('id', noteId);
}

export async function saveNotePosition(noteId, { x, y }, width, height) {
  return supabase.from('sections').update({
    canvas_x: x, canvas_y: y, canvas_width: width, canvas_height: height,
  }).eq('id', noteId);
}

export async function saveNoteType(noteId, type, customLabel) {
  return supabase.from('sections').update({ type, custom_label: customLabel ?? null }).eq('id', noteId);
}

export async function saveNoteText(lineId, text) {
  return supabase.from('lines').update({ text }).eq('id', lineId);
}

export async function saveNoteStatus(lineId, status) {
  return supabase.from('lines').update({ status }).eq('id', lineId);
}

export async function assignProgressionToNote(noteId, progressionId) {
  return supabase.from('sections').update({ chord_progression_id: progressionId }).eq('id', noteId);
}

export async function setProgressionTempo(progressionId, tempoNodeId) {
  return supabase.from('chord_progressions').update({ tempo_node_id: tempoNodeId }).eq('id', progressionId);
}

export async function createChordProgression(songId, { x, y }) {
  return supabase.from('chord_progressions')
    .insert({ song_id: songId, canvas_x: x, canvas_y: y, source: 'manual' })
    .select().single();
}

// Composed via the "vibe" canvas node (phrase/place/photo/genre/colour →
// Claude) rather than typed by hand — vibe_meta keeps everything that went
// into the composition (mood, energy, flavour, texture, easyMode, place,
// photoUrl) so a later "arrange" action can reconstruct a sensible studio
// context without re-asking the user for any of it.
export async function createVibeProgression(songId, { x, y }, composed, meta) {
  return supabase.from('chord_progressions')
    .insert({
      song_id: songId, canvas_x: x, canvas_y: y, source: 'vibe',
      title: composed.title, key: composed.key, progression: composed.progression,
      vibe_meta: { summary: composed.summary, ...meta },
    })
    .select().single();
}

export async function deleteChordProgression(id) {
  return supabase.from('chord_progressions').delete().eq('id', id);
}

export async function saveProgressionPosition(id, { x, y }, width, height) {
  return supabase.from('chord_progressions').update({
    canvas_x: x, canvas_y: y, canvas_width: width, canvas_height: height,
  }).eq('id', id);
}

export async function saveProgressionContent(id, { title, key, progression }) {
  return supabase.from('chord_progressions').update({ title, key, progression }).eq('id', id);
}

// id is generated client-side (crypto.randomUUID()) and reused as the React
// Flow edge id — avoids an async round trip just to reconcile a temp id with
// the DB-assigned one before the edge can be deleted by id later.
export async function createMainThreadLink(id, songId, sourceNoteId, targetNoteId, position) {
  return supabase.from('note_links')
    .insert({ id, song_id: songId, source_note_id: sourceNoteId, target_note_id: targetNoteId, type: 'main-thread', position })
    .select().single();
}

export async function deleteNoteLink(id) {
  return supabase.from('note_links').delete().eq('id', id);
}

// ─── Tempo nodes ────────────────────────────────────────────────────────────
// A bpm a chord progression can plug into for real, beat-accurate playback
// pacing. Real song data (unlike the vibe-compose tool), so it gets its own
// DB row + canvas_x/y/width/height like every other content node.

export async function loadTempoNodes(songId) {
  return supabase.from('tempo_nodes').select('*').eq('song_id', songId);
}

export async function createTempoNode(songId, { x, y }) {
  return supabase.from('tempo_nodes')
    .insert({ song_id: songId, canvas_x: x, canvas_y: y })
    .select().single();
}

export async function saveTempoBpm(id, bpm) {
  return supabase.from('tempo_nodes').update({ bpm }).eq('id', id);
}

export async function saveTempoPosition(id, { x, y }, width, height) {
  return supabase.from('tempo_nodes').update({
    canvas_x: x, canvas_y: y, canvas_width: width, canvas_height: height,
  }).eq('id', id);
}

export async function deleteTempoNode(id) {
  return supabase.from('tempo_nodes').delete().eq('id', id);
}

// ─── Baúl node (Inspiration Black Hole) ────────────────────────────────────
// Same shape as a tempo node — its own DB row for position/size, no content
// columns of its own. What it produces (lyric_dna) lives on the song row,
// not on this node, since there's only ever one evolving ADN per song even
// if someone adds more than one black hole to the canvas.

export async function loadBaulNodes(songId) {
  return supabase.from('baul_nodes').select('*').eq('song_id', songId);
}

export async function createBaulNode(songId, { x, y }) {
  return supabase.from('baul_nodes')
    .insert({ song_id: songId, canvas_x: x, canvas_y: y })
    .select().single();
}

export async function saveBaulNodePosition(id, { x, y }, width, height) {
  return supabase.from('baul_nodes').update({
    canvas_x: x, canvas_y: y, canvas_width: width, canvas_height: height,
  }).eq('id', id);
}

export async function deleteBaulNode(id) {
  return supabase.from('baul_nodes').delete().eq('id', id);
}

// Overwritten wholesale on every processBaulInput call, never appended to
// — see the module header in baulProcessor.js for why.
export async function saveLyricDna(songId, lyricDna) {
  return supabase.from('songs').update({ lyric_dna: lyricDna }).eq('id', songId);
}

export async function loadLyricDna(songId) {
  return supabase.from('songs').select('lyric_dna').eq('id', songId).single();
}

// ─── Baúl entry log — dev-only audit trail, see schema.sql's baul_entries
// comment. Never read by anything user-facing; only MuseEyePanel's baúl
// tab. Best-effort by design: callers should never let a logging failure
// block the real absorb/save flow (see BaulFloatNode/BaulSheet's .catch).

export async function insertBaulEntry(songId, { inputType, rawPreview, generatedSummary, tags, latencyMs }) {
  return supabase.from('baul_entries').insert({
    song_id: songId, input_type: inputType, raw_preview: rawPreview,
    generated_summary: generatedSummary, tags, latency_ms: latencyMs ?? null,
  });
}

export async function loadBaulEntries(songId, limit = 50) {
  return supabase.from('baul_entries').select('*').eq('song_id', songId)
    .order('created_at', { ascending: false }).limit(limit);
}

// Mirrors handleClear's intent ("the muse forgets them too") — clearing
// the baúl should clear its log too, or the debug panel would keep
// showing a pipeline history for material that's supposedly forgotten.
export async function clearBaulEntries(songId) {
  return supabase.from('baul_entries').delete().eq('song_id', songId);
}

// ─── Output nodes ───────────────────────────────────────────────────────────
// A song can hold several — variants/mixes of the same song ("radio edit",
// "acoustic") — each a sink a note plugs into to render its own final
// result. A brand new song gets one by default so there's always something
// to plug into; from there they're created and deleted like any other node.

export async function loadOutputNodes(songId) {
  const { data: existing, error: fetchError } = await supabase
    .from('song_outputs').select('*').eq('song_id', songId).order('created_at');
  if (fetchError) return { error: fetchError };
  if (existing.length) return { outputs: existing };

  const { data, error } = await supabase.from('song_outputs')
    .insert({ song_id: songId }).select().single();
  return error ? { error } : { outputs: [data] };
}

export async function createOutputNode(songId, { x, y }) {
  return supabase.from('song_outputs')
    .insert({ song_id: songId, canvas_x: x, canvas_y: y })
    .select().single();
}

export async function deleteOutputNode(id) {
  return supabase.from('song_outputs').delete().eq('id', id);
}

export async function saveOutputPosition(id, { x, y }, width, height) {
  return supabase.from('song_outputs').update({
    canvas_x: x, canvas_y: y, canvas_width: width, canvas_height: height,
  }).eq('id', id);
}

export async function saveOutputTitle(id, title) {
  return supabase.from('song_outputs').update({ title }).eq('id', id);
}

export async function setOutputPluggedNote(id, noteId) {
  return supabase.from('song_outputs').update({ plugged_note_id: noteId }).eq('id', id);
}

// A note has at most one outgoing and one incoming main-thread link —
// onConnect enforces this going forward (reconnecting either end replaces
// whatever was there). If two links on the same key ever exist anyway (old
// data from before that rule, or a race), the lowest-position one silently
// wins rather than either erroring or needing a picker UI — a mix should
// never break over stray leftover data.
function oneLinkPer(links, keyField) {
  const map = new Map();
  links.forEach((l) => {
    const key = keyField === 'target' ? l.target_note_id : l.source_note_id;
    const existing = map.get(key);
    if (!existing || (l.position ?? 0) < (existing.position ?? 0)) map.set(key, l);
  });
  return map;
}

// Plugging in a note renders the whole song leading up to it too, not just
// the note itself — a straight walk backward through single parents, since
// the graph is a linear chain, not a branching one.
function findChainStart(notes, links, fromId) {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const parentOf = oneLinkPer(links, 'target');

  let current = fromId;
  const seen = new Set([current]);
  while (byId.has(current)) {
    const parent = parentOf.get(current);
    if (!parent) break; // genuine start, nothing feeds it
    if (seen.has(parent.source_note_id)) break; // cycle guard
    current = parent.source_note_id;
    seen.add(current);
  }
  return current;
}

export function summarizeProgression(cp) {
  if (!cp?.progression?.length) return null;
  const chords = cp.progression.map((c) => c.chord).filter(Boolean);
  return chords.length ? chords.join(' · ') : null;
}

// A linear walk from the start of the chain to wherever it ends — no fork
// or merge choices to resolve, since a note only ever has one child.
export function resolveMainThreadPath(notes, links, startNoteId) {
  const byId = new Map(notes.map((n) => [n.id, n]));
  if (!startNoteId || !byId.has(startNoteId)) return [];

  const childOf = oneLinkPer(links, 'source');
  const chainStart = findChainStart(notes, links, startNoteId);

  const path = [];
  const seen = new Set();
  let currentId = chainStart;

  while (currentId && byId.has(currentId) && !seen.has(currentId)) {
    seen.add(currentId);
    path.push({ note: byId.get(currentId) });
    const child = childOf.get(currentId);
    if (!child) break;
    currentId = child.target_note_id;
  }

  return path;
}

// ─── Note detail: variants, apuntes, history ───────────────────────────────────
// All three reuse tables that already existed for the (now-retired) flat
// block editor — nothing new here except annotations.category.

export async function loadNoteDetail(noteId, lineId) {
  const [{ data: variants, error: ve }, { data: annotations, error: ae }, { data: history, error: he }] =
    await Promise.all([
      supabase.from('line_variants').select('*').eq('line_id', lineId).order('position'),
      supabase.from('annotations').select('*').eq('line_id', lineId).order('created_at'),
      supabase.from('section_versions').select('*').eq('section_id', noteId).order('created_at', { ascending: false }),
    ]);
  return { variants: variants || [], annotations: annotations || [], history: history || [], error: ve || ae || he };
}

export async function addVariant(lineId, text, position) {
  return supabase.from('line_variants').insert({ line_id: lineId, text, position }).select().single();
}

export async function updateVariantText(id, text) {
  return supabase.from('line_variants').update({ text }).eq('id', id);
}

export async function deleteVariant(id) {
  return supabase.from('line_variants').delete().eq('id', id);
}

// Promoting a variant to active text does NOT put the outgoing text back
// into the variants pool (that would make "variants" and "history" the same
// list) — it goes only to section_versions, a separate append-only log.
export async function promoteVariant(noteId, lineId, variant, currentText) {
  const { error: histError } = await supabase
    .from('section_versions').insert({ section_id: noteId, snapshot: [{ line_id: lineId, text: currentText }] });
  if (histError) return { error: histError };

  const { error: delError } = await supabase.from('line_variants').delete().eq('id', variant.id);
  if (delError) return { error: delError };

  return supabase.from('lines').update({ text: variant.text }).eq('id', lineId);
}

// Mobile's Tools drawer only ever wants annotations, never the legacy
// variants/history that loadNoteDetail bundles alongside them for
// desktop's NoteSidePanel — a dedicated, lighter query instead of pulling
// (and silently querying) two tables the mobile UI no longer exposes.
// Whole-verse comments are annotations with null start/end_offset;
// selection-anchored comments (not built yet) are the same table with
// real offsets — both come back from this one call, callers filter by
// offset presence for whichever they need.
export async function loadAnnotations(lineId) {
  return supabase.from('annotations').select('*').eq('line_id', lineId).order('created_at');
}

export async function addAnnotation(lineId, authorId, body, category) {
  return supabase.from('annotations')
    .insert({ line_id: lineId, author_id: authorId, body, category: category || null })
    .select().single();
}

export async function updateAnnotation(id, fields) {
  return supabase.from('annotations').update(fields).eq('id', id);
}

export async function deleteAnnotation(id) {
  return supabase.from('annotations').delete().eq('id', id);
}

// Restoring also snapshots what it's about to overwrite — so a restore is
// itself just another entry in the same append-only history log, never
// destructive of the version you're moving away from.
export async function restoreVersion(noteId, lineId, version, currentText) {
  const { error: histError } = await supabase
    .from('section_versions').insert({ section_id: noteId, snapshot: [{ line_id: lineId, text: currentText }] });
  if (histError) return { error: histError };

  const restoredText = version.snapshot?.[0]?.text ?? '';
  return supabase.from('lines').update({ text: restoredText }).eq('id', lineId);
}

// Append-only until the user actually wants something gone for good.
export async function deleteHistoryVersion(id) {
  return supabase.from('section_versions').delete().eq('id', id);
}
