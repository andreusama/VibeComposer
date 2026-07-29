// ─── Supabase client ────────────────────────────────────────────────────────────
// Loaded via ESM CDN (esm.sh) — no bundler, consistent with the rest of the app.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function onAuthChange(callback) {
  supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
