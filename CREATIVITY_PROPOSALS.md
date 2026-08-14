# Creativity proposals — the app is about ideas, not autocomplete

_Last reviewed: 2026-08-14. Proposal doc — nothing here is implemented, this
is a menu to greenlight from, not a plan._

## Why this doc exists

SURGEON and ARCHITECT are useful, but they're fundamentally **convergent**:
given a line/stanza, produce a metrically-correct finish. That's a real
utility, but it's not what the product is actually for. The stated identity
of the app is creativity — sparking ideas, surfacing cool words, helping the
artist's brain get moving ("hacer carburar el cerebro") — which is a
**divergent** problem, not a completion problem.

Meanwhile, several pieces already built for other purposes are sitting on
real creative-ideation potential that nothing currently surfaces on its own:

- **`charisma_score`** (1–10, computed via the CoolScore formula in
  `scripts/recompute-coolscore.ts`) — currently only used to *sort* rhyme
  results. Nothing lets the artist just ask for "cool words," full stop.
- **`lexicon`** (734,753 real Spanish words, `src/utils/lexicon.js`) — a real
  dictionary with rhyme keys (consonant + assonant), syllables, and now (see
  the WORD_BANK concept-filter work) a validated LLM concept-filter step
  (`filterWordBankByConcept`, `museApi.js`) that can select real words by
  meaning, not just by rhyme/letters.
