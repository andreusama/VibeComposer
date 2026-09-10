#!/usr/bin/env node
// ─── Cultural Resonance Engine — CoolScore recompute ───────────────────────
// Replaces the old binary charisma_score heuristic (only ever 5 or 8 — see
// git history / the conversation this was built from) with a weighted
// formula:
//
//   CoolScore = 0.64·Phonetics + 0.36·Loanword
//
// Rarity and Density (the des-/in-/im- negation-prefix heuristic) were
// REMOVED on purpose (2026-09-10): frequency-rarity does not imply a word
// is good — it just rewards obscurity, which the word bank's own sort
// already has to fight — and the prefix heuristic mis-scored perfectly
// good words (deshielo, insomnio, inmenso, desamparo). What's left is the
// two mechanical, string-only signals: how the word sounds (Phonetics) and
// whether it reads as a foreign loan (Loanword). The 0.64/0.36 split keeps
// the old 0.35 : 0.20 ratio between them, renormalized to span 0..1.
//
// freq_rank is STILL computed and stored — it's a separate raw fact used
// by lexicon.js's "common words first" word-bank sort, which is the
// OPPOSITE bias (familiarity, not obscurity) and unaffected by this change.
//
// Deliberately does NOT re-stream the Kaikki dump — everything this
// formula needs (word, syllables, stress_type, rhyme_key, tags) is already
// sitting in the `lexicon` table from the last seed. This just paginates
// through the existing rows and recomputes two columns (charisma_score,
// freq_rank) per row.
//
// CALIBRATION: removing two of the four terms shifts the raw-score
// distribution, so COOLSCORE_CALIBRATION below is an ESTIMATE until
// re-derived. Run `npm run coolscore -- es --dry-run` (and `-- ca
// --dry-run`): it paginates the whole table, computes every score, prints
// the real percentile distribution + a suggested {floor, ceiling}, and
// writes nothing. Update the constants, then run without --dry-run.
//
// LANGUAGE-PARAMETERIZED (npm run coolscore -- es|ca, defaults to es):
// this originally had NO lang_code filter at all on its select/upsert, and
// hardcoded the Spanish frequency list + a Spanish-only vowel set for
// Phonetics + a Spanish-specific LOANWORDS vocabulary. That was fine while
// the table was 100% Spanish, but the moment Catalan rows existed
// alongside it, running this unmodified would have recomputed
// charisma_score for BOTH languages using whichever single config was
// hardcoded — corrupting one or the other. Every query below is now scoped
// by lang_code, and Phonetics/Loanword each pull from a per-language config
// instead of a hardcoded Spanish assumption.
//
// freq_rank is NOT already populated (verified against the live table —
// it's null for all rows). Kaikki is a dictionary extract, not a frequency
// corpus, so it never had rank data to begin with. This script downloads a
// real frequency source (hermitdave/FrequencyWords — es_full.txt /
// ca_full.txt, both confirmed live at the same URL pattern) to backfill
// freq_rank — used ONLY for lexicon.js's "common words first" word-bank
// sort now, no longer as a CoolScore term.
//
// Proper nouns: already excluded before this ever runs — Kaikki tags them
// pos:"name", distinct from noun/verb/adj, so they never entered the table
// (see scripts/seed-lexicon-kaikki.ts / seed-lexicon-kaikki-catalan.ts's
// KEEP_POS filter). Nothing to redo here.
//
// Requires: SUPABASE_SERVICE_ROLE_KEY in .env (same as the seed scripts —
// this is a bulk UPDATE, the anon key can't do it, see migration_lexicon.sql).
// Usage: npm run coolscore -- es|ca [--dry-run]
//   --dry-run: paginate + compute + print the score distribution, write nothing.

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
// ...EXCEPT across a native prefix boundary: "des-hielo", "des-honra",
// "trans-humante", "post-humo" all contain a spurious "sh"/"th" that has
// nothing to do with being a loan. Strip these leading prefixes before the
// digraph test (they never form a real foreign digraph with what follows).
const NATIVE_PREFIXES_RE = /^(des|trans|sub|post|in|en|con)/;

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

// freq_rank only — a word's POSITION in the frequency corpus (1 = most
// frequent). Feeds the freq_rank column, read by lexicon.js's word-bank
// "common words first" sort. No longer scaled into CoolScore.
async function loadFrequencyRanks(lang: Lang): Promise<{ ranks: Map<string, number> }> {
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
  console.log(`Loaded ${ranks.size} ranked words.`);
  return { ranks };
}

// ─── Phonetics (0.64) — fully mechanical, from the word string alone ───────
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

// ─── freq_rank lookup — NO LONGER a CoolScore term ─────────────────────────
// Was "Rarity (0.30)": log(rank)/log(maxRank), rarer = higher score.
// Removed from CoolScore (2026-09-10) — obscurity is not quality. The raw
// rank is still returned and stored in freq_rank, but only lexicon.js's
// word-bank "common words first" sort reads it now.
function lookupFreqRank(word: string, ranks: Map<string, number>): number | null {
  return ranks.get(word.toLowerCase()) ?? null;
}

// ─── Loanword (0.36) ────────────────────────────────────────────────────────
function computeLoanword(word: string, lang: Lang): number {
  const w = word.toLowerCase();
  if (LOANWORDS[lang].has(w)) return 1;
  const stem = w.replace(NATIVE_PREFIXES_RE, ''); // "deshielo" → "hielo", so the "sh" boundary artifact doesn't count
  if (LOANWORD_PATTERNS.some((p) => stem.includes(p))) return 1;
  if (w.includes('w')) return 1; // 'w' doesn't occur in native vocabulary of either language
  return 0;
}

