// ─── Word-variant data layer ───────────────────────────────────────────────
// Alternate wordings for a span of words inside one physical line (see
// supabase/migration_word_variants_line_history.sql). The physical line's
// text always holds exactly options[active_index]; the rest are the
// alternatives you can swap in. Anchored via (section_id, line_index) — the
// same "physical lines have no stable row" tradeoff line_audio accepts.
// section_id === note.id (a note IS a sections row).

import { supabase } from '../utils/supabaseClient.js';

export async function loadWordVariants(sectionId) {
  return supabase.from('word_variants').select('*').eq('section_id', sectionId).order('created_at');
}

export async function addWordVariant(sectionId, lineIndex, options, anchorBefore = '', activeIndex = 0) {
  return supabase.from('word_variants')
    .insert({ section_id: sectionId, line_index: lineIndex, options, anchor_before: anchorBefore, active_index: activeIndex })
    .select()
    .single();
}

export async function updateWordVariant(id, fields) {
  return supabase.from('word_variants').update(fields).eq('id', id).select().single();
}

export async function deleteWordVariant(id) {
  return supabase.from('word_variants').delete().eq('id', id);
}

// Re-locate a variant's span in the current line text. options[active_index]
// is what should be sitting there; find it, preferring the occurrence whose
// left context best matches the stored anchor_before. Returns
// { start, end } or null (detached — line was edited past recognition).
export function resolveVariantRange(variant, lineText) {
  const needle = variant.options?.[variant.active_index] ?? '';
  if (!needle || !lineText) return null;

  const anchorLen = (variant.anchor_before || '').length;
  let best = null;
  let bestDelta = Infinity;
  let from = 0;
  for (;;) {
    const idx = lineText.indexOf(needle, from);
    if (idx === -1) break;
    const delta = Math.abs(idx - anchorLen);
    if (delta < bestDelta) { bestDelta = delta; best = idx; }
    from = idx + 1;
  }
  return best == null ? null : { start: best, end: best + needle.length };
}
