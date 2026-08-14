// The viewport-filling shell every mobile screen needs (fixed to the real
// screen bounds, not a percentage of some ancestor's height — #app/body have
// no fixed height of their own, so `height: 100%` on a screen root just
// grows to fit its content instead of the viewport, which is what let the
// bottom-anchored tab bar/FAB drift down to the bottom of the *content*
// instead of the bottom of the *screen*). One place to fix that, instead of
// every screen re-deriving it.
export default function MobileScreen({ className = '', children }) {
  return <div className={`mobile-screen ${className}`.trim()}>{children}</div>;
}
