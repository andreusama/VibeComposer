#!/usr/bin/env node
// ─── Cultural Resonance Engine — Catalan lexicon seed script (Kaikki.org) ──
// Populates the `lexicon` table with Catalan entries — same table, same
// schema as scripts/seed-lexicon-kaikki.ts's Spanish seed, distinguished
// only by lang_code:'ca'. Written as its own script (not a --lang flag on
// the Spanish one) because several pieces are genuinely language-specific
// and keeping them side by side as separate files is easier to audit than
// threading conditionals through one — the pattern this repo already uses
// (seed-lexicon.mjs vs seed-lexicon-kaikki.ts were separate files too).
//
// Prompted by: rhyme.js and syllables.js ALREADY have real Catalan phonetic
// rules (dialecte oriental/occidental, à/è/ò stress, l·l, etc. — built early
// in this project, task "syllable counter (Spanish + Catalan)"), but the
// `lexicon` table backing WORD_BANK/concept-explorer/proposeConceptWords
// was 100% Spanish (734,753 rows, 0 Catalan) — verified live before writing
// this. Catalan lyrics got real deterministic rhyme matching (SURGEON/
// ARCHITECT verification, inline badges) but WORD_BANK/concept features
// always returned empty. This script closes that gap.
//
// Differences from the Spanish seed script:
//   - KAIKKI_URL points at the Catalan dump (confirmed live: 189,604 word
//     forms, ~212MB — Kaikki's own site flags this specific download page
//     as "deprecated" in favor of a newer raw-data format, but the JSONL
//     itself is still being served as of writing).
//   - VALID_WORD_RE allows Catalan's own accented vowels (à/è/é/í/ï/ò/ó/ú/ü),
//     ç, and the interpunct in "l·l" (paral·lel, col·legi) — none of which
//     exist in the Spanish script's whitelist, and Spanish's á does NOT
//     appear in Catalan, so the two regexes are genuinely different, not a
//     superset/subset of each other.
//   - Computes rhyme_key_assonant in the SAME pass as rhyme_key, since that
//     column already exists in the schema now (it didn't yet when the
//     Spanish seed first ran — that one needed a separate backfill script
//     afterward; this one doesn't).
//   - estimateCharisma/KEEP_POS/BANNED_TAGS/FORM_OF_GLOSS_RE are reused
//     as-is: Kaikki normalizes part-of-speech tags across its language
//     dumps to the same vocabulary (noun/verb/adj/etc.), and the "evocative
//     heuristic" itself has nothing language-specific in its logic (POS +
//     gloss quality + length) — only the CHARACTERS considered valid for a
//     headword differ.
//
// Requires, before running: SUPABASE_SERVICE_ROLE_KEY set in .env (same as
// the Spanish seed — the anon key can't write to `lexicon`).
//
// Usage: npm run seed:lexicon:ca   (or: tsx scripts/seed-lexicon-kaikki-catalan.ts)

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { countWordSyllables } from '../src/utils/syllables.js';
import { classifyWordStress, getWordRhymeKey } from '../src/utils/rhyme.js';
import { SUPABASE_URL } from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const KAIKKI_URL = 'https://kaikki.org/dictionary/Catalan/kaikki.org-dictionary-Catalan.jsonl';
const LANG_CODE = 'ca';
const KEEP_POS = new Set(['noun', 'verb', 'adj']);
const BANNED_TAGS = new Set(['archaic', 'obsolete', 'misspelling']);
const BATCH_SIZE = 1000;
// à/è/é/í/ï/ò/ó/ú/ü + ç + the interpunct (·, U+00B7) used in l·l geminates.
// Deliberately does NOT include á (not a Catalan letter) — this is not the
// Spanish regex with extra characters bolted on, it's genuinely different.
const VALID_WORD_RE = /^[a-zàèéíïòóúüç·]+$/i;
const FORM_OF_GLOSS_RE = /^(plural of|form of|inflection of|feminine of|masculine of)/i;

