// ─── Muse data layer ────────────────────────────────────────────────────────
// Supabase reads/writes for the muse feature. Kept separate from
// canvasData.js since none of this is core canvas/note data — it's a
// self-contained add-on that happens to hang off a line via line_id.
//
// muse_entries is a turn-based conversation log (append-only, never sent to
// the muse API in full); muse_profile is the live, short, per-(song,
// register) summary that IS what gets sent — see museProfileUpdater.js for
// how one feeds the other.

import { supabase } from '../utils/supabaseClient.js';

export async function loadMuseConversation(lineId) {
  return supabase.from('muse_entries').select('*').eq('line_id', lineId).order('created_at');
}

// Inserts the user's ask and the muse's response as one pair, both tagged
// with the register the muse just classified — the two rows always arrive
// together since the register isn't known until the API call returns.
export async function saveMuseTurn(songId, lineId, register, userMessage, museResponse) {
  return supabase.from('muse_entries')
    .insert([
      { song_id: songId, line_id: lineId, register, role: 'user', action: 'ask', content: userMessage },
      {
        song_id: songId, line_id: lineId, register, role: 'muse',
        action: museResponse.action, content: museResponse.message,
        options: museResponse.options?.length ? museResponse.options : null,
      },
    ])
    .select();
}

export async function markMuseOptionSaved(entryId, annotationId) {
  return supabase.from('muse_entries').update({ saved_annotation_id: annotationId }).eq('id', entryId);
}

export async function getRecentMuseUserMessages(songId, register, limit = 5) {
  const { data, error } = await supabase
    .from('muse_entries')
    .select('id, content, created_at')
    .eq('song_id', songId)
    .eq('register', register)
    .eq('role', 'user')
    .order('created_at', { ascending: false })
    .limit(limit);
  return { data: data || [], error };
}

// One row per (song, register) — every register a song has ever touched.
// Missing registers just mean "nothing learned there yet"; the caller
// turns this into a plain {register: summary} map for the muse prompt.
export async function loadMuseProfile(songId) {
  return supabase.from('muse_profile').select('*').eq('song_id', songId);
}

// Atomic — see the muse_increment_interaction function in schema.sql for
// why this is an RPC and not a client-side read-then-write.
export async function incrementMuseInteraction(songId, register) {
  return supabase.rpc('muse_increment_interaction', { p_song_id: songId, p_register: register });
}

// A plain overwrite (not an increment), so no race-safety concern here —
// resets the counter in the same write that lands the new summary.
export async function saveMuseSummary(songId, register, summary) {
  return supabase.from('muse_profile')
    .update({ summary, interaction_count: 0, last_summarized_at: new Date().toISOString() })
    .eq('song_id', songId)
    .eq('register', register);
}
