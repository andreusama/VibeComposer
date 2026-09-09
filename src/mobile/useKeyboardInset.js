import { useState, useEffect } from 'react';

// How many pixels of the viewport the on-screen keyboard is currently
// covering — so a `position: fixed` element can dock flush ABOVE the
// keyboard (`bottom: inset`) instead of being hidden under it. On the
// mobile browsers that support visualViewport, its height shrinks (and
// offsetTop can grow) by exactly the keyboard's height when it opens; the
// gap between window.innerHeight and that shrunk viewport is the answer.
// 0 when there's no keyboard or no visualViewport support.
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const onResize = () => {
      const gap = window.innerHeight - vv.height - vv.offsetTop;
      setInset(Math.max(0, Math.round(gap)));
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    onResize();
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
    };
  }, []);
  return inset;
}
