import { describe, it, expect, vi, beforeEach } from 'vitest';

// api.js's checkAndIncrementLimit reads/writes localStorage, which doesn't
// exist under Vitest's default node environment — same stub pattern as
// baulProcessor.test.js, and for the same reason: these tests are about the
// muse's parsing/verification logic, not rate limiting.
vi.mock('./api.js', () => ({
  API_URL: '/api/claude',
  checkAndIncrementLimit: vi.fn(),
}));

// lexicon.js imports the real Supabase client (supabaseClient.js), which
// constructs a realtime client at module load time — that throws outright
// under Vitest's Node environment (no native WebSocket), same underlying
// issue scripts/seed-lexicon-kaikki.ts works around with the `ws` transport.
// These tests are about the muse's own prompt/parsing/verification logic,
// not the Cultural Resonance Engine's DB integration, so an empty-result
// stub (buildCulturalResonance's real, designed "no match" path) is the
// right fake here, not a real DB round-trip.
vi.mock('./lexicon.js', () => ({
  queryRhymeCandidates: vi.fn().mockResolvedValue({ data: [], error: null }),
  queryWordBank: vi.fn().mockResolvedValue({ data: [], error: null }),
  verifyWordsInLexicon: vi.fn().mockResolvedValue({ data: [], error: null }),
}));

import {
  askMuse, parseCompanionResponse, applyMuseVerification, selectDiverseSuggestions,
  calculateContextWeights, MUSE_ACTION_TYPES, MUSE_TYPES, MUSE_ANGLES,
  buildCulturalResonance, describeCulturalResonance, extractCulturalFrame,
  buildWordBankFromLexicon, filterWordBankByConcept, getCulturalProvocation,
  proposeConceptWords, guessConceptFromLine, getImageGenealogy,
} from './museApi.js';
import { queryRhymeCandidates, queryWordBank, verifyWordsInLexicon } from './lexicon.js';

function mockClaudeResponse(text) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text }] }),
  });
}

const SURGEON_JSON = {
  action_type: 'SURGEON',
  reasoning: 'Sustitución manteniendo la métrica.',
  targetLineText: 'El cielo se cae al suelo',
  isRhymeRequest: true,
  rhymeTargetWord: 'cielo',
  suggestions: [
    { text: 'Todo el mundo pierde el recelo', type: 'CONTINUITY', angle: 'raw' },
    { text: 'La ciudad entera duerme un rato', type: 'CONTRAST', angle: 'atmospheric' },
    { text: 'Nadie mas te espera en el camino', type: 'RESOLUTION', angle: 'abstract' },
  ],
  themes: ['miedo', 'ciudad'],
};