// Maps the raw 0..1 CoolScore onto charisma_score 1..10, per language.
// lexicon.js's queryRhymeCandidates filters on charisma_score >= 7, so
// these must sit where the real distribution actually falls or the Cultural
// Resonance Engine silently degrades on nearly every call.
//
// ESTIMATE (2026-09-10) — the previous values were fit against the OLD
// 4-term formula; dropping Rarity + Density shifts the whole distribution
// down and compresses it (only Phonetics 0..~0.6 for the ~99% of words
// that aren't loanwords). These numbers were reasoned from computePhonetics'
// own component ranges, NOT measured. Re-derive before trusting the
// charisma_score >= 7 gate: `npm run coolscore -- es --dry-run` prints the
// real percentiles + a suggested {floor, ceiling}; same for -- ca.
const COOLSCORE_CALIBRATION: Record<Lang, { floor: number; ceiling: number }> = {
  es: { floor: 0.10, ceiling: 0.49 },
  ca: { floor: 0.12, ceiling: 0.50 },
};

export function computeCoolScore(word: string, ranks: Map<string, number>, lang: Lang = 'es') {
  const phonetics = computePhonetics(word, lang);
  const loanword = computeLoanword(word, lang);
  const freqRank = lookupFreqRank(word, ranks);

  const coolScore = (phonetics * 0.64) + (loanword * 0.36);
  const { floor, ceiling } = COOLSCORE_CALIBRATION[lang];
  const normalized = Math.max(0, Math.min(1, (coolScore - floor) / (ceiling - floor)));
  const charismaScore = Math.max(1, Math.min(10, Math.round(normalized * 9) + 1));

  return { coolScore, charismaScore, freqRank, components: { phonetics, loanword } };
}

async function processPage(
  supabase: SupabaseClient, rows: LexiconRow[], ranks: Map<string, number>, lang: Lang,
  opts: { dryRun: boolean; rawScores: number[] },
): Promise<void> {
  const updated = rows.map((row) => {
    const { coolScore, charismaScore, freqRank } = computeCoolScore(row.word, ranks, lang);
    opts.rawScores.push(coolScore);
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
  if (opts.dryRun) return;
  const { error } = await supabase.from('lexicon').upsert(updated, { onConflict: 'word,lang_code' });
  if (error) throw new Error(`Update failed for a page of ${updated.length} rows: ${error.message}`);
}

// Charisma >= 7 means normalized >= 6/9; solving (p92 - floor)/(ceiling -
// floor) = 6/9 for `ceiling` with floor = observed min gives the ceiling
// that makes the >= 7 gate select ~the top 8% of real words — the same
// selectivity target the original calibration used.
function reportDistribution(scores: number[], lang: Lang): void {
  if (!scores.length) { console.log('\n(no scores collected — nothing to report)'); return; }
  const sorted = [...scores].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const f = (n: number) => n.toFixed(4);
  const floor = sorted[0];
  const p92 = at(92);
  const suggestedCeiling = floor + (p92 - floor) / (6 / 9);
  console.log(`\n─── raw CoolScore distribution (${lang}, n=${scores.length}) ───`);
  console.log(`  min ${f(sorted[0])}  p50 ${f(at(50))}  p90 ${f(at(90))}  p92 ${f(p92)}  p95 ${f(at(95))}  max ${f(sorted[sorted.length - 1])}`);
  console.log(`  suggested COOLSCORE_CALIBRATION.${lang} = { floor: ${f(floor)}, ceiling: ${f(suggestedCeiling)} }`);
  const configured = COOLSCORE_CALIBRATION[lang];
  console.log(`  currently configured               = { floor: ${configured.floor}, ceiling: ${configured.ceiling} }`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const langArg = (args.find((a) => !a.startsWith('--')) || 'es').trim() as Lang;
  if (!SUPPORTED_LANGS.includes(langArg)) {
    console.error(`\nUnsupported lang "${langArg}" — expected one of: ${SUPPORTED_LANGS.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  if (dryRun) console.log('DRY RUN — computing the distribution only, writing nothing.\n');

  const env = loadEnv();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error('\nMissing SUPABASE_SERVICE_ROLE_KEY in .env — same requirement as the seed script.\n');
    process.exitCode = 1;
    return;
  }
  const supabase: SupabaseClient = createClient(SUPABASE_URL, serviceKey, { realtime: { transport: ws as never } });

  const { ranks } = await loadFrequencyRanks(langArg);
  const rawScores: number[] = [];

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
  console.log(`${dryRun ? 'Scanning' : 'Recomputing'} CoolScore for ${count} existing lexicon rows (lang_code: ${langArg})...`);

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

    await processPage(supabase, rows, ranks, langArg, { dryRun, rawScores });
    processed += rows.length;
    lastId = (rows[rows.length - 1] as { id: number }).id;
    console.log(`  ${dryRun ? 'scanned' : 'processed'} ${processed}/${count}`);
  }

  reportDistribution(rawScores, langArg);
  console.log(`\nDone. ${dryRun ? 'Scanned' : 'Recomputed CoolScore for'} ${processed} rows (lang_code: ${langArg})${dryRun ? ' — nothing written' : ''}.`);
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
