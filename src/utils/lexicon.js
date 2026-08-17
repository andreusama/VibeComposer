// ─── Lexicon data layer — Cultural Resonance Engine ─────────────────────────
// Deterministic SQL rhyme lookups against the `lexicon` table (supabase/
// migration_lexicon.sql, populated by scripts/seed-lexicon-kaikki.ts). This file
// does exactly one thing on purpose: query real, pre-computed rhyme data.
// No LLM call, no phonetic calculation of its own — the entire point of
// this engine is that the model is never asked to invent or judge rhymes
// itself; it only ever receives a word this module already verified rhymes,
// via the same rhyme_key algorithm rhyme.js's own live matching uses.
//
// Lives in utils/ (not canvas/) despite being Supabase-backed like
// canvas/museData.js — `lexicon` is global reference data, not scoped to
// any song/section, and it's consumed from utils/museApi.js; canvas/*
// files import FROM utils/*, never the other way, so this needed to sit
// here to keep that layering direction intact.

import { supabase } from './supabaseClient.js';

const DEFAULT_MIN_CHARISMA = 7;
const DEFAULT_LIMIT = 6;

// High-charisma rhyme candidates for a given rhyme_key — the DB Query step
// of the pipeline (see museApi.js's buildCulturalResonance). Returns an
// empty array (not an error) when nothing qualifies — that's the expected,
// designed trigger for the graceful-degrade fallback, not a failure state.
export async function queryRhymeCandidates({
  rhymeKey, lang = 'es', minCharisma = DEFAULT_MIN_CHARISMA, exclude = [], limit = DEFAULT_LIMIT,
}) {
  if (!rhymeKey) return { data: [], error: null };

  let query = supabase
    .from('lexicon')
    .select('word, syllables, stress_type, charisma_score, tags')
    .eq('lang_code', lang)
    .eq('rhyme_key', rhymeKey)
    .gte('charisma_score', minCharisma)
    .order('charisma_score', { ascending: false })
    .limit(limit);

  if (exclude.length) {
    // PostgREST's `not.in` filter — words already used this session
    // (session_angles_history territory, but at the word level) don't come
    // back around as "new" candidates on a regenerate.
    query = query.not('word', 'in', `(${exclude.map((w) => `"${w}"`).join(',')})`);
  }

  const { data, error } = await query;
  return { data: data || [], error };
}

// WORD_BANK's actual content — a real rhyme dictionary, not a curated
// top-N: every real word matching the rhyme (consonant OR assonant, the
// caller picks), optionally narrowed by a letter constraint the user
// explicitly asked for, sorted common-and-cool-first rather than by raw
// charisma_score alone. This matters: charisma_score's own rarity
// component actively rewards obscurity and penalizes common words ("de"
// scores 1, "el" scores 2), so sorting a WORD BANK by it would bury
// exactly the familiar, practical, singable words a songwriter usually
// wants to see first. No hard charisma floor either, unlike
// queryRhymeCandidates — a dictionary that silently hides real rhymes
// because they scored low would defeat the point of "literally all the
// words that match."
const WORD_BANK_DISPLAY_LIMIT = 200; // "a lot of words if there is" — generous, but bounded for payload/render sanity
const WORD_BANK_FETCH_CAP = 2000; // safety cap on the raw fetch, before the common-and-cool sort below picks the best DISPLAY_LIMIT of them
const COMMON_FREQ_RANK_CEILING = 100000; // "common" tier — within the top 100k of a real ~1.2M-word frequency corpus

export async function queryWordBank({
  rhymeKey = null, rhymeType = 'consonante', lang = 'es', letterFilter = null, exclude = [], limit = WORD_BANK_DISPLAY_LIMIT,
}) {
  const column = rhymeType === 'asonante' ? 'rhyme_key_assonant' : 'rhyme_key';

  let query = supabase
    .from('lexicon')
    .select('word, syllables, stress_type, charisma_score, freq_rank')
    .eq('lang_code', lang)
    .order('charisma_score', { ascending: false }) // defensive pre-sort only, in case WORD_BANK_FETCH_CAP is ever actually hit — the real ordering happens in JS below
    .limit(WORD_BANK_FETCH_CAP);

  // rhymeKey is optional now — a request can be pure letter-filter, or (see
  // museApi.js's buildWordBankFromLexicon) combined with a concept filter
  // applied after this query on the candidate pool it returns. With NEITHER
  // rhyme NOR letter filter — e.g. a plain "dame palabras carismáticas"
  // with no other qualifier — this still returns a bounded common-and-
  // cool-first pool (via WORD_BANK_FETCH_CAP) rather than nothing: that IS
  // the correct, honest answer to "just give me your best words," not a
  // fallback standing in for something more specific.
  if (rhymeKey) query = query.eq(column, rhymeKey);

  // letterFilter.type is one of 'starts_with' | 'contains_chain' |
  // 'contains_letters' — the natural-language request the muse parsed
  // (see museApi.js's parseWordBank). 'contains_letters' means each
  // character must appear SOMEWHERE in the word (not necessarily
  // contiguous, not necessarily in order) — distinct from
  // 'contains_chain', an exact substring.
  if (letterFilter?.type === 'starts_with' && letterFilter.value) {
    query = query.ilike('word', `${letterFilter.value}%`);
  } else if (letterFilter?.type === 'contains_chain' && letterFilter.value) {
    query = query.ilike('word', `%${letterFilter.value}%`);
  } else if (letterFilter?.type === 'contains_letters' && letterFilter.value) {
    for (const ch of letterFilter.value) {
      query = query.ilike('word', `%${ch}%`);
    }
  }

  if (exclude.length) {
    query = query.not('word', 'in', `(${exclude.map((w) => `"${w}"`).join(',')})`);
  }

  const { data, error } = await query;
  if (error || !data) return { data: [], error };

  return { data: sortCommonAndCoolFirst(data).slice(0, limit), error: null };
}

// Shared by queryWordBank and verifyWordsInLexicon (below) — "common and
// cool first" rather than raw charisma_score DESC, since charisma's own
// rarity component actively rewards obscurity/penalizes common words (see
// queryWordBank's own comment above).
export function sortCommonAndCoolFirst(rows) {
  return [...rows].sort((a, b) => {
    const aCommon = a.freq_rank != null && a.freq_rank <= COMMON_FREQ_RANK_CEILING;
    const bCommon = b.freq_rank != null && b.freq_rank <= COMMON_FREQ_RANK_CEILING;
    if (aCommon !== bCommon) return aCommon ? -1 : 1; // common tier always first
    if (b.charisma_score !== a.charisma_score) return b.charisma_score - a.charisma_score; // then coolest-first within a tier
    return (a.freq_rank ?? Infinity) - (b.freq_rank ?? Infinity); // then most-familiar-first as the final tiebreak
  });
}

// Existence/metadata check for a small set of LLM-proposed words (see
// museApi.js's proposeConceptWords) — the "verify" half of a propose→verify
// pipeline used ONLY for concept-only WORD_BANK requests (no rhyme, no
// letter filter to anchor a deterministic candidate pool to). Words the LLM
// proposed that aren't real entries here are silently dropped by the `.in`
// filter itself — there's nothing to reject, they just don't come back.
export async function verifyWordsInLexicon({ words = [], lang = 'es' }) {
  if (!words.length) return { data: [], error: null };
  const { data, error } = await supabase
    .from('lexicon')
    .select('word, syllables, stress_type, charisma_score, freq_rank')
    .eq('lang_code', lang)
    .in('word', words);
  if (error || !data) return { data: [], error };
  return { data: sortCommonAndCoolFirst(data), error: null };
}
