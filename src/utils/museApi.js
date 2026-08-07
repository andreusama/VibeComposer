// ─── Muse — Claude calls ────────────────────────────────────────────────────
// Two isolated things live here on purpose: the companion conversation
// (askMuse) and periodically summarizing what's been learned into the
// project's per-register profile (summarizeMuseProfile). They share only
// the low-level callClaude() helper — nothing about adjusting N or the
// summary prompt should ever require touching the conversation path, or
// vice versa.
//
// The muse is a writing companion, not a spectator: the user asks for help
// (continue this line, complement an image, find a rhyme), the muse either
// asks back for context it genuinely needs or gives 2-4 concrete options.
// It never just comments on the song from the outside.

import {API_URL, checkAndIncrementLimit} from './api.js';
import {getLineRhymeKey, getWordRhymeKey, wordMatchesRhyme} from './rhyme.js';
import {splitIntoLines} from './textLines.js';
import {countLineSyllables} from './syllables.js';

// Kept separate from api.js's own API_MODEL on purpose — that one backs the
// vibe-compose chord generator and wasn't meant to move just because this
// feature wants a specific model.
const MUSE_MODEL = 'claude-sonnet-5';

export const MUSE_REGISTERS = ['amor', 'amistad', 'familia', 'lugar', 'otro'];
export const MUSE_ANGLES = ['raw', 'atmospheric', 'abstract'];

async function callClaude(system, userContent, maxTokens) {
    checkAndIncrementLimit();
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            model: MUSE_MODEL,
            max_tokens: maxTokens,
            // claude-sonnet-5 defaults to extended thinking. For this fixed-shape
            // JSON task that reasoning step was eating the entire max_tokens
            // budget on its own (stop_reason "max_tokens", zero text emitted) —
            // disabling it is what actually fixed the muse's "no reply" bug.
            thinking: {type: 'disabled'},
            // No temperature/top_p override, deliberately: Anthropic's default
            // temperature IS 1.0 when omitted (already the max standard
            // variance), and their own guidance is to tune temperature OR
            // top_p, never both. Fighting genericness here is a prompting
            // problem (see the three-angle structure below), not a sampling one.
            system,
            messages: [{role: 'user', content: userContent}],
        }),
    });
    if (!response.ok) throw new Error(`API error ${response.status}`);
    const data = await response.json();
    return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

function formatConversation(conversation) {
    if (!conversation.length) return '(esta es la primera vez que hablas con el usuario sobre esta línea)';
    return conversation
        .map((turn) => {
            if (turn.role === 'user') return `Usuario: "${turn.content}"`;
            // Tolerates both shapes: {text, angle} (current) and a bare
            // string (conversation history saved before angle-tagging
            // existed) — old saved turns still need to read back cleanly.
            const optionsText = turn.options?.length
                ? ` Opciones ofrecidas: ${turn.options.map((o) => `"${typeof o === 'string' ? o : o.text}"`).join(', ')}`
                : '';
            return `Tú (musa): "${turn.content}"${optionsText}`;
        })
        .join('\n');
}

// One row per physical line (textarea row) of the note, each with its own
// syllable count and rhyme key — computed here, not left to the model, so
// the prompt gives it real ground truth instead of asking it to scan and
// count on its own (LLMs are known to be unreliable at exact syllable
// counts zero-shot; grounding + post-hoc verification in askMuse is what
// actually makes the constraint hold, the prompt text alone is not enough).
function describePhysicalLines(verseText, lang, dialect) {
    const lines = splitIntoLines(verseText).filter(Boolean);
    if (!lines.length) return '(nota vacía, sin líneas todavía)';
    return lines
        .map((line, i) => {
            const syllables = countLineSyllables(line, lang);
            const key = getLineRhymeKey(line, lang, dialect);
            const rhymeInfo = key ? `termina en "${key.clean}" — consonante "${key.consonant}", asonante "${key.assonant}"` : 'sin rima';
            return `${i + 1}. "${line}" — ${syllables} sílabas, ${rhymeInfo}`;
        })
        .join('\n');
}

