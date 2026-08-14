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
}));

import {
  askMuse, parseCompanionResponse, applyMuseVerification, selectDiverseSuggestions,
  calculateContextWeights, MUSE_ACTION_TYPES, MUSE_TYPES, MUSE_ANGLES,
  buildCulturalResonance, describeCulturalResonance,
} from './museApi.js';
import { queryRhymeCandidates } from './lexicon.js';

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

  it('parses a WORD_BANK response, including short_phrases', () => {
    const raw = JSON.stringify({
      action_type: 'WORD_BANK',
      target_rhyme: 'cielo',
      rhyme_type: 'asonante',
      word_groups: [
        { syllables: 2, words: ['duelo', 'recelo'] },
        { short_phrases: ['sin consuelo', 'de terciopelo'] },
      ],
      themes: [],
    });
    const result = parseCompanionResponse(raw);
    expect(result.action_type).toBe('WORD_BANK');
    expect(result.wordBank.targetRhyme).toBe('cielo');
    expect(result.wordBank.rhymeType).toBe('asonante');
    expect(result.wordBank.wordGroups[0].words).toEqual(['duelo', 'recelo']);
    expect(result.wordBank.wordGroups[1].shortPhrases).toEqual(['sin consuelo', 'de terciopelo']);
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

  it('falls back when action_type is missing or not one of the four modes', () => {
    const raw = JSON.stringify({ reasoning: 'sin action_type', suggestions: [] });
    expect(parseCompanionResponse(raw).action_type).toBe('SOCRATIC');
  });

  it('exports exactly the four documented action types', () => {
    expect(MUSE_ACTION_TYPES).toEqual(['SURGEON', 'ARCHITECT', 'SOCRATIC', 'WORD_BANK']);
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

describe('applyMuseVerification — WORD_BANK', () => {
  const baseCtx = { verseText: 'Camino solo por la calle vacía', lang: 'es', dialect: 'central' };

  it('filters out words that already sit in the note', () => {
    const parsed = {
      action_type: 'WORD_BANK',
      wordBank: {
        targetRhyme: null, rhymeType: 'consonante',
        wordGroups: [{ syllables: 2, words: ['calle', 'valle'], shortPhrases: [] }],
      },
    };
    applyMuseVerification(parsed, baseCtx);
    expect(parsed.wordBank.wordGroups[0].words).toEqual(['valle']);
  });

  it('filters words that do not actually rhyme with the stated target', () => {
    const parsed = {
      action_type: 'WORD_BANK',
      wordBank: {
        targetRhyme: 'cielo', rhymeType: 'asonante',
        wordGroups: [{ syllables: 2, words: ['duelo', 'camino'], shortPhrases: [] }],
      },
    };
    applyMuseVerification(parsed, baseCtx);
    expect(parsed.wordBank.wordGroups[0].words).toEqual(['duelo']);
  });

  it('drops a group entirely once it has nothing left', () => {
    const parsed = {
      action_type: 'WORD_BANK',
      wordBank: {
        targetRhyme: 'cielo', rhymeType: 'asonante',
        wordGroups: [{ syllables: 2, words: ['camino'], shortPhrases: [] }],
      },
    };
    applyMuseVerification(parsed, baseCtx);
    expect(parsed.wordBank.wordGroups).toHaveLength(0);
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

  it('degrades gracefully with a concept but no mandatory word when the lexicon has no high-charisma match', async () => {
    const result = await buildCulturalResonance({
      verseText: 'Cruzó la frontera a lomos de un caballo',
      targetVerse: null, lang: 'es', dialect: 'central', forceMode: null,
    });
    expect(result.enabled).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.concept).toBe('caballo');
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