describe('parseCompanionResponse', () => {
  it('parses a SURGEON response with suggestions', () => {
    const result = parseCompanionResponse(JSON.stringify(SURGEON_JSON));
    expect(result.action_type).toBe('SURGEON');
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions[0]).toEqual({ text: 'Todo el mundo pierde el recelo', type: 'CONTINUITY', angle: 'raw' });
    expect(result.isRhymeRequest).toBe(true);
    expect(result.rhymeTargetWord).toBe('cielo');
    expect(result.themes).toEqual(['miedo', 'ciudad']);
  });

  it('parses an ARCHITECT response the same way as SURGEON', () => {
    const result = parseCompanionResponse(JSON.stringify({ ...SURGEON_JSON, action_type: 'ARCHITECT' }));
    expect(result.action_type).toBe('ARCHITECT');
    expect(result.suggestions).toHaveLength(3);
  });

  it('parses a SOCRATIC response', () => {
    const raw = JSON.stringify({
      action_type: 'SOCRATIC',
      reasoning: 'La nota tiene dos líneas y no está claro a cuál se refiere.',
      question: { text: '¿A qué línea te refieres?', options: ['La primera', 'La segunda'] },
      themes: [],
    });
    const result = parseCompanionResponse(raw);
    expect(result.action_type).toBe('SOCRATIC');
    expect(result.question).toEqual({ text: '¿A qué línea te refieres?', options: ['La primera', 'La segunda'] });
    expect(result.suggestions).toEqual([]);
  });

  it('parses a WORD_BANK response as a request to look up — never a model-invented word list', () => {
    const raw = JSON.stringify({
      action_type: 'WORD_BANK',
      target_rhyme: 'cielo',
      rhyme_type: 'asonante',
      letter_filter: { type: 'starts_with', value: 'D' },
      concept: 'volar',
      themes: [],
    });
    const result = parseCompanionResponse(raw);
    expect(result.action_type).toBe('WORD_BANK');
    expect(result.wordBank.targetRhyme).toBe('cielo');
    expect(result.wordBank.rhymeType).toBe('asonante');
    expect(result.wordBank.letterFilter).toEqual({ type: 'starts_with', value: 'd' });
    expect(result.wordBank.concept).toBe('volar');
    // Always starts empty — only buildWordBankFromLexicon (a real DB
    // query) is allowed to populate this, never the model's own output.
    expect(result.wordBank.wordGroups).toEqual([]);
  });

  it('ignores a malformed or missing letter_filter rather than throwing', () => {
    const raw = JSON.stringify({
      action_type: 'WORD_BANK', target_rhyme: 'cielo', rhyme_type: 'consonante',
      letter_filter: { type: 'not_a_real_type', value: 'x' }, themes: [],
    });
    expect(parseCompanionResponse(raw).wordBank.letterFilter).toBeNull();

    const rawNoFilter = JSON.stringify({ action_type: 'WORD_BANK', target_rhyme: 'cielo', rhyme_type: 'consonante', themes: [] });
    expect(parseCompanionResponse(rawNoFilter).wordBank.letterFilter).toBeNull();
  });

  it('parses WORD_BANK requests with no rhyme at all — rhyme is optional now', () => {
    const raw = JSON.stringify({
      action_type: 'WORD_BANK', target_rhyme: null, rhyme_type: 'consonante',
      letter_filter: { type: 'contains_chain', value: 'ala' }, concept: 'volar', themes: [],
    });
    const result = parseCompanionResponse(raw);
    expect(result.wordBank.targetRhyme).toBe('');
    expect(result.wordBank.letterFilter).toEqual({ type: 'contains_chain', value: 'ala' });
    expect(result.wordBank.concept).toBe('volar');
  });

  it('defaults concept to null when the model doesn\'t report one', () => {
    const raw = JSON.stringify({ action_type: 'WORD_BANK', target_rhyme: 'cielo', rhyme_type: 'consonante', themes: [] });
    expect(parseCompanionResponse(raw).wordBank.concept).toBeNull();
  });

  it('parses a normal (non-declined) OPEN_REFERENCE response', () => {
    const raw = JSON.stringify({
      action_type: 'OPEN_REFERENCE',
      answer: 'Benidorm — un skyline de rascacielos de los 60 en primera línea de playa.',
      category: 'place',
      declined: false,
      redirect: null,
      themes: ['lugar', 'ambición'],
    });
    const result = parseCompanionResponse(raw);
    expect(result.action_type).toBe('OPEN_REFERENCE');
    expect(result.openReference.declined).toBe(false);
    expect(result.openReference.answer).toMatch(/Benidorm/);
    expect(result.openReference.category).toBe('place');
    expect(result.openReference.redirect).toBeNull();
    // message carries the answer for non-declined turns — this is what
    // satisfies the shared hasContent guard, same field every other mode
    // uses (SOCRATIC's question.text, SURGEON's reasoning, etc.).
    expect(result.message).toMatch(/Benidorm/);
  });

  it('parses a declined OPEN_REFERENCE response — answer/category null, redirect preserved, and it does NOT fall back as empty', () => {
    const raw = JSON.stringify({
      action_type: 'OPEN_REFERENCE',
      answer: null,
      category: null,
      declined: true,
      redirect: 'Soy política, como todo en este mundo — pero intento no contaminar tu mirada. ¿Qué tal un símbolo de esa misma tensión?',
      themes: [],
    });
    const result = parseCompanionResponse(raw);
    // The critical guard: a legitimate decline (answer: null by design)
    // must NOT trip the "empty response" fallback that malformed JSON
    // gets — that fallback forces action_type to SOCRATIC, which would
    // silently swallow every real decline as if it were a parse failure.
    expect(result.action_type).toBe('OPEN_REFERENCE');
    expect(result.openReference.declined).toBe(true);
    expect(result.openReference.answer).toBeNull();
    expect(result.openReference.category).toBeNull();
    expect(result.openReference.redirect).toMatch(/no contaminar tu mirada/);
    expect(result.message).toMatch(/no contaminar tu mirada/);
  });

  it('ignores an invalid category on a declined OPEN_REFERENCE response rather than trusting it', () => {
    const raw = JSON.stringify({
      action_type: 'OPEN_REFERENCE', answer: null, category: 'place', declined: true,
      redirect: 'Soy política — dame un símbolo en vez de una postura.', themes: [],
    });
    // category should never survive on a declined turn even if the model
    // sent one — there's no real answer for it to categorize.
    expect(parseCompanionResponse(raw).openReference.category).toBeNull();
  });

  it('recovers an OPEN_REFERENCE response even when the model drops "action_type" — real observed failure, exact payload', () => {
    // Verbatim from a real production console error: a genuinely correct,
    // well-formed OPEN_REFERENCE answer (Berlin Wall, declined: false) that
    // the model sent with every field present except action_type itself —
    // this used to discard the whole response and fall back to the broken-
    // JSON SOCRATIC placeholder even though the content was perfect.
    const raw = '{"answer": "El Muro de Berlín: hormigón gris de casi 4 metros, alambre de espino encima, franja de arena rastrillada para ver huellas, torres de vigilancia cada pocos metros, y del lado oeste kilómetros de grafitis de colores chillones cubriendo ese mismo gris.", "category": "place", "declined": false, "redirect": null}';
    const result = parseCompanionResponse(raw);
    expect(result.action_type).toBe('OPEN_REFERENCE');
    expect(result.openReference.declined).toBe(false);
    expect(result.openReference.answer).toMatch(/Muro de Berlín/);
    expect(result.openReference.category).toBe('place');
  });

  it('strips markdown code fences before parsing', () => {
    const fenced = '```json\n' + JSON.stringify(SURGEON_JSON) + '\n```';
    expect(parseCompanionResponse(fenced).action_type).toBe('SURGEON');
  });

  it('drops a suggestion missing a text field instead of throwing', () => {
    const raw = JSON.stringify({
      ...SURGEON_JSON,
      suggestions: [{ text: 'línea válida', type: 'CONTINUITY', angle: 'raw' }, { type: 'CONTRAST', angle: 'raw' }, 'una cadena suelta'],
    });
    const result = parseCompanionResponse(raw);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].text).toBe('línea válida');
  });

  it('falls back to a SOCRATIC shape on malformed JSON rather than throwing', () => {
    const result = parseCompanionResponse('esto no es json { roto');
    expect(result.action_type).toBe('SOCRATIC');
    expect(result.suggestions).toEqual([]);
  });

  it('falls back on a syntactically valid but functionally empty response', () => {
    const raw = JSON.stringify({ action_type: 'SURGEON', reasoning: '', suggestions: [], themes: [] });
    const result = parseCompanionResponse(raw);
    // Empty SURGEON content should be treated as a parse failure, not a
    // real (blank) success — same "don't save a blank bubble" guard as
    // baulProcessor's parseBaulResponse.
    expect(result.action_type).toBe('SOCRATIC');
  });

  it('falls back when action_type is missing or not one of the five modes', () => {
    const raw = JSON.stringify({ reasoning: 'sin action_type', suggestions: [] });
    expect(parseCompanionResponse(raw).action_type).toBe('SOCRATIC');
  });

  it('exports exactly the five documented action types', () => {
    expect(MUSE_ACTION_TYPES).toEqual(['SURGEON', 'ARCHITECT', 'SOCRATIC', 'WORD_BANK', 'OPEN_REFERENCE']);
    expect(MUSE_TYPES).toEqual(['CONTINUITY', 'CONTRAST', 'RESOLUTION']);
    expect(MUSE_ANGLES).toEqual(['raw', 'atmospheric', 'abstract']);
  });
});

describe('selectDiverseSuggestions', () => {
  it('keeps one suggestion per type, in first-seen order', () => {
    const suggestions = [
      { text: 'a', type: 'CONTINUITY' },
      { text: 'b', type: 'CONTINUITY' },
      { text: 'c', type: 'CONTRAST' },
      { text: 'd', type: 'RESOLUTION' },
      { text: 'e', type: 'RESOLUTION' },
    ];
    const result = selectDiverseSuggestions(suggestions, 3);
    expect(result.map((s) => s.text)).toEqual(['a', 'c', 'd']);
  });

  it('backfills from leftovers when fewer than `limit` distinct types survived', () => {
    const suggestions = [
      { text: 'a', type: 'CONTINUITY' },
      { text: 'b', type: 'CONTINUITY' },
      { text: 'c', type: 'CONTINUITY' },
    ];
    const result = selectDiverseSuggestions(suggestions, 3);
    // Only one distinct type exists, but the pool shouldn't shrink below
    // what's actually available just because they all share a type.
    expect(result).toHaveLength(3);
  });

  it('treats untyped (null type) suggestions as backfill material, never as a distinct type', () => {
    const suggestions = [
      { text: 'a', type: null }, { text: 'b', type: null }, { text: 'c', type: 'CONTRAST' },
    ];
    const result = selectDiverseSuggestions(suggestions, 3);
    expect(result).toHaveLength(3);
  });
});

