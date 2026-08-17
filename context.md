# VibeComposer — Project Context

_Last reviewed: 2026-08-17. This file is for future sessions (human or AI)
picking up the project — the README is intentionally just "VibeComposer /
Music". Replaces an earlier version of this file that described a much
older, pre-Supabase, pre-React incarnation of the app (a single-page vanilla-
JS chord-progression generator) — that app still exists as a subset (see
"The original composer flow," below) but is no longer the whole story._

## What it is now

A Supabase-backed songwriting app: a canvas-based lyrics/chords composer
(desktop, React Flow) with a native-mobile counterpart (Capacitor-wrapped,
touch-first screens), built around an AI co-writer called **La Musa** that
helps write, rhyme, and refine lyrics — plus the original "feeling → ukulele
chord progression" generator it grew out of, still reachable as one node
type inside the canvas.

No React Native rewrite — the mobile app is the *same* Vite/React app,
wrapped natively with Capacitor, with parallel mobile-specific screens
(`src/mobile/`) that reuse the desktop's data layer (`canvasData.js`,
`museApi.js`, `baulProcessor.js`) rather than duplicating business logic.
See `ROADMAP.md` for the native-wrapper build-out history and what's still
open (iOS build, Android on-device verification).

## Stack

- **Build**: Vite + React 18. `@xyflow/react` (React Flow) powers the
  desktop canvas's free-form 2D node layout.
- **Backend**: Supabase (Postgres + Auth + Storage). `src/config.js` holds
  the project URL + anon key (safe to ship client-side by design — access
  control is entirely RLS, see `supabase/schema.sql`). No custom server;
  the only non-Supabase backend surface is a thin Claude-proxy (see below).
- **AI**: Claude, called via `POST /api/claude` — never directly from the
  browser. `api/claude.js` (Vercel serverless function) and `server.py`
  (local dev) both inject `x-api-key` server-side. `MUSE_MODEL` in
  `museApi.js` is currently `claude-sonnet-5`.
- **Mobile**: Capacitor (`@capacitor/core`/`cli`/`android`, bundle id
  `com.andreusama.vibecomposer`). `npm run build && npx cap sync` is the
  update loop. iOS not yet added (needs a Mac); Android build generates but
  hasn't been run on-device from this Linux dev environment yet.
- **Testing**: Vitest. 120 tests across `museApi.test.js`, `rhyme.test.js`,
  `baulProcessor.test.js` — logic-level (parsing, verification, rhyme/
  syllable correctness), not component/UI tests.
