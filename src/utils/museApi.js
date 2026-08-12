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
3. SOCRATIC: Se activa en TRES escenarios específicos:
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
4. WORD_BANK: Diccionario de palabras y frases cortas (2-3 palabras) filtradas ESTRICTAMENTE
   por el estilo del artista (lyric_dna). NO genera versos completos. Se activa ante peticiones
   explícitas de vocabulario.

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
{"action_type": "WORD_BANK", "target_rhyme": "palabra de ejemplo que ancla la rima", "rhyme_type": "consonante"|"asonante", "word_groups": [{"syllables": 2, "words": ["palabra1", "palabra2"]}, {"syllables": 3, "words": ["palabra3"]}, {"short_phrases": ["frase corta 1", "frase corta 2"]}], "themes": ["..."]}`;
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

export function buildDynamicMuseContext({
                                            verseText,
                                            noteFunction,
                                            conversation,
                                            lang,
                                            dialect,
                                            songStructure,
                                            targetVerse,
                                            forceMode
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
${forceModeBlock}
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

    if (parsed.action_type === 'WORD_BANK' && parsed.wordBank) {
        const wordBankItems = (wb) => wb.wordGroups.flatMap((g) => [...g.words, ...(g.shortPhrases || [])]);
        const wordBankCount = (wb) => wordBankItems(wb).length;
        const proposedCount = wordBankCount(parsed.wordBank);
        trace?.push({stage: 'model proposed', count: proposedCount, rejected: []});

        // Same word-repetition rule as SURGEON/ARCHITECT above: a rhyme
        // bank that hands back a word already sitting in the note isn't
        // offering anything new. minLength 2, not the usual 3 — rhyme
        // words legitimately run shorter than a full line's vocabulary.
        const beforeRepeat = wordBankItems(parsed.wordBank);
        const existingWords = new Set(significantWords(verseText, 2));
        if (existingWords.size) {
            const isFresh = (w) => !significantWords(w, 2).some((tok) => existingWords.has(tok));
            parsed.wordBank.wordGroups = parsed.wordBank.wordGroups.map((g) => ({
                ...g,
                words: g.words.filter(isFresh),
                shortPhrases: g.shortPhrases.filter(isFresh),
            }));
        }
        pushTraceStep(trace, 'after word-repeat filter', beforeRepeat, wordBankItems(parsed.wordBank));

        // No safety valve here on purpose, unlike the metric/rhyme filters
        // above — a word bank whose entries don't actually rhyme is worse
        // than a short, honest one. If nothing survives, the result is
        // genuinely empty; that's the correct outcome, not a bug.
        const beforeRhyme = wordBankItems(parsed.wordBank);
        if (parsed.wordBank.targetRhyme) {
            const targetKey = getWordRhymeKey(parsed.wordBank.targetRhyme, lang, dialect);
            if (targetKey) {
                const matches = (w) => wordMatchesRhyme(w, targetKey, lang, dialect);
                parsed.wordBank.wordGroups = parsed.wordBank.wordGroups
                    .map((g) => ({...g, words: g.words.filter(matches), shortPhrases: g.shortPhrases.filter(matches)}));
            }
        }

        parsed.wordBank.wordGroups = parsed.wordBank.wordGroups.filter((g) => g.words.length || g.shortPhrases.length);
        pushTraceStep(trace, 'after rhyme filter (final)', beforeRhyme, wordBankItems(parsed.wordBank));
    }

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
                              }) {
    const staticSystem = staticSystemOverride ?? buildStaticMuseInstructions({lyricDna, blockProfile, lang, dialect});
    const dynamicContext = buildDynamicMuseContext({
        verseText,
        noteFunction,
        conversation,
        lang,
        dialect,
        songStructure,
        targetVerse,
        forceMode,
    });

    const userPrompt = userMessage
        ? `${dynamicContext}\n\nMensaje del usuario: "${userMessage}"`
        : dynamicContext;

    const startedAt = Date.now();
    const raw = await callClaude(staticSystem, userPrompt, 1000);
    const latencyMs = Date.now() - startedAt;
    const parsed = parseCompanionResponse(raw);

    // Only collected in dev builds — see below, nothing here runs for real
    // users in production.
    const verificationTrace = import.meta.env.DEV ? [] : null;
    applyMuseVerification(parsed, {verseText, targetVerse, lang, dialect}, verificationTrace);

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