// Split in two on purpose, for Anthropic prompt caching: everything in here
// is identical across every turn of a conversation on the same song (it only
// changes when museProfile/lyricDna themselves get rewritten — by the
// periodic summary or by a new baúl entry), so it's the piece worth paying
// the one-time cache-write cost on and reading back cheaply on every
// follow-up turn within the session. Per-note, per-turn content (the line
// breakdown, the recent conversation) lives in buildDynamicMuseContext
// instead, uncached, since caching it would never hit — it's different on
// every call by definition.
//
// The register-based calibration, the "never comment/psychoanalyze" rules,
// and the sensitivity handling are the ones product settled on. What
// changed from the original one-shot curious-question design: the muse now
// responds to a direct request instead of initiating one, so "stay quiet"
// isn't an available move anymore — the user asked for help, it always
// gives *something* back (a clarifying question or options), just gentler
// in tone when the topic is delicate.
function buildStaticMuseInstructions(lyricDna, museProfile) {
    return `Eres la musa de un compositor: su compañera de escritura, no una
espectadora que comenta la canción desde fuera. Tu trabajo es ayudarle a
seguir escribiendo — continuar un verso, complementar una imagen,
encontrar una rima — dándole opciones concretas y utilizables, nunca solo
una reacción o una pregunta por curiosidad.

Trata el lenguaje como pintura cruda, no como piezas de un rompecabezas
que deben encajar perfecto. Ancla siempre en la realidad física y en el
subtexto emocional — un detalle concreto (una luz, una textura, un objeto,
un gesto) vale más que diez adjetivos abstractos. Cuando algo te salga
"bonito" pero genérico, la primera frase que se te ocurre, esa es la que
menos vale — sigue un paso más allá de ahí.

=== 1. ESTILO Y VOZ DEL ESCRITOR (lyric_dna) — el CÓMO ===
Invariable a nivel de TODA la canción: no de qué habla esta nota en
concreto, sino cómo suena esta persona cuando escribe — léxico, actitud,
nivel de abstracción, complejidad métrica. Tus opciones DEBEN sonar con
esta voz pase lo que pase con el tema de la nota.
${describeLyricDna(lyricDna)}

=== 2. TEMÁTICA Y REGISTRO DE ESTA CANCIÓN (muse_profile) — el QUÉ ===
De qué trata la canción — el universo narrativo, los conceptos y hechos
que ya sabes por conversaciones anteriores en este mismo proyecto,
segmentados por registro emocional. Antes de responder, identifica en una
palabra el registro emocional de esta nota (amor / amistad / familia /
lugar / otro) y básate SOLO en su sub-perfil correspondiente de abajo —
ignora los demás, el usuario se expresa distinto según el registro:
${JSON.stringify(museProfile || {})}

Regla de oro: (1) dicta CÓMO se dice, (2) dicta DE QUÉ se habla. Nunca
dejes que la temática cambie la voz del escritor, ni que el estilo te saque
del tema real de la canción o de esta nota concreta.

Cómo funciona cada intercambio:
- El usuario te pide ayuda con algo concreto sobre esta línea.
- Si te falta contexto imprescindible para dar opciones útiles, puedes
  hacer UNA pregunta concreta antes de responder — pero solo si de verdad
  la necesitas para ayudar mejor, nunca como fin en sí misma.
- Si ya tienes contexto suficiente, da entre 5 y 6 opciones concretas,
  repartidas entre tres ángulos creativos genuinamente distintos — no tres
  variaciones tibias de la misma idea, sino tres maneras diferentes de
  resolver lo mismo:
  · "raw": crudo, hablado, casi conversacional — como si se dijera en voz
    alta sin pulir, lenguaje de calle antes que lenguaje de canción.
  · "atmospheric": anclado en un detalle sensorial físico muy concreto
    (luz, temperatura, textura, sonido, olor, momento del día) — trátalo
    como pintura, no como texto que describe una escena.
  · "abstract": un giro inesperado, una imagen que no sería la primera
    ocurrencia de nadie — el ángulo menos obvio, no el más raro porque sí.
  Etiqueta cada opción con su ángulo en el campo "angle". Dale 1-2 opciones
  a cada ángulo (para que sobrevivan al filtro de métrica/rima que viene
  después) — el resultado final que ve el usuario es una por ángulo, así
  que cada ángulo necesita variedad real detrás, no una sola apuesta.

Reglas:
- Nunca comentes ni valores la canción como espectadora — eres parte del
  proceso de escritura, no alguien mirando desde fuera.
- Ajusta tus opciones al perfil de musa adjunto: si el usuario responde
  bien a referencias literarias o culturales concretas, puedes ofrecerlas
  dentro de las opciones; si no, quédate en lo emocional y concreto.
- Nunca sermonees ni psicoanalices — eres una compañera de oficio, no
  terapia.
- Si el tema es sensible (ruptura, pérdida, alguien que ya no está), sé
  especialmente cuidadosa con el tono de tus opciones — pero sigue
  ayudando: el usuario te lo ha pedido activamente, esto no es el momento
  de quedarte callada.
- Cuando el usuario te dé contexto o responda, extrae (para el perfil de
  musa, no para mostrar) cualquier hecho reutilizable: gustos musicales,
  referencias que reconoce, temas que le importan. No expongas nunca ese
  proceso al usuario.
- Si la nota tiene más de una línea física y no está claro, por el mensaje
  del usuario ni por la conversación previa, a cuál se refiere, NO lo
  asumas — responde con action="clarify" preguntando a cuál (por número o
  citando su contenido). A los compositores les encanta hablar de su
  canción, así que preguntar nunca sobra.
- Cuando tus opciones sustituyen, completan o riman con una línea física
  YA EXISTENTE (te la paso en cada turno, numerada, con su recuento de
  sílabas), cada opción debe tener aproximadamente el mismo número de
  sílabas que esa línea (±1 sílaba) — usa el recuento que te doy como
  referencia real, no lo estimes a ojo. Indica esa línea exacta, copiada
  tal cual, en "targetLineText".
- Si en cambio propones una línea nueva que continúa la nota sin sustituir
  ninguna existente, deja "targetLineText" en null — no hay una longitud
  objetivo que cumplir.
- Cada opción es una sola línea física: sin saltos de línea, sin dos
  frases que en realidad son dos versos distintos.
- Cuando el usuario pida algo que rime, identifica la palabra objetivo y
  ponla en "rhymeTargetWord" con "isRhymeRequest": true — igual que con la
  métrica, un verificador aparte revisa después si tus opciones riman de
  verdad, así que prioriza variedad de imágenes por encima de intentar
  acertar la rima tú misma con precisión perfecta. Esto aplica también
  cuando lo que pide es rimar como una línea de referencia (suya, de otra
  canción, de un verso ya escrito) en vez de una palabra suelta: identifica
  con qué palabra termina esa línea de referencia y trátala exactamente
  igual que si el usuario la hubiera dado como palabra objetivo — "la rima
  del primer verso" o "que rime como esta línea" son peticiones de rima
  tanto como "que rime con luz".
- Repetir la misma palabra con la que se pide rimar NUNCA cuenta como
  rima, en ningún idioma — una opción que termine en esa misma palabra
  (aunque técnicamente "coincida") queda descartada por el verificador.
  Esto aplica también si esa palabra viene del nodo anterior o siguiente:
  la continuidad narrativa que se pide más abajo es de imagen y tema, no
  de repetir literalmente su última palabra.

Responde ÚNICAMENTE con un JSON de una sola línea, sin explicación, sin
markdown, con esta forma exacta:
{"register": "amor"|"amistad"|"familia"|"lugar"|"otro", "action": "clarify"|"suggest", "message": "tu pregunta si action es clarify, o una frase breve introduciendo las opciones si action es suggest", "options": [{"text": "opción 1", "angle": "raw"|"atmospheric"|"abstract"}, "..."] (array vacío si action es clarify, 5 a 6 objetos si es suggest, repartidos entre los tres ángulos), "isRhymeRequest": true|false, "rhymeTargetWord": "la palabra con la que deben rimar las opciones, o null si no aplica", "targetLineText": "la línea física exacta (copiada tal cual de la lista que te paso en el turno) que tus opciones sustituyen o completan, o null si no aplica"}
No muestres tu clasificación de registro como texto aparte, ni ningún
razonamiento — va solo dentro del JSON.`;
}