- **Scripts** (`scripts/`): TypeScript, run via `tsx` (no build step, no
  project-wide TS adoption — just this one directory). `tsconfig.json` is
  minimal/non-strict, scoped to `scripts/**/*.ts` + `src/**/*.js` (so the
  scripts can import the app's own JS utilities directly). `scripts/.cache/`
  (downloaded dictionary dumps, gitignored) holds source data a seed script
  would otherwise have to re-download every run.

## Screen flow

Routing lives in `src/main.js` — a hybrid renderer: the canvas, song
thread, mobile projects list, and Muse Eye debug screen are real React
trees (`createRoot`, mounted/unmounted into `#app` as needed); everything
else (`auth`, `home`, `studio`, `loading`) is the original vanilla
`render(state)`/`attach(state)` innerHTML pattern from the pre-Supabase app.
Below `MOBILE_BREAKPOINT` (640px) the router swaps `CanvasScreen` for
`SongThreadScreen` and the desktop `home` composer-intro for
`MobileProjectsScreen` — same session/data, different chrome.

```
auth (signed-out only) → home → [canvas | song-thread] → studio (from a chord progression's "arrange")
                                        ↳ museeye (dev-only, 👁 from projects)
```

- **auth** (`src/screens/auth.js`) — Supabase magic-link sign-in. Known
  gap (see ROADMAP.md): the redirect flow assumes `window.location`, which
  doesn't work cleanly inside a Capacitor WebView yet — unresolved.
- **home** (`src/screens/home.js` desktop / `MobileProjectsScreen.jsx`
  mobile) — the projects dashboard (song list), `projectsData.js` backs
  both, including `deleteSong(id)` (hard delete — every child table
  references `songs.id on delete cascade`, so nothing else needs manual
  cleanup). Each card/row has a 🗑 next to its "open"/chevron affordance,
  gated behind a native `confirm()` (this app's one consistent confirmation
  pattern everywhere — no custom modal component exists). Mobile's row had
  to change from a `<button>` wrapper to a `<div role="button">` to host
  the delete button as an independently-tappable child without nesting
  buttons.
- **canvas** (`src/canvas/CanvasScreen.jsx`, desktop only) — free-form 2D
  React Flow board. Node types: `TextNoteNode` (a section/verse — see "A
  note IS a `sections` row" below), `ChordProgressionNode`,
  `InspirationBlackHoleNode`/`BaulFloatNode` (the Baúl, see below),
  `MuseFloatNode` (La Musa, floating chat), `TempoNode`, `OutputNode`,
  `VibeComposeNode` (the original chord-progression generator, now one node
  type among several). `NoteSidePanel.jsx` is the per-note detail popover
  (variants/annotations/history).
- **song-thread** (`src/canvas/SongThreadScreen.jsx`, mobile) — linear
  scrollable card list replacing the canvas's free layout; ordering reuses
  `resolveMainThreadPath` from `canvasData.js`. Tapping a card opens
  **`NoteEditorScreen.jsx`** (`src/mobile/`) full-screen — the mobile
  equivalent of `TextNoteNode` + `NoteSidePanel` combined, with progressive
  disclosure (write mode → text-selection toolbar → muse popover / rhyme →
  tools bottom sheet). See ROADMAP.md Phase 2 for the exact interaction
  spec this was built against.
- **studio** (`src/screens/studio.js`) — unchanged from the original app:
  a step sequencer built on raw Web Audio API (drum machine + from-scratch
  Hammond organ with drawbars/Leslie simulation), LOOP or SONG STRUCTURE
  mode (`src/audio/songStructure.js`, pure music-theory voice-leading, no
  API calls).
- **museeye** (`src/canvas/MuseEyeScreen.jsx`) — dev-only (gated on
  `import.meta.env.DEV` both at the router and at its entry point) full-page
  debug viewer for La Musa. Three tabs: **history** (every real call this
  session, from `debugLog.js`), **complaints** (persisted QA notes on a
  muse response or a Baúl absorption), **lab** (`MuseLabView.jsx` — Golden
  Set benchmark cases, A/B prompt comparison, pipeline-trace visualization;
  fixtures in `museGoldenSet.js`, run history in `museLabData.js`).

## Data model (`supabase/schema.sql`, run once in the SQL editor — additive
`migration_*.sql` files layer on top for anything added after the initial
schema; superseded migrations get deleted rather than accumulated)

Core: `songs` → `sections` (one row per structural block — verse/chorus/
etc; **"a note IS a `sections` row,"** the schema's own load-bearing
comment, is why `note.id === sections.id` everywhere in the muse code) →
`lines` (**one row per section**, the whole block's text as a single string
with embedded `\n`s — individual visual lines only exist as a client-side
split, `splitIntoLines`/`NoteEditorScreen`'s own array; nothing downstream
has a stable per-physical-line id). `line_variants`, `annotations`
(char-offset or whole-line anchored), `section_versions` (pre-overwrite
snapshots) hang off `lines`. `chord_progressions` + `note_links` +
`tempo_nodes` + `song_outputs`/`output_selections` are canvas/composition
plumbing (assignment, main-thread edges, tempo markers, the Output node's
picks). `ideas_notebook` is loose unattached notes.

**La Musa**: `muse_entries` (append-only conversation log, one row per
turn, keyed by `section_id`; `.action` is a coarse bucket for the chat UI,
`.mode` is the literal `action_type` — kept separate because `.action`
alone can't distinguish `WORD_BANK`'s `{wordGroups}` shape from a flat
suggestions array, see `migration_muse_entries_mode.sql`), `muse_profile`
(one row per section, a short LOCAL prose summary, refreshed every 5 turns
— there is **no song-level summary table**; whole-song context is the real
raw text, read fresh every call via `describeSongStructure`, not a cached/
re-derived rollup — this was a deliberate refactor, see the block-level
migration).

**Baúl** ("Inspiration Black Hole"): `baul_nodes` (canvas position only) +
`songs.lyric_dna` (the fused, never-appended-to ADN Lírico blob — voice,
vocabulary, banned words, tone, reference verses) + `baul_entries`
(append-only per-absorption log, **dev-only** — powers Muse Eye's baúl tab;
nothing in the real product surfaces what was absorbed, only that it was —
`BaulFloatNode` is a deliberate black box).

**Cultural Resonance Engine**: `line_audio` (voice memos, mobile long-press
— anchored via `(section_id, line_index)` since there's no stable
per-physical-line row to reference, same tradeoff `annotations`' char
offsets already accept) and `lexicon` — now **bilingual**: 734,753 real
Spanish words (Kaikki.org's Wiktionary extract) + 878,631 real Catalan
words (Softcatalà's spell-checker word list — see "La Musa," below for
why Catalan changed sources mid-project).

RLS: every table is owned via `songs.user_id = auth.uid()`, reached
directly or through a join, **except** `lexicon` — global reference data,
public-read/no-public-write, since it's not owned by any user (writes only
via the Supabase service-role key, from a local script, bypassing RLS
entirely — the anon key genuinely cannot write there).

## La Musa (AI co-writer)

`src/utils/museApi.js` is the whole brain: one `askMuse()` call, one of
four explicit modes the model itself picks (no generic "give me options"
funnel) —

- **SURGEON** — precise swap of a selected fragment, metric/syllable focus.
  Never touches the Cultural Resonance Engine.
- **ARCHITECT** — a new/continuation line, freer than SURGEON. The only mode
  the Cultural Resonance Engine (below) still injects into.
- **SOCRATIC** — asks back rather than generating. Four scenarios now (not
  three): ambiguity/stuck, phonetic friction (a requested rhyme has no
  natural options), reflection ("modo escucha" — now includes the **espejo
  temático**, see below), and a fourth added this pass — **no real
  context** (empty/near-empty note, no concrete ask either): rather than
  force an interpretation of nothing, it just asks what the artist wants to
  write about. Also newly instructed to recognize **elided-subject
  ambiguity** (Spanish/Catalan drop subjects constantly — "va saborejant la
  derrota" with no explicit subject) and ask who/what the real subject is
  instead of offering interpretations that dodge that question.
- **WORD_BANK** — a real, deterministic rhyme-and-vocabulary dictionary
  (rebuilt this pass, see below) — the model's role shrank to *parsing the
  request only*; it never proposes a single word itself anymore.

Two front-ends, same `askMuse()`: desktop's `MuseFloatNode.jsx` (a
persistent floating chat node, full conversation thread visible) and
mobile's `MusePopover.jsx` ("Zero-Chat" — single-shot per turn, no visible
scrollback, anchored directly under the line it's about rather than a
centered/dimming modal). Both track `session_angles_history` (rhyme
words + cultural frames already surfaced this session) so a regenerate
never repeats itself.

