#!/usr/bin/env node
// ─── Cultural Resonance Engine — CoolScore recompute ───────────────────────
// Replaces the old binary charisma_score heuristic (only ever 5 or 8 — see
// git history / the conversation this was built from) with a real weighted
// formula:
//
//   CoolScore = 0.35·Phonetics + 0.30·Rarity + 0.20·Loanword + 0.15·Density
//
// Deliberately does NOT re-stream the 1GB Kaikki dump — everything this
// formula needs (word, syllables, stress_type, rhyme_key, tags) is already
// sitting in the `lexicon` table from the last seed. This just paginates
// through the existing ~735K rows and recomputes two columns
// (charisma_score, freq_rank) per row.
//
// One factual correction vs. how this was originally specified: freq_rank
// is NOT already populated (verified against the live table — it's null
// for all rows). Kaikki is a dictionary extract, not a frequency corpus, so
// it never had rank data to begin with. This script downloads a real
// frequency source (hermitdave/FrequencyWords' es_full.txt — ~1.2M words,
// not just the top 50k, so it actually covers this lexicon's ~735K rows)
// specifically to backfill Rarity, rather than assuming a field that isn't
// there.
//
// Density uses the cheap prefix heuristic (des-/in-/im-), not the "ask
// Claude to tag a batch" version — that would mean ~735K words through the
// API, which is a real cost/time question, not something to do silently.
// Swap in an LLM pass later if the heuristic proves too coarse.
//
// Proper nouns: already excluded before this ever runs — Kaikki tags them
// pos:"name", distinct from noun/verb/adj, so they never entered the table
// (see scripts/seed-lexicon-kaikki.ts's KEEP_POS filter). Nothing to redo
// here.
//
// Requires: SUPABASE_SERVICE_ROLE_KEY in .env (same as the seed script —
// this is a bulk UPDATE, the anon key can't do it, see migration_lexicon.sql).
// Usage: npm run coolscore   (or: tsx scripts/recompute-coolscore.ts)

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SUPABASE_URL } from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const FREQ_LIST_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/es/es_full.txt';
const PAGE_SIZE = 1000;

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'á', 'é', 'í', 'ó', 'ú', 'ü']);
const OPEN_VOWELS = new Set(['a', 'o']);
const LIQUIDS = new Set(['l', 'r']);
const NEGATION_PREFIXES = ['des', 'in', 'im'];

// Small hand-built list, per the spec's own recommendation ("cheap version
// ... beats trying to auto-detect this reliably") over trying to infer
// "atypical Spanish stress" automatically — real, well-known loanwords
// across a spread of domains (tech, fashion, food, music, sport).
const LOANWORDS = new Set([
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
]);
// Letter sequences that read as phonotactically foreign in Spanish — never
// occur natively (Spanish has no /w/, /θ/-as-th, /ʃ/-as-sh, /f/-as-ph).
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

