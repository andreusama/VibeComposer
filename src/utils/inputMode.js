import { useSyncExternalStore } from 'react';

// ─── Input mode: touch or mouse ─────────────────────────────────────────────
// The app is one UI, but a finger and a mouse want different gestures
// (docs/adr/0002): touch keeps the long-press-and-drag vocabulary proven on
// phones; a mouse gets press-and-drag after a few pixels, hover affordances and
// buttons where touch swipes. Which one applies is decided by the LAST pointer
// the person used — not by screen size or device class — so an iPad with a
// keyboard, or a touch laptop, follows whatever they touch next.
//
// Exposed as `data-input="touch|mouse"` on <html> (for CSS such as hover-only
// buttons) and through getInputMode()/useInputMode() (for gesture code).

// Pen counts as touch: it is held and dragged like a finger.
export function inputModeFromPointerType(pointerType) {
  return pointerType === 'mouse' ? 'mouse' : 'touch';
}

function initialMode() {
  try {
    // No pointer has been used yet: guess from the primary input device.
    return window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
  } catch {
    return 'mouse';
  }
}

let mode = 'mouse';
const listeners = new Set();

function setMode(next) {
  if (next === mode) return;
  mode = next;
  document.documentElement.dataset.input = next;
  listeners.forEach((fn) => fn());
}

export function getInputMode() {
  return mode;
}

export function subscribeInputMode(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useInputMode() {
  return useSyncExternalStore(subscribeInputMode, getInputMode, () => 'mouse');
}

// Called once at boot.
export function initInputMode() {
  mode = initialMode();
  document.documentElement.dataset.input = mode;
  // Capture phase and passive: this must see every pointer, first, without
  // ever getting in the way of the gesture code that reads the result.
  const onPointer = (e) => setMode(inputModeFromPointerType(e.pointerType));
  window.addEventListener('pointerdown', onPointer, { capture: true, passive: true });
  // A mouse moving over the page also counts — it is how hover buttons show up
  // before any click. Touch never fires pointermove with pointerType "mouse".
  window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') setMode('mouse'); }, { capture: true, passive: true });
}
