// ─── Resource import — raw-text segmentation ───────────────────────────────
// Turns a pasted blob (a Notes dump, a WhatsApp "Export Chat" .txt, anything
// copied from anywhere) into candidate resources — metaphors, proverbs,
// quotable phrases — for the artist to review and pick from (see
// ResourceImportSheet.jsx; nothing here ever writes to the database directly,
// same "process, don't persist" split baulProcessor.js keeps).
//
// One call, fixed shape, no back-and-forth — same pattern as baulProcessor's
// extraction, not museApi's conversational one.

import { callClaudeOnce } from '../utils/api.js';
import { RESOURCE_TYPES } from './resourcesData.js';

export const RESOURCE_IMPORT_MODEL = 'claude-sonnet-5';

// A real chat export can be huge; this is a paste-a-note/paste-a-few-
// messages tool, not a bulk archive importer — cap the input so a single
// call stays cheap and fast. The UI tells the artist when it truncates.
export const MAX_IMPORT_CHARS = 20000;

// A photographed page of a book/notebook — same idea as baulProcessor.js's
// own notebook_image handling (Claude reads the photo directly, no separate
// OCR step), reusing the SAME segmentation prompt/criteria below rather
// than a second one, just a different user-content shape.
export const MAX_IMPORT_IMAGE_BYTES = 10 * 1024 * 1024;

// Two real usage shapes need genuinely different filtering strength, and the
// first version of this prompt only handled the second one — a real test
// import of screenwriting-book notes (each block already hand-transcribed
// with its own page number, e.g. "pg 27") returned only 7 of dozens of
// clearly-marked blocks, and mislabeled analytical passages as "metaphor"
// for lack of a better bucket. Both are fixed below: curated/cited text now
// gets a low bar for inclusion instead of the noise-filter meant for chat
// exports, and "lesson" exists as its own type.
export const RESOURCE_IMPORT_SYSTEM_PROMPT = `Eres un curador que ayuda a un compositor/escritor a rescatar material real de un texto en bruto que ha pegado. Puede venir de dos sitios muy distintos, y debes distinguirlos:

1. MATERIAL YA CURADO — notas de una app de notas, o un texto con referencias de página junto a cada bloque (ej. "pg 27", "p. 214"). Una referencia de página es una señal MUY fuerte de que el propio artista ya seleccionó y transcribió ese fragmento a propósito mientras leía. Trata esto como material YA FILTRADO por el propio artista: el listón para incluir un candidato es BAJO — cada bloque marcado con su propia página es, casi siempre, un candidato por derecho propio, aunque sea largo, analítico o no sea una "frase bonita" en sentido literario. NO lo descartes por parecer una definición o una explicación técnica en vez de una cita poética — para eso existe el tipo "lesson" (abajo). El objetivo aquí es rescatar TODOS los bloques reales que el artista ya se molestó en transcribir, no una selección adicional tuya encima de la suya.

2. CONVERSACIÓN EXPORTADA — WhatsApp y similares: la mayoría es charla ordinaria (saludos, logística, "voy de camino") y solo una pequeña parte, si acaso, es material real. Aquí sí el listón es ALTO: descarta activamente el ruido conversacional, los mensajes de sistema, y cualquier metadato estructural (marcas de tiempo, nombres de remitente, "<Multimedia omitido>", etc. — extrae SOLO el contenido real del mensaje, nunca la marca de tiempo ni el remitente).

Si no es evidente cuál de los dos es, usa criterio intermedio.

Sobre los saltos de línea: son una SEÑAL de que dos fragmentos son distintos, no una regla — una frase o cita que se parte en varias líneas por el ajuste de texto (un guion a final de línea, un salto de página) sigue siendo UN solo candidato; dos ideas distintas separadas por una línea en blanco, o cada bloque con su propia referencia de página, son candidatos separados.

Para cada candidato real que encuentres, decide:
- "body": el texto exacto rescatado, limpio de metadato y de guiones de corte de línea sueltos (ej. "ana-lizar" partido por el salto de línea → "analizar")
- "type": ${RESOURCE_TYPES.map((t) => `"${t}"`).join(' | ')} — solo si encaja con claridad, si no null. Distinción clave: "metaphor" es una comparación genuinamente literaria/poética (una imagen); "lesson" es un principio, una definición o una idea de oficio/análisis (ej. de un libro sobre escritura, música o cualquier arte) — la mayoría del contenido analítico o instructivo es "lesson", NO "metaphor".
- "tags": 0 a 3 etiquetas cortas de tema (ej. "amor", "pérdida", "estructura") si es evidente, si no un array vacío
- "origin": una nota breve de dónde parece venir DENTRO del propio texto pegado — una referencia de página tal cual aparece (ej. "pg 27"), un remitente nombrado ("mensaje de [nombre]") — si es evidente y verificable en el texto, si no null. Nunca inventes un origen.

Si el texto pegado no contiene ningún candidato real (todo es charla ordinaria sin nada rescatable, o está vacío de contenido), devuelve una lista vacía — no fuerces candidatos débiles solo por rellenar. Pero si el texto trae material ya curado (caso 1), el resultado por defecto debe ser una lista LARGA, no corta.

Devuelve ÚNICAMENTE este JSON, sin explicación adicional:
{
  "items": [
    { "body": "...", "type": "phrase", "tags": ["..."], "origin": null }
  ]
}`;

