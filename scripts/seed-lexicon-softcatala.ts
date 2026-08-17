#!/usr/bin/env node
// ─── Cultural Resonance Engine — Catalan lexicon seed script (Softcatalà) ──
// Replaces the earlier Kaikki-based Catalan seed (scripts/seed-lexicon-
// kaikki-catalan.ts, retired) — Kaikki's Catalan Wiktionary extract was
// comparatively small (189,604 word forms → 181,291 kept rows) and its own
// coverage gaps (e.g. common words like "amor" missing entirely) motivated
// looking for something more complete.
//
// Source: Softcatalà (github.com/Softcatala/catalan-dict-tools, LGPL 2.1 /
// GPL 2.0), the word list backing Catalan spell-checkers — maintained by
// the reference open-source org for Catalan language tooling.
// huggingface.co/datasets/softcatala/catalan-dictionary — 1,219,652
// form/lemma/pos_tag rows. Verified live before writing this (downloaded
// and inspected the real file, not assumed from the README alone): space-
// delimited, no header, 3 columns, e.g. "cantaré cantar VMIF1S00".
//
// Pipeline:
//   1. Download data.zip (~6.3MB compressed, 37MB uncompressed — small
//      enough to hold fully in memory, unlike Kaikki's ~1GB/212MB dumps
//      which needed line-by-line streaming) and unzip it (shells out to
//      the system `unzip`) into scripts/.cache/, reused on later runs
//      instead of re-downloading every time.
//   2. Parse each line: "form lemma pos_tag" (space-delimited).
//   3. Filter:
//      - pos_tag must start with NC (common noun — NOT NP, proper noun),
//        AQ/AO (adjective), or VM (main verb) — the Freeling tagset
//        Softcatalà uses (see the dataset's own tagset.md), same noun/
//        verb/adj scope every other seed script in this project uses.
//      - Word must match the Catalan letter whitelist (à/è/é/í/ï/ò/ó/ú/ü/ç)
//        — no hyphens, apostrophes, digits, or foreign scripts. Verified
//        live that this correctly drops real junk in the file: elided-
//        pronoun fragments ("'m", "-el"), hyphenated compounds
//        ("cor-robat"), and transliterated foreign place names
//        ("Železnodorožnyj").
//      - length > 2.
//   4. DELIBERATELY does NOT restrict to form===lemma (i.e. does NOT drop
//      conjugated verb forms, plurals, feminine forms). Every kept form is
//      a real, independently rhymable Catalan word, and this app's own
//      stated mission for WORD_BANK is "literally all the words that match
//      the rhyme," not just dictionary headwords — confirmed 878,749
//      distinct valid words survive this filter (checked live before
//      writing the real seed), well above Kaikki's 181,291. Most of that
//      is real conjugated verb forms (Catalan verbs each contribute dozens
//      of forms) — that's completeness working as intended, not noise.
//      The tradeoff this creates — conjugations of the same verb can crowd
//      the TOP of a pure charisma_score ranking with no other filter
//      applied — is a real, known effect (observed with the Kaikki seed
//      too, just smaller-scale), but explicitly deprioritized for now.
//   5. Dedupe on the FORM itself (first occurrence in the file wins — a
//      form appearing under multiple lemma/pos readings, e.g. "casa" as
//      both the noun and a conjugation of "casar," only needs ONE lexicon
//      row; onConflict:'word,lang_code' couldn't handle a batch containing
//      the same word twice anyway, same reasoning as the Kaikki scripts'
//      dedupeBatch).
//   6. Reuse this app's OWN syllable counter + rhyme-key logic
//      (src/utils/syllables.js, src/utils/rhyme.js, lang:'ca' — the same
//      real Catalan phonetic rules SURGEON/ARCHITECT verification already
//      uses) for syllables/stress_type/rhyme_key/rhyme_key_assonant, both
//      computed in this single pass.
//   7. charisma_score: a rough length+POS placeholder only — real weighted
//      CoolScore comes from a separate `npm run coolscore -- ca` pass, same
//      two-phase pattern as every other language here. No gloss-quality
//      signal at all this time: Softcatalà's data has no glosses, and
//      that's an explicit, deliberate trade for far greater completeness.
//
// Requires: SUPABASE_SERVICE_ROLE_KEY in .env. The `unzip` command must be
// available on PATH (standard on Linux/macOS).
// Usage: npm run seed:lexicon:ca   (downloads/unzips the dictionary on first run, cached after)

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { countWordSyllables } from '../src/utils/syllables.js';
import { classifyWordStress, getWordRhymeKey } from '../src/utils/rhyme.js';
import { SUPABASE_URL } from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE_DIR = join(__dirname, '.cache');
const DICT_ZIP_PATH = join(CACHE_DIR, 'softcatala-data.zip');
const DICT_TXT_PATH = join(CACHE_DIR, 'diccionari.txt');
const DICT_ZIP_URL = 'https://huggingface.co/datasets/softcatala/catalan-dictionary/resolve/main/data.zip';

