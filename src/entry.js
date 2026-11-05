import { shouldFrame, mountPhoneFrame, reloadOnBreakpointCross, inPhoneFrame, installMouseTouchShim } from './desktopFrame.js';

// The app itself is loaded dynamically so the wide-screen top page — which
// only shows the phone frame — never boots a second copy of it.
if (shouldFrame()) {
  mountPhoneFrame();
  reloadOnBreakpointCross();
} else {
  if (inPhoneFrame()) installMouseTouchShim();
  import('./main.js');
}