**Suggestion deck (mobile)**: SURGEON/ARCHITECT suggestions render as
swipeable cards — swipe left discards (draws from a local queue first, no
network call, before falling back to a real regenerate, capped at 3/turn),
swipe right accepts, dragging a card up previews it inline in the real line
before committing. Deliberately renders **exactly one card at a time**, not
a fanned stack — an earlier "peek the next card behind" version either
doubled up chrome with the outer anchored panel or let the stacked card's
text bleed through it; a single card sidesteps both.

### WORD_BANK — a real rhyme dictionary

Rebuilt from the ground up this pass around one rule: **the model never
generates the word list.** `parseWordBank` only extracts what was asked —
`target_rhyme` (now optional — a request can be pure letter-filter, pure
concept, or a bare "give me your best words" with none of the three, which
still returns a real answer instead of nothing, see `buildWordBankFromLexicon`'s
own reasoning), `rhyme_type` (consonant/assonant), a `letter_filter`
(`starts_with`/`contains_chain`/`contains_letters`), and a `concept`
(semantic filter, see below). Everything downstream of that is a real SQL
query against `lexicon` via `src/utils/lexicon.js`'s `queryWordBank` —
sorted **common-and-cool-first**, not raw `charisma_score` DESC (charisma's
own rarity component actively rewards obscurity and would bury exactly the
familiar, singable words a songwriter wants first).