describe('applyMuseVerification — SURGEON/ARCHITECT', () => {
  const baseCtx = { verseText: 'El cielo se cae al suelo\nY nadie sabe donde ir', lang: 'es', dialect: 'central' };

  it('narrows to suggestions within ±2 syllables of the target line', () => {
    const parsed = {
      action_type: 'SURGEON',
      targetLineText: 'casa', // 2 syllables
      isRhymeRequest: false, rhymeTargetWord: null,
      suggestions: [
        { text: 'mesa', type: 'CONTINUITY', angle: 'raw' }, // 2 syllables — survives
        { text: 'television', type: 'CONTRAST', angle: 'raw' }, // 4 syllables — within ±2, survives
        { text: 'universidad', type: 'RESOLUTION', angle: 'raw' }, // 5 syllables — filtered out
      ],
    };
    applyMuseVerification(parsed, { ...baseCtx, verseText: 'casa' });
    const texts = parsed.suggestions.map((s) => s.text);
    expect(texts).toContain('mesa');
    expect(texts).toContain('television');
    expect(texts).not.toContain('universidad');
  });

  it('falls back to the unfiltered pool if the metric filter would empty it', () => {
    const parsed = {
      action_type: 'ARCHITECT',
      targetLineText: 'casa',
      isRhymeRequest: false, rhymeTargetWord: null,
      suggestions: [{ text: 'universidad', type: 'CONTINUITY', angle: 'raw' }],
    };
    applyMuseVerification(parsed, { ...baseCtx, verseText: 'casa' });
    // Nothing passed the metric filter, so the original (only) candidate
    // survives rather than the list going to zero.
    expect(parsed.suggestions).toHaveLength(1);
  });

  it('drops a suggestion that reuses a content word already used once elsewhere in the note', () => {
    const parsed = {
      action_type: 'ARCHITECT',
      targetLineText: null,
      isRhymeRequest: false, rhymeTargetWord: null,
      suggestions: [
        { text: 'Vuelvo a cruzar la misma calle', type: 'CONTINUITY', angle: 'raw' }, // reuses "calle"
        { text: 'Miro el reloj y sigo esperando', type: 'CONTRAST', angle: 'raw' }, // fresh vocabulary
      ],
    };
    applyMuseVerification(parsed, { ...baseCtx, verseText: 'Camino solo por la calle vacía\nY nadie sabe donde ir' });
    const texts = parsed.suggestions.map((s) => s.text);
    expect(texts).not.toContain('Vuelvo a cruzar la misma calle');
    expect(texts).toContain('Miro el reloj y sigo esperando');
  });

  it('does NOT ban a word that already repeats 2+ times — a deliberate motif, not accidental reuse', () => {
    // "arte" appears twice already in the note (the exact real case this
    // rule exists for — see project memory / the pre-chorus screenshot).
    const parsed = {
      action_type: 'ARCHITECT',
      targetLineText: null,
      isRhymeRequest: false, rhymeTargetWord: null,
      suggestions: [{ text: 'Y sigo con ese arte que me parte', type: 'CONTINUITY', angle: 'raw' }],
    };
    applyMuseVerification(parsed, {
      ...baseCtx,
      verseText: 'Tu con ese arte arte\nDeja de preocuparte que tu con ese arte',
    });
    expect(parsed.suggestions.map((s) => s.text)).toContain('Y sigo con ese arte que me parte');
  });

  it('does not count the line being replaced against its own replacement', () => {
    const parsed = {
      action_type: 'SURGEON',
      targetLineText: 'Camino solo por la calle vacía',
      isRhymeRequest: false, rhymeTargetWord: null,
      suggestions: [{ text: 'Otra vez por la misma calle', type: 'CONTINUITY', angle: 'raw' }],
    };
    // "calle" only appears in the line being replaced itself, not in any
    // OTHER line — so reusing it isn't a violation.
    applyMuseVerification(parsed, { ...baseCtx, verseText: 'Camino solo por la calle vacía\nY nadie sabe donde ir' });
    expect(parsed.suggestions.map((s) => s.text)).toContain('Otra vez por la misma calle');
  });

  it('drops a suggestion whose ending genuinely does not rhyme (verified via rhyme.js, not guessed)', () => {
    const parsed = {
      action_type: 'SURGEON',
      targetLineText: null,
      isRhymeRequest: true, rhymeTargetWord: 'cielo',
      suggestions: [
        { text: 'Todo el mundo pierde el recelo', type: 'CONTINUITY', angle: 'raw' }, // consonant match
        { text: 'Nadie mas te espera en el camino', type: 'CONTRAST', angle: 'raw' }, // no match at all
      ],
    };
    applyMuseVerification(parsed, baseCtx);
    const texts = parsed.suggestions.map((s) => s.text);
    expect(texts).toContain('Todo el mundo pierde el recelo');
    expect(texts).not.toContain('Nadie mas te espera en el camino');
    expect(parsed.rhymeVerified).toBe(true);
  });

  it('accepts an assonant-only match as a real rhyme — rhyme.js allows either type, this is correct, not a bug', () => {
    // "credo" shares cielo's assonant key (e-o) but not its consonant key
    // (edo vs elo) — a real Spanish rima asonante, not a mistake.
    const parsed = {
      action_type: 'SURGEON',
      targetLineText: null,
      isRhymeRequest: true, rhymeTargetWord: 'cielo',
      suggestions: [{ text: 'Los planetas ya no tienen credo', type: 'CONTINUITY', angle: 'raw' }],
    };
    applyMuseVerification(parsed, baseCtx);
    expect(parsed.suggestions.map((s) => s.text)).toContain('Los planetas ya no tienen credo');
  });

  it('leaves rhyme unverified (no filtering) when isRhymeRequest is false, even if rhymeTargetWord is set', () => {
    // Documents the actual current gap: the rhyme filter is entirely
    // opt-in via isRhymeRequest, so a follow-up turn where the model
    // forgets to re-flag it lets anything through untouched.
    const parsed = {
      action_type: 'SURGEON',
      targetLineText: null,
      isRhymeRequest: false, rhymeTargetWord: 'cielo',
      suggestions: [{ text: 'Nadie mas te espera en el camino', type: 'CONTINUITY', angle: 'raw' }],
    };
    applyMuseVerification(parsed, baseCtx);
    expect(parsed.suggestions).toHaveLength(1);
    expect(parsed.rhymeVerified).toBeUndefined();
  });

  it('caps the final suggestions at 6, one per narrative type first', () => {
    // Cap raised from 3 to 6 so mobile's swipe deck has a local pool (3
    // shown + 3 held as swipe-left replacements, no network round-trip —
    // see museApi.js's applyMuseVerification comment). 7 candidates here
    // so the cap boundary is actually exercised, not just "all survive."
    const parsed = {
      action_type: 'ARCHITECT',
      targetLineText: null,
      isRhymeRequest: false, rhymeTargetWord: null,
      suggestions: [
        { text: 'uno', type: 'CONTINUITY', angle: 'raw' },
        { text: 'dos', type: 'CONTINUITY', angle: 'atmospheric' },
        { text: 'tres', type: 'CONTRAST', angle: 'raw' },
        { text: 'cuatro', type: 'RESOLUTION', angle: 'raw' },
        { text: 'cinco', type: 'RESOLUTION', angle: 'abstract' },
        { text: 'seis', type: 'CONTINUITY', angle: 'abstract' },
        { text: 'siete', type: 'CONTRAST', angle: 'atmospheric' },
      ],
    };
    applyMuseVerification(parsed, baseCtx);
    expect(parsed.suggestions).toHaveLength(6);
    expect(new Set(parsed.suggestions.map((s) => s.type)).size).toBe(3);
  });
});

