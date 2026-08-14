#!/usr/bin/env node
// ─── Cultural Resonance Engine — assonant rhyme key backfill ───────────────
// `lexicon` originally only stored the consonant rhyme_key. WORD_BANK needs
// to serve real "rima asonante" lookups too (a real rhyme dictionary
// distinguishes both), so this backfills a second column
// (rhyme_key_assonant) across the existing ~735K rows.
//
// Deliberately does NOT re-stream the 1GB Kaikki dump or re-download any
// frequency corpus — the assonant key is derived straight from the
// already-stored `word` column via our own rhyme.js (the same algorithm
// the live app uses, same reasoning as the consonant key already stored),
// so this only ever needs to paginate the existing table and write one
// column back.
//
// Requires:
//   - supabase/migration_lexicon_assonant.sql already run once in the
//     Supabase SQL editor (this script only ever does DML — it cannot add
//     the column itself).
//   - SUPABASE_SERVICE_ROLE_KEY in .env (same requirement as every other
//     script here — the anon key cannot write to `lexicon`, by design).
//
// Usage: npm run backfill:assonant   (or: tsx scripts/backfill-assonant-key.ts)

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// Same Node-20-has-no-native-WebSocket workaround as every other script
// here — supabase-js always constructs a realtime client even for plain
// REST calls.
import ws from 'ws';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getWordRhymeKey } from '../src/utils/rhyme.js';
import { SUPABASE_URL } from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PAGE_SIZE = 1000;
const LANG_CODE = 'es';

interface LexiconRow {
  id: number;
  word: string;
  lang_code: string;
  syllables: number;
  stress_type: string | null;
  rhyme_key: string;
  charisma_score: number;
  freq_rank: number | null;
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

export function computeAssonantKey(word: string): string | null {
  const key = getWordRhymeKey(word, LANG_CODE);
  return key?.assonant ? key.assonant.slice(0, 20) : null;
}

async function processPage(supabase: SupabaseClient, rows: LexiconRow[]): Promise<void> {
  const updated = rows.map((row) => ({
    word: row.word,
    lang_code: row.lang_code,
    syllables: row.syllables,
    stress_type: row.stress_type,
    rhyme_key: row.rhyme_key,
    rhyme_key_assonant: computeAssonantKey(row.word),
    charisma_score: row.charisma_score,
    freq_rank: row.freq_rank,
    tags: row.tags,
  }));
  const { error } = await supabase.from('lexicon').upsert(updated, { onConflict: 'word,lang_code' });
  if (error) throw new Error(`Update failed for a page of ${updated.length} rows: ${error.message}`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error('\nMissing SUPABASE_SERVICE_ROLE_KEY in .env — same requirement as the other scripts here.\n');
    process.exitCode = 1;
    return;
  }
  const supabase: SupabaseClient = createClient(SUPABASE_URL, serviceKey, { realtime: { transport: ws as never } });

  // Fail fast with a clear message if the column doesn't exist yet.
  const { error: probeError } = await supabase.from('lexicon').select('rhyme_key_assonant').limit(1);
  if (probeError) {
    console.error(
      `\nCouldn't query \`lexicon.rhyme_key_assonant\`: ${probeError.message}\n` +
      'Run supabase/migration_lexicon_assonant.sql in the Supabase SQL editor first, then re-run this script.\n'
    );
    process.exitCode = 1;
    return;
  }

  const { count, error: countError } = await supabase.from('lexicon').select('*', { count: 'exact', head: true });
  if (countError) throw new Error(`Couldn't count lexicon rows: ${countError.message}`);
  console.log(`Backfilling rhyme_key_assonant for ${count} existing lexicon rows...`);

  let processed = 0;
  for (let offset = 0; offset < (count || 0); offset += PAGE_SIZE) {
    const { data: rows, error } = await supabase
      .from('lexicon')
      .select('id, word, lang_code, syllables, stress_type, rhyme_key, charisma_score, freq_rank, tags')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to fetch page at offset ${offset}: ${error.message}`);
    if (!rows || !rows.length) break;

    await processPage(supabase, rows as LexiconRow[]);
    processed += rows.length;
    console.log(`  processed ${processed}/${count}`);
  }

  console.log(`\nDone. Backfilled rhyme_key_assonant for ${processed} rows.`);
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err) => {
    console.error('\nbackfill-assonant-key failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