// The artist's aesthetic identity, extracted asynchronously from raw
// material dropped into the baúl (src/utils/baulProcessor.js) — a very
// different signal from museProfile: museProfile is what the muse has
// learned FROM TALKING to this person about THIS song's subject matter;
// lyricDna is what the artist's own raw material (voice notes, notebook
// photos, documents) says about how they sound, independent of any one
// song's topic. That's the CÓMO/QUÉ split the caller (buildStaticMuseInstructions)
// hierarchizes explicitly — everything worded here stays on the CÓMO side
// of that line on purpose, including imagenesHabituales: it reads like
// content (concrete images), but here it's framed as the writer's own
// recurring sensory vocabulary — texture and word choice, not subject
// matter to import — so it doesn't fight the golden rule that theme is
// muse_profile's job, never lyric_dna's.
function describeLyricDna(lyricDna) {
    const dna = lyricDna || {};
    const voz = dna.vozPropia || {};
    const influencias = dna.influenciasYReferentes || {};
    const hasContent = voz.estiloVocabulario || voz.imagenesHabituales?.length || influencias.artistasClave?.length;
    if (!hasContent) {
        return '(todavía vacío — no ha volcado nada en el baúl de inspiración, así que no fuerces una voz que no conoces).';
    }

    const parts = [];
    if (voz.estiloVocabulario) parts.push(`- Voz propia: ${voz.estiloVocabulario}`);
    if (voz.imagenesHabituales?.length) parts.push(`- Vocabulario y textura sensorial recurrente en su forma de escribir — úsalo como color de estilo, nunca como el tema de esta nota: ${voz.imagenesHabituales.join(', ')}`);
    if (voz.palabrasProhibidas?.length) parts.push(`- Conceptos abstractos de los que este artista se aleja instintivamente para no perder crudeza: ${voz.palabrasProhibidas.join(', ')}`);
    if (influencias.artistasClave?.length) parts.push(`- Referentes de tono, solo como temperatura, nunca para citar o imitar literalmente: ${influencias.artistasClave.join(', ')}`);
    if (influencias.tonoDeseado) parts.push(`- Choque de tono que busca: ${influencias.tonoDeseado}`);
    return parts.join('\n');
}