describe('applyMuseVerification — WORD_BANK is explicitly a no-op', () => {
  it('leaves parsed.wordBank untouched — buildWordBankFromLexicon owns this now, not verification', () => {
    const wordBank = { targetRhyme: 'cielo', rhymeType: 'asonante', letterFilter: null, wordGroups: [] };
    const parsed = { action_type: 'WORD_BANK', wordBank };
    applyMuseVerification(parsed, { verseText: 'texto', lang: 'es', dialect: 'central' });
    expect(parsed.wordBank).toBe(wordBank); // same reference, nothing mutated
  });
});

describe('buildWordBankFromLexicon', () => {
  beforeEach(() => {
    queryWordBank.mockReset();
    queryWordBank.mockResolvedValue({ data: [], error: null });
    verifyWordsInLexicon.mockReset();
    verifyWordsInLexicon.mockResolvedValue({ data: [], error: null });
  });

  it('never trusts model-generated words — the list comes entirely from queryWordBank', async () => {
    queryWordBank.mockResolvedValue({
      data: [
        { word: 'duelo', syllables: 2, charisma_score: 6 },
        { word: 'recelo', syllables: 3, charisma_score: 5 },
      ],
      error: null,
    });
    const wordBank = { targetRhyme: 'cielo', rhymeType: 'asonante', letterFilter: null, wordGroups: [] };
    const result = await buildWordBankFromLexicon(wordBank, { verseText: 'texto', lang: 'es', dialect: 'central' });

    expect(queryWordBank).toHaveBeenCalledWith(expect.objectContaining({ rhymeType: 'asonante', lang: 'es' }));
    expect(result.wordGroups).toEqual([
      { syllables: 2, words: ['duelo'], shortPhrases: [] },
      { syllables: 3, words: ['recelo'], shortPhrases: [] },
    ]);
  });

  it('groups multiple words sharing a syllable count together, preserving query order', async () => {
    queryWordBank.mockResolvedValue({
      data: [
        { word: 'duelo', syllables: 2, charisma_score: 8 },
        { word: 'suelo', syllables: 2, charisma_score: 5 },
      ],
      error: null,
    });
    const wordBank = { targetRhyme: 'cielo', rhymeType: 'consonante', letterFilter: null, wordGroups: [] };
    const result = await buildWordBankFromLexicon(wordBank, { verseText: 'texto', lang: 'es', dialect: 'central' });
    expect(result.wordGroups).toEqual([{ syllables: 2, words: ['duelo', 'suelo'], shortPhrases: [] }]);
  });

  it('passes the letterFilter straight through to queryWordBank untouched', async () => {
    const letterFilter = { type: 'starts_with', value: 'd' };
    const wordBank = { targetRhyme: 'cielo', rhymeType: 'consonante', letterFilter, wordGroups: [] };
    await buildWordBankFromLexicon(wordBank, { verseText: 'texto', lang: 'es', dialect: 'central' });
    expect(queryWordBank).toHaveBeenCalledWith(expect.objectContaining({ letterFilter }));
  });

  it('excludes words already sitting in the note, same repetition principle as SURGEON/ARCHITECT', async () => {
    const wordBank = { targetRhyme: 'cielo', rhymeType: 'consonante', letterFilter: null, wordGroups: [] };
    await buildWordBankFromLexicon(wordBank, { verseText: 'Camino solo por la calle vacía', lang: 'es', dialect: 'central' });
    const callArg = queryWordBank.mock.calls[0][0];
    expect(callArg.exclude).toEqual(expect.arrayContaining(['camino', 'calle', 'vacía']));
  });

  it('is a real, honest empty result (not a fallback) when the lexicon has no matches — no group survives', async () => {
    const wordBank = { targetRhyme: 'cielo', rhymeType: 'consonante', letterFilter: null, wordGroups: [] };
    const result = await buildWordBankFromLexicon(wordBank, { verseText: 'texto', lang: 'es', dialect: 'central' });
    expect(result.wordGroups).toEqual([]);
    expect(queryWordBank).toHaveBeenCalled(); // a real query ran — this isn't a short-circuit
  });

  // Reported bug: "dame palabras carismáticas" (no rhyme/letters/concept at
  // all) used to short-circuit to an empty result — even though reaching
  // this function at all means the model already classified the turn as an
  // explicit vocabulary request. Now it runs the plain common-and-cool
  // query instead of nothing.
  it('runs the plain common-and-cool query (not a short-circuit) when rhyme, letter filter, AND concept are all absent', async () => {
    queryWordBank.mockResolvedValue({
      data: [{ word: 'carisma', syllables: 3, charisma_score: 9 }],
      error: null,
    });
    const wordBank = { targetRhyme: '', rhymeType: 'consonante', letterFilter: null, concept: null, wordGroups: [] };
    const result = await buildWordBankFromLexicon(wordBank, { verseText: 'texto', lang: 'es', dialect: 'central' });

    expect(queryWordBank).toHaveBeenCalledWith(expect.objectContaining({ rhymeKey: null, letterFilter: null }));
    expect(result.wordGroups).toEqual([{ syllables: 3, words: ['carisma'], shortPhrases: [] }]);
  });

  it('runs the query using only a letter filter when no rhyme was requested — the reported bug ("ala" with no rhyme target)', async () => {
    queryWordBank.mockResolvedValue({ data: [{ word: 'ala', syllables: 2, charisma_score: 5 }], error: null });
    const letterFilter = { type: 'contains_chain', value: 'ala' };
    const wordBank = { targetRhyme: '', rhymeType: 'consonante', letterFilter, concept: null, wordGroups: [] };
    const result = await buildWordBankFromLexicon(wordBank, { verseText: 'texto', lang: 'es', dialect: 'central' });

    expect(queryWordBank).toHaveBeenCalledWith(expect.objectContaining({ rhymeKey: null, letterFilter }));
    expect(result.wordGroups).toEqual([{ syllables: 2, words: ['ala'], shortPhrases: [] }]);
  });

  // Rewritten after a real reported bug: a concept-only request used to run
  // queryWordBank with no rhyme/letter filter at all — a "top N by
  // charisma across the whole 734k-word lexicon" pool that has NO real
  // relationship to any given concept, then filtered it with
  // filterWordBankByConcept. Live testing showed this surfacing as "a
  // random word family" completely unrelated to what was asked. The fix:
  // for concept-only, don't touch queryWordBank at all — propose real
  // words for the concept (LLM), then verify each is a real lexicon entry.
  it('proposes real words for a concept alone (no rhyme, no letter filter) and verifies them against the lexicon — never queries queryWordBank\'s blind top-charisma pool', async () => {
    verifyWordsInLexicon.mockResolvedValue({
      data: [{ word: 'alado', syllables: 3, charisma_score: 7, freq_rank: 50000 }],
      error: null,
    });
    mockClaudeResponse(JSON.stringify({ words: ['alado', 'volar'] }));
    const wordBank = { targetRhyme: '', rhymeType: 'consonante', letterFilter: null, concept: 'volar', wordGroups: [] };
    const result = await buildWordBankFromLexicon(wordBank, { verseText: 'texto', lang: 'es', dialect: 'central' });

    expect(queryWordBank).not.toHaveBeenCalled();
    expect(verifyWordsInLexicon).toHaveBeenCalledWith(expect.objectContaining({ words: ['alado', 'volar'], lang: 'es' }));
    expect(result.wordGroups).toEqual([{ syllables: 3, words: ['alado'], shortPhrases: [] }]);
    expect(result.conceptMatched).toBe(true);
  });

  it('an honest empty result (not a fallback to an irrelevant pool) when none of the proposed words verify', async () => {
    verifyWordsInLexicon.mockResolvedValue({ data: [], error: null });
    mockClaudeResponse(JSON.stringify({ words: ['palabraInventada'] }));
    const wordBank = { targetRhyme: '', rhymeType: 'consonante', letterFilter: null, concept: 'volar', wordGroups: [] };
    const result = await buildWordBankFromLexicon(wordBank, { verseText: 'texto', lang: 'es', dialect: 'central' });

    expect(result.wordGroups).toEqual([]);
    expect(result.conceptMatched).toBeUndefined();
    expect(queryWordBank).not.toHaveBeenCalled();
  });

  it('excludes words already in the note from a concept-only result too', async () => {
    verifyWordsInLexicon.mockResolvedValue({
      data: [
        { word: 'alado', syllables: 3, charisma_score: 7, freq_rank: 50000 },
        { word: 'camino', syllables: 3, charisma_score: 5, freq_rank: 200 },
      ],
      error: null,
    });
    mockClaudeResponse(JSON.stringify({ words: ['alado', 'camino'] }));
    const wordBank = { targetRhyme: '', rhymeType: 'consonante', letterFilter: null, concept: 'volar', wordGroups: [] };
    const result = await buildWordBankFromLexicon(wordBank, { verseText: 'Camino solo por la calle', lang: 'es', dialect: 'central' });

    expect(result.wordGroups).toEqual([{ syllables: 3, words: ['alado'], shortPhrases: [] }]);
  });

  it('falls back to the unfiltered deterministic pool when the concept filter finds nothing real — never a dead end', async () => {
    queryWordBank.mockResolvedValue({ data: [{ word: 'mesa', syllables: 2, charisma_score: 5 }], error: null });
    mockClaudeResponse(JSON.stringify({ words: [] }));
    const wordBank = { targetRhyme: 'cielo', rhymeType: 'consonante', letterFilter: null, concept: 'volar', wordGroups: [] };
    const result = await buildWordBankFromLexicon(wordBank, { verseText: 'texto', lang: 'es', dialect: 'central' });

    expect(result.wordGroups).toEqual([{ syllables: 2, words: ['mesa'], shortPhrases: [] }]);
    expect(result.conceptMatched).toBe(false);
  });

  it('does not run the concept filter at all when no concept was requested', async () => {
    queryWordBank.mockResolvedValue({ data: [{ word: 'duelo', syllables: 2, charisma_score: 6 }], error: null });
    const wordBank = { targetRhyme: 'cielo', rhymeType: 'consonante', letterFilter: null, concept: null, wordGroups: [] };
    const result = await buildWordBankFromLexicon(wordBank, { verseText: 'texto', lang: 'es', dialect: 'central' });

    expect(result.conceptMatched).toBeUndefined();
    expect(result.wordGroups).toEqual([{ syllables: 2, words: ['duelo'], shortPhrases: [] }]);
  });
});