- **`lyric_dna`** (`songs.lyric_dna`, built by the Baúl —
  `src/utils/baulProcessor.js`) — a rich artist-voice profile:
  `vozPropia.imagenesHabituales` (5–6 recurring physical objects/sensations/
  scenes from the artist's own subconscious), `vozPropia.estiloVocabulario`,
  `influenciasYReferentes.tonoDeseado`, and `versosDeReferencia` (reference
  verses the artist supplied). Today this is **write-only** in practice — it
  gets captured once at onboarding and then only ever used silently, as a
  filter inside prompts. The artist never sees their own `imagenesHabituales`
  or `versosDeReferencia` again.
- **Cultural Resonance Engine** (`extractCulturalFrame`, `museApi.js`) — can
  surface a real refrán/tropo/archetype tied to a concept, filtered for voice
  fit. Currently only ever fires bundled inside an ARCHITECT line generation,
  never as a standalone "give me a cultural angle to think about" surface.
- **`session_angles_history`** (tracked client-side in `MusePopover.jsx` /
  `MuseFloatNode.jsx`) — exists purely to prevent repeats. Nothing reads it
  back to the artist as "here's what you've been circling."

The proposals below are mostly about **surfacing what's already computed**,
not building new AI pipelines from scratch.

## Proposals

### 1. Detonador — a spark button with no target
A button that has nothing to do with any specific line: tap it, get 2–3
wildly evocative high-charisma words, filtered for voice fit against
`lyric_dna` (same validated-selection pattern as `extractCulturalFrame`, but
with no rhyme constraint at all — a random/rotating slice of the top charisma
tier as the candidate pool). Explicitly framed as "just play with these," not
tied to inserting anything. This is the purest expression of "palabras
chulas" as a first-class feature instead of a rhyme-lookup side effect.
- **Reuses:** `queryWordBank` (rhymeKey=null, high-charisma slice),
  voice-fit selection pattern from `extractCulturalFrame`.
- **New:** a selection prompt without a "must relate to a rhyme" framing —
  needs its own small LLM call or a purely random+charisma-weighted pick
  with no LLM at all (cheaper, arguably more "surprising" — worth deciding
  which before building).
- **Effort:** medium.

### 2. Surface the artist's own imagenesHabituales
`lyric_dna.vozPropia.imagenesHabituales` already exists per song — 5–6
recurring images/sensations the Baúl extracted from the artist's own input.
Show them back as a small rotating deck the artist can glance at while stuck
("your own recurring images: neon, rain on glass, a phone left face-down…").
Zero LLM cost — this is a read of data that's already sitting there, unused
after the moment it was captured.
- **Reuses:** `lyric_dna.vozPropia.imagenesHabituales`, already loaded
  wherever `lyricDna` is (`SongThreadScreen.jsx`, `CanvasScreen.jsx`).
- **Effort:** low.

### 3. Concept-to-vocabulary explorer, as its own entry point
The concept filter just built for WORD_BANK (`filterWordBankByConcept`)
already does exactly this — real words, filtered by meaning, voice-fit-aware
— but it's currently reachable only by phrasing a request that happens to
include a concept alongside a rhyme/letter ask. Give it its own doorway: type
a feeling/image/theme, get a curated, charisma-sorted word cloud, no rhyme
required at all. This turns what's currently a WORD_BANK side-feature into
the headline "give me cool words about X" experience the app is supposed to
be about.
- **Reuses:** `queryWordBank` (rhymeKey=null) + `filterWordBankByConcept`,
  both already built and tested. Needs only a new UI entry point, no new
  backend logic.
- **Effort:** low.

### 4. Cultural provocation as its own SOCRATIC action
SOCRATIC's "modo escucha" (reflection) today is 1–2 sentences and a
question — explicitly "CERO VERSOS." Add an optional next step: "give me a
cultural angle" surfaces ONE refrán/tropo/archetype for the current theme via
`extractCulturalFrame`, deliberately decoupled from any mandatory word to
insert — framed as "react to this, don't copy it." This reuses the exact
mechanism that currently only exists to justify a single word choice inside
an ARCHITECT call, exposed instead as a thinking prompt in its own right.
- **Reuses:** `extractCulturalFrame`, minus the "must anchor a rhyme"
  constraint.
- **Effort:** medium.

### 5. "Break your own mold" mode (careful, opt-in)
The Cultural Resonance Engine's voice-fit filter (REGLA DE ADUANA LÉXICA)
exists specifically to discard words that don't fit the artist's established
voice — the fix for the "tiwanacota" problem. That filter is exactly right
as a *default*. But sometimes a creative jolt comes from a productive clash,
not a confirmation of your own patterns. An explicit, opt-in toggle that
inverts the filter for one request — surface a high-charisma word that does
*not* fit the established voice, on purpose, clearly labeled as a
provocation rather than a suggestion to use as-is.
- **Reuses:** the same candidate pool as `extractCulturalFrame`, inverted
  selection criterion.
- **Needs care:** must stay explicitly opt-in and clearly labeled — this is
  the one proposal that directly runs against a safety rule we added on
  purpose, so it should never be the default path.
- **Effort:** medium, mostly UX framing risk rather than engineering risk.

### 6. Session recap — a mirror, not a generator
A small passive summary at the end of a writing session, built entirely from
`session_angles_history` (words/tropes already surfaced this session) —
"today you kept circling: sea, wound, ash." Zero generation, zero new LLM
call — just reflecting back a pattern the artist may not have noticed
forming in real time. Purely observational, which fits "help the brain get
going" better than another suggestion would.
- **Reuses:** `session_angles_history`, already tracked client-side.
- **Effort:** low.

### 7. Echoes of versosDeReferencia
`lyric_dna.versosDeReferencia` (reference verses the artist supplied at
onboarding) are captured once and never shown again. An occasional (not
spammy) ambient callback — "remember why you started" — surfacing one
reference verse back to the artist as texture, not as something to imitate
line-by-line.
- **Reuses:** `lyric_dna.versosDeReferencia`, already stored.
- **Effort:** low.

## Suggested order (cheapest real wins first)

1. **Low effort, pure data-surfacing, zero new AI cost:** #2, #3, #6, #7 —
   these are almost entirely "show what's already computed," not new
   pipelines.
2. **Medium effort, reuse existing validated patterns:** #1, #4 — need a new
   LLM call shape, but copy the already-proven
   propose→validate-against-candidates pattern from `extractCulturalFrame`.
3. **Needs the most product judgment, not the most code:** #5 — technically
   simple, but worth a deliberate conversation about framing before building,
   since it intentionally works against an existing safety rule.