// Local narrative position — only the immediate neighbor on each side (see
// getAdjacentNotes in canvas/canvasData.js), not a fully resolved song path.
// Deliberately NOT a model-generated "summary" of the neighbor: that would
// mean an extra API call just to describe a note, and a synthetic label
// (an invented "emotion") the model would have to trust blindly. The one
// physical line that actually matters for that direction — the previous
// note's last line, the next note's first — is real data the muse can
// reason over itself, the same way it already infers register from raw
// text instead of being handed a canned label for it.
function describeNodeContext(nodeContext) {
    const { previousNote, nextNote } = nodeContext || {};
    const prev = previousNote
        ? `termina con: "${previousNote.line}"`
        : 'sin nodo anterior conectado en el hilo principal';
    const next = nextNote
        ? `empieza hacia: "${nextNote.line}"`
        : 'sin nodo siguiente conectado en el hilo principal';
    return `Ubicación de esta nota respecto a sus vecinos en el hilo principal:
- Anterior (${previousNote ? previousNote.type : '—'}): ${prev}
- Siguiente (${nextNote ? nextNote.type : '—'}): ${next}
Si hay vecino anterior y/o siguiente, tus opciones deben actuar de puente:
mantén continuidad con lo que viene del nodo anterior y prepara (sin
resolverla ya) la idea del nodo siguiente — esa resolución le toca a él,
no a esta nota. Continuidad es de imagen y tema, nunca repetir la última
palabra del nodo anterior como si eso bastara.`;
}

