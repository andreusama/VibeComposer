---
status: accepted
---
# Gestures branch on input mode: touch and mouse are handled differently

The app keeps a global **input mode** flag (touch or mouse) and the gesture code branches on it. Touch keeps the touch handling already proven on phones. Mouse gets its own direct-manipulation behaviour instead of imitating a finger: press-and-drag with a small movement threshold rather than a 380 ms long-press, hover affordances, and buttons or keyboard where touch uses swipes.

**Considered:** a single Pointer Events path for both (one code path, but a long-press-and-swipe vocabulary is the wrong interaction for a mouse, and it risks re-opening the native-scroll-claiming bugs touch has already hit twice); and the mouse→Touch bridge built for the phone frame, dropped because it only works in Chromium.

**Consequences:** about 80 touch-handler sites in 15 files each need a decision about what the mouse version is. Touch behaviour on phones must not change, so the Playwright touch suite stays as the safety net and gains mouse variants.
