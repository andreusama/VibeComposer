// ─── Desktop: show the mobile app in a phone-sized frame ────────────────────
// VibeComposer is a mobile-first product (the desktop canvas isn't part of the
// demo). On a wide screen the app is loaded inside a phone-sized iframe of
// itself: the iframe's viewport is genuinely phone-width, so the real mobile
// layout, its media queries and every `window.innerWidth` check just work —
// no layout code has to know about the frame.
//
// The TOP page deliberately never imports the app (see entry.js): two copies
// would both try to consume the same auth redirect and hit the same Supabase
// storage lock. Only the iframe boots it.

export const FRAME_BREAKPOINT = 640; // same value as main.js's MOBILE_BREAKPOINT

// `?desktop=1` is the developer escape hatch to the old canvas layout.
export function shouldFrame() {
  if (window.top !== window.self) return false;
  if (new URLSearchParams(window.location.search).has('desktop')) return false;
  return window.innerWidth > FRAME_BREAKPOINT;
}

export function inPhoneFrame() {
  return window.top !== window.self;
}

export function mountPhoneFrame() {
  document.title = 'Vibe Composer';
  document.body.classList.add('phone-frame-page');
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="phone-frame-stage">
      <div class="phone-frame-device">
        <iframe class="phone-frame-screen" title="Vibe Composer" src="${window.location.pathname}${window.location.search}${window.location.hash}" allow="microphone"></iframe>
      </div>
      <p class="phone-frame-caption">VibeComposer está pensada para el móvil — esta es su vista.</p>
    </div>
  `;
}

// Re-evaluate when the window is resized across the breakpoint, so a narrow
// window never keeps the frame and a wide one never keeps the bare layout.
export function reloadOnBreakpointCross() {
  let framed = shouldFrame();
  let timer = null;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (shouldFrame() !== framed) window.location.reload();
    }, 80); // under main.js's own 150ms resize debounce, so its desktop layout never flashes first
  });
}

// ─── Mouse → touch, inside the frame ────────────────────────────────────────
// Every gesture in the app (long-press-and-drag a chord, swipe a card, drag
// the audio sheet) is built on touch events, which a desktop mouse never
// fires. So in the frame, a held-and-dragged mouse is translated into the
// equivalent touchstart/touchmove/touchend sequence on the element it went
// down on — exactly the contract a finger has. Chromium only: it is the one
// desktop engine with constructible Touch/TouchEvent; elsewhere this is a
// no-op and taps/typing still work (only the drag gestures don't).
export function installMouseTouchShim() {
  const hasRealTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  if (hasRealTouch || typeof Touch !== 'function' || typeof TouchEvent !== 'function') return;

  let target = null;
  const ID = 1;

  const touchAt = (e) => new Touch({
    identifier: ID, target,
    clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
    pageX: e.pageX, pageY: e.pageY,
  });

  const fire = (type, e) => {
    const t = touchAt(e);
    const ended = type === 'touchend' || type === 'touchcancel';
    const ev = new TouchEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      touches: ended ? [] : [t],
      targetTouches: ended ? [] : [t],
      changedTouches: [t],
    });
    // dispatched on the ORIGINAL target for the whole gesture, like a real touch
    target.dispatchEvent(ev);
    return ev;
  };

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    target = e.target;
    fire('touchstart', e);
  }, true);

  document.addEventListener('mousemove', (e) => {
    if (!target || !(e.buttons & 1)) return;
    const ev = fire('touchmove', e);
    // the app cancels touchmove while it owns a drag — don't also select text
    if (ev.defaultPrevented) e.preventDefault();
  }, true);

  const finish = (type) => (e) => {
    if (!target) return;
    fire(type, e);
    target = null;
  };
  document.addEventListener('mouseup', finish('touchend'), true);
  // The pointer left the window mid-drag: end the gesture instead of leaving it
  // open. `mouseout` with no relatedTarget is the "left the document" signal —
  // a capture-phase `mouseleave` on document would fire for every element the
  // pointer leaves and cancel the gesture almost immediately.
  document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) finish('touchcancel')(e); });
}
