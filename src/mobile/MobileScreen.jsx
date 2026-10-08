// The viewport-filling shell every mobile screen needs (fixed to the real
// screen bounds, not a percentage of some ancestor's height — #app/body have
// no fixed height of their own, so `height: 100%` on a screen root just
// grows to fit its content instead of the viewport, which is what let the
// bottom-anchored tab bar/FAB drift down to the bottom of the *content*
// instead of the bottom of the *screen*). One place to fix that, instead of
// every screen re-deriving it.
// `fixed={false}` opts out of the position:fixed/inset:0 behavior above —
// used for a screen mounted as one page inside MobileHomePager's swipeable
// strip, where the pager itself owns the real fixed screen rect and each
// page just needs to fill its 100%-width slot (see .mobile-screen-relative).
export default function MobileScreen({ className = '', children, fixed = true }) {
  const cls = fixed ? 'mobile-screen' : 'mobile-screen mobile-screen-relative';
  return <div className={`${cls} ${className}`.trim()}>{children}</div>;
}
