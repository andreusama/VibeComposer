// ─── Muse — Claude calls ────────────────────────────────────────────────────
// Two isolated things live here on purpose: the companion conversation
// (askMuse) and periodically summarizing what's been learned into the
// project's single evolving profile (summarizeMuseProfile). They share only
// the low-level callClaude() helper — nothing about adjusting N or the
// summary prompt should ever require touching the conversation path, or
// vice versa.
//
// The muse is a co-writer sitting next to the composer, not a spectator —
// four explicit modes (SURGEON/ARCHITECT/SOCRATIC/WORD_BANK) instead of one
// generic "give me options" funnel, since what a composer needs varies a lot
// turn to turn: sometimes it's a precise swap of a chosen fragment, sometimes
// it's resolving an unfinished thought, sometimes it's just direction, and
// sometimes it's raw vocabulary, not crafted lines.

import {API_URL, checkAndIncrementLimit} from './api.js';
import {getLineRhymeKey, getWordRhymeKey, wordMatchesRhyme} from './rhyme.js';
import {splitIntoLines} from './textLines.js';
import {countLineSyllables} from './syllables.js';
import {significantWords} from './repeatedWords.js';

// Kept separate from api.js's own API_MODEL on purpose — that one backs the
// vibe-compose chord generator and wasn't meant to move just because this
// feature wants a specific model.
const MUSE_MODEL = 'claude-sonnet-5';

export const MUSE_ACTION_TYPES = ['SURGEON', 'ARCHITECT', 'SOCRATIC', 'WORD_BANK'];
// Secondary, per-suggestion flavor axis — independent of MUSE_TYPES below.
// A CONTINUITY suggestion can be raw, atmospheric, or abstract just as
// easily as a CONTRAST or RESOLUTION one; this never drives which
// suggestions survive the final selection, only how each one reads.
export const MUSE_ANGLES = ['raw', 'atmospheric', 'abstract'];
// Primary diversity axis for SURGEON/ARCHITECT suggestions — narrative
// function (what the line DOES) rather than tone (how it sounds). This is
// the axis selectDiverseSuggestions actually selects across.
export const MUSE_TYPES = ['CONTINUITY', 'CONTRAST', 'RESOLUTION'];

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
            // problem (see the type/angle axes below), not a sampling one.
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
            const optionsText = turn.options?.length
                ? ` Opciones ofrecidas: ${turn.options.map((o) => `"${typeof o === 'string' ? o : o.text}"`).join(', ')}`
                : '';
            return `Tú (musa, modo ${turn.action_type || '—'}): "${turn.content}"${optionsText}`;
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

// Describes exactly which fragment the user selected in the textarea (the
// Genius-style "select a piece, ask about it" flow) — authoritative data,
// not something the model has to infer from a free-text description of
// which line it means. Only ever present for SURGEON-shaped asks.
function describeTargetVerse(targetVerse) {
    if (!targetVerse) return null;
    const fullLine = `${targetVerse.before}${targetVerse.text}${targetVerse.after}`;
    return `El usuario ha SELECCIONADO explícitamente este fragmento exacto — no lo
infieras de otra parte del mensaje, es un dato autoritativo:
- Fragmento seleccionado: "${targetVerse.text}"
- Línea completa donde vive ese fragmento: "${fullLine}" (antes: "${targetVerse.before}", después: "${targetVerse.after}")
Cuando actúes en modo SURGEON sobre este fragmento, "targetLineText" en tu
respuesta debe ser exactamente esa línea completa, copiada tal cual.`;
}

