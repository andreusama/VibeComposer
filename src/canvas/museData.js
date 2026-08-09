// ─── Muse data layer ────────────────────────────────────────────────────────
// Supabase reads/writes for the muse feature. Kept separate from
// canvasData.js since none of this is core canvas/note data — it's a
// self-contained add-on that happens to hang off a line via line_id.
//
// muse_entries is a turn-based conversation log (append-only, never sent to
// the muse API in full); songs.muse_profile is the live, single evolving
// JSON that IS what gets sent — see museProfileUpdater.js for how one feeds
// the other. Same fused-replacement pattern as songs.lyric_dna.

import { supabase } from '../utils/supabaseClient.js';

export async function loadMuseConversation(lineId) {
  return supabase.from('muse_entries').select('*').eq('line_id', lineId).order('created_at');
}

// Inserts the user's ask and the muse's response as one pair, both tagged
// with the free-form themes the muse just detected — the two rows always
// arrive together since themes aren't known until the API call returns.
export async function saveMuseTurn(songId, lineId, themes, userMessage, museResponse) {
  return supabase.from('muse_entries')
    .insert([
      { song_id: songId, line_id: lineId, themes, role: 'user', action: 'ask', content: userMessage },
      {
        song_id: songId, line_id: lineId, themes, role: 'muse',
        action: museResponse.action_type, content: museResponse.message,
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

// No longer scoped to a register — the profile refresh loop just wants the
// song's most recent asks overall, regardless of what theme(s) they touched.
export async function getRecentMuseUserMessages(songId, limit = 5) {
  const { data, error } = await supabase
    .from('muse_entries')
    .select('id, content, created_at')
    .eq('song_id', songId)
    .eq('role', 'user')
    .order('created_at', { ascending: false })
    .limit(limit);
  return { data: data || [], error };
}

// A single evolving JSON per song — same shape/pattern as lyric_dna, see
// canvasData.js's loadLyricDna/saveLyricDna.
export async function loadMuseProfile(songId) {
  return supabase.from('songs').select('muse_profile').eq('id', songId).single();
}

// Atomic — see the muse_increment_interaction function in schema.sql for
// why this is an RPC and not a client-side read-then-write.
export async function incrementMuseInteraction(songId) {
  return supabase.rpc('muse_increment_interaction', { p_song_id: songId });
}

// A plain overwrite (not an increment), so no race-safety concern here —
// resets the counter in the same write that lands the new profile.
export async function saveMuseSummary(songId, profile) {
  return supabase.from('songs')
    .update({ muse_profile: profile, muse_interaction_count: 0 })
    .eq('id', songId);
}
