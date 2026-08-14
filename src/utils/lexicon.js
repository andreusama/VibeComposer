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