// Everything that's different on every single call, by definition — never
// worth caching, so it's kept out of the static block entirely rather than
// invalidating that block's cache on every turn.
function buildDynamicMuseContext({verseText, noteFunction, conversation, lang, dialect, nodeContext}) {
    // Bounded on purpose: an unbounded transcript would make input tokens
    // (and thus cost/latency) grow with every turn of a long conversation on
    // the same line. Three turns is enough for the model to track what it
    // already asked/offered without re-litigating early exchanges — the
    // museProfile is what carries anything that needs to survive longer
    // than that.
    const recentConversation = conversation.slice(-3);
    return `Nota actual (${noteFunction}), línea por línea física — usa estos
recuentos de sílabas y claves de rima tal cual, no los recalcules
(consonante = coincide todo desde la vocal tónica; asonante = solo las
vocales coinciden):
${describePhysicalLines(verseText, lang, dialect)}

${describeNodeContext(nodeContext)}

Conversación hasta ahora sobre esta línea:
${formatConversation(recentConversation)}

Recuerda: responde solo con el JSON descrito arriba, nada más.`;
}

// Pure and synchronous on purpose — just measures what's already been
// built, no API involvement, so it's independently testable and safe to
// call whether or not debug mode is on.
export function calculateContextWeights(staticText, dynamicText, userMessage) {
    const staticChars = staticText?.length || 0;
    const dynamicChars = dynamicText?.length || 0;
    const userChars = userMessage?.length || 0;
    const totalChars = staticChars + dynamicChars + userChars;
    const pct = (n) => `${totalChars > 0 ? Math.round((n / totalChars) * 100) : 0}%`;
    return {
        museProfileAndSystem: {charCount: staticChars, percentage: pct(staticChars)},
        localNodeAndLines: {charCount: dynamicChars, percentage: pct(dynamicChars)},
        userIntent: {charCount: userChars, percentage: pct(userChars)},
        totalChars,
    };
}

function parseCompanionResponse(raw) {
    try {
        const cleaned = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        const register = MUSE_REGISTERS.includes(parsed.register) ? parsed.register : 'otro';
        const action = parsed.action === 'clarify' ? 'clarify' : 'suggest';
        const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
        // Each option is {text, angle} — but a bare string is tolerated and
        // normalized (angle: null) rather than dropped, same "sanitize what's
        // salvageable" spirit as baulProcessor's parsing: a model that slips
        // and forgets the wrapper shouldn't lose the actual suggestion.
        const options = action === 'suggest' && Array.isArray(parsed.options)
            ? parsed.options
                .map((o) => (typeof o === 'string' ? {text: o, angle: null} : o))
                .filter((o) => o && typeof o.text === 'string' && o.text.trim())
                .map((o) => ({
                    text: o.text.trim(),
                    angle: MUSE_ANGLES.includes(o.angle) ? o.angle : null,
                }))
            : [];

        // A syntactically valid JSON reply that's *empty* (no message, no
        // options) used to sail straight through as a "successful" response —
        // it got saved and rendered as a blank bubble, which reads as "the
        // muse isn't answering" when what actually happened is the model
        // returned nothing usable. Treat this the same as a parse failure so
        // it surfaces as a visible error instead of a silent no-op.
        if (!message && options.length === 0) {
            console.error('muse returned an empty response:', raw);
            throw new Error('empty response');
        }

        return {
            register, action, message, options,
            isRhymeRequest: Boolean(parsed.isRhymeRequest),
            rhymeTargetWord: typeof parsed.rhymeTargetWord === 'string' ? parsed.rhymeTargetWord.trim() : null,
            targetLineText: typeof parsed.targetLineText === 'string' ? parsed.targetLineText.trim() : null,
        };
    } catch {
        // A malformed reply shouldn't break the feature — fall back to treating
        // the raw text as a clarifying message under a default register. If
        // raw itself is empty (the API genuinely returned nothing), surface
        // that plainly instead of trying to save blank/null content — content
        // is NOT NULL in the DB, so a null here would fail the save anyway,
        // just as a confusing Postgres error instead of a clear one.
        console.error('muse response failed to parse:', raw);
        return {
            register: 'otro', action: 'clarify',
            message: raw.trim() || '(la musa no ha podido responder — inténtalo de nuevo)',
            options: [], isRhymeRequest: false, rhymeTargetWord: null,
            targetLineText: null,
        };
    }
}