// Split in two on purpose, for Anthropic prompt caching: everything in here
// is identical across every turn of a conversation on the same song (it only
// changes when museProfile/lyricDna themselves get rewritten — by the
// periodic summary or by a new baúl entry), so it's the piece worth paying
// the one-time cache-write cost on and reading back cheaply on every
// follow-up turn within the session. Per-note, per-turn content (the line
// breakdown, the selected fragment, the recent conversation) lives in
// buildDynamicMuseContext instead, uncached, since caching it would never
// hit — it's different on every call by definition.
function buildStaticMuseInstructions({lyricDna, museProfile, lang = 'es', dialect = 'central'}) {
    return `Eres "La Musa", un co-writer experto y colega de estudio sentado al lado
del compositor. Tu función es asistir y ofrecer material bruto o ideas de
ingeniería poética. JAMÁS juzgas las decisiones del artista, ni usas relleno
melodramático ("slop") ni frases vacías de cortesía. Nunca comentas ni
valoras la canción como espectadora — eres parte del proceso de escritura,
no alguien mirando desde fuera. Nunca sermoneas ni psicoanalizas.

=== 1. IDIOMA Y FONÉTICA DIALECTAL ===
- Idioma base: ${lang}
- Dialecto / registro regional: ${dialect}
- Regla fonética: evalúa métrica y rimas según la PRONUNCIACIÓN REAL del
  dialecto, no la ortografía académica estricta. Hoy solo existen tres
  combinaciones válidas de idioma+dialecto en este proyecto — razona la
  fonética según cuál te ha tocado:
  · es / central: castellano estándar. Elisiones coloquiales habituales en
    lenguaje cantado/hablado ("pa'" por "para", "na'" por "nada", apócopes)
    son válidas si el registro de la nota es informal, pero no inventes
    seseo ni yeísmo regional — el castellano central no los tiene.
  · ca / oriental: catalán oriental — las vocales átonas se neutralizan
    (reducción vocálica), afecta a qué asonancias suenan iguales.
  · ca / occidental: catalán occidental — vocales átonas más diferenciadas
    que en oriental, no asumas la misma reducción.
  La métrica cantada prima sobre la ortografía académica estricta en
  cualquiera de los tres casos.

=== 2. ESTILO DEL ESCRITOR (lyric_dna — CÓMO) ===
Invariable a nivel de TODA la canción: no de qué habla esta nota en
concreto, sino cómo suena esta persona cuando escribe — léxico, actitud,
nivel de abstracción, complejidad métrica. Tus opciones DEBEN sonar con
esta voz pase lo que pase con el tema de la nota.
${JSON.stringify(lyricDna || {})}

=== 3. UNIVERSO DE LA CANCIÓN (muse_profile — QUÉ) ===
La temática, conceptos clave y atmósfera de ESTA canción, aprendidos de
conversaciones anteriores. No viene pre-filtrada por tema — identifica tú
qué partes son relevantes para la nota actual, y ten en cuenta que un solo
verso puede tocar más de un tema a la vez:
${JSON.stringify(museProfile || {})}

Regla de oro: el estilo (2) dicta CÓMO se habla; la temática (3) dicta QUÉ
se dice. Nunca dejes que la temática cambie la voz del escritor, ni que el
estilo te saque del tema real de la canción o de esta nota concreta.

Cuando el usuario te dé contexto o responda, extrae (para el perfil de la
canción, no para mostrar) cualquier hecho reutilizable: gustos, referencias
que reconoce, temas que le importan, detalles concretos de su universo. No
expongas nunca ese proceso al usuario — va solo en el campo "themes" de tu
JSON de salida, nunca en el texto que lee.

Si el tema es sensible (ruptura, pérdida, alguien que ya no está), sé
especialmente cuidadosa con el tono — pero sigue ayudando activamente: el
usuario te lo ha pedido, esto no es momento de quedarte callada.

=== 4. MODOS DE ACTUACIÓN (elige ÚNICAMENTE UNO según el contexto) ===

1. SURGEON: reemplazo o ajuste quirúrgico de un fragmento o línea concreta
   ("targetVerse"). Se usa cuando hay un fragmento identificado con
   precisión — porque el usuario lo ha seleccionado explícitamente (te lo
   paso ya marcado como dato autoritativo cuando ocurre) o porque lo ha
   señalado sin ambigüedad en su mensaje. Mantiene la métrica exacta de la
   línea que sustituye.
2. ARCHITECT: resolución o remate de un verso incompleto/estrofa, sin un
   fragmento concreto que sustituir. Analiza los motivos internos (ej.
   repetición de fonemas) y el flujo narrativo (nota anterior → esta nota →
   nota siguiente, te paso ese contexto en cada turno).
3. SOCRATIC: se activa (a) si el usuario está atascado o pide dirección, o
   (b) si la nota tiene más de una línea física y no está claro por el
   mensaje ni por la conversación previa a cuál se refiere — en ese caso NO
   asumas, pregunta cuál (por número o citando su contenido). Lanza UNA sola
   pregunta estratégica con chips de respuesta rápida. NO genera versos.
4. WORD_BANK: genera un diccionario de rimas/palabras puras organizadas por
   sílabas. Se activa al pedir vocabulario explícito. NO genera versos ni
   juzga si la palabra es "bonita".

Para SURGEON y ARCHITECT: internamente genera 5-6 candidatos repartidos
entre los tres tipos narrativos de abajo, no solo 3 — un verificador aparte
comprueba después si cumplen la métrica y la rima exactas, así que necesitas
margen real para que sobrevivan suficientes tras el filtro. El campo
"suggestions" de tu JSON debe llevar esos 5-6, no solo 3.

Regla dura sobre vocabulario: NUNCA reutilices una palabra significativa
(sustantivo, verbo, adjetivo — no artículos/preposiciones/conectores) que ya
aparece UNA SOLA VEZ en otra línea de esta misma nota — cada línea aporta
léxico nuevo, ningún buen escritor repite vocabulario porque sí. Excepción:
si una palabra ya aparece 2 o más veces en la nota, es un gancho deliberado
del propio compositor (juego de palabras, motivo que sostiene la estrofa) y
SÍ puedes seguir usándola — ahí lo que sería un error es evitarla. Un
verificador aparte aplica esta misma distinción después, así que no la
rompas por tu cuenta.

Regla dura de continuidad, igual de importante: evitar una palabra NUNCA es
excusa para abandonar el tema, el campo de imágenes o la idea que la nota ya
tiene establecida. Si no puedes reutilizar una palabra concreta, sigue
expresando la MISMA idea con vocabulario distinto — no saltes a una metáfora
o campo semántico nuevo sin relación con lo que ya hay (si la nota habla de
frío/ocultarse/espacio, tu sugerencia sigue hablando de frío/ocultarse/
espacio, nunca de algo ajeno como apuestas o dinero solo porque sonaba bien
y evitaba la palabra prohibida). Vocabulario nuevo, tema idéntico.

Cada sugerencia lleva dos etiquetas independientes:
- "type" (obligatorio, elige uno): "CONTINUITY" sigue la misma dirección
  emocional/narrativa que ya lleva la nota; "CONTRAST" introduce un giro o
  tensión que rompe la dirección esperada; "RESOLUTION" cierra o resuelve lo
  que el verso venía planteando. Una sugerencia CONTINUITY puede sonar tan
  cruda, atmosférica o abstracta como una CONTRAST o una RESOLUTION — son
  ejes independientes.
- "angle" (obligatorio, elige uno): "raw" (crudo, hablado, casi
  conversacional, lenguaje de calle antes que de canción), "atmospheric"
  (anclado en un detalle sensorial físico muy concreto — luz, temperatura,
  textura, sonido, olor, momento del día — trátalo como pintura, no como
  texto que describe una escena), "abstract" (un giro inesperado, una
  imagen que no sería la primera ocurrencia de nadie).
Trata el lenguaje como pintura cruda, no como piezas de un rompecabezas que
deben encajar perfecto. Cuando algo te salga "bonito" pero genérico, la
primera frase que se te ocurre, esa es la que menos vale — sigue un paso
más allá de ahí.

Cuando el usuario pida algo que rime (en SURGEON o ARCHITECT), identifica la
palabra objetivo y ponla en "rhymeTargetWord" con "isRhymeRequest": true —
un verificador aparte revisa después si tus opciones riman de verdad, así
que prioriza variedad de imágenes por encima de intentar acertar la rima tú
misma con precisión perfecta. Esto aplica también cuando lo que pide es
rimar como una línea de referencia en vez de una palabra suelta: identifica
con qué palabra termina esa línea y trátala igual que si fuera la palabra
objetivo. Repetir la misma palabra con la que se pide rimar NUNCA cuenta
como rima, en ningún idioma.

=== 5. FORMATO DE SALIDA (JSON ESTRICTO) ===
Responde EXCLUSIVAMENTE con un JSON de una sola línea, sin explicación, sin
markdown. Todas las formas llevan además "themes": array de 1-3 palabras o
frases cortas libres describiendo de qué trata esta nota/turno (para
aprender el perfil de la canción — nunca mostrado al usuario, puede estar
vacío si no hay nada nuevo que aprender).

SI action_type == "SURGEON" o "ARCHITECT":
{"action_type": "SURGEON"|"ARCHITECT", "reasoning": "explicación técnica/fonética de 1 frase", "targetLineText": "la línea física exacta (copiada tal cual) que tus opciones sustituyen o completan, o null si es una línea nueva sin longitud objetivo", "isRhymeRequest": true|false, "rhymeTargetWord": "palabra objetivo o null", "suggestions": [{"text": "verso propuesto", "type": "CONTINUITY"|"CONTRAST"|"RESOLUTION", "angle": "raw"|"atmospheric"|"abstract"}, "... (5-6 en total)"], "themes": ["..."]}

SI action_type == "SOCRATIC":
{"action_type": "SOCRATIC", "reasoning": "justificación del bloqueo o de la ambigüedad detectada", "question": {"text": "¿pregunta concisa para dirigir la intención o desambiguar?", "options": ["opción A", "opción B", "opción C"]}, "themes": ["..."]}

SI action_type == "WORD_BANK":
{"action_type": "WORD_BANK", "target_rhyme": "una palabra real de ejemplo que ancla la rima pedida (no solo la terminación abstracta)", "rhyme_type": "consonante"|"asonante", "word_groups": [{"syllables": 2, "words": ["palabra1", "palabra2", "palabra3"]}, {"syllables": 3, "words": ["palabra4", "palabra5"]}, {"short_phrases": ["frase de 2-3 palabras 1", "frase de 2-3 palabras 2"]}], "themes": ["..."]}

No muestres tu clasificación de modo o de tema como texto aparte, ni ningún
razonamiento fuera de estos campos — va solo dentro del JSON.`;
}