interface KaikkiSense {
  glosses?: string[];
  tags?: string[];
}
interface KaikkiEntry {
  word?: string;
  pos?: string;
  lang_code?: string;
  tags?: string[];
  senses?: KaikkiSense[];
}
interface LexiconRow {
  word: string;
  lang_code: string;
  syllables: number;
  stress_type: string;
  rhyme_key: string;
  rhyme_key_assonant: string | null;
  charisma_score: number;
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

function allTags(entry: KaikkiEntry): string[] {
  const senseTags = (entry.senses || []).flatMap((s) => s.tags || []);
  return [...(entry.tags || []), ...senseTags];
}

function hasCleanGloss(entry: KaikkiEntry): boolean {
  return (entry.senses || []).some((s) =>
    (s.glosses || []).some((g) => g && g.trim() && !FORM_OF_GLOSS_RE.test(g.trim()))
  );
}

function estimateCharisma(entry: KaikkiEntry, word: string): number {
  const isEvocativePos = entry.pos === 'noun' || entry.pos === 'adj';
  if (isEvocativePos && hasCleanGloss(entry) && word.length >= 6) return 8;
  return 5;
}

export function toLexiconRow(entry: KaikkiEntry): LexiconRow | null {
  if (!entry.pos || !KEEP_POS.has(entry.pos)) return null;
  if (entry.lang_code && entry.lang_code !== LANG_CODE) return null;

  const tags = allTags(entry);
  if (tags.some((t) => BANNED_TAGS.has(t))) return null;

  const rawWord = entry.word || '';
  if (!VALID_WORD_RE.test(rawWord)) return null; // non-alphabetic / spaces / multi-word
  if (rawWord.length <= 2) return null;

  const word = rawWord.toLowerCase();
  const syllables = countWordSyllables(word, LANG_CODE);
  const stressType = classifyWordStress(word, LANG_CODE);
  const keys = getWordRhymeKey(word, LANG_CODE);
  if (!syllables || !stressType || !keys?.consonant) return null; // couldn't analyze — skip rather than seed garbage

  return {
    word,
    lang_code: LANG_CODE,
    syllables,
    stress_type: stressType,
    rhyme_key: keys.consonant.slice(0, 20), // column is varchar(20)
    rhyme_key_assonant: keys.assonant ? keys.assonant.slice(0, 20) : null,
    charisma_score: estimateCharisma(entry, word),
    tags: [entry.pos as string],
  };
}

function dedupeBatch(rows: LexiconRow[]): LexiconRow[] {
  const byKey = new Map<string, LexiconRow>();
  for (const row of rows) byKey.set(`${row.word} ${row.lang_code}`, row);
  return [...byKey.values()];
}

async function upsertBatch(supabase: SupabaseClient, rows: LexiconRow[]): Promise<void> {
  const deduped = dedupeBatch(rows);
  const { error } = await supabase.from('lexicon').upsert(deduped, { onConflict: 'word,lang_code' });
  if (error) {
    throw new Error(
      `Upsert failed for a batch of ${deduped.length} rows: ${error.message}\n` +
      'Most likely cause: the service-role key is wrong/missing, or rhyme_key_assonant doesn\'t exist yet (run supabase/migration_lexicon_assonant.sql first).'
    );
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error(
      '\nMissing SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Add it to .env (Supabase Dashboard → Project Settings → API → service_role secret).\n'
    );
    process.exitCode = 1;
    return;
  }

  const supabase: SupabaseClient = createClient(SUPABASE_URL, serviceKey, { realtime: { transport: ws as never } });

  const { error: probeError } = await supabase.from('lexicon').select('id').limit(1);
  if (probeError) {
    console.error(`\nCouldn't query \`lexicon\`: ${probeError.message}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`Streaming ${KAIKKI_URL} ...`);
  const res = await fetch(KAIKKI_URL);
  if (!res.ok || !res.body) throw new Error(`Failed to fetch Kaikki dump: HTTP ${res.status}`);

  const rl = createInterface({ input: Readable.fromWeb(res.body as never) });

  let batch: LexiconRow[] = [];
  let seenLines = 0;
  let kept = 0;
  let upserted = 0;

  for await (const line of rl) {
    if (!line) continue;
    seenLines++;
    let entry: KaikkiEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const row = toLexiconRow(entry);
    if (!row) continue;
    kept++;
    batch.push(row);

    if (batch.length >= BATCH_SIZE) {
      await upsertBatch(supabase, batch);
      upserted += batch.length;
      console.log(`  scanned ${seenLines} entries, kept ${kept}, upserted ${upserted}`);
      batch = [];
    }
  }

  if (batch.length) {
    await upsertBatch(supabase, batch);
    upserted += batch.length;
  }

  console.log(`\nDone. Scanned ${seenLines} Kaikki entries, kept ${kept}, upserted ${upserted} rows into lexicon (lang_code: ca).`);
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err) => {
    console.error('\nCatalan seed script failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
