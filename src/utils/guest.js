import { supabase } from './supabaseClient.js';
import { setState, getState } from '../state/store.js';
import { loadProjectSummaries } from '../screens/projectsData.js';

// ─── "Try the demo" guest sessions ──────────────────────────────────────────
// A guest is a Supabase ANONYMOUS user: a real session (so every RLS policy
// and the Claude proxy's login check apply exactly as for anyone else) with
// no sign-up. What makes it a demo rather than free reign is enforced in the
// database, not here — see supabase/migration_guest_demo.sql: ~10 Muse calls
// a day, one shared daily cap across all users, no Storage uploads, a small
// song cap, and accounts auto-deleted after a day. Everything in this file
// (hiding upload buttons, the demo banner) is only the friendly face of
// those limits.

export const GUEST_MUSE_CALLS_PER_DAY = 10;
export const GUEST_UPLOADS_MESSAGE = 'No disponible en la demo';

export function isGuest(session) {
  return session?.user?.is_anonymous === true;
}

// For components that render outside a prop chain from main.js's state.
export function isGuestNow() {
  return isGuest(getState().session);
}

function friendlyError(error) {
  const msg = String(error?.message || '');
  // Anonymous sign-ins switched off in the Supabase dashboard (or CAPTCHA /
  // rate limits tripped) — not something the visitor can fix.
  if (/anonymous/i.test(msg) || error?.status === 422 || error?.status === 429) {
    return 'la demo no está disponible ahora mismo — prueba de nuevo en un rato.';
  }
  return msg || 'no se pudo abrir la demo.';
}

// Signs in as a guest and makes sure there's a sample song to open. The song
// list is refreshed here (not left to the projects screen's own load) because
// that screen starts loading the moment the session lands — before the
// sample song below exists.
export async function startGuestDemo() {
  const { error } = await supabase.auth.signInAnonymously();
  if (error) return { error: friendlyError(error) };

  const { error: seedError } = await supabase.rpc('create_demo_song');
  if (seedError) return { error: friendlyError(seedError) };

  const { songs, albums, error: loadError } = await loadProjectSummaries();
  if (!loadError) setState({ songs, albums, projectError: null, songsLoaded: true });
  return {};
}
