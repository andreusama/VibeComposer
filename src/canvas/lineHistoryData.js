// ─── Line-history data layer ───────────────────────────────────────────────
// A per-physical-line version log (see
// supabase/migration_word_variants_line_history.sql): every meaningful edit
// to a line appends its PREVIOUS wording here. Finer-grained than
// section_versions (whole-block snapshots); the two coexist.
// Anchored via (section_id, line_index) — section_id === note.id.

import { supabase } from '../utils/supabaseClient.js';

export async function loadLineHistory(sectionId) {
  return supabase.from('line_history')
    .select('*')
    .eq('section_id', sectionId)
    .order('created_at', { ascending: false });
}

export async function addLineHistory(sectionId, lineIndex, text) {
  return supabase.from('line_history')
    .insert({ section_id: sectionId, line_index: lineIndex, text })
    .select()
    .single();
}

export async function deleteLineHistory(id) {
  return supabase.from('line_history').delete().eq('id', id);
}
