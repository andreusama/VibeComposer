# VibeComposer — Project Context

_Last reviewed: 2026-08-12. This file is for future sessions (human or AI)
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
- **Testing**: Vitest. 70 tests across `museApi.test.js`, `rhyme.test.js`,
  `baulProcessor.test.js` — logic-level (parsing, verification, rhyme/
  syllable correctness), not component/UI tests.
- **Scripts** (`scripts/`): TypeScript, run via `tsx` (no build step, no
  project-wide TS adoption — just this one directory). `tsconfig.json` is
  minimal/non-strict, scoped to `scripts/**/*.ts` + `src/**/*.js` (so the
  scripts can import the app's own JS utilities directly).

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
  both.
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
offsets already accept) and `lexicon` (734,753 real Spanish words from
Kaikki.org's Wiktionary extract — see "La Musa," below).

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
- **ARCHITECT** — a new/continuation line, freer than SURGEON.
- **SOCRATIC** — asks back rather than generating (a genuine block, unfilled
  narrative gap, or phonetic friction) — one question + 2-3 chips, never a
  full lyric line.
- **WORD_BANK** — a filtered word/short-phrase dictionary, grouped by
  syllable count.

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

**Cultural Resonance Engine** (`museApi.js`'s `buildCulturalResonance` +
`extractCulturalFrame`, `src/utils/lexicon.js`): for ARCHITECT/WORD_BANK
only (never SURGEON), takes the target line's last significant word,
queries `lexicon` for real high-charisma (`charisma_score >= 7`) rhyme
matches via deterministic SQL — **the model is never asked to invent or
judge a rhyme**, it only ever receives one this module already verified —
then makes a small separate LLM call to find a cultural trope/frame for
that concept (genuinely interpretive, intentionally still LLM-driven,
unlike the rhyme word itself), and injects both as a constraint into the
main call. Degrades gracefully (flagged, not silently broken) when the
lexicon has no high-charisma match for a given rhyme.

`lexicon` was seeded from Kaikki.org's Spanish Wiktionary JSONL dump
(`scripts/seed-lexicon-kaikki.ts`, ~1GB streamed via readline, filtered to
noun/verb/adj, archaic/obsolete/misspelling excluded) — chosen over an
earlier hermitdave/FrequencyWords-based attempt (`seed-lexicon.mjs`,
deleted) because a pure frequency list has no part-of-speech or usage-
register tags, so the "keep only real, non-archaic content words" filter
literally isn't implementable against it, and it structurally excludes the
rare/evocative vocabulary a "charisma" feature actually wants.
`charisma_score` comes from `scripts/recompute-coolscore.ts`'s CoolScore
formula (phonetics + rarity + loanword + semantic-density, weighted) —
rarity needed a *second* real data source (hermitdave's `es_full.txt`,
~1.2M words) backfilled in as `freq_rank`, since Kaikki (a dictionary) has
no frequency data at all despite an earlier draft of this feature assuming
it did. The formula's rarity term needed two corrections after real-data
verification before it was usable: the original spec's direction was
inverted (`1 - rank/maxRank` gave common words *higher* rarity), and linear
rank scaling badly compressed real vocabulary against a Zipfian-distributed
1.2M-word corpus (0% of a real sample cleared the `>=7` filter) — fixed
with log-scaled rank + a distribution calibrated against real percentiles.
Both scripts guard their `main()` behind an entrypoint check
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
- `lexicon`'s loanword detection is a small hand-built list + mechanical
  phonotactic check (sh/th/ph/w) — real but coarse; a rare-register or
  informal-loanword word can still pass the archaic/obsolete/misspelling
  filter untouched (e.g. "swap," a real but slangy Spanish loanword)
  since those tags were the only ones the original filter spec excluded.
- Two separate chord-frequency lookup tables (`studio.js`,
  `songStructure.js`) predate this whole rewrite and are still
  independent — no single source of truth for "what chords exist," watch
  for drift if adding chord types.
- No CI, no linter config beyond whatever Vite/Vitest assume by default.
- iOS build unstarted (needs a Mac); Android build generates but hasn't
  been run on an actual device/emulator from this Linux dev environment.