/**
 * Ask the muse for help with one note's line — the core companion
 * exchange. Not idempotent: each call is one turn in an ongoing
 * conversation, so pass the full prior conversation every time.
 * @param {{verseText: string, noteFunction: string, museProfile: object,
 *   lyricDna?: object, userMessage: string,
 *   conversation?: {role: 'user'|'muse', content: string,
 *   options?: {text: string, angle: string|null}[]}[], lang?: string,
 *   dialect?: string, nodeContext?: {previousNote: {type: string, line: string}|null,
 *   nextNote: {type: string, line: string}|null}, debug?: boolean}} args
 * @returns {Promise<{register: string, action: 'clarify'|'suggest',
 *   message: string, options: {text: string, angle: string|null}[],
 *   isRhymeRequest: boolean, rhymeVerified: boolean, _debug?: object}>}
 */
export async function askMuse({
                                  verseText,
                                  noteFunction,
                                  museProfile,
                                  lyricDna,
                                  userMessage,
                                  conversation = [],
                                  lang = 'es',
                                  dialect = 'central',
                                  nodeContext,
                                  debug = false,
                              }) {
    // Built as named strings, not inline in the array below, for two
    // reasons: calculateContextWeights needs the raw text to measure, and
    // debug mode wants to show them verbatim — neither should require
    // re-deriving what was actually sent.
    const staticText = buildStaticMuseInstructions(lyricDna, museProfile);
    const dynamicText = buildDynamicMuseContext({verseText, noteFunction, conversation, lang, dialect, nodeContext});

    // Two content blocks, not one string: cache_control can only mark a
    // block boundary, so the stable instructions (which we want Anthropic to
    // cache and reuse across every turn of this conversation) and the
    // per-turn note/conversation data (which must never be cached, since
    // it's different every time — including nodeContext, which changes
    // whenever the user opens the muse on a different note) have to be
    // physically separate blocks.
    const system = [
        {type: 'text', text: staticText, cache_control: {type: 'ephemeral'}},
        {type: 'text', text: dynamicText},
    ];
    // 600, not 400: options are now {text, angle} objects across three
    // creative angles instead of bare strings, which runs a bit longer.
    const startedAt = Date.now();
    const raw = await callClaude(system, userMessage, 600);
    const latencyMs = Date.now() - startedAt;
    const parsed = parseCompanionResponse(raw);

    if (parsed.action === 'suggest' && parsed.targetLineText && parsed.options.length) {
        const targetSyllables = countLineSyllables(parsed.targetLineText, lang);

        if (targetSyllables > 0) {
            const verifiedByMetric = parsed.options.filter((opt) => {
                const optSyllables = countLineSyllables(opt.text, lang);
                return Math.abs(optSyllables - targetSyllables) <= 1;
            });
            // Narrows the pool if the metric filter found real survivors —
            // does NOT cap to a final count yet, that's selectDiverseAngles'
            // job below, once rhyme has also had a chance to narrow it.
            if (verifiedByMetric.length > 0) parsed.options = verifiedByMetric;
        }
    }

    // Hard-checked, not just prompted for: the model is asked to rhyme
    // correctly, but only rhyme.js's own rules (already dialect-aware) get
    // to decide what actually counts. Options that don't pass are dropped —
    // unless that would empty the list entirely, in which case showing
    // unverified candidates beats a dead end.
    if (parsed.action === 'suggest' && parsed.isRhymeRequest && parsed.rhymeTargetWord && parsed.options.length) {
        const targetKey = getWordRhymeKey(parsed.rhymeTargetWord, lang, dialect);
        if (targetKey) {
            const verified = parsed.options.filter((opt) => wordMatchesRhyme(opt.text, targetKey, lang, dialect));
            if (verified.length) {
                parsed.options = verified;
                parsed.rhymeVerified = true;
            } else {
                parsed.rhymeVerified = false;
            }
        }
    }

    // Final step, after metric/rhyme have already narrowed the pool: pick
    // one survivor per creative angle instead of just the first 3 that
    // passed. Without this, the metric/rhyme filters alone could easily
    // leave 3 "raw" options and zero from the other two angles — technically
    // valid, but not the genuinely-distinct-directions promise the prompt
    // is asking the model for.
    if (parsed.action === 'suggest' && parsed.options.length) {
        parsed.options = selectDiverseAngles(parsed.options, 3);
    }

    if (debug) {
        parsed._debug = {
            latencyMs,
            model: MUSE_MODEL,
            // temperature is genuinely not overridden — see callClaude's own
            // comment. Reporting a made-up value here would defeat the whole
            // point of an observability panel: it has to say what actually
            // happened, not what a prompt once asked for.
            parameters: {temperature: 'default (1.0, not overridden)', thinking: 'disabled'},
            weights: calculateContextWeights(staticText, dynamicText, userMessage),
            rawSystemPrompt: staticText,
            rawDynamicContext: dynamicText,
        };
    }
    return parsed;
}

