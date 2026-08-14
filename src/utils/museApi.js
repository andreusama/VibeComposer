// ─── Muse — Claude calls ────────────────────────────────────────────────────
// Two isolated things live here on purpose: the companion conversation
// (askMuse) and periodically summarizing what's been learned into a
// block's own LOCAL profile (summarizeBlockProfile). There's no song-level
// summary — the whole song's context is the real raw text
// (describeSongStructure, sent fresh every turn), not something cached and
// re-derived by a second AI call. They share only the low-level
// callClaude() helper — nothing about adjusting N or the summary prompt
// should ever require touching the conversation path, or vice versa.
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
import {logDebugEvent} from './debugLog.js';
import {queryRhymeCandidates, queryWordBank, verifyWordsInLexicon} from './lexicon.js';

export const MUSE_MODEL = 'claude-sonnet-5';

export const MUSE_ACTION_TYPES = ['SURGEON', 'ARCHITECT', 'SOCRATIC', 'WORD_BANK'];
export const MUSE_ANGLES = ['raw', 'atmospheric', 'abstract'];
export const MUSE_TYPES = ['CONTINUITY', 'CONTRAST', 'RESOLUTION'];

async function callClaude(system, userContent, maxTokens) {
    checkAndIncrementLimit();
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            model: MUSE_MODEL,
            max_tokens: maxTokens,
            thinking: {type: 'disabled'},
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

export function buildStaticMuseInstructions({lyricDna, blockProfile, lang = 'es', dialect = 'central'}) {
    return `Eres "La Musa", un co-writer experto y colega de estudio sentado al lado
del compositor en la mesa de mezclas. Tu función es asistir con material bruto
e ingeniería poética. Cero juicio, cero adulación ("slop"), cero sermones o
psicoanálisis. Hablas con transparencia técnica y actitud de estudio.

=== 1. IDIOMA Y FONÉTICA DIALECTAL ===
- Idioma base: ${lang}
- Dialecto / registro regional: ${dialect}
- Evalúa métrica y rimas según la PRONUNCIACIÓN REAL cantada/hablada.
  Elisiones coloquiales ("pa'", "na'", apócopes) son válidas si el registro es informal.
  La rima cantada y el compás rítmico priman sobre la ortografía estricta.
- Esto NO es solo para los versos: todo texto que escribas TÚ MISMA en
  cualquier campo de la respuesta ("reasoning", "question.text",
  "question.options") va en ${lang} (registro ${dialect}) también, sin
  excepción — nunca cambies al castellano para tu propio comentario,
  explicación o pregunta solo porque estas instrucciones estén en
  castellano. Estas instrucciones son el idioma en el que TÚ recibes
  órdenes, no el idioma en el que respondes.

=== 2. ESTILO DEL ESCRITOR (lyric_dna — CÓMO) ===
Aplica ESTE filtro de voz a TODAS tus respuestas sin excepción (incluyendo WORD_BANK):
${JSON.stringify(lyricDna || {})}

REGLA DE ADUANA LÉXICA: Si una palabra existe en el diccionario pero no encaja con la
actitud o léxico del artista (ej. palabras geográficas o descontextualizadas como "Perú",
"Bantú", "bambú" en contexto urbano/moderno), QUEDA COMPLETAMENTE PROHIBIDA.
Prioriza siempre asonancias naturales, frases cortas o verbos antes que forzar
sustantivos extraños por el mero hecho de conseguir una rima consonante.

=== 3. ESTE BLOQUE CONCRETO (perfil LOCAL — QUÉ) ===
De qué trata este bloque (verso/estribillo/etc., no la canción entera) en concreto,
aprendido de conversaciones anteriores sobre él:
${blockProfile || '(todavía no hay resumen local para este bloque)'}

El estilo (2) dicta CÓMO se habla; este perfil local (3) dicta de QUÉ trata ESTE bloque
en concreto. Para el contexto de la canción entera — su historia, sus otros bloques, y si
el conjunto es literal o metafórico/abstracto — usa el texto real y completo que recibes
en cada turno bajo "contexto global de la canción" (más abajo): decide el VIBE a partir de
ESE texto directamente, no archives ni des por sentada una interpretación previa de él.

=== 4. MODOS DE ACTUACIÓN (elige ÚNICAMENTE UNO) ===

1. SURGEON: Reemplazo o ajuste quirúrgico de un fragmento/línea concreta ("targetVerse").
   Mantiene la métrica exacta y la acentuación del compás de la línea que sustituye.
2. ARCHITECT: Resolución o remate de un verso incompleto/estrofa. Mantiene la continuidad
   narrativa y rítmica.
3. SOCRATIC: Se activa en CUATRO escenarios específicos:
   a) AMBIGÜEDAD / DESORIENTACIÓN: La nota tiene múltiples líneas o el usuario está atascado.
   b) FRICCIÓN FONÉTICA (APUNTE DE ESTUDIO): La rima pedida ("rhymeTargetWord") tiene opciones
      consonantes muy escasas o antinaturales en español (ej. consonantes agudas en -ú, -ij, -oj).
      En este caso, NO fuerces palabras malas. Lanza un "APUNTE DE ESTUDIO" directo explicando
      la limitación técnica en 1 frase y ofrece 2-3 chips tácticos en "options" para desbloquear
      (ej. abrir a asonantes ricas, rematar con frase corta, reflexionar sobre el tema).
   c) REFLEXIÓN SOBRE LA CANCIÓN (MODO ESCUCHA): El usuario pide reflexionar o explorar el concepto.
      - REGLA DE ORO 80/20: Habla lo mínimo (1-2 frases).
      - CERO VERSOS: Prohibido sugerir versos, rimas o palabras en este turno.
      - Haz UNA sola pregunta incisiva sobre la verdad emocional/escena/intención del tema.
   d) SIN CONTEXTO REAL: La nota está vacía o casi vacía (nada que analizar) y el mensaje del
      usuario tampoco da un tema, línea o petición concreta a la que responder. NO improvises una
      interpretación de la nada ni fuerces un "consejo genérico" sobre un vacío — pregunta
      directa y brevemente de qué quiere hablar o escribir (ej. "¿de qué quieres hablar hoy?" /
      "¿sobre qué quieres escribir?"), sin chips de opciones inventadas para rellenar.
4. WORD_BANK: Diccionario real de rimas y vocabulario — se activa ante CUALQUIER petición
   explícita de vocabulario/palabras sueltas, INCLUIDA una petición sin ningún filtro concreto
   (ej. "dame palabras carismáticas", "dame palabras chulas", "dame palabras que suenen bien",
   sin más). Esto NO es SURGEON/ARCHITECT (no se piden versos ni frases) ni SOCRATIC (no hace
   falta preguntar nada, es una petición perfectamente clara) — es exactamente lo que WORD_BANK
   existe para responder: el propio diccionario ya viene ordenado por lo más común-y-carismático
   primero, así que "dame palabras carismáticas" sin más filtro es una petición WORD_BANK
   completa y válida con target_rhyme, letter_filter y concept los tres en null.
   TU ÚNICA FUNCIÓN es entender la petición, NO inventar palabras: identifica (cada uno es
   independiente y opcional) la palabra ancla de la rima si se pidió una, si es consonante o
   asonante, cualquier filtro de letras explícito, y cualquier concepto/tema semántico pedido.
   LA RIMA YA NO ES OBLIGATORIA para activar este modo — una petición válida puede pedir solo
   letras, solo un concepto, solo "las más chulas sin más filtro", o cualquier combinación de
   rima + letras + concepto. El diccionario real (y, si se pidió concepto, un filtro semántico
   aparte sobre esos resultados reales) se consulta por separado, directamente contra datos
   verificados — cualquier palabra que tú propongas aquí se descarta.
   Ejemplos:
   - "que empiecen por S" / "que empiecen con la letra ese" → letter_filter {"type": "starts_with", "value": "s"}
   - "que tengan 'tr' en algún lado" / "con la cadena 'bl'" → letter_filter {"type": "contains_chain", "value": "tr"}
   - "que tengan las letras a, r y o" → letter_filter {"type": "contains_letters", "value": "aro"}
   - "que tengan que ver con volar" / "relacionadas con el mar" → concept: "volar" / "el mar"
     (copia o resume el concepto en 1-3 palabras, no lo inventes)
   - "dame palabras carismáticas" / "palabras chulas" / "palabras que suenen bien" (sin más
     detalle) → target_rhyme null, letter_filter null, concept null — el propio banco ya
     resuelve esto ordenando por carisma, no necesitas pedir ninguna aclaración
   - sin petición de letras → letter_filter null; sin petición de concepto → concept null

Para SURGEON y ARCHITECT: genera 5-6 candidatos en "suggestions" repartidos en los 3 tipos.
No reutilices palabras significativas que ya aparezcan 1 sola vez en esta nota (salvo si ya
aparecen 2+ veces como gancho).

=== 5. FORMATO DE SALIDA (JSON ESTRICTO DE UNA SOLA LÍNEA) ===
Responde EXCLUSIVAMENTE con el JSON correspondiente al modo ejecutado, sin explicaciones
exteriores ni bloques markdown. Incluye siempre el array "themes".

SI action_type == "SURGEON" o "ARCHITECT":
{"action_type": "SURGEON"|"ARCHITECT", "reasoning": "explicación técnica/fonética de 1 frase", "targetLineText": "línea física exacta copiada tal cual o null", "isRhymeRequest": true|false, "rhymeTargetWord": "palabra objetivo o null", "suggestions": [{"text": "verso propuesto", "type": "CONTINUITY"|"CONTRAST"|"RESOLUTION", "angle": "raw"|"atmospheric"|"abstract"}, "... (5-6 en total)"], "themes": ["..."]}

SI action_type == "SOCRATIC":
{"action_type": "SOCRATIC", "reasoning": "justificación del bloqueo, fricción fonética o reflexión", "question": {"text": "pregunta concisa o apunte de estudio", "options": ["opción A", "opción B", "opción C"]}, "themes": ["..."]}

SI action_type == "WORD_BANK":
{"action_type": "WORD_BANK", "target_rhyme": "palabra que ancla la rima — cópiala de la línea seleccionada o del mensaje del usuario, no la inventes — o null si no se pidió rima", "rhyme_type": "consonante"|"asonante", "letter_filter": {"type": "starts_with"|"contains_chain"|"contains_letters", "value": "cadena de letras pedida"} o null si no se pidió ningún filtro, "concept": "concepto/tema semántico pedido en 1-3 palabras, o null si no se pidió ninguno", "themes": ["..."]}`;
}

// The GLOBAL layer (see buildStaticMuseInstructions' section 3) — real,
// complete, uncompressed text of every block connected to the main
// thread, every single turn. Deliberately NOT summarized: an earlier
// version tried caching an AI-generated "song_summary" alongside this and
// it was pure redundancy (a lossy, potentially-stale interpretation of
// text the model already reads in full right here). Literal-vs-metaphorical
// and "the vibe" are for the model to read directly off this text, not a
// separately stored field.
function describeSongStructure(songStructure) {
    const {before = [], after = []} = songStructure || {};
    const describe = (n) => `${n.type}: "${(n.text || '(vacía)').replace(/\n/g, ' / ')}"`;
    const beforeText = before.length
        ? before.map(describe).join('\n')
        : 'sin bloques anteriores conectados en el hilo principal';
    const afterText = after.length
        ? after.map(describe).join('\n')
        : 'sin bloques siguientes conectados en el hilo principal';
    return `CONTEXTO GLOBAL DE LA CANCIÓN — texto real y completo de cada bloque conectado
al hilo principal, en orden (no un resumen: úsalo para entender la historia, la dinámica y
si el conjunto es literal o metafórico/abstracto):

ANTES de este bloque (de más lejano a más cercano):
${beforeText}

DESPUÉS de este bloque (de más cercano a más lejano):
${afterText}`;
}

// Cultural Resonance Engine's Step 4 (LLM Assembly) — renders whatever
// buildCulturalResonance (below) produced into the prompt. Explicitly
// scoped to ARCHITECT/WORD_BANK: since the model — not this code — makes
// the final mode call on an unforced turn, the instruction itself tells it
// to disregard this block entirely if SURGEON is the right answer, rather
// than relying only on the forceMode==='SURGEON' skip upstream.
export function describeCulturalResonance(resonance) {
    if (!resonance) return '';
    if (!resonance.enabled) {
        return `\n(Motor de resonancia cultural: no se encontraron rimas de alto carisma en el léxico para "${resonance.concept}" — genera con tu criterio habitual, sin palabra obligatoria.)\n`;
    }
    const frameLine = resonance.culturalFrame
        ? `- Marco cultural sugerido: "${resonance.culturalFrame}"${resonance.tropo ? ` (${resonance.tropo})` : ''}\n`
        : '';
    return `\nMOTOR DE RESONANCIA CULTURAL — aplica ÚNICAMENTE si tu respuesta es ARCHITECT; si el modo correcto para este turno es SURGEON o WORD_BANK, ignora este bloque por completo:
- Palabra sugerida para esta línea: "${resonance.mandatoryWord}" (ya verificada como rima real de "${resonance.concept}" y preseleccionada por encajar con la voz del artista — no la cuestiones fonéticamente)
${frameLine}Construye la línea con naturalidad alrededor de esa palabra y ese marco. La REGLA DE ADUANA LÉXICA (sección 2) sigue teniendo prioridad sobre esta sugerencia: si pese a la preselección la palabra sigue sin encajar con la voz del artista, descártala y sigue tu criterio habitual — la voz siempre gana.\n`;
}

export function buildDynamicMuseContext({
                                            verseText,
                                            noteFunction,
                                            conversation,
                                            lang,
                                            dialect,
                                            songStructure,
                                            targetVerse,
                                            forceMode,
                                            culturalResonance = null,
                                        }) {
    const recentConversation = conversation.slice(-3);
    const targetVerseBlock = describeTargetVerse(targetVerse);
    const forceModeBlock = forceMode
        ? `\nINSTRUCCIÓN OBLIGATORIA PARA ESTE TURNO: responde EXCLUSIVAMENTE en modo ${forceMode}, sin excepción.\n`
        : '';
    return `Nota actual (${noteFunction}), línea por línea física:
${describePhysicalLines(verseText, lang, dialect)}

${targetVerseBlock ? targetVerseBlock + '\n\n' : ''}${describeSongStructure(songStructure)}

Conversación hasta ahora sobre esta línea:
${formatConversation(recentConversation)}
${forceModeBlock}${describeCulturalResonance(culturalResonance)}
Recuerda: responde solo con el JSON descrito arriba, nada más.`;
}

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

const LETTER_FILTER_TYPES = ['starts_with', 'contains_chain', 'contains_letters'];

// The model NEVER generates the actual word list anymore — its only job is
// parsing the request into {targetRhyme, rhymeType, letterFilter}.
// wordGroups starts empty and gets filled in by buildWordBankFromLexicon
// (a real lexicon.js query), which is the only thing allowed to populate
// it — see that function's own comment for why.
function parseWordBank(parsed) {
    const targetRhyme = typeof parsed.target_rhyme === 'string' ? parsed.target_rhyme.trim() : '';
    const rhymeType = parsed.rhyme_type === 'asonante' ? 'asonante' : 'consonante';
    const rawFilter = parsed.letter_filter;
    const letterFilter = rawFilter
        && LETTER_FILTER_TYPES.includes(rawFilter.type)
        && typeof rawFilter.value === 'string' && rawFilter.value.trim()
        ? {type: rawFilter.type, value: rawFilter.value.trim().toLowerCase()}
        : null;
    const concept = typeof parsed.concept === 'string' && parsed.concept.trim() ? parsed.concept.trim() : null;

    const parts = [];
    if (targetRhyme) parts.push(`rima ${rhymeType} con "${targetRhyme}"`);
    if (letterFilter) parts.push('filtro de letras');
    if (concept) parts.push(`relacionadas con "${concept}"`);
    const message = parts.length ? `banco de palabras — ${parts.join(', ')}` : 'banco de palabras';

    return {
        action_type: 'WORD_BANK',
        message,
        suggestions: [],
        question: null,
        wordBank: {targetRhyme, rhymeType, letterFilter, concept, wordGroups: []},
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

        const hasContent = result.message || result.suggestions.length || result.wordBank?.wordGroups.length;
        if (!hasContent) {
            console.error('muse returned an empty response:', raw);
            throw new Error('empty response');
        }

        return {...result, themes};
    } catch {
        console.error('muse response failed to parse:', raw);
        return {
            action_type: 'SOCRATIC',
            message: raw.trim() || '(la musa no ha podido responder — inténtalo de nuevo)',
            suggestions: [], question: {text: raw.trim(), options: []}, wordBank: null,
            targetLineText: null, isRhymeRequest: false, rhymeTargetWord: null, themes: [],
        };
    }
}

export function selectDiverseSuggestions(suggestions, limit = 3) {
    if (!suggestions || !suggestions.length) return [];
    const selected = [];

    for (const type of MUSE_TYPES) {
        const found = suggestions.find((s) => s.type === type);
        if (found && selected.length < limit) {
            selected.push(found);
        }
    }

    for (const s of suggestions) {
        if (selected.length >= limit) break;
        if (!selected.includes(s)) {
            selected.push(s);
        }
    }

    return selected;
}

// Records a trace step with BOTH the survivor count and the specific items
// that got rejected this step (before-minus-after) — the Lab's pipeline
// view shows the rejected list directly, not just a shrinking number, so
// "why did this get cut" never requires re-running the call to find out.
function pushTraceStep(trace, stage, beforeItems, afterItems) {
    if (!trace) return;
    const afterSet = new Set(afterItems);
    const rejected = beforeItems.filter((item) => !afterSet.has(item));
    trace.push({stage, count: afterItems.length, rejected});
}

export function applyMuseVerification(parsed, {
    verseText,
    targetVerse,
    lang = 'es',
    dialect = 'central'
}, trace = null) {
    if ((parsed.action_type === 'SURGEON' || parsed.action_type === 'ARCHITECT') && parsed.suggestions.length) {
        trace?.push({stage: 'model proposed', count: parsed.suggestions.length, rejected: []});
        const targetLine = targetVerse ? `${targetVerse.before}${targetVerse.text}${targetVerse.after}` : parsed.targetLineText;

        const beforeMetric = parsed.suggestions.map((s) => s.text);
        if (targetLine) {
            const targetSyllables = countLineSyllables(targetLine, lang);
            if (targetSyllables > 0) {
                const verifiedByMetric = parsed.suggestions.filter((s) => {
                    const optSyllables = countLineSyllables(s.text, lang);
                    return Math.abs(optSyllables - targetSyllables) <= 2;
                });
                if (verifiedByMetric.length > 0) parsed.suggestions = verifiedByMetric;
            }
        }
        pushTraceStep(trace, 'after metric filter (±2 syllables)', beforeMetric, parsed.suggestions.map((s) => s.text));

        const beforeRepeat = parsed.suggestions.map((s) => s.text);
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
        pushTraceStep(trace, 'after word-repeat filter', beforeRepeat, parsed.suggestions.map((s) => s.text));

        if (parsed.isRhymeRequest && parsed.rhymeTargetWord && parsed.suggestions.length) {
            const beforeRhyme = parsed.suggestions.map((s) => s.text);
            const targetKey = getWordRhymeKey(parsed.rhymeTargetWord, lang, dialect);
            if (targetKey) {
                const verified = parsed.suggestions.filter((s) => wordMatchesRhyme(s.text, targetKey, lang, dialect));
                parsed.suggestions = verified;
                parsed.rhymeVerified = verified.length > 0;
            }
            pushTraceStep(
                trace,
                `after rhyme filter (${parsed.rhymeVerified ? 'verified' : 'unverified — kept anyway'})`,
                beforeRhyme, parsed.suggestions.map((s) => s.text)
            );
        }

        // Cap raised from 3 to 6 (the model already generates 5-6 raw
        // candidates per call, see the SURGEON/ARCHITECT prompt above) so
        // mobile's swipe deck gets a real local pool — the first 3 are
        // shown, the rest sit client-side as swipe-left replacements with
        // no network round-trip. Desktop's MuseFloatNode still renders only
        // 3 (its own render loop slices), so this is a no-op for it.
        const beforeFinal = parsed.suggestions.map((s) => s.text);
        parsed.suggestions = selectDiverseSuggestions(parsed.suggestions, 6);
        pushTraceStep(trace, 'after diversity selection (final)', beforeFinal, parsed.suggestions.map((s) => s.text));
    }

    // WORD_BANK is deliberately NOT handled here — there is nothing to
    // verify, because the model never generates the word list in the first
    // place anymore. See buildWordBankFromLexicon (below): it replaces
    // parsed.wordBank.wordGroups with a real lexicon.js query result,
    // async, called separately from askMuse. A previous version trusted
    // the model's own invented words and ran them back through
    // wordMatchesRhyme() as a post-hoc check — exactly the "let the LLM
    // propose, then verify" pattern the whole Cultural Resonance Engine
    // exists to replace with real data queried up front.

    return parsed;
}

// Structured (not prose) line-by-line breakdown for the debug payload only
// — real product prompting still goes through describePhysicalLines above.
// Per explicit product decision: "N" is the WHOLE current note (every
// physical line), not a single target line — the model already gets full
// song-structure context (potentially several notes each direction, not
// just one adjacent line), so a fake N-1/N/N+1 triplet would be less
// truthful than what's actually sent. before/after are passed through as-is
// (arrays of {type, text}, however many songStructure actually has).
function buildLineContextForDebug(verseText, lang, dialect, songStructure) {
    const lines = splitIntoLines(verseText).filter(Boolean).map((text, i) => {
        const key = getLineRhymeKey(text, lang, dialect);
        return {
            i,
            text,
            syllables: countLineSyllables(text, lang),
            rhyme: key ? `consonante "${key.consonant}" · asonante "${key.assonant}"` : null,
        };
    });
    const {before = [], after = []} = songStructure || {};
    return {lines, before, after};
}

/**
 * @param {object} args - see buildDynamicMuseContext/buildStaticMuseInstructions
 *   for most fields.
 * @param {boolean} [args.debug] - whether to attach the debug bundle onto
 *   the RETURNED response (parsed._debug), for a caller that wants to
 *   render it inline (e.g. MuseFloatNode's 🔧 toggle). Does NOT gate
 *   capture — see below.
 * @param {{songId?: string, songTitle?: string, nodeLabel?: string}} [args.meta] -
 *   optional context attached to the debug-log entry (MuseEyeScreen's
 *   history list/footer). Purely descriptive, never sent to Claude.
 * @param {string} [args.staticSystemOverride] - dev-only escape hatch for
 *   the Muse Lab's A/B prompt testing: when given, this literal text is
 *   sent as the static system block INSTEAD of buildStaticMuseInstructions'
 *   output (lyricDna/blockProfile are ignored in that case). Never set by
 *   any real product call path — only the lab's "Prompt B" flow uses it.
 */
export async function askMuse({
                                  verseText,
                                  noteFunction = 'Verso',
                                  userMessage,
                                  conversation = [],
                                  lyricDna = {},
                                  blockProfile = '',
                                  lang = 'es',
                                  dialect = 'central',
                                  songStructure = {},
                                  targetVerse = null,
                                  forceMode = null,
                                  debug = false,
                                  meta = {},
                                  staticSystemOverride = null,
                                  // session_angles_history — words/frames the CALLER already surfaced
                                  // for this concept earlier in the session (tracked client-side, see
                                  // MusePopover.jsx/MuseFloatNode.jsx), so a regenerate never hands
                                  // back a duplicate rhyme word or refrán/tropo.
                                  excludeRhymeWords = [],
                                  excludeCulturalFrames = [],
                              }) {
    const staticSystem = staticSystemOverride ?? buildStaticMuseInstructions({lyricDna, blockProfile, lang, dialect});
    const culturalResonance = await buildCulturalResonance({
        verseText, targetVerse, lang, dialect, forceMode, lyricDna,
        excludeWords: excludeRhymeWords, excludeFrames: excludeCulturalFrames,
    });
    const dynamicContext = buildDynamicMuseContext({
        verseText,
        noteFunction,
        conversation,
        lang,
        dialect,
        songStructure,
        targetVerse,
        forceMode,
        culturalResonance,
    });

    const userPrompt = userMessage
        ? `${dynamicContext}\n\nMensaje del usuario: "${userMessage}"`
        : dynamicContext;

    const startedAt = Date.now();
    const raw = await callClaude(staticSystem, userPrompt, 1000);
    const latencyMs = Date.now() - startedAt;
    const parsed = parseCompanionResponse(raw);

    // Exposed regardless of DEV/production — session_angles_history lives
    // in the CALLER (MusePopover.jsx/MuseFloatNode.jsx), not here, and it
    // needs this on every real turn to know what word/frame to exclude on
    // the next regenerate, not just when a debug panel happens to be open.
    parsed.culturalResonance = culturalResonance;

    // Only collected in dev builds — see below, nothing here runs for real
    // users in production.
    const verificationTrace = import.meta.env.DEV ? [] : null;
    applyMuseVerification(parsed, {verseText, targetVerse, lang, dialect}, verificationTrace);

    // WORD_BANK's word list comes from here, not from the model or from
    // applyMuseVerification above (which explicitly does nothing for this
    // action_type now) — see buildWordBankFromLexicon's own comment.
    if (parsed.action_type === 'WORD_BANK' && parsed.wordBank) {
        await buildWordBankFromLexicon(parsed.wordBank, {verseText, lang, dialect, lyricDna, trace: verificationTrace});
    }

    // Captured for EVERY real call in dev, not just the ones a UI toggle
    // happened to have on (that's what debugMode/the 🔧 toggle used to
    // gate, and it meant most calls — including every mobile MusePopover
    // one — never made it into the debug log at all). Centralized here,
    // inside askMuse itself, so every current and future caller gets this
    // for free without having to remember to wire it up. Production builds
    // skip this entirely — no raw-prompt capture for real user traffic.
    if (import.meta.env.DEV) {
        const debugPayload = {
            // Stable per-call identity, independent of debugLog's own entry
            // id — lets a comment left in MuseEyePanel stay attached to
            // THIS specific response whether it's viewed live (inline,
            // overwritten on every new message) or later from history.
            id: crypto.randomUUID(),
            latencyMs,
            model: MUSE_MODEL,
            // temperature is genuinely not overridden — see callClaude's own
            // request body. Reporting a made-up value would defeat the point
            // of an observability panel: it has to say what actually
            // happened, not what a prompt once asked for.
            parameters: {temperature: 'default (1.0, not overridden)', thinking: 'disabled'},
            weights: calculateContextWeights(staticSystem, dynamicContext, userMessage || ''),
            rawSystemPrompt: staticSystem,
            rawDynamicContext: dynamicContext,
            rawUserMessage: userMessage || '',
            verificationTrace,
            // First trace entry is always "model proposed", last is always
            // the final survivor count — a plain number here (not smuggled
            // onto the trace array as an extra property) so it survives
            // JSON.stringify when the Lab persists a run to localStorage.
            survivalRate: verificationTrace?.length
                ? (verificationTrace[0].count > 0
                    ? Math.round((verificationTrace[verificationTrace.length - 1].count / verificationTrace[0].count) * 100)
                    : 0)
                : null,
            actionType: parsed.action_type,
            parsedOutput: {suggestions: parsed.suggestions, question: parsed.question, wordBank: parsed.wordBank},
            lineContext: buildLineContextForDebug(verseText, lang, dialect, songStructure),
            // Surfaced explicitly (not just buried in rawDynamicContext's
            // rendered text) so Muse Eye/the Lab can show WHY the engine
            // didn't fire — 'no_rhyme_match' (lexicon had nothing) vs
            // 'no_voice_fit' (real candidates existed, none read as this
            // artist's voice) point at different tuning knobs.
            culturalResonance,
        };
        logDebugEvent('muse', debugPayload, meta);
        // debug=true additionally attaches it to the return value — only
        // MuseFloatNode's inline panel needs this; the debug log above
        // already has it regardless.
        if (debug) parsed._debug = debugPayload;
    }

    return parsed;
}

/**
 * Refreshes ONE block's LOCAL profile — a short prose summary of what THIS
 * block (verse/chorus/etc.) is about, not the whole song. Plain text, not
 * JSON: nothing downstream needs structured fields, and short prose is
 * exactly what gets interpolated back into the next call's system prompt
 * (see buildStaticMuseInstructions' section 3). There is no song-level
 * counterpart to this — the whole song's context is the real raw text
 * (describeSongStructure, above), read fresh every turn, not a cached
 * summary rolled up from these.
 * @param {{currentSummary?: string, userMessages: string[], lang?: string}} args
 * @returns {Promise<string>} the updated summary — falls back to
 *   currentSummary on any failure, never throws.
 */
export async function summarizeBlockProfile({currentSummary = '', userMessages = [], lang = 'es'}) {
    if (!userMessages.length) return currentSummary;

    const system = `Eres un asistente analítico que mantiene actualizado un resumen breve de qué trata UN BLOQUE
concreto (un verso, estribillo, etc.) de una canción, a partir de lo que el compositor le ha
pedido a su musa sobre él.
Responde EXCLUSIVAMENTE con el resumen actualizado en prosa (2-4 frases), en ${lang}, sin JSON,
sin markdown, sin explicación fuera del resumen mismo.`;

    const userPrompt = `Resumen actual de este bloque:
${currentSummary || '(todavía no hay resumen)'}

Lo que el compositor ha pedido recientemente sobre este bloque:
${userMessages.map((m, i) => `${i + 1}. "${m}"`).join('\n')}

Genera el resumen actualizado.`;

    try {
        const raw = await callClaude(system, userPrompt, 300);
        return raw.trim() || currentSummary;
    } catch (e) {
        console.error('Error al actualizar el perfil local del bloque:', e);
        return currentSummary;
    }
}

// ─── Cultural Resonance Engine — voice-fit selection + cultural framing ────
// Step 3 of the pipeline (see buildCulturalResonance below): a short,
// separate LLM call with two jobs, deliberately combined into one instead
// of two separate calls:
//   1. SELECT — of the rhyme-verified candidateWords (all real, all
//      phonetically confirmed by lexicon.js's SQL query), pick the one a
//      composer with THIS artist's specific voice would actually reach
//      for — or explicitly none, if nothing in the pool fits. This is the
//      fix for a real failure mode: charisma_score alone doesn't know
//      anything about the song, so a genuinely rare, high-scoring word
//      ("tiwanacota") could win purely on rarity/phonetics while reading
//      as a total non-sequitur against an artist whose voice is
//      "crudo, callejero" — nothing before this step ever checked fit.
//   2. FRAME — only for a selected word, find the cultural trope/aesthetic
//      frame it evokes (e.g. "caballo" → "el caballo del malo," derrota y
//      mala suerte), consistent with that same voice.
// Both are genuinely interpretive, not lookups — unlike the rhyme
// candidates themselves (always from lexicon.js's SQL query, never
// invented here) — so this stays the one deliberately LLM-driven part of
// the engine. Deliberately NOT folded into the MAIN ARCHITECT/WORD_BANK
// call, since its result is an INPUT to that call, per the pipeline's own
// ordering: DB rhyme query → voice-fit selection + framing → LLM assembly.
//
// excludeFrames is this turn's session_angles_history — tropes already
// surfaced for THIS concept earlier in the session, so a regenerate never
// hands back the same refrán/archetype twice.
export async function extractCulturalFrame({concept, candidateWords = [], lyricDna, lang = 'es', excludeFrames = []}) {
    if (!concept || !candidateWords.length) return null;

    const system = `Eres a la vez un editor exigente de voz artística y un experto en refranes,
tropos culturales y arquetipos estéticos hispanohablantes.

Se te da un concepto clave de una letra, una lista de palabras candidatas que YA riman
verificadamente con él (verificación fonética real, no la cuestiones), y la voz propia del
artista (lyric_dna). Tu trabajo, en este orden:

1. SELECCIÓN: de la lista de candidatas, elige la ÚNICA palabra que un compositor con ESA voz
   específica realmente usaría — no la más rara o "interesante" en abstracto, sino la que encaja
   con su vocabulario, actitud e imágenes habituales. Aplica el mismo criterio que la REGLA DE
   ADUANA LÉXICA: una palabra rara y bien sonante pero descontextualizada (ej. un adjetivo
   arqueológico/histórico específico en una voz urbana moderna) NO encaja solo por rimar bien.
   Si NINGUNA candidata encaja de verdad con esta voz, selectedWord debe ser null — no fuerces
   una elección solo por tener que elegir algo.
2. MARCO CULTURAL: solo si elegiste una palabra, identifica UNA asociación cultural concreta y
   evocadora (refrán, tropo popular, arquetipo estético/de género) que ese concepto evoque,
   coherente con esa misma voz. No la desarrolles en verso, solo nómbrala.

Responde EXCLUSIVAMENTE con JSON: {"selectedWord": "una de las candidatas, o null", "frame": "nombre corto del tropo/arquetipo, o null", "tropo": "en qué consiste muy brevemente, o null"}.
Sin markdown, sin explicación fuera del JSON.`;

    const excludeText = excludeFrames.length
        ? `\n\nYa se han usado estos tropos para "${concept}" en esta sesión — NO los repitas, encuentra uno distinto:\n${excludeFrames.map((f) => `- ${f}`).join('\n')}`
        : '';
    const userPrompt = `Concepto clave: "${concept}"
Palabras candidatas (todas verificadas como rima real de "${concept}"): ${candidateWords.join(', ')}
Voz propia del artista (lyric_dna): ${JSON.stringify(lyricDna || {})}${excludeText}`;

    try {
        const raw = await callClaude(system, userPrompt, 250);
        const parsed = JSON.parse(raw.trim());
        if (!parsed.selectedWord || !candidateWords.includes(parsed.selectedWord)) return null;
        return {selectedWord: parsed.selectedWord, frame: parsed.frame || null, tropo: parsed.tropo || ''};
    } catch (e) {
        // An enhancement, not a requirement — a failed call just means the
        // main call proceeds without a mandatory word (same "graceful
        // degrade" the DB-side fallback uses for zero rhyme matches), not
        // a broken turn.
        console.error('Error al seleccionar/enmarcar la palabra cultural:', e);
        return null;
    }
}

// Orchestrates the full pipeline for one turn: DB Query → voice-fit
// Selection + Cultural Framing, producing the material Step 4 (LLM
// Assembly) injects into the main call — see the block built in
// buildDynamicMuseContext. Never called for SURGEON (forceMode ===
// 'SURGEON' skips it entirely, per the engine's own rule of staying purely
// metric there); for an unforced/model-decided turn we still can't know in
// advance whether the model will land on SURGEON, so the injected prompt
// block itself also tells the model to ignore this material if it does.
//
// The "key concept" is simply the target line's own last significant
// word — matches every example in the spec (caballo/haunted/cierge are
// each literally the line's ending word, not a separately abstracted
// theme), and it's also exactly the word whose rhyme_key we need to query
// anyway, so one word serves both roles.
//
// Two distinct degrade reasons, both landing on the SAME "no mandatory
// word, generate normally" behavior downstream (describeCulturalResonance
// treats any !enabled result identically) but worth telling apart in the
// debug log for tuning: 'no_rhyme_match' means the lexicon had nothing
// (charisma_score >= 7) for this rhyme at all; 'no_voice_fit' means real
// rhyme-verified candidates existed but NONE of them read as something
// this artist's voice would actually use — the fix for a real failure
// mode where a rare, high-charisma word won purely on phonetics/rarity
// while being a total non-sequitur for the song ("tiwanacota" in a modern
// urban track). Explicitly NOT forced to pick something when the pool
// comes back empty on fit — a forced bad pick defeats the point of adding
// this check at all.
export async function buildCulturalResonance({verseText, targetVerse, lang, dialect, forceMode, lyricDna, excludeWords = [], excludeFrames = []}) {
    // WORD_BANK no longer runs through this at all — it's now a pure
    // lexicon.js dictionary query (see buildWordBankFromLexicon, below),
    // not a single-winner voice-fit selection. A single "mandatory word"
    // makes sense when you're building ONE line (ARCHITECT); it's the
    // wrong shape for "show me every real rhyme," which is what a word
    // bank actually is — that mismatch was the real cause of an empty
    // deck: every filtering stage can only shrink the surviving set, and
    // reducing a whole dictionary down to "one word or nothing" made an
    // artificial dead end far more likely than it needed to be.
    if (forceMode === 'SURGEON' || forceMode === 'WORD_BANK') return null;

    const targetLine = targetVerse
        ? `${targetVerse.before}${targetVerse.text}${targetVerse.after}`
        : splitIntoLines(verseText).filter(Boolean).pop();
    if (!targetLine) return null;

    const key = getLineRhymeKey(targetLine, lang, dialect);
    if (!key) return null;

    const words = significantWords(targetLine);
    const concept = words[words.length - 1];
    if (!concept) return null;

    const {data: candidates} = await queryRhymeCandidates({rhymeKey: key.consonant, lang, exclude: excludeWords});
    if (!candidates.length) return {enabled: false, degraded: true, concept, reason: 'no_rhyme_match'};

    const selection = await extractCulturalFrame({
        concept, candidateWords: candidates.map((c) => c.word), lyricDna, lang, excludeFrames,
    });
    if (!selection?.selectedWord) return {enabled: false, degraded: true, concept, reason: 'no_voice_fit'};

    return {
        enabled: true,
        concept,
        mandatoryWord: selection.selectedWord,
        candidateWords: candidates.map((c) => c.word),
        culturalFrame: selection.frame,
        tropo: selection.tropo,
        reason: null,
    };
}

// Zero-cost (no LLM, no network), synchronous best guess at "the concept"
// for a quick confirm-before-you-fire UI step — used by both the cultural
// provocation button and the concept explorer (creativity proposals #3/#4).
// Deliberately NOT an LLM call: the whole point is to show the user
// something to confirm/correct BEFORE spending an API call on it, so
// guessing has to be free. Same "last significant word" heuristic
// buildCulturalResonance already uses for its own concept derivation.
// Returns null when there's no usable text at all — the caller is expected
// to ask the user to type a concept from scratch in that case, not to
// silently guess something meaningless.
export function guessConceptFromLine({verseText, targetVerse}) {
    const targetLine = targetVerse
        ? `${targetVerse.before}${targetVerse.text}${targetVerse.after}`
        : splitIntoLines(verseText || '').filter(Boolean).pop();
    if (!targetLine || !targetLine.trim()) return null;
    const words = significantWords(targetLine);
    return words[words.length - 1] || null;
}

// Creativity proposal #4 — "cultural provocation" as its own standalone
// action, not bundled inside an ARCHITECT line generation.
//
// FIRST VERSION of this function reused buildCulturalResonance's
// queryRhymeCandidates → extractCulturalFrame pipeline, which turned out to
// be the wrong shape entirely: it gated a feature that has nothing to do
// with rhyme behind "does the target line's last word happen to have
// high-charisma rhyme matches in the lexicon" — reported live as the button
// always coming back with "no encontré un ángulo cultural," even for a real
// Quijote line dense with cultural weight. That gate only ever existed
// because extractCulturalFrame's OTHER caller (buildCulturalResonance) has
// to pick a real word to insert into a line, so it needs a verified
// candidate list. Nothing here gets inserted anywhere — this is read-only
// inspiration, never written into the lyric — so that whole constraint was
// never actually load-bearing for this use case.
//
// SECOND VERSION derived a "concept" internally from the target line and
// fired straight at the model with no human check in between — reasonable
// for correctness, but the caller (a real user) had no way to say "no,
// that's not what I meant" before the call ran. `concept` is now a
// REQUIRED, externally-confirmed input: the caller shows the user
// guessConceptFromLine's guess (or asks them to type one, with no guess
// available) and only calls this once it's confirmed. verseText/targetVerse
// are now optional EXTRA context, still passed through when available so
// the model can recognize a real quote/refrán the line already IS — but
// they no longer drive what "the concept" is on their own.
//
// Never gated by forceMode the way buildCulturalResonance is (that gate
// exists to avoid double-injecting into an LLM call this function doesn't
// make) — this is a direct, on-demand tap, not something folded into a
// turn the model is also generating.
//
// Returns null when there's no confirmed concept, or when the model itself
// genuinely finds no reasonable association (asked to say so explicitly
// rather than force one) — the caller shows an honest "couldn't find an
// angle for this" state rather than treating null as an error.
export async function getCulturalProvocation({concept, verseText, targetVerse, lyricDna, lang = 'es', excludeFrames = []}) {
    if (!concept || !concept.trim()) return null;

    const targetLine = targetVerse
        ? `${targetVerse.before}${targetVerse.text}${targetVerse.after}`
        : splitIntoLines(verseText || '').filter(Boolean).pop();

    const system = `Eres un experto en refranes, tropos culturales, arquetipos estéticos y
referencias literarias/históricas del ámbito hispanohablante, ayudando a un compositor a
PENSAR, no escribiendo por él.

Se te da un concepto ya confirmado por el propio compositor (y, si está disponible, la línea
real de la que salió, como contexto adicional) junto a su voz propia (lyric_dna). Identifica
UNA asociación cultural concreta y evocadora para ese concepto — puede ser un refrán, un tropo
popular, un arquetipo estético o narrativo, o una referencia literaria/histórica real si la
línea la evoca claramente (incluida la posibilidad de que la línea SEA, total o parcialmente,
una cita reconocible — en ese caso nombra exactamente esa referencia y qué significa
culturalmente, no inventes una distinta). Prioriza SIEMPRE una referencia real y
verificable sobre una asociación vaga o genérica ("perseverancia", "el paso del tiempo")
si hay algo más concreto disponible.

Responde EXCLUSIVAMENTE con JSON: {"frame": "nombre corto de la referencia/tropo/arquetipo, o null si de verdad no hay ninguna asociación razonable", "tropo": "en qué consiste o por qué encaja, muy brevemente, o null"}.
Sin markdown, sin explicación fuera del JSON.`;

    const excludeText = excludeFrames.length
        ? `\n\nYa se han mostrado estos ángulos en esta sesión — NO los repitas, encuentra uno distinto:\n${excludeFrames.map((f) => `- ${f}`).join('\n')}`
        : '';
    const contextLine = targetLine && targetLine.trim() ? `\nLínea de origen (contexto adicional): "${targetLine.trim()}"` : '';
    const userPrompt = `Concepto confirmado: "${concept.trim()}"${contextLine}
Voz propia del artista (lyric_dna): ${JSON.stringify(lyricDna || {})}${excludeText}`;

    try {
        const raw = await callClaude(system, userPrompt, 300);
        const parsed = JSON.parse(raw.trim());
        if (!parsed.frame) return null;
        return {frame: parsed.frame, tropo: parsed.tropo || ''};
    } catch (e) {
        console.error('Error al generar el ángulo cultural:', e);
        return null;
    }
}

// Cap on how many candidate words get sent to the concept-filter LLM call
// (below) — queryWordBank's pool can be up to WORD_BANK_FETCH_CAP (2000,
// e.g. a concept-only request with no rhyme/letter constraint), and
// sending all of that every turn would be needlessly slow/expensive. The
// pool arrives common-and-cool-first, so taking the top slice keeps the
// most useful candidates, not an arbitrary truncation.
const WORD_BANK_CONCEPT_CANDIDATE_CAP = 500;

// The one deliberately LLM-driven step in WORD_BANK's otherwise-pure-SQL
// pipeline — same justification as extractCulturalFrame: matching a real
// concept ("cosas relacionadas con volar") against word MEANING isn't
// something rhyme_key/letter columns can do, and this repo has no stored
// glosses or embeddings to query deterministically for that (see
// scripts/seed-lexicon-kaikki.ts — glosses are read from Kaikki only to
// compute charisma_score, then discarded). So: give the model a CLOSED,
// already-real list of candidate words and ask it to select the subset
// that actually relates — never to invent new ones. Validated the same way
// extractCulturalFrame validates selectedWord: every returned word must be
// a member of the candidate list, or it's dropped.
export async function filterWordBankByConcept({concept, candidateWords = [], lyricDna = null, lang = 'es'}) {
    if (!concept || !candidateWords.length) return candidateWords;

    const pool = candidateWords.slice(0, WORD_BANK_CONCEPT_CANDIDATE_CAP);

    const system = `Eres un filtro léxico exigente para un diccionario de rimas de un compositor.

Se te da un concepto y una lista CERRADA de palabras reales (ya verificadas ortográfica y,
si aplica, fonéticamente — no las cuestiones ni propongas otras). Tu única tarea: de esa
lista, selecciona TODAS las palabras que tengan una relación real y directa con el concepto
— por significado, campo semántico o asociación evidente. No selecciones una palabra solo
porque suene parecida o comparta letras con el concepto; eso ya se filtró aparte.

Ten en cuenta también la voz propia del artista (lyric_dna) si te resulta útil para juzgar
qué asociaciones son razonables, pero el criterio principal es el significado real de la
palabra frente al concepto pedido.

Responde EXCLUSIVAMENTE con JSON: {"words": ["subset de la lista original, mismo texto exacto, o [] si ninguna encaja de verdad"]}.
Sin markdown, sin explicación fuera del JSON.`;

    const userPrompt = `Concepto: "${concept}"
Lista cerrada de palabras candidatas: ${pool.join(', ')}
Voz propia del artista (lyric_dna): ${JSON.stringify(lyricDna || {})}`;

    try {
        const raw = await callClaude(system, userPrompt, 1500);
        const parsed = JSON.parse(raw.trim());
        const poolSet = new Set(pool);
        return Array.isArray(parsed.words) ? parsed.words.filter((w) => typeof w === 'string' && poolSet.has(w)) : [];
    } catch (e) {
        // A failed call degrades to "couldn't apply the concept filter this
        // turn" — see buildWordBankFromLexicon's own handling of an empty
        // return, which falls back to the unfiltered deterministic pool
        // rather than manufacturing a dead end.
        console.error('Error al filtrar el banco de palabras por concepto:', e);
        return [];
    }
}

// Concept-ONLY WORD_BANK requests (no rhyme, no letter filter — just "words
// related to X") need a fundamentally different first step than
// filterWordBankByConcept above. That function FILTERS an already-relevant
// candidate pool (words that already share a rhyme or letter constraint
// with the request) — but with no rhyme/letters to anchor a SQL query to,
// the only deterministic pool available would be "top N by charisma across
// the whole 734k-word lexicon," which has NO relationship to any given
// concept (charisma_score measures rarity/phonetics, not topic) and
// produced exactly the reported bug: a "random word family" completely
// unrelated to what was asked. The fix inverts the pipeline for this case
// specifically: let the LLM (good at semantics) PROPOSE real Spanish words
// for the concept, then verify each one actually exists in the lexicon
// (verifyWordsInLexicon, below) — same "never show an invented word"
// guarantee as everywhere else in this engine, just checked AFTER
// generation instead of filtering BEFORE it, because here there's nothing
// meaningful to filter beforehand.
const CONCEPT_ONLY_PROPOSAL_COUNT = 20;

export async function proposeConceptWords({concept, lyricDna = null, lang = 'es'}) {
    if (!concept) return [];

    const system = `Eres un poeta y lexicógrafo ayudando a un compositor a explorar vocabulario
para un concepto o sensación concreta — no a escribir versos por él.

Dado un concepto y la voz propia del artista (lyric_dna), propón hasta ${CONCEPT_ONLY_PROPOSAL_COUNT}
palabras REALES en español (existentes de verdad, sin inventar ni deformar ninguna) que se
relacionen con ese concepto por significado, campo semántico o asociación evocadora — no
necesitan rimar entre sí ni con nada. Prioriza variedad: mezcla palabras comunes y palabras
menos comunes pero evocadoras, coherentes con esa voz si el contexto ayuda a decidir.

Responde EXCLUSIVAMENTE con JSON: {"words": ["palabra1", "palabra2", "..."]}.
Sin markdown, sin explicación fuera del JSON.`;

    const userPrompt = `Concepto: "${concept}"
Voz propia del artista (lyric_dna): ${JSON.stringify(lyricDna || {})}`;

    try {
        const raw = await callClaude(system, userPrompt, 600);
        const parsed = JSON.parse(raw.trim());
        return Array.isArray(parsed.words)
            ? parsed.words.filter((w) => typeof w === 'string' && w.trim()).map((w) => w.trim().toLowerCase())
            : [];
    } catch (e) {
        console.error('Error al proponer palabras para el concepto:', e);
        return [];
    }
}

// WORD_BANK's actual content — called from askMuse right after parsing,
// BEFORE applyMuseVerification (which now does nothing for WORD_BANK, see
// its own comment). Replaces parsed.wordBank.wordGroups (always [] out of
// parseWordBank) with a real lexicon.js query result — optionally narrowed
// by filterWordBankByConcept — never from the model's own suggestion: the
// model's role for this mode is parsing the request (rhyme, letter filter,
// concept), not proposing vocabulary.
//
// Rhyme is now OPTIONAL (see parseWordBank/queryWordBank) — a request can
// be pure letter-filter, pure concept, a plain "dame palabras carismáticas"
// with NONE of the three (queryWordBank's own common-and-cool sort already
// answers that honestly — see its own comment), or any combination.
// Reaching this function at all means the model already classified the
// turn as WORD_BANK (an explicit vocabulary request per its own
// instructions), so there's no "nothing was actually asked" case left to
// short-circuit here — every combination, including all-three-empty, falls
// through to a real query below.
export async function buildWordBankFromLexicon(wordBank, {verseText, lang = 'es', dialect = 'central', lyricDna = null, trace = null}) {
    const hasRhyme = Boolean(wordBank?.targetRhyme);
    const hasLetterFilter = Boolean(wordBank?.letterFilter);
    const hasConcept = Boolean(wordBank?.concept);

    // Same word-repetition principle SURGEON/ARCHITECT already apply — a
    // rhyme bank handing back a word already sitting in the note isn't
    // offering anything new. minLength 2, not the usual 3: rhyme words
    // legitimately run shorter than a full line's vocabulary.
    const existingWords = significantWords(verseText || '', 2);

    let finalRows;

    if (hasConcept && !hasRhyme && !hasLetterFilter) {
        // Concept-ONLY request — no rhyme/letters to anchor a deterministic
        // SQL pool to. Using "top charisma across the whole lexicon" here
        // (the old behavior) had zero real relationship to the concept and
        // was the actual cause of the reported "random word family" bug —
        // see proposeConceptWords' own comment for the full reasoning.
        // Propose real words for the concept, then verify each is a real
        // lexicon entry — same "never show an invented word" guarantee,
        // just checked after generation instead of before it.
        const proposed = await proposeConceptWords({concept: wordBank.concept, lyricDna, lang});
        const {data: verified} = await verifyWordsInLexicon({words: proposed, lang});
        const existingSet = new Set(existingWords);
        finalRows = verified.filter((r) => !existingSet.has(r.word));
        // No "unfiltered pool" to fall back to here (there was never a
        // deterministic pool in the first place) — an honest empty result
        // stays unflagged rather than reusing conceptMatched's "here's the
        // fallback" messaging over nothing.
        if (finalRows.length > 0) wordBank.conceptMatched = true;
        trace?.push({
            stage: `concept proposal + lexicon verification ("${wordBank.concept}")`,
            count: finalRows.length,
            rejected: proposed.filter((w) => !verified.some((r) => r.word === w)),
        });
    } else {
        let rhymeKey = null;
        if (hasRhyme) {
            const targetKey = getWordRhymeKey(wordBank.targetRhyme, lang, dialect);
            if (!targetKey) { wordBank.wordGroups = []; return wordBank; }
            rhymeKey = wordBank.rhymeType === 'asonante' ? targetKey.assonant : targetKey.consonant;
        }

        const {data: rows} = await queryWordBank({
            rhymeKey, rhymeType: wordBank.rhymeType, lang, letterFilter: wordBank.letterFilter, exclude: existingWords,
        });
        trace?.push({stage: 'lexicon query (real dictionary data, no model-generated words)', count: rows.length, rejected: []});

        finalRows = rows;
        if (hasConcept && rows.length) {
            // Here (unlike the concept-only branch above) rows already came
            // from a real rhyme/letter constraint, so this pool genuinely
            // relates to the request — filtering it down by meaning, rather
            // than proposing from scratch, is the right shape (and this is
            // the path that already worked for the "ala" + "volar" case).
            const filteredWords = await filterWordBankByConcept({
                concept: wordBank.concept, candidateWords: rows.map((r) => r.word), lyricDna, lang,
            });
            if (filteredWords.length) {
                const filteredSet = new Set(filteredWords);
                finalRows = rows.filter((r) => filteredSet.has(r.word));
                wordBank.conceptMatched = true;
                trace?.push({
                    stage: `concept filter ("${wordBank.concept}")`,
                    count: finalRows.length,
                    rejected: rows.filter((r) => !filteredSet.has(r.word)).map((r) => r.word),
                });
            } else {
                // Graceful degrade — same principle as buildCulturalResonance's
                // zero-fit path: a concept filter that finds nothing real
                // doesn't get to collapse a real, non-empty rhyme/letter pool
                // down to a dead end. Keep the deterministic pool, but flag it
                // so the caller knows the concept itself didn't actually match
                // (see MusePopover/MuseFloatNode's use of wordBank.conceptMatched).
                wordBank.conceptMatched = false;
                trace?.push({
                    stage: `concept filter ("${wordBank.concept}") — no real matches, showing unfiltered pool`,
                    count: rows.length, rejected: [],
                });
            }
        }
    }

    // Grouped by syllable count — same shape the UI already renders
    // (MusePopover's .mp-wb-group), just built from real data. `finalRows`
    // is already common-and-cool-first from queryWordBank; a plain Map
    // insertion preserves that relative order within each syllable bucket,
    // no re-sort needed here.
    const bySyllables = new Map();
    for (const row of finalRows) {
        if (!bySyllables.has(row.syllables)) bySyllables.set(row.syllables, []);
        bySyllables.get(row.syllables).push(row.word);
    }
    wordBank.wordGroups = [...bySyllables.entries()]
        .sort(([a], [b]) => a - b)
        .map(([syllables, words]) => ({syllables, words, shortPhrases: []}));

    return wordBank;
}