describe('filterWordBankByConcept', () => {
  it('returns the candidate list untouched when there is no concept, and [] when there are no candidates', async () => {
    expect(await filterWordBankByConcept({ concept: null, candidateWords: ['ala', 'bala'] })).toEqual(['ala', 'bala']);
    expect(await filterWordBankByConcept({ concept: 'volar', candidateWords: [] })).toEqual([]);
  });

  it('only ever returns words that were actually in the candidate list — never invents new ones', async () => {
    mockClaudeResponse(JSON.stringify({ words: ['alado', 'palabra-inventada-fuera-de-la-lista'] }));
    const result = await filterWordBankByConcept({ concept: 'volar', candidateWords: ['alado', 'mesa', 'silla'] });
    expect(result).toEqual(['alado']);
  });

  it('degrades to an empty array (not a thrown error) when the call fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await filterWordBankByConcept({ concept: 'volar', candidateWords: ['alado'] });
    expect(result).toEqual([]);
  });
});

describe('proposeConceptWords', () => {
  it('returns [] without calling anything when there is no concept', async () => {
    expect(await proposeConceptWords({ concept: null })).toEqual([]);
  });

  it('lowercases and trims the model\'s proposed words', async () => {
    mockClaudeResponse(JSON.stringify({ words: [' Alado ', 'PLANEAR'] }));
    const result = await proposeConceptWords({ concept: 'volar' });
    expect(result).toEqual(['alado', 'planear']);
  });

  it('degrades to an empty array (not a thrown error) when the call fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await proposeConceptWords({ concept: 'volar' });
    expect(result).toEqual([]);
  });

  // Reported live: a real Claude response wrapped its JSON in a ```json
  // fence despite the "sin markdown" instruction, and JSON.parse(raw.trim())
  // crashed with "unexpected character at line 1 column 1" instead of
  // degrading gracefully. stripJsonFences (shared by every direct-JSON
  // helper in this file) fixes this — same regression matters for
  // extractCulturalFrame/getCulturalProvocation/getImageGenealogy/
  // filterWordBankByConcept too, all fixed the same way.
  it('parses a markdown-fenced response instead of crashing', async () => {
    mockClaudeResponse('```json\n' + JSON.stringify({ words: ['alado'] }) + '\n```');
    const result = await proposeConceptWords({ concept: 'volar' });
    expect(result).toEqual(['alado']);
  });
});

describe('calculateContextWeights', () => {
  it('computes char counts and percentages that sum close to 100%', () => {
    const w = calculateContextWeights('x'.repeat(1200), 'y'.repeat(1100), 'z'.repeat(360));
    expect(w.totalChars).toBe(2660);
    expect(w.museProfileAndSystem).toEqual({ charCount: 1200, percentage: '45%' });
    expect(w.localNodeAndLines).toEqual({ charCount: 1100, percentage: '41%' });
    expect(w.userIntent).toEqual({ charCount: 360, percentage: '14%' });
  });

  it('handles all-empty input without dividing by zero', () => {
    expect(calculateContextWeights('', '', '').totalChars).toBe(0);
  });
});