function callClaude(userContent) {
  return callClaudeOnce({
    model: RESOURCE_IMPORT_MODEL,
    system: RESOURCE_IMPORT_SYSTEM_PROMPT,
    userContent,
    // Curated book-note pastes can legitimately produce dozens of
    // candidates (see the prompt comment above) — 2000 was tuned for the
    // "a handful of real quotes in a chat export" case and would truncate a
    // long curated list mid-JSON.
    maxTokens: 8000,
  });
}

function toStringArray(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
  return [];
}

const VALID_TYPES = new Set(RESOURCE_TYPES);

// Defensive parsing, same philosophy as baulProcessor's parseBaulResponse:
// sanitize what's salvageable, never throw. A malformed/empty response
// becomes an empty candidate list rather than blocking the review screen.
export function parseImportResponse(raw) {
  try {
    const cleaned = (raw || '').replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return items
      .map((item) => ({
        body: typeof item.body === 'string' ? item.body.trim() : '',
        type: VALID_TYPES.has(item.type) ? item.type : null,
        tags: toStringArray(item.tags).slice(0, 3),
        origin: typeof item.origin === 'string' && item.origin.trim() ? item.origin.trim() : null,
      }))
      .filter((item) => item.body);
  } catch {
    console.error('resource import response failed to parse:', raw);
    return [];
  }
}

/**
 * Segments a pasted blob into candidate resources for review. Never writes
 * anything — the caller (ResourceImportSheet) owns turning accepted
 * candidates into real resources via resourcesData.js.
 * @param {string} rawText
 * @returns {Promise<{candidates: Array<{body:string,type:string|null,tags:string[],origin:string|null}>, truncated: boolean}>}
 */
export async function segmentImportedText(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return { candidates: [], truncated: false };
  const truncated = text.length > MAX_IMPORT_CHARS;
  const input = truncated ? text.slice(0, MAX_IMPORT_CHARS) : text;
  const raw = await callClaude(`Texto pegado:\n"""\n${input}\n"""`);
  return { candidates: parseImportResponse(raw), truncated };
}

/**
 * Same segmentation, but the material is a photo (a book page, a notebook,
 * a printed poster) instead of pasted text — Claude reads the text in the
 * image directly, then applies the exact same curated-vs-noisy criteria.
 * @param {{base64: string, mimeType?: string}} image
 * @returns {Promise<{candidates: Array<{body:string,type:string|null,tags:string[],origin:string|null}>, truncated: boolean}>}
 *   truncated is always false here — there's no length cap on an image the
 *   way there is on pasted text.
 */
export async function segmentImportedImage({ base64, mimeType } = {}) {
  if (!base64) return { candidates: [], truncated: false };
  const content = [
    { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: base64 } },
    { type: 'text', text: 'Foto de una página, libreta o texto impreso. Lee el texto real que aparece en la imagen y aplica exactamente el mismo criterio de arriba sobre qué rescatar.' },
  ];
  const raw = await callClaude(content);
  return { candidates: parseImportResponse(raw), truncated: false };
}
