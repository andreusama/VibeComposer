// Proxy to the Anthropic Messages API. The live URL is public, so this must
// never act as an open relay for ANTHROPIC_API_KEY: every request needs a
// valid Supabase session, may only use the models/fields the app actually
// sends, has a capped output budget, and is rate-limited per user.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://slfxdrxtujchfqwvhyer.supabase.co';
// Public by design (same publishable key the client ships in src/config.js).
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_YAH1RUASJRewSxHU53YcDg_tsCoJssr';

const ALLOWED_MODELS = new Set(['claude-sonnet-5', 'claude-sonnet-4-5']);
const MAX_OUTPUT_TOKENS = 8000;   // resource import asks for 8000, the largest caller
const MAX_BODY_CHARS = 200_000;   // system + messages, roughly 50k tokens
const UPSTREAM_TIMEOUT_MS = 55_000;

// Per-user burst limit. In-memory, so it's per warm serverless instance —
// best-effort only. The hard, global daily cap is consumeDailyQuota() below
// (Postgres); keep a spend limit on the Anthropic key itself as well.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 20;
const hits = new Map();

function rateLimited(userId) {
  const now = Date.now();
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (now - v.start > RATE_WINDOW_MS) hits.delete(k);
  }
  const entry = hits.get(userId);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    hits.set(userId, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX_REQUESTS;
}

function getToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

// Hard daily cap, enforced in Postgres (supabase/migration_claude_usage.sql).
// Called with the caller's own token so the function sees auth.uid(). Returns
// true (allowed), false (over the cap), or null (couldn't check — we fail
// closed, since this is the guard on real money).
async function consumeDailyQuota(token) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claude_consume_quota`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    return (await r.json()) === true;
  } catch {
    return null;
  }
}

async function getUserId(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const user = await r.json();
    return user?.id || null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = getToken(req);
  const userId = await getUserId(token);
  if (!userId) return res.status(401).json({ error: 'Sign in to use the Muse.' });

  if (rateLimited(userId)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Too many requests — try again in a minute.' });
  }

  const b = req.body;
  if (!b || typeof b !== 'object' || !ALLOWED_MODELS.has(b.model) || !Array.isArray(b.messages)) {
    return res.status(400).json({ error: 'Invalid request.' });
  }
  const maxTokens = Number.isInteger(b.max_tokens) ? b.max_tokens : 0;
  if (maxTokens < 1 || maxTokens > MAX_OUTPUT_TOKENS) {
    return res.status(400).json({ error: 'Invalid max_tokens.' });
  }
  if (JSON.stringify([b.system, b.messages]).length > MAX_BODY_CHARS) {
    return res.status(413).json({ error: 'Request too large.' });
  }

  // Last check before spending anything, so rejected/invalid requests above
  // never count against the user's day.
  const allowed = await consumeDailyQuota(token);
  if (allowed === null) return res.status(503).json({ error: 'Usage check unavailable — try again shortly.' });
  if (!allowed) return res.status(429).json({ error: 'Daily limit reached — come back tomorrow.' });

  // Forward only the fields the app uses — no tools, streaming, etc.
  const body = { model: b.model, max_tokens: maxTokens, messages: b.messages };
  if (b.system !== undefined) body.system = b.system;
  if (b.thinking?.type === 'disabled') body.thinking = { type: 'disabled' };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch {
    res.status(502).json({ error: 'Upstream request failed.' });
  }
}