describe('askMuse (integration, mocked network)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sends the request with thinking disabled and runs verification on the result', async () => {
    mockClaudeResponse(JSON.stringify(SURGEON_JSON));

    const result = await askMuse({
      verseText: 'El cielo se cae al suelo',
      noteFunction: 'verse',
      blockProfile: '',
      userMessage: 'ayúdame a continuar esta línea',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.model).toBe('claude-sonnet-5');

    // Verification actually ran: "Nadie mas te espera en el camino" doesn't
    // rhyme with the request's own rhymeTargetWord and should be gone.
    expect(result.suggestions.map((s) => s.text)).not.toContain('Nadie mas te espera en el camino');
  });

  it('rejects an unknown action_type from parseCompanionResponse gracefully end-to-end', async () => {
    mockClaudeResponse('{ esto rompe el json');
    const result = await askMuse({
      verseText: 'texto', noteFunction: 'verse', blockProfile: '', userMessage: 'hola',
    });
    expect(result.action_type).toBe('SOCRATIC');
  });

  it('WORD_BANK end-to-end: the model only parses the request, real words come from the lexicon query', async () => {
    // vi.restoreAllMocks() above wipes the vi.mock() factory's default
    // resolved value for this describe block's tests — set explicitly here
    // rather than relying on it.
    queryWordBank.mockResolvedValue({
      data: [{ word: 'duelo', syllables: 2, charisma_score: 6 }, { word: 'recelo', syllables: 3, charisma_score: 5 }],
      error: null,
    });
    mockClaudeResponse(JSON.stringify({
      action_type: 'WORD_BANK', target_rhyme: 'cielo', rhyme_type: 'asonante',
      letter_filter: null, themes: [],
    }));

    const result = await askMuse({
      verseText: 'texto', noteFunction: 'verse', blockProfile: '', userMessage: 'dame rimas con cielo',
    });

    expect(result.action_type).toBe('WORD_BANK');
    // The real content came from the lexicon query, not anything the model
    // itself proposed (the mocked Claude response never mentioned these words).
    expect(result.wordBank.wordGroups).toEqual([
      { syllables: 2, words: ['duelo'], shortPhrases: [] },
      { syllables: 3, words: ['recelo'], shortPhrases: [] },
    ]);
    expect(queryWordBank).toHaveBeenCalledWith(expect.objectContaining({ rhymeType: 'asonante' }));
  });

  it('WORD_BANK concept filtering end-to-end: a rhyme-less "letters + concept" request runs a real lexicon query, then an LLM concept filter over real candidates — the reported "ala" + "volar" bug', async () => {
    queryWordBank.mockResolvedValue({
      data: [
        { word: 'alado', syllables: 3, charisma_score: 7 },
        { word: 'palabrota', syllables: 4, charisma_score: 5 },
      ],
      error: null,
    });
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: JSON.stringify({
          action_type: 'WORD_BANK', target_rhyme: null, rhyme_type: 'consonante',
          letter_filter: { type: 'contains_chain', value: 'ala' }, concept: 'volar', themes: [],
        }) }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ words: ['alado'] }) }] }),
      });

    const result = await askMuse({
      verseText: 'texto', noteFunction: 'verse', blockProfile: '',
      userMessage: 'dame todas las palabras que contengan "ala" y tengan que ver con volar',
    });

    expect(result.action_type).toBe('WORD_BANK');
    // Not empty (the reported dead end) and not the concept-irrelevant "palabrota" either.
    expect(result.wordBank.wordGroups).toEqual([{ syllables: 3, words: ['alado'], shortPhrases: [] }]);
    expect(result.wordBank.conceptMatched).toBe(true);
    expect(queryWordBank).toHaveBeenCalledWith(expect.objectContaining({
      rhymeKey: null, letterFilter: { type: 'contains_chain', value: 'ala' },
    }));
  });
});

describe('extractCulturalFrame', () => {
  it('rejects a hallucinated selection not present in the candidate list', async () => {
    mockClaudeResponse(JSON.stringify({ selectedWord: 'palabraInventada', frame: 'x', tropo: 'y' }));
    const result = await extractCulturalFrame({
      concept: 'caballo', candidateWords: ['soslayo', 'vasallo'], lyricDna: {},
    });
    expect(result).toBeNull();
  });

  it('returns null (not a thrown error) with an empty candidate list', async () => {
    const result = await extractCulturalFrame({ concept: 'caballo', candidateWords: [], lyricDna: {} });
    expect(result).toBeNull();
  });
});

