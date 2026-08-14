// ─── Muse Golden Set — hardcoded benchmark fixtures ────────────────────────
// Dev-only, never touches Supabase. Every CALL made against these is 100%
// real (real Claude API, real applyMuseVerification pipeline) — only the
// INPUT scenario is fixed/synthetic, same way any benchmark works. Edit
// this file directly to tweak a case; no UI form, no migration, no
// round-trip — that's the "quick iteration" this was asked for.
//
// expectedMode is a lightweight automatic sanity check (did the model even
// pick the right mode for this scenario), separate from and much weaker
// than the human quick-tag (good/slop/off-vibe/metric-error) — a run can
// match expectedMode and still be bad, or diverge from it and still be a
// legitimate model judgment call (SOCRATIC vs ARCHITECT is genuinely
// ambiguous sometimes). It's a hint for the Lab's dashboard, not a verdict.

export const MUSE_GOLDEN_SET = [
  {
    id: 'phonetic-trap',
    label: 'Phonetic Trap',
    description: 'Scarce consonant rhymes in -ú — should recognize the trap and go SOCRATIC (fricción fonética / apunte de estudio) instead of forcing a bad rhyme.',
    verseText: 'Perdí la fe una noche de tabú\nY no sé si algún día vuelvo a repetir',
    noteFunction: 'verse',
    lang: 'es',
    dialect: 'central',
    lyricDna: {
      vozPropia: { estiloVocabulario: 'directo, algo melancólico', imagenesHabituales: ['noche', 'fe perdida'], palabrasProhibidas: [] },
      influenciasYReferentes: { artistasClave: [], tonoDeseado: 'introspectivo' },
      versosDeReferencia: [],
    },
    blockProfile: '',
    songStructure: { before: [], after: [] },
    targetVerse: null,
    forceMode: null,
    userMessage: 'quiero que la siguiente línea rime en consonante con "tabú"',
    expectedMode: 'SOCRATIC',
  },
  {
    id: 'fast-cadence',
    label: 'Fast Cadence',
    description: 'High-density urban/trap line, explicit SURGEON replacement that must land at exactly 12 syllables without breaking the flow.',
    verseText: 'Voy directo sin frenar, la calle me vio crecer\nY ahora todos quieren hablar pero nadie estuvo ayer\nTengo el flow pesado, el corazón de acero',
    noteFunction: 'verse',
    lang: 'es',
    dialect: 'central',
    lyricDna: {
      vozPropia: { estiloVocabulario: 'trap, flow rápido, jerga urbana, frases cortas y contundentes', imagenesHabituales: ['calle', 'acero', 'noche'], palabrasProhibidas: ['corazón de oro'] },
      influenciasYReferentes: { artistasClave: [], tonoDeseado: 'crudo, directo' },
      versosDeReferencia: [],
    },
    blockProfile: '',
    songStructure: { before: [], after: [] },
    targetVerse: { before: '', text: 'Tengo el flow pesado, el corazón de acero', after: '' },
    forceMode: 'SURGEON',
    userMessage: 'cambia esta línea sin perder el flow — que tenga exactamente 12 sílabas',
    expectedMode: 'SURGEON',
  },
  {
    id: 'narrative-void',
    label: 'Narrative Void',
    description: 'A deliberately vague, thin 2-line stanza where the story has nowhere obvious to go — should ask for direction (SOCRATIC ambiguity), not invent a random continuation.',
    verseText: 'No sé qué decir\nSolo miro',
    noteFunction: 'verse',
    lang: 'es',
    dialect: 'central',
    lyricDna: {
      vozPropia: { estiloVocabulario: 'sencillo, sin adornos', imagenesHabituales: [], palabrasProhibidas: [] },
      influenciasYReferentes: { artistasClave: [], tonoDeseado: '' },
      versosDeReferencia: [],
    },
    blockProfile: '',
    songStructure: { before: [], after: [] },
    targetVerse: null,
    forceMode: null,
    userMessage: 'ayúdame a continuar, no sé hacia dónde va esto',
    expectedMode: 'SOCRATIC',
  },
  {
    id: 'tone-check',
    label: 'Tone Check',
    description: 'Raw street-slang lyric_dna given a request that tempts a generic "atmospheric pop" answer — checks whether REGLA DE ADUANA LÉXICA actually holds the voice, not just the topic.',
    verseText: 'La ciudad no duerme y yo tampoco\nCada esquina tiene una historia que no cuento',
    noteFunction: 'verse',
    lang: 'es',
    dialect: 'central',
    lyricDna: {
      vozPropia: {
        estiloVocabulario: 'crudo, callejero, jerga de calle, cero metáfora bonita, frases habladas antes que cantadas',
        imagenesHabituales: ['esquina', 'asfalto', 'humo'],
        palabrasProhibidas: ['amanecer dorado', 'alma', 'susurro'],
      },
      influenciasYReferentes: { artistasClave: [], tonoDeseado: 'visceral, directo' },
      versosDeReferencia: [],
    },
    blockProfile: '',
    songStructure: { before: [], after: [] },
    targetVerse: null,
    forceMode: 'ARCHITECT',
    userMessage: 'dame una línea sobre ver amanecer después de una noche dura',
    expectedMode: 'ARCHITECT',
  },
];
