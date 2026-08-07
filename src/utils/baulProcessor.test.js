import { describe, it, expect, vi, beforeEach } from 'vitest';

// api.js's checkAndIncrementLimit reads/writes localStorage, which doesn't
// exist under Vitest's default node environment — and these tests aren't
// about rate limiting anyway, so the whole module is swapped for a stub
// that keeps API_URL (used to assert the fetch call) and no-ops the limit
// check.
vi.mock('./api.js', () => ({
  API_URL: '/api/claude',
  checkAndIncrementLimit: vi.fn(),
}));

import { processBaulInput, parseBaulResponse, buildUserContent, emptyAdnLirico, BAUL_INPUT_TYPES } from './baulProcessor.js';

function mockClaudeResponse(text) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text }] }),
  });
}

const FUSED_ADN = {
  vozPropia: {
    estiloVocabulario: 'Cinismo callejero que tapa el miedo a quedarse solo, frases cortas, respiración entrecortada.',
    imagenesHabituales: ['semáforo en rojo a las 4 AM', 'colillas en el alféizar', 'wifi ajeno', 'chaqueta prestada', 'el ruido del micro a las 6'],
    palabrasProhibidas: ['tristeza', 'amor eterno', 'destino'],
  },
  influenciasYReferentes: {
    artistasClave: ['Leiva', 'C. Tangana'],
    tonoDeseado: 'La crudeza de un cuaderno de madrugada con el pulso de una producción urbana pulida.',
  },
  versosDeReferencia: [
    'me quedé mirando el semáforo como si fuera a decirme algo',
    'la chaqueta que no es mía todavía huele a otra casa',
  ],
};

describe('parseBaulResponse', () => {
  it('parses a clean JSON response', () => {
    const result = parseBaulResponse(JSON.stringify(FUSED_ADN));
    expect(result).toEqual(FUSED_ADN);
  });

  it('strips markdown code fences before parsing', () => {
    const fenced = '```json\n' + JSON.stringify(FUSED_ADN) + '\n```';
    const result = parseBaulResponse(fenced);
    expect(result).toEqual(FUSED_ADN);
  });

  it('coerces a bare string field into a one-element array', () => {
    const raw = JSON.stringify({
      ...FUSED_ADN,
      vozPropia: { ...FUSED_ADN.vozPropia, imagenesHabituales: 'un solo objeto suelto' },
    });
    const result = parseBaulResponse(raw);
    expect(result.vozPropia.imagenesHabituales).toEqual(['un solo objeto suelto']);
  });

  it('defaults missing fields to empty arrays/strings instead of throwing', () => {
    const raw = JSON.stringify({ vozPropia: { estiloVocabulario: 'algo mínimo' } });
    const result = parseBaulResponse(raw);
    expect(result.vozPropia.estiloVocabulario).toBe('algo mínimo');
    expect(result.vozPropia.imagenesHabituales).toEqual([]);
    expect(result.vozPropia.palabrasProhibidas).toEqual([]);
    expect(result.influenciasYReferentes.artistasClave).toEqual([]);
    expect(result.versosDeReferencia).toEqual([]);
  });

  it('returns null on malformed JSON rather than throwing', () => {
    expect(parseBaulResponse('esto no es json { roto')).toBeNull();
  });

  it('returns null on syntactically valid but functionally empty JSON', () => {
    const blank = JSON.stringify(emptyAdnLirico());
    expect(parseBaulResponse(blank)).toBeNull();
  });

  it('returns null on an empty string', () => {
    expect(parseBaulResponse('')).toBeNull();
  });
});