describe('buildCulturalResonance', () => {
  beforeEach(() => {
    queryRhymeCandidates.mockReset();
    queryRhymeCandidates.mockResolvedValue({ data: [], error: null });
  });

  it('is disabled entirely for SURGEON — never even queries the lexicon', async () => {
    const result = await buildCulturalResonance({
      verseText: 'Cruzó la frontera a lomos de un caballo',
      targetVerse: null, lang: 'es', dialect: 'central', forceMode: 'SURGEON',
    });
    expect(result).toBeNull();
    expect(queryRhymeCandidates).not.toHaveBeenCalled();
  });

  it('is disabled entirely for WORD_BANK too — that mode is now a pure lexicon dictionary lookup, not a single-word selection', async () => {
    const result = await buildCulturalResonance({
      verseText: 'Cruzó la frontera a lomos de un caballo',
      targetVerse: null, lang: 'es', dialect: 'central', forceMode: 'WORD_BANK',
    });
    expect(result).toBeNull();
    expect(queryRhymeCandidates).not.toHaveBeenCalled();
  });

  it('degrades gracefully (reason: no_rhyme_match) when the lexicon has no high-charisma match', async () => {
    const result = await buildCulturalResonance({
      verseText: 'Cruzó la frontera a lomos de un caballo',
      targetVerse: null, lang: 'es', dialect: 'central', forceMode: null,
    });
    expect(result.enabled).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.reason).toBe('no_rhyme_match');
    expect(result.concept).toBe('caballo');
  });

  it('selects the model-chosen word (not just the top DB result) when real candidates exist', async () => {
    queryRhymeCandidates.mockResolvedValue({
      data: [{ word: 'soslayo' }, { word: 'vasallo' }, { word: 'desmayo' }],
      error: null,
    });
    mockClaudeResponse(JSON.stringify({ selectedWord: 'vasallo', frame: 'lealtad feudal', tropo: 'servir a un señor' }));

    const result = await buildCulturalResonance({
      verseText: 'Cruzó la frontera a lomos de un caballo',
      targetVerse: null, lang: 'es', dialect: 'central', forceMode: null,
      lyricDna: { vozPropia: { estiloVocabulario: 'crudo, callejero' } },
    });

    expect(result.enabled).toBe(true);
    expect(result.mandatoryWord).toBe('vasallo');
    expect(result.culturalFrame).toBe('lealtad feudal');
    expect(result.reason).toBeNull();

    const userPrompt = JSON.parse(fetch.mock.calls[0][1].body).messages[0].content;
    expect(userPrompt).toContain('crudo, callejero');
  });

  it('degrades (reason: no_voice_fit) when real candidates exist but none fit the artist voice', async () => {
    queryRhymeCandidates.mockResolvedValue({
      data: [{ word: 'tiwanacota' }, { word: 'idiota' }],
      error: null,
    });
    mockClaudeResponse(JSON.stringify({ selectedWord: null, frame: null, tropo: null }));

    const result = await buildCulturalResonance({
      verseText: 'Como piedra tiwanacota resisto',
      targetVerse: null, lang: 'es', dialect: 'central', forceMode: null,
      lyricDna: { vozPropia: { estiloVocabulario: 'crudo, callejero, urbano moderno' } },
    });

    expect(result.enabled).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.reason).toBe('no_voice_fit');
  });

  it('does not use the DB pool blindly — a candidates[0]-only regression would fail this', async () => {
    // Same candidates as the first test, but the model picks the LAST one
    // rather than the first (DB-sorted-by-charisma) one — proves selection
    // actually drives the outcome, not array position.
    queryRhymeCandidates.mockResolvedValue({
      data: [{ word: 'soslayo' }, { word: 'vasallo' }, { word: 'desmayo' }],
      error: null,
    });
    mockClaudeResponse(JSON.stringify({ selectedWord: 'desmayo', frame: 'vulnerabilidad', tropo: 'perder el control' }));

    const result = await buildCulturalResonance({
      verseText: 'Cruzó la frontera a lomos de un caballo',
      targetVerse: null, lang: 'es', dialect: 'central', forceMode: null,
      lyricDna: {},
    });
    expect(result.mandatoryWord).toBe('desmayo');
  });

  it('queries the lexicon using the target verse selection, not the raw note text, when one is given', async () => {
    await buildCulturalResonance({
      verseText: 'línea irrelevante que no termina en la palabra seleccionada',
      targetVerse: { before: '', text: 'un viejo cierge', after: '' },
      lang: 'es', dialect: 'central', forceMode: null,
    });
    expect(queryRhymeCandidates).toHaveBeenCalledWith(expect.objectContaining({ lang: 'es' }));
  });

  it('returns null when there is no usable text at all', async () => {
    const result = await buildCulturalResonance({
      verseText: '', targetVerse: null, lang: 'es', dialect: 'central', forceMode: null,
    });
    expect(result).toBeNull();
    expect(queryRhymeCandidates).not.toHaveBeenCalled();
  });
});

describe('guessConceptFromLine', () => {
  // Zero-cost, synchronous — no LLM call at all, used purely to seed a
  // confirm-before-you-fire UI step (see MusePopover/MuseFloatNode's
  // provocationStage / conceptStage). Same "last significant word"
  // heuristic buildCulturalResonance's own concept derivation used.
  it('returns the last significant word of the target verse when given one', () => {
    expect(guessConceptFromLine({ verseText: '', targetVerse: { before: '', text: 'un viejo caballo', after: '' } }))
      .toBe('caballo');
  });

  it('falls back to the last non-empty line of verseText when there is no targetVerse', () => {
    expect(guessConceptFromLine({ verseText: 'primera línea\nCruzó la frontera a lomos de un caballo', targetVerse: null }))
      .toBe('caballo');
  });

  it('returns null when there is no usable text at all', () => {
    expect(guessConceptFromLine({ verseText: '', targetVerse: null })).toBeNull();
  });
});

describe('getCulturalProvocation', () => {
  // Rewritten TWICE after real reported bugs:
  // 1. The first version routed this through queryRhymeCandidates/
  //    extractCulturalFrame (buildCulturalResonance's pipeline), which
  //    gated a non-rhyme feature behind "does this line's last word have
  //    high-charisma rhyme matches" — it came back empty even for a real
  //    Quijote quote.
  // 2. The second version derived a concept from the line internally and
  //    fired straight at the model with no human check — the caller had no
  //    way to correct a wrong guess before the call ran. `concept` is now a
  //    REQUIRED, externally-confirmed input (see guessConceptFromLine
  //    above, used by the UI to seed a confirm step); verseText/targetVerse
  //    are optional EXTRA context only.
  it('requires an explicit, confirmed concept — returns null without calling anything if missing', async () => {
    const result = await getCulturalProvocation({ verseText: 'una línea cualquiera', targetVerse: null, lang: 'es' });
    expect(result).toBeNull();
    expect(queryRhymeCandidates).not.toHaveBeenCalled();
  });

  it('never queries the lexicon at all — no rhyme dependency, unlike the first version of this function', async () => {
    mockClaudeResponse(JSON.stringify({ frame: 'refrán: "quien a buen árbol se arrima..."', tropo: 'protección/pertenencia' }));

    const result = await getCulturalProvocation({ concept: 'caballo', lang: 'es' });

    expect(result).toEqual({ frame: 'refrán: "quien a buen árbol se arrima..."', tropo: 'protección/pertenencia' });
    expect(queryRhymeCandidates).not.toHaveBeenCalled();
  });

  it('passes the confirmed concept AND the line (as extra context) when both are available', async () => {
    mockClaudeResponse(JSON.stringify({ frame: 'x', tropo: 'y' }));
    await getCulturalProvocation({
      concept: 'caballo', verseText: 'ladran, luego cabalgamos', targetVerse: null, lang: 'es',
    });
    const userPrompt = JSON.parse(fetch.mock.calls[0][1].body).messages[0].content;
    expect(userPrompt).toContain('caballo');
    expect(userPrompt).toContain('ladran, luego cabalgamos');
  });

  it('works with only a concept and no line context at all', async () => {
    mockClaudeResponse(JSON.stringify({ frame: 'x', tropo: 'y' }));
    const result = await getCulturalProvocation({ concept: 'la ausencia', lang: 'es' });
    expect(result).not.toBeNull();
  });

  it('never gated by forceMode — unlike buildCulturalResonance, this is a direct, on-demand tap with no forceMode param at all', async () => {
    mockClaudeResponse(JSON.stringify({ frame: 'x', tropo: 'y' }));
    const result = await getCulturalProvocation({ concept: 'caballo', lang: 'es' });
    expect(result).not.toBeNull();
  });

  it('returns null when the model genuinely finds no reasonable association, rather than forcing one', async () => {
    mockClaudeResponse(JSON.stringify({ frame: null, tropo: null }));
    const result = await getCulturalProvocation({ concept: 'caballo', lang: 'es' });
    expect(result).toBeNull();
  });

  it('returns null (not a thrown error) when the call fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await getCulturalProvocation({ concept: 'caballo', lang: 'es' });
    expect(result).toBeNull();
  });

  it('passes excludeFrames straight through so "otro ángulo" never repeats a tropo already shown', async () => {
    mockClaudeResponse(JSON.stringify({ frame: 'x', tropo: 'y' }));
    await getCulturalProvocation({
      concept: 'caballo', lang: 'es',
      excludeFrames: ['un tropo ya visto'],
    });
    const userPrompt = JSON.parse(fetch.mock.calls[0][1].body).messages[0].content;
    expect(userPrompt).toContain('un tropo ya visto');
  });

  // Reported live: "saboreando la derrota" with no explicit subject read as
  // ambiguity about the METAPHOR (physical vs. emotional defeat) when the
  // real gap was the elided SUBJECT — "el miedo," named two lines earlier,
  // was never even considered. Rather than guess, the model can ask.
  it('returns {needsClarification} instead of {frame,tropo} when the subject/agent is genuinely ambiguous', async () => {
    mockClaudeResponse(JSON.stringify({ needsClarification: '¿quién saborea la derrota — tú, o el miedo mencionado antes?' }));
    const result = await getCulturalProvocation({ concept: 'saborear la derrota', lang: 'es' });
    expect(result).toEqual({ needsClarification: '¿quién saborea la derrota — tú, o el miedo mencionado antes?' });
  });

  it('passes the clarification through to the prompt on a re-run', async () => {
    mockClaudeResponse(JSON.stringify({ frame: 'x', tropo: 'y' }));
    await getCulturalProvocation({ concept: 'saborear la derrota', clarification: 'el miedo', lang: 'es' });
    const userPrompt = JSON.parse(fetch.mock.calls[0][1].body).messages[0].content;
    expect(userPrompt).toContain('el miedo');
  });
});

