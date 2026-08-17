#!/usr/bin/env node
// ─── Cultural Resonance Engine — CoolScore recompute ───────────────────────
// Replaces the old binary charisma_score heuristic (only ever 5 or 8 — see
// git history / the conversation this was built from) with a real weighted
// formula:
//
//   CoolScore = 0.35·Phonetics + 0.30·Rarity + 0.20·Loanword + 0.15·Density
//
// Deliberately does NOT re-stream the Kaikki dump — everything this
// formula needs (word, syllables, stress_type, rhyme_key, tags) is already
// sitting in the `lexicon` table from the last seed. This just paginates
// through the existing rows and recomputes two columns (charisma_score,
// freq_rank) per row.
//
// LANGUAGE-PARAMETERIZED (npm run coolscore -- es|ca, defaults to es):
// this originally had NO lang_code filter at all on its select/upsert, and
// hardcoded the Spanish frequency list + a Spanish-only vowel set for
// Phonetics + a Spanish-specific LOANWORDS vocabulary. That was fine while
// the table was 100% Spanish, but the moment Catalan rows existed
// alongside it, running this unmodified would have recomputed
// charisma_score for BOTH languages using whichever single config was
// hardcoded — corrupting one or the other. Every query below is now scoped
// by lang_code, and Phonetics/Rarity/Loanword each pull from a per-language
// config instead of a hardcoded Spanish assumption. Density (the negation-
// prefix heuristic) stays language-agnostic on purpose — des-/in-/im- are
// real negation prefixes in both Spanish and Catalan.
//
// One factual correction vs. how this was originally specified: freq_rank
// is NOT already populated (verified against the live table — it's null
// for all rows). Kaikki is a dictionary extract, not a frequency corpus, so
// it never had rank data to begin with. This script downloads a real
// frequency source (hermitdave/FrequencyWords — es_full.txt / ca_full.txt,
// both confirmed live at the same URL pattern) specifically to backfill
// Rarity, rather than assuming a field that isn't there.
//
// Density uses the cheap prefix heuristic (des-/in-/im-), not the "ask
// Claude to tag a batch" version — that would mean the whole lexicon
// through the API, which is a real cost/time question, not something to do
// silently. Swap in an LLM pass later if the heuristic proves too coarse.
//
// Proper nouns: already excluded before this ever runs — Kaikki tags them
// pos:"name", distinct from noun/verb/adj, so they never entered the table
// (see scripts/seed-lexicon-kaikki.ts / seed-lexicon-kaikki-catalan.ts's
// KEEP_POS filter). Nothing to redo here.
//
// Requires: SUPABASE_SERVICE_ROLE_KEY in .env (same as the seed scripts —
// this is a bulk UPDATE, the anon key can't do it, see migration_lexicon.sql).
// Usage: npm run coolscore [-- es|ca]   (or: tsx scripts/recompute-coolscore.ts es)

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SUPABASE_URL } from '../src/config.js';
import { LANG_RULES } from '../src/utils/syllables.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

type Lang = 'es' | 'ca';
const SUPPORTED_LANGS: Lang[] = ['es', 'ca'];

const FREQ_LIST_URLS: Record<Lang, string> = {
  es: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/es/es_full.txt',
  ca: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ca/ca_full.txt',
};

const PAGE_SIZE = 1000;

const OPEN_VOWELS = new Set(['a', 'o']); // open/sonorous vowels — same pair in both Spanish and Catalan
const LIQUIDS = new Set(['l', 'r']); // universal consonant classification, not language-specific
const NEGATION_PREFIXES = ['des', 'in', 'im']; // real negation prefixes in both languages