// Full main-thread song context, not just the immediate neighbor — every
// note connected via note_links (see resolveMainThreadPath in
// canvas/canvasData.js), in order, whole current text. Deliberately NOT a
// model-generated "summary" of each note: that would mean an extra API call
// per note just to describe it, and a synthetic label the model would have
// to trust blindly. Every main-thread note is short (a handful of lyric
// lines), so the model reads the real text and works out what it means
// itself — the same way it already infers themes from raw text instead of
// being handed a canned label for it. Lets a chorus (or any node) answer
// "what's the first verse about" even when it isn't the adjacent note.
function describeSongStructure(songStructure) {
    const { before = [], after = [] } = songStructure || {};
    const describe = (n) => `${n.type}: "${(n.text || '(vacía)').replace(/\n/g, ' / ')}"`;
    const beforeText = before.length
        ? before.map(describe).join('\n')
        : 'sin notas anteriores conectadas en el hilo principal';
    const afterText = after.length
        ? after.map(describe).join('\n')
        : 'sin notas siguientes conectadas en el hilo principal';
    return `Estructura completa de la canción conectada al hilo principal, en orden.
Puedes referenciar el contenido de CUALQUIERA de estas notas si el usuario
te pregunta por ellas (de qué trata tal verso, qué dice el estribillo...),
no solo la inmediatamente anterior o siguiente:

ANTES de esta nota (de más lejana a más cercana):
${beforeText}

DESPUÉS de esta nota (de más cercana a más lejana):
${afterText}

Para continuidad narrativa (no para responder preguntas sobre el contenido):
tus opciones deben actuar de puente con la nota INMEDIATAMENTE más cercana
en cada dirección — mantén continuidad con lo último que dice la más
cercana anterior y prepara (sin resolverla ya) la idea de la más cercana
siguiente, esa resolución le toca a ella, no a esta nota. Continuidad es de
imagen y tema, nunca repetir la última palabra de la nota anterior como si
eso bastara.`;
}

