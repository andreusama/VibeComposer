// ─── Supabase client ────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function onAuthChange(callback) {
  supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
