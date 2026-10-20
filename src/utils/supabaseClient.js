// ─── Supabase client ────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { DEFAULT_LOAD_TIMEOUT_MS } from './withTimeout.js';

// Every request this client makes gets a hard timeout. withTimeout.js's own
// comment explains the exact failure mode this closes: a cold launch can
// stall a request with no error at all (waking wifi/cellular, DNS, a
// silent token refresh riding along on the first request) — fetch() has no
// built-in timeout, so an unlucky request just hangs forever and whatever
// screen is waiting on it never resolves its own loading state (reported
// 2026-10-20 as "infinite loading when entering the page"). withTimeout
// already fixed this per call site for canvasData.js/collaborationData.js/
// projectsData.js, but every OTHER data module (lineChordData,
// wordVariantData, resourcesData, baulItemsData, …) never got wrapped —
// this closes the gap for all of them at once, at the one place every
// single one of their requests actually goes through, and for any future
// data module that forgets to wrap itself too.
//
// Storage uploads/downloads (voice memos, Baúl photo attachments) get a
// much longer allowance than a plain table query — a recording or a photo
// on a slow connection can legitimately take a while, and a 12s cutoff
// that's generous for "fetch some rows" would just as easily break real,
// successful uploads. Everything else (table queries, RPCs, auth/session
// calls) gets the same short DEFAULT_LOAD_TIMEOUT_MS withTimeout.js uses,
// so the two mechanisms agree on what "stalled" means.
const STORAGE_TIMEOUT_MS = 60000;

const TIMEOUT_MESSAGE = "Couldn't reach the server — check your connection and try again.";

function timedFetch(input, init) {
  const href = typeof input === 'string' ? input : input?.url || '';
  const ms = href.includes('/storage/v1/') ? STORAGE_TIMEOUT_MS : DEFAULT_LOAD_TIMEOUT_MS;
  const controller = new AbortController();
  // A reason, not a bare abort(): an unreasoned abort surfaces to callers
  // as the generic "AbortError: signal is aborted without reason", which
  // is exactly the kind of raw technical string a screen's own error UI
  // (e.g. MobileResourcesScreen's "Reintentar") would otherwise show
  // verbatim — same friendly wording withTimeout.js already uses for its
  // own timeout, so the two mechanisms read as one thing to whoever sees
  // either of them. `.name` MUST stay 'AbortError', not just the message —
  // postgrest-js's own retry logic specifically checks
  // `fetchError?.name === 'AbortError'` to skip retrying a genuinely
  // aborted request; a plain `new Error(...)` (name: 'Error') fails that
  // check silently, so a stalled request gets retried up to
  // DEFAULT_MAX_RETRIES times — each attempt re-stalling for the FULL
  // timeout again — rather than surfacing immediately. Confirmed the hard
  // way: a first version of this fix without the renamed error took 20s+
  // to resolve instead of 12s, on what should have been a one-shot abort.
  const timer = setTimeout(() => {
    const err = new Error(TIMEOUT_MESSAGE);
    err.name = 'AbortError';
    controller.abort(err);
  }, ms);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: timedFetch },
});

export function onAuthChange(callback) {
  supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
