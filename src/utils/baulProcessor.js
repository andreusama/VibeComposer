// ─── Baúl — raw-material processing ────────────────────────────────────────
// The "baúl" (trunk) is where an artist dumps unprocessed inspiration —
// voice-note transcripts, notebook pages, documents, raw text — and this
// module distills it into an evolving "ADN Lírico" (lyrical DNA) profile:
// voice, recurring imagery, forbidden words, influences, and a couple of
// verbatim reference lines rescued from the material itself.
//
// Pure and stateless on purpose: this module only transforms
// (currentAdnLirico, rawInput) -> nextAdnLirico. Persisting the result is
// the caller's job — same separation museApi.js keeps between the
// conversation call and the profile-summary call.
//
// rawInput has two possible shapes depending on inputType:
//  - a plain string, for 'text' / 'audio_transcript' (already-transcribed
//    material), and also accepted for 'notebook_image' / 'document' if the
//    caller already has extracted text (e.g. OCR done elsewhere) instead
//    of a raw file.
//  - { base64, mimeType } for real binary material — a photographed
//    notebook page or a native PDF — sent to Claude as an actual image /
//    document content block so it reads the material itself instead of
//    a text description of it.

import { API_URL, checkAndIncrementLimit } from './api.js';

// Kept separate from api.js's own API_MODEL and museApi.js's MUSE_MODEL on
// purpose — this call's shape (a single large structured-JSON extraction,
// no back-and-forth) may need its own tuning later without touching either.
const BAUL_MODEL = 'claude-sonnet-5';

export const BAUL_INPUT_TYPES = ['text', 'audio_transcript', 'notebook_image', 'document'];