describe('getImageGenealogy', () => {
  // "Genealogía de la imagen" — its own dedicated feature, separate from
  // getCulturalProvocation: universal culture (not scoped to Spanish-
  // speaking tropes), and returns SEVERAL references at once instead of one
  // frame/tropo. Same "confirm a real concept first" contract.
  it('requires an explicit, confirmed concept — returns null without calling anything if missing', async () => {
    const result = await getImageGenealogy({ verseText: 'una línea cualquiera', targetVerse: null, lang: 'es' });
    expect(result).toBeNull();
  });

  it('returns the real references the model proposes, wrapped in {references}', async () => {
    mockClaudeResponse(JSON.stringify({
      references: [
        { title: 'La Odisea', source: 'Homero, épica griega', connection: 'el nostos, el regreso a casa como viaje mítico' },
        { title: 'Ulysses', source: 'James Joyce', connection: 'la versión moderna/urbana del mismo viaje' },
      ],
    }));

    const result = await getImageGenealogy({ concept: 'volver a casa', lang: 'es' });

    expect(result).toEqual({
      references: [
        { title: 'La Odisea', source: 'Homero, épica griega', connection: 'el nostos, el regreso a casa como viaje mítico' },
        { title: 'Ulysses', source: 'James Joyce', connection: 'la versión moderna/urbana del mismo viaje' },
      ],
    });
  });

  it('passes the confirmed concept AND the line (as extra context) when both are available', async () => {
    mockClaudeResponse(JSON.stringify({ references: [{ title: 'x', source: 'y', connection: 'z' }] }));
    await getImageGenealogy({
      concept: 'volver a casa', verseText: 'después de la guerra, vuelvo a casa', targetVerse: null, lang: 'es',
    });
    const userPrompt = JSON.parse(fetch.mock.calls[0][1].body).messages[0].content;
    expect(userPrompt).toContain('volver a casa');
    expect(userPrompt).toContain('después de la guerra, vuelvo a casa');
  });

  it('drops malformed entries (missing title) rather than throwing', async () => {
    mockClaudeResponse(JSON.stringify({
      references: [{ source: 'sin título' }, { title: 'La Odisea', source: 'Homero', connection: 'x' }],
    }));
    const result = await getImageGenealogy({ concept: 'volver a casa', lang: 'es' });
    expect(result).toEqual({ references: [{ title: 'La Odisea', source: 'Homero', connection: 'x' }] });
  });

  it('returns {needsClarification} instead of references when the subject/agent is genuinely ambiguous', async () => {
    mockClaudeResponse(JSON.stringify({ needsClarification: '¿quién vuelve a casa — tú, o alguien más en la canción?' }));
    const result = await getImageGenealogy({ concept: 'volver a casa', lang: 'es' });
    expect(result).toEqual({ needsClarification: '¿quién vuelve a casa — tú, o alguien más en la canción?' });
  });

  it('passes the clarification through to the prompt on a re-run', async () => {
    mockClaudeResponse(JSON.stringify({ references: [{ title: 'x', source: 'y', connection: 'z' }] }));
    await getImageGenealogy({ concept: 'volver a casa', clarification: 'el miedo', lang: 'es' });
    const userPrompt = JSON.parse(fetch.mock.calls[0][1].body).messages[0].content;
    expect(userPrompt).toContain('el miedo');
  });

  it('returns null (not an empty array) when the model genuinely finds no real reference', async () => {
    mockClaudeResponse(JSON.stringify({ references: [] }));
    const result = await getImageGenealogy({ concept: 'volver a casa', lang: 'es' });
    expect(result).toBeNull();
  });

  it('returns null (not a thrown error) when the call fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await getImageGenealogy({ concept: 'volver a casa', lang: 'es' });
    expect(result).toBeNull();
  });

  it('passes excludeReferences straight through so "otras referencias" never repeats one already shown', async () => {
    mockClaudeResponse(JSON.stringify({ references: [{ title: 'x', source: 'y', connection: 'z' }] }));
    await getImageGenealogy({
      concept: 'volver a casa', lang: 'es',
      excludeReferences: ['La Odisea'],
    });
    const userPrompt = JSON.parse(fetch.mock.calls[0][1].body).messages[0].content;
    expect(userPrompt).toContain('La Odisea');
  });
});

describe('describeCulturalResonance', () => {
  it('renders nothing when there is no resonance data', () => {
    expect(describeCulturalResonance(null)).toBe('');
  });

  it('renders a graceful-degrade note (no mandatory word) when disabled', () => {
    const text = describeCulturalResonance({ enabled: false, degraded: true, concept: 'caballo' });
    expect(text).toContain('caballo');
    expect(text).not.toContain('MOTOR DE RESONANCIA CULTURAL');
  });

  it('renders the mandatory word + cultural frame, with an explicit SURGEON-ignore instruction', () => {
    const text = describeCulturalResonance({
      enabled: true, concept: 'caballo', mandatoryWord: 'soslayo',
      culturalFrame: 'el caballo del malo', tropo: 'derrota y mala suerte',
    });
    expect(text).toContain('soslayo');
    expect(text).toContain('el caballo del malo');
    expect(text).toContain('SURGEON');
  });

  it('still renders the mandatory word when no cultural frame was extracted', () => {
    const text = describeCulturalResonance({
      enabled: true, concept: 'caballo', mandatoryWord: 'soslayo', culturalFrame: null, tropo: null,
    });
    expect(text).toContain('soslayo');
  });
});
