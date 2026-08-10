# Roadmap — VibeComposer as a native app

_Last reviewed: 2026-08-09._

## Why

The web app has less reach than a real mobile app. The existing canvas UI
(`CanvasScreen.jsx`, a drag-based 2D React Flow layout) doesn't translate to
touch — no reliable drag-and-drop on a phone, no room for floating panels.
The mobile direction (see design mockup, 4 screens: Projects, Song thread,
Node detail bottom sheet, Baúl tap-to-attach) replaces the canvas with a
linear, touch-first UI on small/native viewports while reusing the same
data layer (`canvasData.js`, `museApi.js`, `baulProcessor.js`) that already
backs the desktop canvas.

Given the app leans on Web Audio (Tone.js, a from-scratch Hammond organ) and
React Flow, a React Native rewrite would be very costly and throw away
working code for little gain. The path is: **wrap the existing Vite/React
app natively with Capacitor**, then build the mobile-specific screens as new
React components on top of the same backend logic.

## Phases

### Phase 0 — Native wrapper
Add Capacitor, get a real iOS + Android build installable on a device/
simulator, running the existing desktop UI as-is (cramped on a phone, that's
fine — this phase only proves the packaging/signing/build pipeline works,
which has its own long lead time: Apple Developer account, provisioning,
Android signing key).

- `npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android`
- `npx cap init` — app name **VibeComposer**, bundle id
  **com.andreusama.vibecomposer**
- `capacitor.config`: `webDir: 'dist'` (Vite's existing build output,
  `vite.config.js` untouched)
- `npx cap add ios` and `npx cap add android`
- Standard "ship a new web build to the native app" loop from here on:
  `npm run build && npx cap sync`
- Android buildable/testable on Windows via Android Studio; iOS needs Xcode
  on a Mac.

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

### Phase 2 — Node detail bottom sheet
Variants/Notes/History tabs + "Ask the muse", as a bottom sheet instead of
the docked side panel / floating muse node. Reuses `NoteSidePanel.jsx` and
`MuseFloatNode.jsx`'s existing data logic — new mobile chrome around the
same components/hooks, not new business logic.

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
- iOS access: Mac available starting 2026-08-10 — `ios/` gets added and
  synced in the same Phase 0 pass as Android; iOS build/simulator
  verification happens on the Mac, Android verification on Windows via
  Android Studio.
