// ─── Canvas data layer ──────────────────────────────────────────────────────────
// All Supabase reads/writes for canvas mode. A "note" is a `sections` row;
// its text lives in one `lines` row (canvas notes keep it simple — one line
// per note — variants/annotations UI for canvas notes is a later pass).

import { supabase } from '../utils/supabaseClient.js';

export const SECTION_TYPES = ['verse', 'chorus', 'pre-chorus', 'bridge', 'outro', 'custom'];
export const STATUS_CYCLE = ['unresolved', 'provisional', 'closed'];

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

export async function createNote(songId, { x, y }) {
  const { data: section, error } = await supabase
    .from('sections')
    .insert({ song_id: songId, type: 'verse', canvas_x: x, canvas_y: y })
    .select().single();
  if (error) return { error };

  const { data: line, error: lineError } = await supabase
    .from('lines').insert({ section_id: section.id, position: 0, text: '' }).select().single();
  if (lineError) return { error: lineError };

  return { note: { ...section, lines: [line] } };
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

// ─── Output selections ──────────────────────────────────────────────────────
// A final mix is one linear playthrough — when the note graph forks (a note
// has more than one outgoing main-thread link), each mix needs its own
// record of which branch it takes there. One row per (mix, forking note);
// no row means "use the default" (see resolveMainThreadPath below), so a
// fork is never left ambiguous even before anyone has chosen anything.

export async function loadOutputSelections(outputIds) {
  if (!outputIds.length) return { selections: [] };
  const { data, error } = await supabase
    .from('output_selections').select('*').in('output_id', outputIds);
  return error ? { error } : { selections: data };
}

export async function setOutputSelection(outputId, sourceNoteId, noteLinkId) {
  return supabase.from('output_selections')
    .upsert({ output_id: outputId, source_note_id: sourceNoteId, note_link_id: noteLinkId });
}

// Plugging in a note should render the whole song leading up to it too, not
// just the note itself — but walking backward blindly runs into the mirror
// image of the fork problem: a note with two *incoming* links (two verses
// converging on one chorus) has no unambiguous "previous note." So this
// only extends backward while each step is unambiguous (exactly one
// predecessor); a note with zero predecessors is a genuine start, and a
// note with two or more is a real merge point — stop there rather than
// silently guessing which branch feeds it. To start from that exact point,
// plug into that specific note instead.
//
// Along the way it also records exactly which link was taken at each step
// (`impliedPath`) — reversed, that's the forward path from the found start
// back to the plugged note. Any fork on that stretch was already answered
// the moment the user chose to plug into a note reachable only through one
// specific branch; there's nothing left to ask.
function findChainStart(notes, links, fromId) {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const parentsOf = new Map();
  links.forEach((l) => {
    if (!parentsOf.has(l.target_note_id)) parentsOf.set(l.target_note_id, []);
    const list = parentsOf.get(l.target_note_id);
    // Two links from the same source into the same target is the same
    // connection drawn twice, not a real second parent — collapse it so a
    // stray duplicate can't masquerade as an actual merge point (onConnect
    // guards against creating these going forward, but this stays tolerant
    // of any that already exist).
    if (!list.some((existing) => existing.source_note_id === l.source_note_id)) list.push(l);
  });

  const impliedPath = [];
  let current = fromId;
  const seen = new Set([current]);
  while (byId.has(current)) {
    const parents = parentsOf.get(current) || [];
    if (parents.length !== 1 || seen.has(parents[0].source_note_id)) break;
    impliedPath.unshift(parents[0]);
    current = parents[0].source_note_id;
    seen.add(current);
  }
  return { start: current, impliedPath };
}

// A note with several *outgoing* links is a real fork — but only once the
// walk has reached the plugged note. Before that point, whichever branch
// actually leads to the plugged note is used silently (no picker, nothing
// to choose). From the plugged note onward, `selections` (a plain
// {sourceNoteId: noteLinkId} map for this one mix) says which branch this
// mix takes; with no entry, the default is whichever link has the lowest
// `position` (drawn first) — always something deterministic, never both.
export function resolveMainThreadPath(notes, links, startNoteId, selections = {}) {
  const byId = new Map(notes.map((n) => [n.id, n]));
  if (!startNoteId || !byId.has(startNoteId)) return [];

  const childrenOf = new Map();
  links.forEach((l) => {
    if (!childrenOf.has(l.source_note_id)) childrenOf.set(l.source_note_id, []);
    const list = childrenOf.get(l.source_note_id);
    // Same dedup as findChainStart, mirrored for the forward direction —
    // two links to the same target isn't a real fork.
    if (!list.some((existing) => existing.target_note_id === l.target_note_id)) list.push(l);
  });
  childrenOf.forEach((candidates) => candidates.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)));

  const { start: chainStart, impliedPath } = findChainStart(notes, links, startNoteId);
  const impliedChoices = {};
  impliedPath.forEach((l) => { impliedChoices[l.source_note_id] = l.id; });

  const path = [];
  const seen = new Set();
  let currentId = chainStart;
  let reachedPlug = chainStart === startNoteId;

  while (currentId && byId.has(currentId) && !seen.has(currentId)) {
    seen.add(currentId);
    const candidates = childrenOf.get(currentId) || [];
    const isRealFork = reachedPlug && candidates.length > 1;
    path.push({ note: byId.get(currentId), fork: isRealFork ? candidates : null });
    if (!candidates.length) break;

    const chosenLinkId = reachedPlug ? selections[currentId] : impliedChoices[currentId];
    const chosen = candidates.find((c) => c.id === chosenLinkId) || candidates[0];
    currentId = chosen.target_note_id;
    if (currentId === startNoteId) reachedPlug = true;
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