**Concept explorer** — words related by *meaning*, not rhyme (SelectionCallout's
"✧ Concept" pill on mobile: select any word/phrase, one tap, confirm the
guess or type a different one before it fires — a real reported bug came
from auto-firing on a raw selection with zero chance to correct it). Two
different pipelines depending on what else was asked:
- **Rhyme/letters + concept together** (`filterWordBankByConcept`): the SQL
  pool is already relevant (it shares the requested rhyme/letters), so the
  model just filters that closed list down to what actually relates by
  meaning — never proposes words outside it.
- **Concept alone** (`proposeConceptWords` + `verifyWordsInLexicon`):
  reported live as a real bug — using "top-N by charisma across the whole
  734k+/878k-word lexicon" as the candidate pool (the old behavior) has
  *zero* relationship to any given concept, and silently degraded to
  showing an unrelated "random word family." Inverted the pipeline instead:
  the model *proposes* real words for the concept (good at semantics), the
  lexicon *verifies* each one is a real, non-invented entry (good at
  never-invent-a-word) — same guarantee, checked after generation instead
  of filtering before it, because here there's nothing meaningful to filter
  beforehand.

### Cultural Resonance Engine (ARCHITECT-only now)

`museApi.js`'s `buildCulturalResonance` + `extractCulturalFrame`,
`src/utils/lexicon.js`. **No longer touches WORD_BANK at all** (moved out
this pass) — a single "mandatory word" selection is the right shape for
writing *one* ARCHITECT line, but was the wrong shape for "show me every
real rhyme," and reducing a whole dictionary down to one word or nothing
made an empty WORD_BANK deck far more likely than it needed to be. For
ARCHITECT specifically: takes the target line's last significant word,
queries `lexicon` for real high-charisma (`charisma_score >= 7`) rhyme
matches via deterministic SQL — **the model is never asked to invent or
judge a rhyme** — then makes a small separate LLM call to pick the one
candidate that actually fits the artist's own voice (`lyric_dna`) and name
a cultural trope/frame for it. This voice-fit step exists because of a real
reported failure: a rare, high-charisma word can win purely on phonetics
while being a total non-sequitur for the song's register (a specific
archaeological/historical adjective surfacing in a modern urban track).
Degrades gracefully, with a distinguishable reason (`no_rhyme_match` vs.
`no_voice_fit`), rather than forcing a bad pick just to have picked
something.

### Ángulo cultural & genealogía de la imagen — standalone reflection features

