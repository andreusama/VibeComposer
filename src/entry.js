import { shouldFrame, mountPhoneFrame, reloadOnBreakpointCross, inPhoneFrame, installMouseTouchShim } from './desktopFrame.js';

// The app itself is loaded dynamically so the wide-screen top page — which
// only shows the phone frame — never boots a second copy of it.
if (shouldFrame()) {
  mountPhoneFrame();
  reloadOnBreakpointCross();
} else {
  if (inPhoneFrame()) installMouseTouchShim();
  // Also watch the TOP page when it started narrow (dev-tools device mode, a
  // half-split window): widening it must bring the phone frame back, not let
  // main.js flip to the old desktop canvas. The iframe itself never needs
  // this — its own width is fixed by the frame.
  else reloadOnBreakpointCross();
  import('./main.js');
}
