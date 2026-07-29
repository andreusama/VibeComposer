# VibeComposer — Project Context

_Last reviewed: 2026-07-29. This file is for future sessions (human or AI) picking up the project — the README is intentionally just "VibeComposer / Music"._

## What it is

A single-page web app that turns a feeling into a ukulele chord progression.
The user walks through a guided flow — a phrase, a place, a photo — that gets
distilled into a "vibe profile" (mood/energy/flavour/texture), which is sent
to Claude to generate a 4-chord progression. The result is presented as a
lead-sheet "artifact card" with ukulele fretboard diagrams, playable audio,
a shareable URL, and a "studio" mode with a tonewheel-organ-style sequencer
and an auto-generated VERSE/CHORUS/BRIDGE song structure.

No framework, no build step. Plain ES modules loaded directly by the browser.

## Screen flow (state machine in `src/state/store.js`)

```
muse → place → photo → builder → loading → result → chord
                                              ↘ studio
```

- **muse** (`src/screens/muse.js`) — free-text "phrase", the emotional anchor. Can be skipped ("can't put it into words").
- **place** (`src/screens/place.js`) — Leaflet map (CDN), click-to-pin or search via Nominatim (OpenStreetMap) geocoding. Skippable.
- **photo** (`src/screens/photo.js`) — optional image upload; dominant color extracted client-side via `<canvas>` pixel sampling (skips near-black/near-white pixels). That RGB becomes the app's accent color and one input to the mood.
- **builder** (`src/screens/builder.js`) — refinement screen: RGB sliders → mood (via HSL bucketing, see `constants.js:moodFromHsl`), energy slider (quiet…intense) with an animated canvas waveform, flavour/texture tag pickers (`constants.js:DIMENSIONS`), and an "easy chords only" toggle. "Compose" triggers the API call.
- **loading** — plain spinner while awaiting Claude.
- **result** (`src/screens/result.js`) — the "artifact card": lead-sheet-styled progression display, play-all button, link to studio, share button (encodes state into URL hash).
- **chord** (`src/screens/chord.js`) — per-chord detail view with fretboard SVG and play button, prev/next nav.
- **studio** (`src/screens/studio.js`) — the deep end: a step sequencer (drum machine + Hammond-organ-style synth with drawbars and Leslie speaker simulation) built on raw Web Audio API. Has two modes:
  - **LOOP**: cycles the 4 chords.
  - **SONG STRUCTURE**: calls `src/audio/songStructure.js` to build an 8-section VERSE/VERSE/CHORUS/CHORUS/BRIDGE/BRIDGE/CHORUS/CHORUS arrangement using a voice-leading scoring algorithm (interval quality between chord roots) and "borrowed" chords from the parallel minor — all pure music theory, no API calls.

State is a single mutable object with pub/sub (`subscribe`/`setState`, one listener — `main.js` re-renders the whole screen via `innerHTML` on every change). Screens export `render(state)` (returns HTML string) and `attach(state)` (wires up event listeners after injection).

## Claude integration

- `src/constants.js` → `SYSTEM_PROMPT`: instructs Claude to act as a ukulele chord composition assistant, return **raw JSON only**, given a vibe profile (phrase, place, mood, energy, flavour, texture, easyMode). Schema includes `key`, `title`, `summary`, and a 4-item `progression` array with `chord`/`function`/`feel`/`ukulele` (fret array `[G,C,E,A]`, `0`=open, `-1`=muted).
- `easyMode` restricts Claude to 8 open-position beginner chords (C, G, Am, F, Dm, D, A, E7).
- `src/utils/api.js` → `composeProgression()`: POSTs to `/api/claude` (model `claude-sonnet-4-5`, hardcoded). Has a `MOCK_MODE` flag (currently `false`) with hand-written mock responses per mood for offline UI dev.
- **API key never touches the browser**: `api/claude.js` (Vercel serverless function, routed via `vercel.json` rewrite) and `server.py` (local dev server, `ANTHROPIC_API_KEY` env var) both proxy `POST /api/claude` → `https://api.anthropic.com/v1/messages`, injecting `x-api-key` server-side.
- Client-side daily usage cap: 100 composes/day tracked in `localStorage` (`vc_usage` key, resets by comparing `Date().toDateString()`). This is a soft, easily-bypassed limit (pure client-side), not real rate limiting.

## Audio

Two **separate, non-shared** audio stacks:
- `src/audio/player.js` — uses **Tone.js** (CDN) for chord playback on the result/chord screens. Energy level (`quiet`→`intense`) maps to a `Tone.PolySynth` envelope/reverb/strum-speed profile (`ENERGY_PROFILES`).
- `src/screens/studio.js` — uses **raw Web Audio API** directly (oscillators, buffers, biquad filters) for the sequencer: kick/snare/hi-hat synthesis, a sawtooth bass, and a from-scratch Hammond organ (`playHammond`) with 9 drawbars and a Leslie-speaker vibrato/tremolo simulation. Drum patterns and drawbar levels are hardcoded defaults, adjustable in the UI but not persisted.

Chord name → frequency lookup tables are duplicated between `studio.js` and `songStructure.js` (`CHORD_FREQS`) — not shared, watch for drift if adding new chord types.

## Sharing

`src/utils/share.js` — the entire result state (progression, phrase, place, vibeLabel, rgb) is base64-JSON-encoded into the URL hash (`writeShareUrl`). `store.js` reads it back on load (`readShareUrl`) and boots straight into the `result` screen. No backend persistence — the URL *is* the save file. Long phrases/places make for long URLs.

## Other notable pieces

- `src/components/fretboard.js` — generates ukulele chord-diagram SVGs from a fret array, auto-shifts the fret window when a chord is played above the open position (`Nfr` indicator).
- `src/constants.js` — also home to the color→mood logic: RGB → HSL → mood string (`moodFromHsl`), and `energyIdFromValue` bucketing (quiet/mellow/medium/vibrant/intense).
- No tests, no linter config, no `package.json` — everything runs via `<script type="module">` and two CDN `<script>` tags (Leaflet, Tone.js) in `index.html`.
- `style.css` is a single 1834-line hand-written stylesheet (no preprocessor).

## Deployment

- Deploys to **Vercel**; `vercel.json` rewrites `/api/claude` to the serverless function `api/claude.js`.
- Local dev: `ANTHROPIC_API_KEY=sk-ant-... python3 server.py` (serves static files + proxies the API on port 3000). This replaces `python3 -m http.server`.
- MIT licensed (Copyright Sama7, 2026).

## Known rough edges (as of this review)

- `MOCK_MODE` in `api.js` is a manual toggle developers must remember to flip back before shipping (it's been flipped both ways in git history already).
- The two chord-frequency tables (`studio.js`, `songStructure.js`) and the fret-based one implied by `SYSTEM_PROMPT` are independent — no single source of truth for "what chords exist."
- Daily compose limit is purely client-side (`localStorage`), trivially reset by clearing storage or using a private window.
- ⚠️ The git remote in this repo's config (`VibeComposer/VibeComposer/.git/config`) has a GitHub personal access token embedded in plaintext in the URL (`https://andreusama:ghp_...@github.com/...`). Worth rotating/removing if this repo or its config is ever shared.