const LANG_CODE = 'ca';
const BATCH_SIZE = 1000;
const VALID_WORD_RE = /^[a-zàèéíïòóúüç]+$/i;

type Category = 'noun' | 'adj' | 'verb';

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

// Freeling tagset (dataset's own tagset.md): position 0-1 of pos_tag.
function posTagToCategory(tag: string): Category | null {
  if (tag.startsWith('NC')) return 'noun'; // NOT "NP" (proper noun) — deliberately excluded
  if (tag.startsWith('AQ') || tag.startsWith('AO')) return 'adj';
  if (tag.startsWith('VM')) return 'verb';
  return null;
}

// No gloss data available at all (unlike the Kaikki scripts) — a rough
// length+POS placeholder only, replaced by real weighted CoolScore in the
// separate recompute-coolscore.ts pass.
function estimateCharisma(category: Category, word: string): number {
  const isEvocativePos = category === 'noun' || category === 'adj';
  return isEvocativePos && word.length >= 6 ? 8 : 5;
}

export function toLexiconRow(line: string): LexiconRow | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const [rawForm, , rawTag] = parts;

  const category = posTagToCategory(rawTag);
  if (!category) return null;

  if (!VALID_WORD_RE.test(rawForm)) return null;
  if (rawForm.length <= 2) return null;

  const word = rawForm.toLowerCase();
  const syllables = countWordSyllables(word, LANG_CODE);
  const stressType = classifyWordStress(word, LANG_CODE);
  const keys = getWordRhymeKey(word, LANG_CODE);
  if (!syllables || !stressType || !keys?.consonant) return null;

  return {
    word,
    lang_code: LANG_CODE,
    syllables,
    stress_type: stressType,
    rhyme_key: keys.consonant.slice(0, 20),
    rhyme_key_assonant: keys.assonant ? keys.assonant.slice(0, 20) : null,
    charisma_score: estimateCharisma(category, word),
    tags: [category],
  };
}

async function ensureDictionaryFile(): Promise<string> {
  if (existsSync(DICT_TXT_PATH)) {
    console.log(`Using cached dictionary at ${DICT_TXT_PATH}`);
    return DICT_TXT_PATH;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`Downloading ${DICT_ZIP_URL} ...`);
  const res = await fetch(DICT_ZIP_URL);
  if (!res.ok) throw new Error(`Failed to download dictionary: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(DICT_ZIP_PATH, buf);
  console.log(`Unzipping into ${CACHE_DIR} ...`);
  execFileSync('unzip', ['-o', DICT_ZIP_PATH, '-d', CACHE_DIR]);
  if (!existsSync(DICT_TXT_PATH)) throw new Error(`Expected ${DICT_TXT_PATH} after unzip but it's missing.`);
  return DICT_TXT_PATH;
}

async function upsertBatch(supabase: SupabaseClient, rows: LexiconRow[]): Promise<void> {
  const { error } = await supabase.from('lexicon').upsert(rows, { onConflict: 'word,lang_code' });
  if (error) {
    throw new Error(
      `Upsert failed for a batch of ${rows.length} rows: ${error.message}\n` +
      'Most likely cause: the service-role key is wrong/missing, or rhyme_key_assonant doesn\'t exist yet.'
    );
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error('\nMissing SUPABASE_SERVICE_ROLE_KEY in .env.\n');
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

  const dictPath = await ensureDictionaryFile();

  console.log('Reading and parsing the dictionary file (in memory — 37MB, small enough)...');
  const lines = readFileSync(dictPath, 'utf8').split('\n');

  // Dedupe on the form itself — first occurrence wins, matches the file's
  // own effective ordering and the pattern every other seed script here
  // uses for the same reason (a batch can't upsert the same conflict key
  // twice).
  const byWord = new Map<string, LexiconRow>();
  let seenLines = 0;
  for (const line of lines) {
    if (!line) continue;
    seenLines++;
    const row = toLexiconRow(line);
    if (!row) continue;
    if (!byWord.has(row.word)) byWord.set(row.word, row);
  }
  const allRows = [...byWord.values()];
  console.log(`Scanned ${seenLines} lines, kept ${allRows.length} distinct valid words.`);

  let upserted = 0;
  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    await upsertBatch(supabase, batch);
    upserted += batch.length;
    if (upserted % 20000 < BATCH_SIZE) console.log(`  upserted ${upserted}/${allRows.length}`);
  }

  console.log(`\nDone. Upserted ${upserted} rows into lexicon (lang_code: ca, source: Softcatalà).`);
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err) => {
    console.error('\nSoftcatalà seed script failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
