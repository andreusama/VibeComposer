// Top-level navigation only — mounted on screens that sit at the root of a
// tab (see MobileHomePager.jsx), not on drill-down screens like the song
// thread or an album, which use a back button instead. `tabs` is
// caller-supplied so this stays generic rather than hardcoding any one
// tab's name.
export default function MobileTabBar({ tabs, active, onSelect }) {
  return (
    <div className="mobile-tabbar">
      {tabs.map((t) => (
        <button
          key={t.key}
          className={`mobile-tab${t.key === active ? ' mobile-tab-active' : ''}`}
          onClick={() => onSelect?.(t.key)}
        >
          <span className="mobile-tab-icon">{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