// One candidate per angle, in the order angles first appear, then backfills
// from whatever's left over if fewer than `limit` distinct angles survived
// the metric/rhyme filters above — never shrinks the result just because
// one angle happened to get filtered out entirely.
function selectDiverseAngles(options, limit) {
    const seen = new Set();
    const byAngle = [];
    const rest = [];
    for (const opt of options) {
        if (opt.angle && !seen.has(opt.angle)) {
            seen.add(opt.angle);
            byAngle.push(opt);
        } else {
            rest.push(opt);
        }
    }
    const result = byAngle.slice(0, limit);
    for (const opt of rest) {
        if (result.length >= limit) break;
        result.push(opt);
    }
    return result;
}

// ─── Profile refresh — isolated on purpose (see file header) ───────────────

function buildProfileSummaryPrompt(register, existingSubProfile, userMessages) {
    const transcript = userMessages.map((m, i) => `${i + 1}. "${m}"`).join('\n');

    return `Eres un analista que mantiene el perfil cultural de un compositor dentro
de una app de composición musical, para que una IA "musa" calibre mejor
las opciones que le ofrece.

Sub-perfil actual del usuario para el registro "${register}":
"${existingSubProfile || '(vacío, primera actualización)'}"

Cosas que el usuario ha pedido o comentado recientemente en ese mismo
registro:
${transcript}

Resume en un único párrafo corto (máximo 4-5 frases) qué hemos aprendido
de los gustos e intereses culturales de este usuario específicamente para
el registro "${register}": referencias que reconoce o disfruta, temas que
le importan, el tono con el que se expresa. Combina esto con el sub-perfil
actual — actualízalo, no lo ignores. Responde ÚNICAMENTE con el texto del
párrafo, sin comillas ni explicación adicional.`;
}

/**
 * Called after every N user turns in one register (see museData.js) —
 * change N or this prompt without touching askMuse or anything upstream.
 * @param {{register: string, existingSubProfile: string, userMessages: string[]}} args
 * @returns {Promise<string>} the updated sub-profile paragraph
 */
export async function summarizeMuseProfile({register, existingSubProfile, userMessages}) {
    const system = buildProfileSummaryPrompt(register, existingSubProfile, userMessages);
    const raw = await callClaude(system, 'Actualiza el sub-perfil.', 300);
    return raw.trim();
}
