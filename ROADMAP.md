# Roadmap — VibeComposer as a native app

_Last reviewed: 2026-08-10._

## Why

The web app has less reach than a real mobile app. The existing canvas UI
(`CanvasScreen.jsx`, a drag-based 2D React Flow layout) doesn't translate to
touch — no reliable drag-and-drop on a phone, no room for floating panels.
The mobile direction replaces the canvas with a linear, touch-first UI on
small/native viewports while reusing the same data layer (`canvasData.js`,
`museApi.js`, `baulProcessor.js`) that already backs the desktop canvas.

**Design references** (mockups, not yet committed as image assets — describe
here so intent survives without the files):
1. 4 screens: Projects list, Song thread, Node detail bottom sheet, Baúl
   tap-to-attach.
2. Song thread card detail: swipeable in-card variant carousel (pagination
   dots) + conditional metadata footer.
3. Full-screen note editor: 4-state progressive disclosure (write mode /
   text-selection toolbar / rhyme popover / tools sheet). Supersedes an
   earlier "node detail bottom sheet" idea (design ref #1's 3rd screen) —
   see Phase 2's note below.

Given the app leans on Web Audio (Tone.js, a from-scratch Hammond organ) and
React Flow, a React Native rewrite would be very costly and throw away
working code for little gain. The path is: **wrap the existing Vite/React
app natively with Capacitor**, then build the mobile-specific screens as new
React components on top of the same backend logic.

## Phases

### Phase 0 — Native wrapper — mostly done
Add Capacitor, get a real iOS + Android build installable on a device/
simulator, running the existing desktop UI as-is (cramped on a phone, that's
fine — this phase only proves the packaging/signing/build pipeline works,
which has its own long lead time: Apple Developer account, provisioning,
Android signing key).

- [x] `@capacitor/core`/`cli`/`android` installed (8.5.0). Required bumping
  this environment's Node to 22 LTS via `nvm` — Capacitor's CLI hard-requires
  Node ≥22 — `nvm alias default 22` set, `.bashrc` updated so new terminals
  pick it up automatically.
- [x] `npx cap init` — app name **VibeComposer**, bundle id
  **com.andreusama.vibecomposer**
- [x] `capacitor.config.json`: `webDir: 'dist'` (Vite's existing build
  output, `vite.config.js` untouched)
- [x] `npx cap add android`, `npx cap sync` verified working
      (`npm run build && npx cap sync` is the standing update loop)
- [ ] `npx cap add ios` — needs the Mac (Xcode is macOS-only, no Linux path)
- [ ] Actually run the Android build on a device/emulator — this Linux
  environment has no Android SDK/`adb`/emulator installed yet, so the native
  build has been verified to *generate* correctly but not yet *run*. Two
  options when needed: install Android command-line SDK tools + connect a
  phone via USB debugging (`npx cap run android`), or a lighter emulator
  (Genymotion) instead of full Android Studio.

**Known gap surfaced here, not fixed in this phase:** Supabase auth's
magic-link redirect (`src/screens/auth.js`) assumes a browser
`window.location` flow — inside a Capacitor WebView this needs either a
custom URL scheme / universal link registered in both native shells, or a
different auth method for the mobile build. First hard mobile-specific
problem to solve once Phase 0's basic "does it run" check passes.

### Phase 1 — Song thread view
New mobile-only screen replacing the canvas below a viewport/platform
breakpoint: notes rendered as an ordered, scrollable list of cards instead
of a free-form 2D layout, with an "insert node" affordance between cards.
Ordering reuses `resolveMainThreadPath` (`canvasData.js`) — the same
main-thread walk the desktop Output node and the Muse's song-structure
context already use.

Card: type badge, chord summary, 2-line lyric preview, note count. Variant
browsing/carousel is explicitly **out of scope for now** — ignore it until
revisited; cards don't need to expose variants at all in this phase.

### Phase 2 — Full-screen note editor (design ref #3)
**Revised 2026-08-10: the separate "node detail bottom sheet" idea (old
Phase 2a) is dropped.** Tapping a card in the song thread opens this editor
directly — there's no intermediate quick-glance sheet. `NoteSidePanel.jsx`'s
features (variants, notes/annotations, history) fold into this screen's
tools sheet as additional rows rather than living in their own surface.
Reuses `NoteSidePanel.jsx` and `MuseFloatNode.jsx`'s existing data
logic/hooks throughout — new mobile chrome around the same functions, not
new business logic. Four-state progressive disclosure, nothing shown that
isn't needed for the current action:

1. **Write mode (default)**: full-screen, header is a back chevron +
   section-type pill + a small bpm/chord badge + "..." menu + "Done". Body
   is numbered lines, each with the line number AND its rhyme-key letter
   stacked in the margin (reuses `classifyStanzaRhymes` from `rhyme.js` —
   same per-line letter the desktop `.rhyme-badge` strip already shows, just
   laid out differently) with an always-present blank "write the next
   line…" row. Bottom toolbar: **chords** / **muse** / **tools** — three
   icons, nothing else. No floating panels, no side panel — everything else
   is tucked away until asked for.
2. **Text-selection toolbar**: selecting any text fragment (a word, a line,
   a partial phrase) pops a small contextual toolbar directly above the
   selection: **Rhyme**, **Ask muse**, **+ Variant**. This is the mobile
   surface for the existing `targetVerse` fragment-targeting concept
   (`museApi.js`'s SURGEON mode already expects exactly this shape:
   `{text, before, after}`) — "Ask muse" opens the muse pre-scoped to the
   selection, "+ Variant" calls `addVariant` scoped to the selected line.
3. **Rhyme popover** ("Rhyme" tapped): a small panel anchored below the
   selection toolbar — "rhymes with {word}" + word-pill suggestions, an
   asonante/consonante filter, tapping a pill replaces the selected word in
   place. Pure client-side lookup (`getWordRhymeKey`/`wordMatchesRhyme` in
   `rhyme.js`) — no muse/LLM call, so it's instant. Asonante matches are
   visually favored (matches how the word is actually sung in Spanish), but
   both types stay available via the filter.
4. **Tools sheet**: tapping the "tools" toolbar icon slides up a settings-
   style bottom sheet, dimming the editor behind it:
   - *Syllable count* (toggle, on by default) — shown in the margin, reuses
     `countLineSyllables` (`syllable.js`).
   - *Focus mode* (toggle, off by default) — dims everything but the current
     line. **Genuinely new**, no desktop equivalent today.
   - *Repeated words* (button: "Check") — checks across the whole lyric,
     reuses `findRepeatedWords`/`significantWords` (`repeatedWords.js`).
   - *Assign chords* (disclosure row, shows current progression e.g.
     "Dm · A7 · Bb") — reuses the existing chord-progression assignment flow
     from `ChordProgressionNode`.
   - *Variants / Notes / History* (three more disclosure rows, each showing
     a count) — **this is where `NoteSidePanel.jsx` folds in.** Tapping one
     opens that tab's existing content (add/promote/delete a variant,
     add/resolve/delete an annotation, restore/delete a history version) —
     same Supabase calls (`addVariant`, `promoteVariant`, `addAnnotation`,
     `restoreVersion`, etc. in `canvasData.js`), new mobile presentation.

### Phase 3 — Baúl tap-to-attach
Modal instead of a draggable float; adds a genuinely new capability — voice
memo record + transcribe — since `baulProcessor.js` already accepts an
`'audio_transcript'` input type but nothing today actually records or
transcribes audio yet.

### Phase 4 — Store submission
Icons, splash screens, privacy policy (required for mic/photo permissions),
TestFlight + Play internal testing, actual store listing.

## Open/decided

- Bundle id / app name: `com.andreusama.vibecomposer` / "VibeComposer" —
  trivial to rename later, low stakes before real submission.
- iOS access: Mac available starting 2026-08-10 — `ios/` gets added once
  the Mac is in use; iOS build/simulator verification happens there. Android
  verification path on this Linux dev machine is still open — see Phase 0's
  unchecked items (SDK/device setup, not yet done).
- Node version for the dev environment: resolved — upgraded to Node 22 LTS
  via `nvm` rather than pinning Capacitor to the older 7.x line, so the
  toolchain stays current.
- Variant-carousel data model (per-line vs. note-level variants): **deferred,
  not structural** — build Phase 1 against the existing per-line
  `line_variants` (first-line-only carousel, matching the desktop
  `variantCount` simplification). Not a blocker; revisit only if it turns
  out to matter in practice.
