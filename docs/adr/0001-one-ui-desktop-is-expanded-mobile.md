---
status: accepted
---
# One UI for every screen size: desktop is the mobile app, expanded

Desktop no longer has its own interface. The node canvas (React Flow) is retired and so is the phone-sized frame added on 2026-11-05; on a wide screen the mobile screens are shown in a centred column that is a share of the window (fluid, not a fixed width) with the type growing along with it, and bottom sheets become centred dialogs. Features that only existed on the canvas (the chord-progression generator, the studio sequencer, the output and tempo nodes) are parked: unreachable, code left in the repo. Tempo stays, because the mobile settings already expose it.

**Considered:** keeping two UIs (double the surface to maintain and test, and the demo audience is mostly on phones), and the phone frame (a mobile layout stuck in a box, with a mouse bridge that only worked in Chromium).
