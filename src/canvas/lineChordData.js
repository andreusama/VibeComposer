// ─── Line-chord data layer ─────────────────────────────────────────────────
// Chords attached to a VERSE, not a word — a stackable, reorderable,
// overridable sequence per line (see supabase/migration_line_chords.sql
// and src/utils/chordAnchor.js's own header for the 2026-10-16 redesign
// this replaced).
//
// Keyed by (line_id, line_index): `lines` holds exactly ONE row per section
// (the whole block's text as one string with embedded \n), so line_id is
// the block's text row — note.lines[0].id in NoteEditorScreen, the same id
// persist() saves text to — and line_index the physical line inside it.
// `position` is the chord's only location: a plain 0-based rank among the
// other chords on its own line, renumbered to a clean 0..N-1 sequence by
// the caller (NoteEditorScreen.jsx) on every insert/move/delete.

import { supabase } from '../utils/supabaseClient.js';

export async function loadLineChords(lineId) {
  return supabase.from('line_chords')
    .select('*')
    .eq('line_id', lineId)
    .order('line_index')
    .order('position');
}

// The same read, for every block's lineId in one song at once — the full
// song read-through (SongPerformanceScreen.jsx) needs every section's
// chords together, not one query per block. One request either way; `.in`
// just lets Postgres do the fan-out instead of the client firing N of
// loadLineChords's own query in parallel.
export async function loadLineChordsForLines(lineIds) {
  if (!lineIds?.length) return { data: [] };
  return supabase.from('line_chords')
    .select('*')
    .in('line_id', lineIds)
    .order('line_index')
    .order('position');
}

export async function addLineChord(lineId, lineIndex, { chordName, position }) {
  return supabase.from('line_chords')
    .insert({
      line_id: lineId,
      line_index: lineIndex,
      chord_name: chordName,
      position,
    })
    .select()
    .single();
}

// Generic patch — renaming a chord in place (an override), renumbering its
// `position`, or moving it to a different `line_index` all go through this
// same call; NoteEditorScreen.jsx decides which fields to send.
export async function updateLineChord(id, fields) {
  return supabase.from('line_chords').update(fields).eq('id', id).select().single();
}

export async function deleteLineChord(id) {
  return supabase.from('line_chords').delete().eq('id', id);
}