// Small hand-built list per language, per the original spec's own
// recommendation ("cheap version ... beats trying to auto-detect this
// reliably") over trying to infer "atypical stress" automatically.
const LOANWORDS: Record<Lang, Set<string>> = {
  es: new Set([
    'sweater', 'nascar', 'whisky', 'jazz', 'sándwich', 'closet', 'mouse', 'email',
    'footing', 'ticket', 'parking', 'sexy', 'bikini', 'jean', 'jeans', 'rock', 'pop',
    'blues', 'jet', 'set', 'club', 'fútbol', 'básquetbol', 'kiwi', 'karaoke', 'sushi',
    'pizza', 'spaghetti', 'croissant', 'baguette', 'chef', 'boutique', 'ballet',
    'vodka', 'curry', 'yoga', 'samurai', 'ninja', 'tsunami', 'kamikaze', 'panda',
    'gong', 'punk', 'gay', 'ok', 'okay', 'web', 'internet', 'software', 'hardware',
    'laptop', 'smartphone', 'wifi', 'bluetooth', 'podcast', 'blog', 'selfie',
    'hashtag', 'tuit', 'tweet', 'escáner', 'córner', 'penalti', 'gol', 'mitin',
    'líder', 'estrés', 'test', 'récord', 'flash', 'spot', 'ranking', 'marketing',
    'casting', 'catering', 'camping', 'shopping', 'sándwich', 'muffin', 'brownie',
    'cupcake', 'smoothie', 'yogur', 'crep', 'panqueque', 'hobby', 'freelance',
  ]),
  // Many international loanwords are shared verbatim with Spanish (pizza,
  // sushi, whisky, wifi, internet...), but several have their own distinct
  // Catalan spelling — reused where identical, corrected where not (futbol
  // not fútbol, bàsquet not básquetbol, estrès not estrés, xef alongside
  // chef). Smaller/rougher than the Spanish list on purpose: this is a
  // first pass, not a linguistic authority — same "cheap heuristic, swap
  // for something better later if it proves too coarse" caveat applies.
  ca: new Set([
    'sweater', 'whisky', 'jazz', 'mouse', 'email', 'parking', 'sexy', 'bikini',
    'jean', 'jeans', 'rock', 'pop', 'blues', 'jet', 'set', 'club', 'futbol',
    'bàsquet', 'handbol', 'voleibol', 'rugbi', 'hoquei', 'gol', 'esprint',
    'kiwi', 'karaoke', 'sushi', 'pizza', 'spaghetti', 'croissant', 'baguette',
    'chef', 'xef', 'boutique', 'ballet', 'vodka', 'curry', 'yoga', 'samurai',
    'ninja', 'tsunami', 'kamikaze', 'panda', 'gong', 'punk', 'gay', 'ok',
    'okay', 'web', 'internet', 'software', 'hardware', 'laptop', 'smartphone',
    'wifi', 'bluetooth', 'podcast', 'blog', 'selfie', 'hashtag', 'tuit',
    'tweet', 'escàner', 'córner', 'penal', 'lider', 'estrès', 'test', 'rècord',
    'flash', 'spot', 'ranking', 'marketing', 'càsting', 'càtering', 'càmping',
    'xopin', 'muffin', 'brownie', 'cupcake', 'smoothie', 'iogurt', 'hobby',
    'freelance',
  ]),
};
// Letter sequences that read as phonotactically foreign — never occur
// natively in either language (neither has native /w/, /θ/-as-th,
// /ʃ/-as-sh, /f/-as-ph spellings).
const LOANWORD_PATTERNS = ['sh', 'th', 'ph'];

interface LexiconRow {
  id: number;
  word: string;
  lang_code: string;
  syllables: number;
  stress_type: string | null;
  rhyme_key: string;
  tags: string[];
}