// Everything that's different on every single call, by definition — never
// worth caching, so it's kept out of the static block entirely rather than
// invalidating that block's cache on every turn.
function buildDynamicMuseContext({verseText, noteFunction, conversation, lang, dialect, songStructure, targetVerse, forceMode}) {
    // Bounded on purpose: an unbounded transcript would make input tokens
    // (and thus cost/latency) grow with every turn of a long conversation on
    // the same line. Three turns is enough for the model to track what it
    // already asked/offered without re-litigating early exchanges — the
    // museProfile is what carries anything that needs to survive longer
    // than that.
    const recentConversation = conversation.slice(-3);
    const targetVerseBlock = describeTargetVerse(targetVerse);
    // A dedicated UI element (the mobile "Rhyme" pill) already unambiguously
    // signals which mode this turn needs — no reason to leave that to the
    // model's own free-text interpretation the way an open-ended message
    // has to. Placed right before the final reminder so it's the last thing
    // read, closest to where the model commits to its action_type.
    const forceModeBlock = forceMode
        ? `\nINSTRUCCIÓN OBLIGATORIA PARA ESTE TURNO: responde EXCLUSIVAMENTE en modo ${forceMode}, sin excepción, independientemente de cómo interpretarías el mensaje del usuario en otro contexto.\n`
        : '';
    return `Nota actual (${noteFunction}), línea por línea física — usa estos
recuentos de sílabas y claves de rima tal cual, no los recalcules
(consonante = coincide todo desde la vocal tónica; asonante = solo las
vocales coinciden):
${describePhysicalLines(verseText, lang, dialect)}

${targetVerseBlock ? targetVerseBlock + '\n\n' : ''}${describeSongStructure(songStructure)}

Conversación hasta ahora sobre esta línea:
${formatConversation(recentConversation)}
${forceModeBlock}
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

function normalizeSuggestion(s) {
    if (!s || typeof s.text !== 'string' || !s.text.trim()) return null;
    return {
        text: s.text.trim(),
        type: MUSE_TYPES.includes(s.type) ? s.type : null,
        angle: MUSE_ANGLES.includes(s.angle) ? s.angle : null,
    };
}

function parseSurgeonOrArchitect(parsed, actionType) {
    const suggestions = Array.isArray(parsed.suggestions)
        ? parsed.suggestions.map(normalizeSuggestion).filter(Boolean)
        : [];
    return {
        action_type: actionType,
        message: typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '',
        suggestions,
        question: null,
        wordBank: null,
        targetLineText: typeof parsed.targetLineText === 'string' ? parsed.targetLineText.trim() : null,
        isRhymeRequest: Boolean(parsed.isRhymeRequest),
        rhymeTargetWord: typeof parsed.rhymeTargetWord === 'string' ? parsed.rhymeTargetWord.trim() : null,
    };
}

function parseSocratic(parsed) {
    const question = parsed.question || {};
    const options = Array.isArray(question.options)
        ? question.options.filter((o) => typeof o === 'string' && o.trim()).map((o) => o.trim())
        : [];
    return {
        action_type: 'SOCRATIC',
        message: typeof question.text === 'string' ? question.text.trim() : '',
        suggestions: [],
        question: {text: typeof question.text === 'string' ? question.text.trim() : '', options},
        wordBank: null,
        targetLineText: null,
        isRhymeRequest: false,
        rhymeTargetWord: null,
    };
}

function parseWordBank(parsed) {
    const wordGroups = Array.isArray(parsed.word_groups)
        ? parsed.word_groups.map((g) => ({
            syllables: typeof g.syllables === 'number' ? g.syllables : null,
            words: Array.isArray(g.words) ? g.words.filter((w) => typeof w === 'string' && w.trim()) : [],
            shortPhrases: Array.isArray(g.short_phrases) ? g.short_phrases.filter((p) => typeof p === 'string' && p.trim()) : [],
        }))
        : [];
    const targetRhyme = typeof parsed.target_rhyme === 'string' ? parsed.target_rhyme.trim() : '';
    const rhymeType = parsed.rhyme_type === 'asonante' ? 'asonante' : 'consonante';
    return {
        action_type: 'WORD_BANK',
        message: targetRhyme ? `banco de palabras — rima ${rhymeType} con "${targetRhyme}"` : 'banco de palabras',
        suggestions: [],
        question: null,
        wordBank: {targetRhyme, rhymeType, wordGroups},
        targetLineText: null,
        isRhymeRequest: false,
        rhymeTargetWord: null,
    };
}

export function parseCompanionResponse(raw) {
    try {
        const cleaned = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        const actionType = MUSE_ACTION_TYPES.includes(parsed.action_type) ? parsed.action_type : null;
        if (!actionType) throw new Error('missing/invalid action_type');

        const themes = Array.isArray(parsed.themes)
            ? parsed.themes.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
            : [];

        let result;
        if (actionType === 'SURGEON' || actionType === 'ARCHITECT') result = parseSurgeonOrArchitect(parsed, actionType);
        else if (actionType === 'SOCRATIC') result = parseSocratic(parsed);
        else result = parseWordBank(parsed);

        // A syntactically valid JSON reply that's *empty* (no message, no
        // suggestions/question/wordBank) used to sail straight through as a
        // "successful" response — it got saved and rendered as a blank
        // bubble. Treat this the same as a parse failure so it surfaces as a
        // visible error instead of a silent no-op.
        const hasContent = result.message || result.suggestions.length || result.wordBank?.wordGroups.length;
        if (!hasContent) {
            console.error('muse returned an empty response:', raw);
            throw new Error('empty response');
        }

        return {...result, themes};
    } catch {
        // A malformed reply shouldn't break the feature — fall back to treating
        // the raw text as a clarifying (SOCRATIC-shaped) message. If raw itself
        // is empty (the API genuinely returned nothing), surface that plainly
        // instead of trying to save blank/null content — content is NOT NULL
        // in the DB, so a null here would fail the save anyway, just as a
        // confusing Postgres error instead of a clear one.
        console.error('muse response failed to parse:', raw);
        return {
            action_type: 'SOCRATIC',
            message: raw.trim() || '(la musa no ha podido responder — inténtalo de nuevo)',
            suggestions: [], question: {text: raw.trim(), options: []}, wordBank: null,
            targetLineText: null, isRhymeRequest: false, rhymeTargetWord: null, themes: [],
        };
    }
}

/**
 * Verify (never just trust) a parsed muse response against deterministic
 * rules, mutating and returning `parsed` in place. Split out of askMuse on
 * purpose: this is the part actually worth unit-testing without a network
 * call — every rule here mirrors an instruction given to the model in
 * buildStaticMuseInstructions, and if one changes, the other needs to too.
 * @param {object} parsed - the parseCompanionResponse() result to verify
 * @param {{verseText: string, targetVerse?: {text: string, before: string,
 *   after: string}|null, lang?: string, dialect?: string}} ctx
 * @returns {object} the same `parsed` object, filtered in place
 */
export function applyMuseVerification(parsed, {verseText, targetVerse, lang = 'es', dialect = 'central'}) {
    if ((parsed.action_type === 'SURGEON' || parsed.action_type === 'ARCHITECT') && parsed.suggestions.length) {
        // Ground truth for the target line: an explicit user selection beats
        // the model's own echo, since we already know it for certain — the
        // model's targetLineText is only the fallback when nothing was
        // selected (see describeTargetVerse's instruction to echo it back).
        const targetLine = targetVerse ? `${targetVerse.before}${targetVerse.text}${targetVerse.after}` : parsed.targetLineText;

        if (targetLine) {
            const targetSyllables = countLineSyllables(targetLine, lang);
            if (targetSyllables > 0) {
                const verifiedByMetric = parsed.suggestions.filter((s) => {
                    const optSyllables = countLineSyllables(s.text, lang);
                    return Math.abs(optSyllables - targetSyllables) <= 1;
                });
                // Narrows the pool if the metric filter found real survivors —
                // does NOT cap to a final count yet, that's
                // selectDiverseSuggestions' job below, once rhyme has also had
                // a chance to narrow it.
                if (verifiedByMetric.length > 0) parsed.suggestions = verifiedByMetric;
            }
        }

        // Hard-checked, not just prompted for: no good lyric repeats a
        // content word already used elsewhere in the same note — the model
        // is told this, but only this filter actually enforces it. Compares
        // against every OTHER physical line (the one being replaced doesn't
        // count against its own replacement). Words already repeated 2+
        // times are excluded from the ban — that's not an accident, it's the
        // note's own deliberate hook/wordplay (e.g. a stanza built around
        // repeating "arte"), and banning the word that carries the stanza's
        // actual device is what pushed suggestions into unrelated imagery
        // the one time this went untested — see project memory. Same
        // narrows-only-if-survivors safety valve as the filters around it.
        const wordCounts = new Map();
        splitIntoLines(verseText)
            .filter((l) => l && l !== targetLine?.trim())
            .flatMap((l) => significantWords(l))
            .forEach((w) => wordCounts.set(w, (wordCounts.get(w) || 0) + 1));
        const existingWords = new Set([...wordCounts].filter(([, count]) => count === 1).map(([w]) => w));
        if (existingWords.size && parsed.suggestions.length) {
            const original = parsed.suggestions.filter((s) => !significantWords(s.text).some((w) => existingWords.has(w)));
            if (original.length > 0) parsed.suggestions = original;
        }

        // Hard-checked, not just prompted for: the model is asked to rhyme
        // correctly, but only rhyme.js's own rules (already dialect-aware) get
        // to decide what actually counts. Options that don't pass are dropped
        // — unless that would empty the list entirely, in which case showing
        // unverified candidates beats a dead end.
        if (parsed.isRhymeRequest && parsed.rhymeTargetWord && parsed.suggestions.length) {
            const targetKey = getWordRhymeKey(parsed.rhymeTargetWord, lang, dialect);
            if (targetKey) {
                const verified = parsed.suggestions.filter((s) => wordMatchesRhyme(s.text, targetKey, lang, dialect));
                if (verified.length) {
                    parsed.suggestions = verified;
                    parsed.rhymeVerified = true;
                } else {
                    parsed.rhymeVerified = false;
                }
            }
        }

        // Final step, after metric/rhyme have already narrowed the pool: pick
        // one survivor per narrative type instead of just the first 3 that
        // passed. Without this, the metric/rhyme filters alone could easily
        // leave 3 "CONTINUITY" suggestions and zero from the other two types
        // — technically valid, but not the genuinely-distinct-directions
        // promise the prompt is asking the model for.
        parsed.suggestions = selectDiverseSuggestions(parsed.suggestions, 3);
    }

    if (parsed.action_type === 'WORD_BANK' && parsed.wordBank) {
        // Same word-repetition rule as SURGEON/ARCHITECT: a rhyme bank that
        // hands back a word already sitting in the note isn't offering
        // anything new. minLength 2 here, not the usual 3 — rhyme words
        // legitimately run shorter than a full line's vocabulary.
        const existingWords = new Set(significantWords(verseText, 2));
        if (existingWords.size) {
            const isFresh = (w) => !significantWords(w, 2).some((tok) => existingWords.has(tok));
            parsed.wordBank.wordGroups = parsed.wordBank.wordGroups.map((g) => ({
                ...g,
                words: g.words.filter(isFresh),
                shortPhrases: g.shortPhrases.filter(isFresh),
            }));
        }

        // Same "verify, don't trust" philosophy as rhyme above: each
        // generated word only survives if rhyme.js itself confirms it
        // rhymes with the model's own anchor word — a plausible-sounding
        // word that doesn't actually rhyme is worse than a shorter, honest
        // list.
        if (parsed.wordBank.targetRhyme) {
            const targetKey = getWordRhymeKey(parsed.wordBank.targetRhyme, lang, dialect);
            if (targetKey) {
                const matches = (w) => wordMatchesRhyme(w, targetKey, lang, dialect);
                parsed.wordBank.wordGroups = parsed.wordBank.wordGroups
                    .map((g) => ({...g, words: g.words.filter(matches), shortPhrases: g.shortPhrases.filter(matches)}));
            }
        }

        parsed.wordBank.wordGroups = parsed.wordBank.wordGroups.filter((g) => g.words.length || g.shortPhrases.length);
    }

    return parsed;
}

/**
 * Ask the muse for help with one note's line — the core companion
 * exchange. Not idempotent: each call is one turn in an ongoing
 * conversation, so pass the full prior conversation every time.
 * @param {{verseText: string, noteFunction: string, museProfile: object,
 *   lyricDna?: object, userMessage: string,
 *   conversation?: {role: 'user'|'muse', content: string, action_type?: string,
 *   options?: any[]}[], lang?: string, dialect?: string,
 *   songStructure?: {before: {type: string, text: string}[],
 *   after: {type: string, text: string}[]},
 *   targetVerse?: {text: string, before: string, after: string}|null,
 *   forceMode?: 'SURGEON'|'ARCHITECT'|'SOCRATIC'|'WORD_BANK'|null,
 *   debug?: boolean}} args
 * @returns {Promise<{action_type: string, message: string,
 *   suggestions: {text: string, type: string|null, angle: string|null}[],
 *   question: {text: string, options: string[]}|null,
 *   wordBank: {targetRhyme: string, rhymeType: string, wordGroups: object[]}|null,
 *   isRhymeRequest: boolean, rhymeVerified?: boolean, themes: string[],
 *   _debug?: object}>}
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
                                  songStructure,
                                  targetVerse = null,
                                  forceMode = null,
                                  debug = false,
                              }) {
    // Built as named strings, not inline in the array below, for two
    // reasons: calculateContextWeights needs the raw text to measure, and
    // debug mode wants to show them verbatim — neither should require
    // re-deriving what was actually sent.
    const staticText = buildStaticMuseInstructions({lyricDna, museProfile, lang, dialect});
    const dynamicText = buildDynamicMuseContext({verseText, noteFunction, conversation, lang, dialect, songStructure, targetVerse, forceMode});

    // Two content blocks, not one string: cache_control can only mark a
    // block boundary, so the stable instructions (which we want Anthropic to
    // cache and reuse across every turn of this conversation) and the
    // per-turn note/conversation data (which must never be cached, since
    // it's different every time — including songStructure and targetVerse,
    // which change whenever the user opens the muse on a different note or
    // selects a different fragment) have to be physically separate blocks.
    const system = [
        {type: 'text', text: staticText, cache_control: {type: 'ephemeral'}},
        {type: 'text', text: dynamicText},
    ];
    // 900, not 600: SURGEON/ARCHITECT now over-generate 5-6 {text, type,
    // angle} suggestions instead of 5-6 bare-ish options, and WORD_BANK's
    // word_groups run longer than a handful of one-line options ever did.
    const startedAt = Date.now();
    const raw = await callClaude(system, userMessage, 900);
    const latencyMs = Date.now() - startedAt;
    const parsed = parseCompanionResponse(raw);

    applyMuseVerification(parsed, {verseText, targetVerse, lang, dialect});

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

// One candidate per type, in the order types first appear, then backfills
// from whatever's left over if fewer than `limit` distinct types survived
// the metric/rhyme filters above — never shrinks the result just because
// one type happened to get filtered out entirely.
export function selectDiverseSuggestions(suggestions, limit) {
    const seen = new Set();
    const byType = [];
    const rest = [];
    for (const s of suggestions) {
        if (s.type && !seen.has(s.type)) {
            seen.add(s.type);
            byType.push(s);
        } else {
            rest.push(s);
        }
    }
    const result = byType.slice(0, limit);
    for (const s of rest) {
        if (result.length >= limit) break;
        result.push(s);
    }
    return result;
}

// ─── Profile refresh — isolated on purpose (see file header) ───────────────

function buildProfileSummaryPrompt(existingProfile, userMessages) {
    const transcript = userMessages.map((m, i) => `${i + 1}. "${m}"`).join('\n');

    return `Eres un analista que mantiene el perfil temático de una canción dentro de
una app de composición musical, para que una IA "musa" calibre mejor las
opciones que le ofrece al compositor.

Perfil actual (JSON, puede tener cualquier forma — claves temáticas libres
que se han ido creando conversación a conversación):
${JSON.stringify(existingProfile || {})}

Cosas que el usuario ha pedido o comentado recientemente en esta canción:
${transcript}

Devuelve el perfil actualizado COMPLETO: funde lo nuevo con lo que ya había
— enriquece una clave temática existente si lo nuevo pertenece ahí, crea una
clave nueva si es un tema genuinamente distinto, y si dos claves acaban
hablando de lo mismo, fúndelas en una sola. Cada valor debe seguir siendo
una frase corta (1-2 frases), y el conjunto entero debe mantenerse compacto
— no dejes que crezca sin límite, prioriza lo que sigue siendo relevante
sobre acumular historial. Responde ÚNICAMENTE con el JSON actualizado, sin
explicación ni markdown.`;
}

/**
 * Called after every N user turns on a song (see museData.js) — change N
 * or this prompt without touching the conversation flow in askMuse.
 * @param {{existingProfile: object, userMessages: string[]}} args
 * @returns {Promise<object>} the updated, fused profile object
 */
export async function summarizeMuseProfile({existingProfile, userMessages}) {
    const system = buildProfileSummaryPrompt(existingProfile, userMessages);
    const raw = await callClaude(system, 'Actualiza el perfil.', 500);
    try {
        return JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch {
        console.error('muse profile summary failed to parse:', raw);
        return existingProfile || {};
    }
}