Two client-forced actions (the UI already decided what's being asked, so
neither goes through `askMuse`'s own mode-selection at all) — both confirm
a concept first (guessed via the zero-cost, no-LLM `guessConceptFromLine`,
or typed from scratch), then call the model directly:

- **Ángulo cultural** (`getCulturalProvocation`) — mobile (SOCRATIC banner)
  and desktop (`MuseFloatNode`'s SOCRATIC turn), a static button available
  on any SOCRATIC response. ONE real cultural association (refrán, tropo,
  arquetipo, or a literary/historical reference if the line evokes one
  directly) for the given language's own cultural sphere (Spanish or
  Catalan, not assumed interchangeable). Framed explicitly as "react to
  this, don't copy it" — nothing ever gets inserted into the lyric.
- **Genealogía de la imagen** (`getImageGenealogy`) — mobile only
  (SelectionCallout's "🏛 Genealogía" pill; no desktop entry point exists
  for it). Deliberately reaches for **universal** culture rather than one
  language's tropes — up to 3 distinct real references (literature, myth,
  painting, film, historical figures) so the artist can see the
  conversation their own image is already part of (e.g. "volver a casa" in
  an Odyssey-themed song → Homer's Odyssey, a legitimate reference despite
  not being Spanish-speaking at all).

Both — and SOCRATIC's own elided-subject handling — can return
`{needsClarification: "..."}` instead of their normal shape when a line's
grammatical subject is ambiguous enough that guessing would risk
confidently answering the wrong question (Spanish/Catalan drop subjects
constantly). The UI renders that as a plain question + text input; the
artist's answer gets threaded back in as explicit context on the re-run,
never silently assumed.

### Seeding & CoolScore

`lexicon` is now **bilingual** — Spanish (734,753 rows, unchanged this
pass) and Catalan (878,631 rows, rebuilt this pass — see below), each
independently seeded and scored, `.eq('lang_code', ...)` scoping every
query that touches either so operating on one language can never corrupt
the other (a real near-miss: `recompute-coolscore.ts` originally had *no*
`lang_code` filter at all on its bulk update, harmless while the table was
single-language, a real corruption risk the moment a second one existed).

**Spanish** — `scripts/seed-lexicon-kaikki.ts`, Kaikki.org's Spanish
Wiktionary JSONL dump (~1GB streamed via readline, filtered to noun/verb/
adj, archaic/obsolete/misspelling excluded) — chosen over an earlier
hermitdave/FrequencyWords-based attempt (`seed-lexicon.mjs`, deleted)
because a pure frequency list has no part-of-speech/usage tags, so "keep
only real, non-archaic content words" isn't implementable against it.

**Catalan** — went through two real sources this pass, not one:
1. First attempt: Kaikki's Catalan Wiktionary dump, same pipeline as
   Spanish (`scripts/seed-lexicon-kaikki-catalan.ts`, since deleted/
   retired) — only 189,604 word forms → 181,291 kept rows, and genuinely
   incomplete (a live check found "amor," an entirely ordinary word,
   missing outright).
2. Replaced with **Softcatalà** (`scripts/seed-lexicon-softcatala.ts`,
   `huggingface.co/datasets/softcatala/catalan-dictionary`, LGPL/GPL,
   1,219,652 `form lemma pos_tag` rows, the word list behind Catalan
   spell-checkers) — 878,631 distinct kept words, confirmed "amor" present.
   Deliberately does **not** restrict to `form === lemma` (i.e. keeps
   conjugated verb forms, plurals, feminine forms as independent rows) —
   every kept form is a real, independently rhymable word, and this app's
   own stated WORD_BANK mission is "literally all the words that match the
   rhyme," not just dictionary headwords. Trade-off, accepted deliberately:
   conjugations of the same verb (or agentive nouns sharing a suffix) can
   cluster the very top of a *pure* charisma ranking with no other filter
   applied — a real, known, low-priority cosmetic effect, not a
   correctness bug. Softcatalà has no glosses at all, so Catalan's
   `charisma_score` placeholder (before CoolScore recompute) drops the
   gloss-quality signal Spanish's still uses.

