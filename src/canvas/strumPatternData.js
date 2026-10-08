// ─── Strum-pattern data layer ──────────────────────────────────────────────
// One recorded right-hand strum pattern per SECTION (see
// supabase/migration_strum_patterns.sql). section_id === note.id (a note IS
// a sections row), same as muse_profile / word_variants / line_history.
//
// One row per section, upserted on section_id — re-recording a section's
// strum replaces it rather than accumulating takes, the same
// one-row-per-section shape muse_profile already uses. (Voice memos are the
// opposite case and keep every take; a strum pattern is a decision, not a
// performance you'd want to compare three versions of.)

import { supabase } from '../utils/supabaseClient.js';

export async function loadStrumPattern(sectionId) {
  return supabase.from('strum_patterns')
    .select('*')
    .eq('section_id', sectionId)
    .maybeSingle();
}

export async function saveStrumPattern(sectionId, bpm, pattern) {
  return supabase.from('strum_patterns')
    .upsert({ section_id: sectionId, bpm, pattern }, { onConflict: 'section_id' })
    .select()
    .single();
}

export async function deleteStrumPattern(sectionId) {
  return supabase.from('strum_patterns').delete().eq('section_id', sectionId);
}
