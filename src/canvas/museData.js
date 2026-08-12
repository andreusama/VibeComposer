// ─── Muse data layer ────────────────────────────────────────────────────────
// Supabase reads/writes for the muse feature. Kept separate from
// canvasData.js since none of this is core canvas/note data — it's a
// self-contained add-on that happens to hang off a section (a "block" —
// one verse/chorus/etc, see "A 'note' IS a sections row" in schema.sql)
// via section_id.
//
// Only one layer now: muse_entries (turn-based conversation log, per
// block, append-only, never sent to the muse API in full) feeds
// muse_profile.summary — one row per section, live, IS what gets sent as
// this block's local context. There's no song-level counterpart — the
// muse already gets the full raw song text every turn via
// describeSongStructure in museApi.js's buildDynamicMuseContext, real and
// uncompressed, so a separate AI-summarized song-wide field would just be
// a stale, lossy duplicate of context the model already has in full.

import { supabase } from '../utils/supabaseClient.js';

export async function loadMuseConversation(sectionId) {
  return supabase.from('muse_entries').select('*').eq('section_id', sectionId).order('created_at');
}

// Maps the muse's own action_type (SURGEON/ARCHITECT/SOCRATIC/WORD_BANK) to
// muse_entries' simpler `action` bucket — SOCRATIC is genuinely asking
// back for direction ('clarify'); everything else is handing back concrete
// material ('suggest'). The user's own row is always 'ask'. The RAW
// action_type is still stored separately, as `mode` (below) — `action`
// collapses SURGEON/ARCHITECT/WORD_BANK together, which loses exactly the
// distinction the chat UI needs to know how to render `options`.
function storedActionFor(museActionType) {
  return museActionType === 'SOCRATIC' ? 'clarify' : 'suggest';
}

// Inserts the user's ask and the muse's response as one pair — the two
// rows always arrive together since the muse's reply isn't known until the
// API call returns.
export async function saveMuseTurn(songId, sectionId, userMessage, museResponse) {
  return supabase.from('muse_entries')
    .insert([
      { song_id: songId, section_id: sectionId, role: 'user', action: 'ask', content: userMessage },
      {
        song_id: songId, section_id: sectionId, role: 'muse',
        action: storedActionFor(museResponse.action_type), mode: museResponse.action_type,
        content: museResponse.message,
        options: museResponse.suggestions?.length ? museResponse.suggestions
          : museResponse.question?.options?.length ? museResponse.question.options
          : museResponse.wordBank || null,
      },
    ])
    .select();
}

export async function markMuseOptionSaved(entryId, annotationId) {
  return supabase.from('muse_entries').update({ saved_annotation_id: annotationId }).eq('id', entryId);
}

// Scoped to ONE block, not the whole song — the local profile is only ever
// about this block, so its summarizer should only ever read this block's
// own recent asks.
export async function getRecentMuseUserMessages(sectionId, limit = 5) {
  const { data, error } = await supabase
    .from('muse_entries')
    .select('id, content, created_at')
    .eq('section_id', sectionId)
    .eq('role', 'user')
    .order('created_at', { ascending: false })
    .limit(limit);
  return { data: data || [], error };
}

// One row per block, same fused-replacement shape/pattern as lyric_dna
// (see canvasData.js's loadLyricDna/saveLyricDna), just scoped narrower.
// maybeSingle, not single — a block with no conversation yet genuinely has
// no row, that's not an error.
export async function loadMuseProfile(sectionId) {
  return supabase.from('muse_profile').select('summary').eq('section_id', sectionId).maybeSingle();
}

// Atomic — see the muse_increment_interaction function in schema.sql for
// why this is an RPC and not a client-side read-then-write.
export async function incrementMuseInteraction(sectionId, songId) {
  return supabase.rpc('muse_increment_interaction', { p_section_id: sectionId, p_song_id: songId });
}

// A plain overwrite (not an increment), so no race-safety concern here —
// resets the counter in the same write that lands the new summary.
export async function saveMuseSummary(sectionId, songId, summary) {
  return supabase.from('muse_profile').upsert(
    { section_id: sectionId, song_id: songId, summary, interaction_count: 0, last_summarized_at: new Date().toISOString() },
    { onConflict: 'section_id' }
  );
}
