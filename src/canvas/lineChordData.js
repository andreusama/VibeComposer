// ─── Line-chord data layer ─────────────────────────────────────────────────
// Chords attached to a word range inside a lyric line — "mainstream
// tablature" (see supabase/migration_line_chords.sql).
//
// Keyed by (line_id, line_index): `lines` holds exactly ONE row per section
// (the whole block's text as one string), so line_id is the block's text row
// — note.lines[0].id in NoteEditorScreen, the same id persist() saves text
// to — and line_index the physical line inside it. The span itself is
// re-resolved from anchor_text on every render (resolveChordRange,
// src/utils/chordAnchor.js); start/end_offset are stored only as the
// tie-breaker for a repeated anchor, never trusted on their own.

import { supabase } from '../utils/supabaseClient.js';

export async function loadLineChords(lineId) {
  return supabase.from('line_chords')
    .select('*')
    .eq('line_id', lineId)
    .order('created_at');
}

export async function addLineChord(lineId, lineIndex, { anchorText, startOffset, endOffset, chordName }) {
  return supabase.from('line_chords')
    .insert({
      line_id: lineId,
      line_index: lineIndex,
      anchor_text: anchorText,
      start_offset: startOffset,
      end_offset: endOffset,
      chord_name: chordName,
    })
    .select()
    .single();
}

// Only ever used to rename a chord already sitting on a span — a chord
// dropped onto a range that already has one replaces its name rather than
// stacking a second symbol on the identical word (see Part A's "unless they
// occupy the exact same range").
export async function updateLineChord(id, fields) {
  return supabase.from('line_chords').update(fields).eq('id', id).select().single();
}

export async function deleteLineChord(id) {
  return supabase.from('line_chords').delete().eq('id', id);
}