function loadEnv(): Record<string, string> {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

async function loadFrequencyRanks(lang: Lang): Promise<{ ranks: Map<string, number>; maxRank: number }> {
  const url = FREQ_LIST_URLS[lang];
  console.log(`Downloading ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download frequency list: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split('\n').filter(Boolean);
  const ranks = new Map<string, number>();
  let rank = 0;
  for (const line of lines) {
    const [word] = line.trim().split(/\s+/);
    if (!word) continue;
    rank++;
    // First occurrence wins (the list is already frequency-sorted).
    if (!ranks.has(word.toLowerCase())) ranks.set(word.toLowerCase(), rank);
  }
  console.log(`Loaded ${ranks.size} ranked words (max rank ${rank}).`);
  return { ranks, maxRank: rank };
}

// ─── Phonetics (0.35) — fully mechanical, from the word string alone ───────
// VOWELS now comes from syllables.js's own LANG_RULES (the same source of
// truth SURGEON/ARCHITECT verification and rhyme.js use) instead of a
// hand-copied Spanish-only accented-vowel set — Catalan has à/è/ò/ï that
// set never included, and doesn't have á, which that set assumed applied
// universally.
function computePhonetics(word: string, lang: Lang): number {
  const vowels = LANG_RULES[lang].vowels();
  const letters = [...word.toLowerCase()];
  const length = letters.length;
  if (!length) return 0;

  const liquidCount = letters.filter((ch) => LIQUIDS.has(ch)).length;
  const liquidRatio = liquidCount / length;

  const vowelLetters = letters.filter((ch) => vowels.has(ch));
  const openVowelCount = vowelLetters.filter((ch) => OPEN_VOWELS.has(ch)).length;
  const openVowelRatio = vowelLetters.length ? openVowelCount / vowelLetters.length : 0;

  // harshPenalty: count of consonant clusters >= 3 letters long, / length.
  let harshClusters = 0;
  let run = 0;
  for (const ch of letters) {
    if (vowels.has(ch)) {
      if (run >= 3) harshClusters++;
      run = 0;
    } else {
      run++;
    }
  }
  if (run >= 3) harshClusters++;
  const harshPenalty = harshClusters / length;

  // alternationBonus: "alternates C-V-C-V reasonably well" — operationalized
  // as >=60% of adjacent letter-pairs actually switching consonant/vowel.
  let alternating = 0;
  for (let i = 0; i < letters.length - 1; i++) {
    if (vowels.has(letters[i]) !== vowels.has(letters[i + 1])) alternating++;
  }
  const alternationRatio = letters.length > 1 ? alternating / (letters.length - 1) : 1;
  const alternationBonus = alternationRatio >= 0.6 ? 1 : 0.5;

  const raw = (liquidRatio * 0.4) + (openVowelRatio * 0.3) + (alternationBonus * 0.2) - (harshPenalty * 0.3);
  return Math.max(0, Math.min(1, raw));
}

// ─── Rarity (0.30) — real frequency data, not invented ─────────────────────
// Two corrections vs. the originally-specified formula (`1 - rank/maxRank`):
//
// 1. Direction was inverted. rank here is a POSITION (1 = most frequent
//    word in the corpus, maxRank = least frequent), so `1 - rank/maxRank`
//    gave a COMMON word (small rank) a rarity near 1 and a RARE word
//    (large rank) a rarity near 0 — backwards. Verified concretely: "cosa"
//    (rank 187) computed 0.9998 vs "claroscuro" (rank 150473) at 0.8749
//    under the literal formula — cosa would have beaten claroscuro,
//    contradicting the spec's own worked example.
//
// 2. Even direction-corrected (rank/maxRank), LINEAR scaling badly
//    compresses everything except the extreme tail of a large corpus —
//    word frequency is Zipfian (power-law), not uniform. Log-scaling the
//    rank is the standard fix and spreads real vocabulary across the range
//    (verified for Spanish before running at scale: claroscuro → 0.85,
//    cosa → 0.37).
function computeRarity(word: string, ranks: Map<string, number>, maxRank: number): { rarity: number; freqRank: number | null } {
  const rank = ranks.get(word.toLowerCase());
  if (rank == null) return { rarity: 1, freqRank: null }; // beyond even the frequency corpus — legitimately maximally rare
  const rarity = Math.max(0, Math.min(1, Math.log(rank) / Math.log(maxRank)));
  return { rarity, freqRank: rank };
}

// ─── Loanword (0.20) ────────────────────────────────────────────────────────
function computeLoanword(word: string, lang: Lang): number {
  const w = word.toLowerCase();
  if (LOANWORDS[lang].has(w)) return 1;
  if (LOANWORD_PATTERNS.some((p) => w.includes(p))) return 1;
  if (w.includes('w')) return 1; // 'w' doesn't occur in native vocabulary of either language
  return 0;
}

// ─── Semantic density (0.15) — cheap prefix heuristic ──────────────────────
function computeDensity(word: string): number {
  const w = word.toLowerCase();
  return NEGATION_PREFIXES.some((p) => w.startsWith(p)) ? 0.7 : 0.3;
}

// Empirically calibrated PER LANGUAGE against a real sample of that
// language's own lexicon rows — Spanish's numbers came from a 10,000-word
// Spanish sample (min 0.185, max 0.709) and do NOT transfer to Catalan
// automatically: different vocabulary, different phonotactics, a smaller/
// different-shaped source dump all shift where the raw coolScore
// distribution actually falls. lexicon.js's queryRhymeCandidates filters
// on charisma_score >= 7, so an uncalibrated mapping risks the Cultural
// Resonance Engine silently degrade-falling-back on nearly every real call
// for that language — exactly the failure mode the original Spanish
// calibration pass (dry-run against a real sample, check the distribution,
// THEN pick floor/ceiling) exists to avoid. Catalan's values below were
// derived the same way, not assumed.
// Catalan recalibrated after the lexicon source itself changed (Kaikki
// 181,291 rows → Softcatalà 878,631 rows — a much larger, differently-
// shaped population, including far more conjugated verb forms) — reused a
// real 4,000-row sample scattered across the full new table (min 0.264,
// max 0.659, p90 0.501, p92 0.504, p95 0.510). Floor set just below the
// observed min, ceiling solved so charisma_score >= 7 selects ~p92
// (roughly the top ~8% of real words), same selectivity target as Spanish
// and the previous Catalan calibration — reusing Spanish's raw numbers
// blindly would have been wrong for either Catalan population, and this
// one shifted enough from the first Catalan pass to be worth redoing
// rather than assumed stable.
const COOLSCORE_CALIBRATION: Record<Lang, { floor: number; ceiling: number }> = {
  es: { floor: 0.18, ceiling: 0.71 },
  ca: { floor: 0.26, ceiling: 0.659 },
};

export function computeCoolScore(word: string, ranks: Map<string, number>, maxRank: number, lang: Lang = 'es') {
  const phonetics = computePhonetics(word, lang);
  const { rarity, freqRank } = computeRarity(word, ranks, maxRank);
  const loanword = computeLoanword(word, lang);
  const density = computeDensity(word);

  const coolScore = (phonetics * 0.35) + (rarity * 0.30) + (loanword * 0.20) + (density * 0.15);
  const { floor, ceiling } = COOLSCORE_CALIBRATION[lang];
  const normalized = Math.max(0, Math.min(1, (coolScore - floor) / (ceiling - floor)));
  const charismaScore = Math.max(1, Math.min(10, Math.round(normalized * 9) + 1));

  return { coolScore, charismaScore, freqRank, components: { phonetics, rarity, loanword, density } };
}

async function processPage(supabase: SupabaseClient, rows: LexiconRow[], ranks: Map<string, number>, maxRank: number, lang: Lang): Promise<void> {
  const updated = rows.map((row) => {
    const { charismaScore, freqRank } = computeCoolScore(row.word, ranks, maxRank, lang);
    return {
      word: row.word,
      lang_code: row.lang_code,
      syllables: row.syllables,
      stress_type: row.stress_type,
      rhyme_key: row.rhyme_key,
      tags: row.tags,
      charisma_score: charismaScore,
      freq_rank: freqRank,
    };
  });
  const { error } = await supabase.from('lexicon').upsert(updated, { onConflict: 'word,lang_code' });
  if (error) throw new Error(`Update failed for a page of ${updated.length} rows: ${error.message}`);
}

async function main(): Promise<void> {
  const langArg = (process.argv[2] || 'es').trim() as Lang;
  if (!SUPPORTED_LANGS.includes(langArg)) {
    console.error(`\nUnsupported lang "${langArg}" — expected one of: ${SUPPORTED_LANGS.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  const env = loadEnv();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error('\nMissing SUPABASE_SERVICE_ROLE_KEY in .env — same requirement as the seed script.\n');
    process.exitCode = 1;
    return;
  }
  const supabase: SupabaseClient = createClient(SUPABASE_URL, serviceKey, { realtime: { transport: ws as never } });

  const { ranks, maxRank } = await loadFrequencyRanks(langArg);

  // Scoped by lang_code — the whole reason this script got parameterized:
  // running it unscoped after Catalan rows existed would have recomputed
  // BOTH languages' charisma_score using whichever single config this call
  // happened to load.
  const { count, error: countError } = await supabase
    .from('lexicon').select('*', { count: 'exact', head: true }).eq('lang_code', langArg);
  if (countError) {
    console.error(`\nCouldn't query \`lexicon\`: ${countError.message}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`Recomputing CoolScore for ${count} existing lexicon rows (lang_code: ${langArg})...`);

  // Reported live: paginating with .range(offset, offset+PAGE_SIZE-1) (an
  // OFFSET under the hood) started timing out against the much larger
  // post-Softcatalà table — first at offset 0, then again at offset 64000
  // after a retry got past the first failure. That's not a transient blip,
  // it's the standard OFFSET-pagination problem: Postgres has to scan and
  // discard `offset` rows before it can return the next page, so the query
  // gets more expensive the deeper it pages, and eventually crosses the
  // statement timeout. Switched to keyset (cursor) pagination instead —
  // `.gt('id', lastId)` is a fast indexed lookup regardless of how far into
  // the table we already are, no scan-and-discard cost at any depth. Kept
  // a few retries with backoff on top, for genuine transient network blips.
  const MAX_PAGE_RETRIES = 4;
  let processed = 0;
  let lastId = 0;
  while (processed < (count || 0)) {
    let rows: LexiconRow[] | null = null;
    let lastError: { message: string } | null = null;
    for (let attempt = 0; attempt <= MAX_PAGE_RETRIES; attempt++) {
      const { data, error } = await supabase
        .from('lexicon')
        .select('id, word, lang_code, syllables, stress_type, rhyme_key, tags')
        .eq('lang_code', langArg)
        .gt('id', lastId)
        .order('id', { ascending: true })
        .limit(PAGE_SIZE);
      if (!error) { rows = data as LexiconRow[]; lastError = null; break; }
      lastError = error;
      const waitMs = 1000 * 2 ** attempt;
      console.warn(`  after id ${lastId} attempt ${attempt + 1}/${MAX_PAGE_RETRIES + 1} failed (${error.message}) — retrying in ${waitMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    if (lastError) throw new Error(`Failed to fetch page after id ${lastId} after ${MAX_PAGE_RETRIES + 1} attempts: ${lastError.message}`);
    if (!rows || !rows.length) break;

    await processPage(supabase, rows, ranks, maxRank, langArg);
    processed += rows.length;
    lastId = (rows[rows.length - 1] as { id: number }).id;
    console.log(`  processed ${processed}/${count}`);
  }

  console.log(`\nDone. Recomputed CoolScore for ${processed} rows (lang_code: ${langArg}).`);
}

// Guarded — this file exports computeCoolScore for reuse/dry-run testing
// (e.g. verifying against known words before touching production), and an
// unguarded top-level main() call means simply IMPORTING the module for
// that export runs the real production update as a side effect. That
// already happened once while testing this script.
const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err) => {
    console.error('\nrecompute-coolscore failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
