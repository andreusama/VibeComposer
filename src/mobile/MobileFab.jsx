// The one floating "+" action — shared across every mobile screen instead of
// each one hardcoding its own copy (append a note on the song thread, create
// a project on the projects list, more to come). Screens differ only in
// what the tap does and whether a tab bar sits below it.
export default function MobileFab({ onClick, pending, title, aboveTabBar }) {
  return (
    <button
      className={`mobile-fab${aboveTabBar ? ' mobile-fab-above-tabbar' : ''}`}
      onClick={onClick}
      disabled={pending}
      title={title}
    >
      {pending ? '…' : '+'}
    </button>
  );
}