async function loadFrequencyRanks(): Promise<{ ranks: Map<string, number>; maxRank: number }> {
  console.log(`Downloading ${FREQ_LIST_URL} ...`);
  const res = await fetch(FREQ_LIST_URL);
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
function computePhonetics(word: string): number {
  const letters = [...word.toLowerCase()];
  const length = letters.length;
  if (!length) return 0;

  const liquidCount = letters.filter((ch) => LIQUIDS.has(ch)).length;
  const liquidRatio = liquidCount / length;

  const vowelLetters = letters.filter((ch) => VOWELS.has(ch));
  const openVowelCount = vowelLetters.filter((ch) => OPEN_VOWELS.has(ch)).length;
  const openVowelRatio = vowelLetters.length ? openVowelCount / vowelLetters.length : 0;

  // harshPenalty: count of consonant clusters >= 3 letters long, / length.
  let harshClusters = 0;
  let run = 0;
  for (const ch of letters) {
    if (VOWELS.has(ch)) {
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
    if (VOWELS.has(letters[i]) !== VOWELS.has(letters[i + 1])) alternating++;
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
//    compresses everything except the extreme tail of a ~1.2M-word corpus
//    — word frequency is Zipfian (power-law), not uniform, so a genuinely
//    rare/evocative word like "claroscuro" (rank 150473) only scored 0.125,
//    while a truly obscure one needs to be past rank ~1M to score highly.
//    In practice this meant almost nothing would clear the
//    charisma_score >= 7 threshold lexicon.js already filters on — the
//    Cultural Resonance Engine would have silently degraded to fallback on
//    nearly every real call. Log-scaling the rank is the standard fix for
//    Zipfian distributions and spreads real vocabulary across the range:
//    claroscuro → 0.85, cosa → 0.37 (verified before running this at scale).
function computeRarity(word: string, ranks: Map<string, number>, maxRank: number): { rarity: number; freqRank: number | null } {
  const rank = ranks.get(word.toLowerCase());
  if (rank == null) return { rarity: 1, freqRank: null }; // beyond even a 1.2M-word corpus — legitimately maximally rare
  const rarity = Math.max(0, Math.min(1, Math.log(rank) / Math.log(maxRank)));
  return { rarity, freqRank: rank };
}

// ─── Loanword (0.20) ────────────────────────────────────────────────────────
function computeLoanword(word: string): number {
  const w = word.toLowerCase();
  if (LOANWORDS.has(w)) return 1;
  if (LOANWORD_PATTERNS.some((p) => w.includes(p))) return 1;
  if (w.includes('w')) return 1; // 'w' doesn't occur in native Spanish vocabulary
  return 0;
}

// ─── Semantic density (0.15) — cheap prefix heuristic ──────────────────────
function computeDensity(word: string): number {
  const w = word.toLowerCase();
  return NEGATION_PREFIXES.some((p) => w.startsWith(p)) ? 0.7 : 0.3;
}

// Empirically calibrated against a 10,000-word sample spread across the
// live lexicon (min 0.185, max 0.709, p90 0.525, p95 0.542) — mapping raw
// coolScore's THEORETICAL 0-1 range straight onto 1-10 was checked first
// and found to put 0.00% of a real 1000-word sample at charisma_score >= 7,
// since no real word gets remotely close to maxing all four weighted
// components at once. lexicon.js's queryRhymeCandidates filters on
// charisma_score >= 7, so an uncalibrated mapping would make the Cultural
// Resonance Engine silently degrade-fallback on nearly every real call.
// This min-max stretch makes >=7 select roughly the top ~7-8% of real
// words instead of ~0% — a comparable selectivity to the old binary
// heuristic's ~13% "high charisma" share, not a rubber-stamp.
const COOLSCORE_FLOOR = 0.18;
const COOLSCORE_CEILING = 0.71;

export function computeCoolScore(word: string, ranks: Map<string, number>, maxRank: number) {
  const phonetics = computePhonetics(word);
  const { rarity, freqRank } = computeRarity(word, ranks, maxRank);
  const loanword = computeLoanword(word);
  const density = computeDensity(word);

  const coolScore = (phonetics * 0.35) + (rarity * 0.30) + (loanword * 0.20) + (density * 0.15);
  const normalized = Math.max(0, Math.min(1, (coolScore - COOLSCORE_FLOOR) / (COOLSCORE_CEILING - COOLSCORE_FLOOR)));
  const charismaScore = Math.max(1, Math.min(10, Math.round(normalized * 9) + 1));

  return { coolScore, charismaScore, freqRank, components: { phonetics, rarity, loanword, density } };
}

async function processPage(supabase: SupabaseClient, rows: LexiconRow[], ranks: Map<string, number>, maxRank: number): Promise<void> {
  const updated = rows.map((row) => {
    const { charismaScore, freqRank } = computeCoolScore(row.word, ranks, maxRank);
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
  const env = loadEnv();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error('\nMissing SUPABASE_SERVICE_ROLE_KEY in .env — same requirement as the seed script.\n');
    process.exitCode = 1;
    return;
  }
  const supabase: SupabaseClient = createClient(SUPABASE_URL, serviceKey, { realtime: { transport: ws as never } });

  const { ranks, maxRank } = await loadFrequencyRanks();

  const { count, error: countError } = await supabase.from('lexicon').select('*', { count: 'exact', head: true });
  if (countError) {
    console.error(`\nCouldn't query \`lexicon\`: ${countError.message}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`Recomputing CoolScore for ${count} existing lexicon rows...`);

  let processed = 0;
  for (let offset = 0; offset < (count || 0); offset += PAGE_SIZE) {
    const { data: rows, error } = await supabase
      .from('lexicon')
      .select('id, word, lang_code, syllables, stress_type, rhyme_key, tags')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to fetch page at offset ${offset}: ${error.message}`);
    if (!rows || !rows.length) break;

    await processPage(supabase, rows as LexiconRow[], ranks, maxRank);
    processed += rows.length;
    console.log(`  processed ${processed}/${count}`);
  }

  console.log(`\nDone. Recomputed CoolScore for ${processed} rows.`);
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