Both languages' real `charisma_score` comes from
`scripts/recompute-coolscore.ts`'s CoolScore formula (phonetics + rarity +
loanword + semantic-density, weighted) — now parameterized per language
(`npm run coolscore -- es|ca`), each with its own frequency source
(hermitdave's `es_full.txt`/`ca_full.txt`), its own hand-built loanword
list (Catalan spells several loanwords differently — `futbol` not
`fútbol`, `bàsquet` not `básquetbol`), and its own empirically-calibrated
floor/ceiling (Catalan's distribution doesn't transfer from Spanish's
numbers — checked directly, not assumed, both times the underlying Catalan
word population changed). Rarity needed a real frequency source at all
because Kaikki/Softcatalà are dictionaries, not frequency corpora — the
Spanish corpus (~1.2M words) covers this lexicon's ~735K rows well;
Catalan's (71,184 words) covers under 6% of its much larger 878,631-row
table, so most Catalan rows default to maximum rarity (`freq_rank: null`)
— a known, disclosed gap, not silently hidden (a much larger corpus,
SUBTLEX-CAT's 278M-word subtitle corpus, was identified as the fix but not
yet integrated). The rarity formula itself needed two corrections after
real-data verification before it was usable: the original spec's direction
was inverted (`1 - rank/maxRank` gave common words *higher* rarity), and
linear rank scaling badly compressed real vocabulary against a
Zipfian-distributed corpus (0% of a real sample cleared the `>=7` filter)
— fixed with log-scaled rank + a distribution calibrated against real
percentiles.

`recompute-coolscore.ts` also switched from OFFSET to **keyset (cursor)
pagination** mid-pass — reported live as real timeouts against the larger
post-Softcatalà table (`.range(offset, ...)` gets more expensive the deeper
it pages, a standard Postgres OFFSET problem, not a transient blip as it
first looked). `.gt('id', lastId).order('id').limit(pageSize)` stays
equally fast at any depth; a few retries with backoff sit on top for
genuine transient network blips.

Every seed/recompute script guards its `main()` behind an entrypoint check
(`import.meta.url === file://${process.argv[1]}`) — they export their pure
functions for dry-run testing, and an earlier unguarded version ran a real
partial production update as a side effect of being imported for that
purpose.

## Rhyme & syllable engine (`src/utils/rhyme.js`, `syllables.js`)

Heuristic vowel-run/hiatus scansion for **Spanish and Catalan only** (no
English/French — the whole app, UI included, only supports `es`/`ca`, one
dialect each for `es`, two for `ca`). Not a full linguistic grammar, good
enough for live per-line counting and rhyme classification
(`classifyStanzaRhymes`, consonant/assonant keys, aguda/llana/esdrújula
stress). `detectRhymeFriction` flags a line that breaks the stanza's
established scheme — purely content-driven (no idle/pause timer anywhere;
"the writer needs room to think in silence" was an explicit, deliberate
product call), surfaces as a quiet tappable gutter icon on mobile, costs no
API call until tapped.

This engine's own Catalan support long predates `lexicon` having any
Catalan data at all — SURGEON/ARCHITECT rhyme verification and the inline
rhyme badges worked correctly for Catalan lyrics well before WORD_BANK/
concept-explorer features could return anything for that language (fixed
this pass, see "Seeding & CoolScore" above). `scripts/recompute-coolscore.ts`
reuses this file's own `LANG_RULES` (via `syllables.js`) for its Phonetics
component now too, instead of a hand-copied, Spanish-only accented-vowel
set that silently didn't apply to Catalan (à/è/ò aren't in Spanish's
accent set, and Spanish's á isn't in Catalan's).

Two real, previously-undetected bugs were found and fixed while building
the Cultural Resonance Engine (both had silently existed since these files
were first written, well before this): **á was stripped as if it didn't
exist** in 7 independent hand-copied regexes across both files (missing
from a whitelist otherwise built from Catalan's accent set, which has no
á) — corrupted syllable/stress/rhyme detection for any word containing it
(está, árbol, días, rápido...). Now centralized into shared
`ACCENT_VOWELS`/`ACCENT_LETTERS` constants so it can't recur. Separately,
**mid-word consonantal y was being deleted** instead of kept
(`normalizeY`), silently merging two separate vowel runs into one false
diphthong — "rayo" computed the *same* rhyme key as "cacao," which don't
rhyme. Both have regression tests in `rhyme.test.js`.

## Deployment

- Web: Vercel, `vercel.json` rewrites `/api/claude` to the serverless
  function.
- Local dev: `npm run dev` (Vite) + the Claude proxy needs
  `ANTHROPIC_API_KEY` — either `python3 server.py` (serves + proxies) or
  Vercel's own dev server; `.env` holds the key for local script use
  (`scripts/`) but the app itself gets it server-side only, never client.
- Mobile: `npm run build && npx cap sync android`, then a native Android
  Studio/Gradle build. No CI/store pipeline yet (ROADMAP.md Phase 4,
  untouched).
- MIT licensed.

## Known rough edges

- Auth's magic-link redirect doesn't have a real mobile-native flow yet
  (ROADMAP.md, Phase 0's noted gap) — first hard mobile-auth problem,
  unsolved.
- `lexicon.charisma_score`'s semantic-density component uses a cheap
  prefix heuristic (des-/in-/im- → 0.7, else 0.3), not the LLM-tagged
  version the original CoolScore spec offered as an alternative — that
  would mean ~735K words through the API, a real cost/time tradeoff that
  was flagged rather than silently done.
- `lexicon`'s loanword detection is a small hand-built list per language +
  a shared mechanical phonotactic check (sh/th/ph/w) — real but coarse; a
  rare-register or informal-loanword word can still pass the archaic/
  obsolete/misspelling filter untouched (e.g. "swap," a real but slangy
  Spanish loanword) since those tags were the only ones the original filter
  spec excluded. Catalan's list is smaller/rougher than Spanish's — a
  first pass, not linguistically authoritative.
- Two separate chord-frequency lookup tables (`studio.js`,
  `songStructure.js`) predate this whole rewrite and are still
  independent — no single source of truth for "what chords exist," watch
  for drift if adding chord types.
- No CI, no linter config beyond whatever Vite/Vitest assume by default.
- iOS build unstarted (needs a Mac); Android build generates but hasn't
  been run on an actual device/emulator from this Linux dev environment.
- Catalan's frequency corpus (71,184 words) covers under 6% of the
  878,631-row Catalan lexicon — most Catalan `charisma_score` values are
  currently inflated by the "unranked word defaults to max rarity"
  fallback. SUBTLEX-CAT (278M-word subtitle corpus) was identified as the
  real fix but not yet integrated — see "Seeding & CoolScore" above.
- A pure-charisma, no-other-filter WORD_BANK/concept query can surface a
  cluster of near-duplicate words sharing a prefix/suffix (conjugations of
  one verb, agentive nouns off one root) at the very top of the ranking,
  for both languages — a known, explicitly deprioritized cosmetic effect
  of keeping every real word form rather than restricting to dictionary
  lemmas (a deliberate completeness-over-ranking-purity trade, not an
  oversight).
- **Genealogía de la imagen** has no desktop entry point at all (mobile-only
  SelectionCallout pill) — desktop's chat-based interaction model has no
  equivalent "select text, tap a pill" mechanism to hang it off. The
  **concept explorer**'s dedicated one-tap pill is mobile-only too, but its
  backend already works from desktop's free-text chat without one (just
  type the request). A standalone, no-selection "Cool words" FabMenu entry
  point was built and then explicitly pulled (felt too trivial as its own
  doorway) — the `mode='concept'` plumbing it used still exists and still
  works via SelectionCallout, so re-adding a no-selection entry point later
  is cheap if it turns out to be wanted after all.
