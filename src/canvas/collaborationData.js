// ─── Project collaboration data layer ──────────────────────────────────────
// Up to 4 people per song (one owner + up to 3 editors), joined through a
// shareable invite code rather than looking anyone up by email. See
// supabase/migration_project_collaboration.sql for the schema/RLS this
// drives — every function here is a thin wrapper over that: the real access
// rules live in Postgres (is_song_participant / accept_project_invite), not
// here, so a direct REST call made outside the app is bound by the same
// rules a bug in this file would be.

import { supabase } from '../utils/supabaseClient.js';
import { withTimeout } from '../utils/withTimeout.js';

export const MAX_COLLABORATORS = 4;

// One row per participant (owner included), joined to profiles for display
// names — auth.users itself isn't queryable from the client.
export async function loadCollaborators(songId) {
  try {
    return await withTimeout(
      supabase
        .from('project_collaborators')
        .select('id, user_id, role, joined_at, profiles(display_name)')
        .eq('song_id', songId)
        .order('joined_at')
    );
  } catch (err) {
    return { data: null, error: err };
  }
}

// Removes a collaborator. The owner can remove anyone (except the owner
// row itself, which the DB policy refuses); anyone can remove themself to
// leave a project they don't own — same call, RLS tells the two cases apart.
export async function removeCollaborator(collaboratorRowId) {
  return supabase.from('project_collaborators').delete().eq('id', collaboratorRowId);
}

// Creates a new shareable invite. `singleUse` makes it dead after its first
// redemption; `expiresInHours` is optional (null = no expiry). Capacity is
// NOT checked here — accept_project_invite re-checks it at redemption time,
// since the cap can be reached by a different invite link between now and
// then.
export async function createInvite(songId, { singleUse = false, expiresInHours = null } = {}) {
  const expires_at = expiresInHours ? new Date(Date.now() + expiresInHours * 3600_000).toISOString() : null;
  const { data: userRes } = await supabase.auth.getUser();
  return supabase
    .from('project_invites')
    .insert({ song_id: songId, single_use: singleUse, expires_at, created_by: userRes?.user?.id })
    .select()
    .single();
}

// Active (not revoked, not expired, not a used-up single-use link) invites
// for the "manage invites" view — expired/dead ones are left in the table
// for audit rather than deleted, so they're filtered out here instead.
export async function loadActiveInvites(songId) {
  const { data, error } = await supabase
    .from('project_invites')
    .select('*')
    .eq('song_id', songId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) return { data: null, error };
  const now = Date.now();
  const active = (data || []).filter((inv) => {
    if (inv.expires_at && new Date(inv.expires_at).getTime() < now) return false;
    if (inv.single_use && inv.used_count > 0) return false;
    return true;
  });
  return { data: active, error: null };
}

export async function revokeInvite(inviteId) {
  return supabase.from('project_invites').update({ revoked_at: new Date().toISOString() }).eq('id', inviteId);
}

// Builds the actual shareable URL for an invite code. Kept as one function
// so the route shape (?invite=<code>) only needs to change in one place —
// see main.js for where this gets read back on launch.
export function inviteUrl(code) {
  return `${window.location.origin}${window.location.pathname}?invite=${code}`;
}

// Redeems a code: validates it, adds the signed-in user as an editor, bumps
// used_count — all inside accept_project_invite (security definer), so this
// is just the RPC call. Returns the song's id on success so the caller can
// navigate straight to it.
export async function acceptInvite(code) {
  const { data, error } = await supabase.rpc('accept_project_invite', { p_code: code });
  if (error) return { songId: null, error };
  return { songId: data, error: null };
}

// Lets the signed-in user set how they appear to collaborators. Defaults to
// the email's local part at signup (see the migration's trigger) until
// changed.
export async function updateDisplayName(name) {
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user?.id) return { error: new Error('not signed in') };
  return supabase.from('profiles').update({ display_name: name }).eq('id', userRes.user.id);
}

// The signed-in user's own row — used for the presence channel's track()
// payload and the collaborators sheet's "you" row, so both show whatever
// name they've actually set rather than re-deriving it from the session.
export async function loadMyProfile() {
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user?.id) return { data: null, error: new Error('not signed in') };
  return supabase.from('profiles').select('id, display_name').eq('id', userRes.user.id).single();
}