describe('processBaulInput', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('processes a chaotic transcribed voice note and returns the fused ADN', async () => {
    mockClaudeResponse(JSON.stringify(FUSED_ADN));

    const rawInput = `okay entonces, o sea, no sé, es como que salgo a las cuatro de la mañana `
      + `y hay como este semáforo que está en rojo eterno y yo qué sé, siento que la chaqueta esta `
      + `que llevo prestada todavía huele a otra casa, a otra vida, y no sé eso, eso es la canción`;

    const result = await processBaulInput({
      currentAdnLirico: null,
      rawInput,
      inputType: 'audio_transcript',
    });

    expect(result).toEqual(FUSED_ADN);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/claude');
    const body = JSON.parse(options.body);
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.system).toContain('psicoanalista cultural');
    expect(body.messages[0].content).toContain('TIPO: audio_transcript');
    expect(body.messages[0].content).toContain(rawInput);
  });

  it('fuses new material with an existing ADN rather than starting from scratch', async () => {
    const existingAdn = { ...FUSED_ADN, versosDeReferencia: ['un verso viejo que ya existía'] };
    mockClaudeResponse(JSON.stringify(FUSED_ADN));

    await processBaulInput({
      currentAdnLirico: existingAdn,
      rawInput: 'nuevo material de cuaderno',
      inputType: 'notebook_image',
    });

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain(JSON.stringify(existingAdn));
  });

  it('falls back to the previous ADN, unmodified, if the model response cannot be parsed', async () => {
    mockClaudeResponse('respuesta rota que no es json');
    const existingAdn = { ...FUSED_ADN };

    const result = await processBaulInput({
      currentAdnLirico: existingAdn,
      rawInput: 'algo de texto',
      inputType: 'text',
    });

    // A clean fallback: the caller's ADN comes back exactly as it went in,
    // never a corrupted/blank merge — this is the "actualización limpia"
    // guarantee even when the model misbehaves.
    expect(result).toEqual(existingAdn);
  });

  it('falls back to an empty ADN shape (not null/undefined) when there is no prior ADN and parsing fails', async () => {
    mockClaudeResponse('{ json malformado');

    const result = await processBaulInput({
      currentAdnLirico: null,
      rawInput: 'primera entrada, algo caótica',
      inputType: 'text',
    });

    expect(result).toEqual(emptyAdnLirico());
  });

  it('rejects an unknown inputType before ever calling the API', async () => {
    mockClaudeResponse(JSON.stringify(FUSED_ADN));
    await expect(processBaulInput({
      currentAdnLirico: null,
      rawInput: 'algo',
      inputType: 'carrier_pigeon',
    })).rejects.toThrow(/unknown inputType/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects empty rawInput before ever calling the API', async () => {
    mockClaudeResponse(JSON.stringify(FUSED_ADN));
    await expect(processBaulInput({
      currentAdnLirico: null,
      rawInput: '   ',
      inputType: 'text',
    })).rejects.toThrow(/rawInput is empty/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts every documented inputType', () => {
    expect(BAUL_INPUT_TYPES).toEqual(['text', 'audio_transcript', 'notebook_image', 'document']);
  });

  it('sends a real image content block for a photographed notebook page', async () => {
    mockClaudeResponse(JSON.stringify(FUSED_ADN));

    await processBaulInput({
      currentAdnLirico: null,
      rawInput: { base64: 'ZmFrZS1iYXNlNjQ=', mimeType: 'image/png' },
      inputType: 'notebook_image',
    });

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(Array.isArray(body.messages[0].content)).toBe(true);
    expect(body.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'ZmFrZS1iYXNlNjQ=' },
    });
    expect(body.messages[0].content[1].type).toBe('text');
    expect(body.messages[0].content[1].text).toContain('TIPO: notebook_image');
  });

  it('sends a real document content block for a native PDF', async () => {
    mockClaudeResponse(JSON.stringify(FUSED_ADN));

    await processBaulInput({
      currentAdnLirico: null,
      rawInput: { base64: 'ZmFrZS1wZGY=', mimeType: 'application/pdf' },
      inputType: 'document',
    });

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.messages[0].content[0]).toEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'ZmFrZS1wZGY=' },
    });
  });

  it('defaults media_type to image/jpeg and application/pdf when mimeType is omitted', () => {
    const imageContent = buildUserContent(null, { base64: 'x' }, 'notebook_image');
    expect(imageContent[0].source.media_type).toBe('image/jpeg');

    const docContent = buildUserContent(null, { base64: 'x' }, 'document');
    expect(docContent[0].source.media_type).toBe('application/pdf');
  });

  it('still treats notebook_image/document as plain text when rawInput is a string (already-extracted text)', () => {
    const content = buildUserContent(null, 'texto ya extraído de la libreta', 'notebook_image');
    expect(typeof content).toBe('string');
    expect(content).toContain('texto ya extraído de la libreta');
  });

  it('rejects binary input missing base64 before ever calling the API', async () => {
    mockClaudeResponse(JSON.stringify(FUSED_ADN));
    await expect(processBaulInput({
      currentAdnLirico: null,
      rawInput: { mimeType: 'image/png' },
      inputType: 'notebook_image',
    })).rejects.toThrow(/base64 is required/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