async function callClaude(system, userContent, maxTokens) {
  checkAndIncrementLimit();
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: BAUL_MODEL,
      max_tokens: maxTokens,
      // claude-sonnet-5 defaults to extended thinking, which for a
      // fixed-shape JSON extraction task like this one can quietly eat the
      // entire max_tokens budget and leave zero room for the actual answer
      // (stop_reason "max_tokens", no text block at all) — the same
      // failure mode already found and fixed in museApi.js. Disabling it
      // is what makes this reliably return the JSON instead of nothing.
      thinking: { type: 'disabled' },
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  if (!response.ok) throw new Error(`API error ${response.status}`);
  const data = await response.json();
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

const BAUL_SYSTEM_PROMPT = `Eres un psicoanalista cultural y curador de arte contemporáneo. Tu única función es leer entre líneas en el material bruto de un artista (sus ramblings verbales, tachones de cuaderno, textos a las 3 AM o fotos) para mapear su SUBCONSCIENTE CREATIVO.

No busques lo obvio. Decodifica lo implícito:
1. Paisaje Sensorial Implícito: ¿Qué luz, temperatura, textura, olor o momento del día evoca este caos? (Ejemplo: no busques "tristeza", busca "luces de freno rojas reflejadas en el asfalto mojado a las 4 AM").
2. Pulso Emocional Latente: Identifica la tensión de fondo (ej. cinismo que oculta miedo a la soledad, euforia desesperada, nostalgia de algo que no ha ocurrido).
3. Simbolismo y Objetos Fetiche: Extrae los elementos concretos u objetos cotidianos que el artista usa inconscientemente como metáforas.
4. Tono y Fricción del Lenguaje: Capta la métrica natural de su voz (versos rotos, frases cortas, lenguaje de calle, susurros).

Compara la nueva inspiración con el ADN Lírico actual (si existe) y realiza una FUSIÓN EVOLUTIVA en formato JSON estricto:

{
  "vozPropia": {
    "estiloVocabulario": "Descripción del registro, actitud y pulso emocional latente detectado",
    "imagenesHabituales": ["5 a 6 objetos físicos, sensaciones táctiles, escenarios o luces recurrentes en su subconsciente"],
    "palabrasProhibidas": ["Conceptos abstractos a evitar para mantener la crudeza del texto"]
  },
  "influenciasYReferentes": {
    "artistasClave": ["Referentes explícitos o implícitos deducidos de su atmósfera"],
    "tonoDeseado": "Descripción del choque entre su universo visual y el ritmo de sus referentes"
  },
  "versosDeReferencia": [
    "2 o 3 líneas reales o fragmentos reveladores rescatados directamente del material"
  ]
}`;

function adnHeader(currentAdnLirico, inputType) {
  return `ADN LÍRICO ACTUAL DEL PROYECTO:
${JSON.stringify(currentAdnLirico || {})}

NUEVO MATERIAL VOLCADO AL BAÚL (TIPO: ${inputType}).`;
}

const CLOSING_INSTRUCTION = 'Extrae el subconsciente de esta nueva entrada, fusiónalo con su ADN previo y devuelve ÚNICAMENTE el JSON actualizado.';

/**
 * Builds the `content` value for the user message — a plain string for
 * text-shaped input, or an array of Anthropic content blocks (image/
 * document + a text block) when rawInput carries real binary material.
 * Exported mainly so it's independently testable without a network call.
 * @param {object|null} currentAdnLirico
 * @param {string|{base64: string, mimeType?: string}} rawInput
 * @param {string} inputType
 * @returns {string | Array<object>}
 */
export function buildUserContent(currentAdnLirico, rawInput, inputType) {
  const isBinary = rawInput && typeof rawInput === 'object';
  const header = adnHeader(currentAdnLirico, inputType);

  if (isBinary && inputType === 'notebook_image') {
    return [
      {
        type: 'image',
        source: { type: 'base64', media_type: rawInput.mimeType || 'image/jpeg', data: rawInput.base64 },
      },
      { type: 'text', text: `${header}\n\n${CLOSING_INSTRUCTION}` },
    ];
  }

  if (isBinary && inputType === 'document') {
    return [
      {
        type: 'document',
        source: { type: 'base64', media_type: rawInput.mimeType || 'application/pdf', data: rawInput.base64 },
      },
      { type: 'text', text: `${header}\n\n${CLOSING_INSTRUCTION}` },
    ];
  }

  // Plain text — either a genuinely text-shaped inputType, or a caller
  // that already extracted text from an image/document itself.
  return `${header}\n"""\n${rawInput}\n"""\n\n${CLOSING_INSTRUCTION}`;
}

// ─── Defensive parsing / sanitization ──────────────────────────────────────
// The model is asked for strict JSON, but "asked for" isn't "guaranteed" —
// markdown fences, a missing field, an array collapsed to a bare string,
// none of that should ever throw past this function. Same philosophy as
// museApi.js's parseCompanionResponse: sanitize what's salvageable, return
// null (not throw, not a blank object) when it truly isn't — the caller
// decides what "couldn't extract anything" should fall back to.

function toStringArray(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function emptyAdnLirico() {
  return {
    vozPropia: { estiloVocabulario: '', imagenesHabituales: [], palabrasProhibidas: [] },
    influenciasYReferentes: { artistasClave: [], tonoDeseado: '' },
    versosDeReferencia: [],
  };
}

/**
 * Sanitizes a raw Claude response into a well-formed ADN Lírico object, or
 * null if nothing usable could be salvaged from it.
 * @param {string} raw
 * @returns {{vozPropia: {estiloVocabulario: string, imagenesHabituales: string[],
 *   palabrasProhibidas: string[]}, influenciasYReferentes: {artistasClave: string[],
 *   tonoDeseado: string}, versosDeReferencia: string[]} | null}
 */
export function parseBaulResponse(raw) {
  try {
    const cleaned = (raw || '').replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const vozPropia = parsed.vozPropia || {};
    const influencias = parsed.influenciasYReferentes || {};

    const result = {
      vozPropia: {
        estiloVocabulario: toTrimmedString(vozPropia.estiloVocabulario),
        imagenesHabituales: toStringArray(vozPropia.imagenesHabituales),
        palabrasProhibidas: toStringArray(vozPropia.palabrasProhibidas),
      },
      influenciasYReferentes: {
        artistasClave: toStringArray(influencias.artistasClave),
        tonoDeseado: toTrimmedString(influencias.tonoDeseado),
      },
      versosDeReferencia: toStringArray(parsed.versosDeReferencia),
    };

    // Syntactically valid but functionally empty (no voice, no imagery, no
    // reference lines at all) isn't a real extraction — treat it as a
    // failure rather than silently overwriting a real ADN with a blank one.
    const isEmpty = !result.vozPropia.estiloVocabulario
      && !result.vozPropia.imagenesHabituales.length
      && !result.versosDeReferencia.length;
    if (isEmpty) {
      console.error('baúl response parsed but was empty:', raw);
      return null;
    }
    return result;
  } catch {
    console.error('baúl response failed to parse:', raw);
    return null;
  }
}

/**
 * Reads one piece of raw material (a transcript, a document, a photographed
 * notebook page) against the project's current ADN Lírico and returns the
 * fused, updated ADN. Not idempotent in intent — each call is meant to
 * evolve the profile forward, not just re-derive it from scratch.
 * @param {{currentAdnLirico: object|null,
 *   rawInput: string|{base64: string, mimeType?: string},
 *   inputType: 'text'|'audio_transcript'|'notebook_image'|'document'}} args
 * @returns {Promise<object>} the fused ADN Lírico — falls back to
 *   currentAdnLirico (or an empty ADN if there wasn't one yet) if the model's
 *   response couldn't be salvaged, so a bad response never wipes real data.
 */
export async function processBaulInput({ currentAdnLirico, rawInput, inputType }) {
  if (!BAUL_INPUT_TYPES.includes(inputType)) {
    throw new Error(`processBaulInput: unknown inputType "${inputType}"`);
  }

  const isBinary = rawInput && typeof rawInput === 'object';
  if (isBinary) {
    if (!rawInput.base64) throw new Error('processBaulInput: rawInput.base64 is required for binary input');
  } else if (!rawInput || !String(rawInput).trim()) {
    throw new Error('processBaulInput: rawInput is empty');
  }

  const userContent = buildUserContent(currentAdnLirico, rawInput, inputType);
  const raw = await callClaude(BAUL_SYSTEM_PROMPT, userContent, 1200);
  const parsed = parseBaulResponse(raw);

  return parsed || currentAdnLirico || emptyAdnLirico();
}
