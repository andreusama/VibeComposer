// Top-level navigation only — mounted on screens that sit at the root of a
// tab (Projects today), not on drill-down screens like the song thread,
// which use a back button instead. `tabs` is caller-supplied so this stays
// generic rather than hardcoding "Projects"/"Profile" itself.
export default function MobileTabBar({ tabs, active }) {
  //return (
    //<div className="mobile-tabbar">
    //  {tabs.map((t) => (
    //    <div key={t.key} className={`mobile-tab${t.key === active ? ' mobile-tab-active' : ''}`}>
    //      <span className="mobile-tab-icon">{t.icon}</span>
    //      <span>{t.label}</span>
    //    </div>
    //  ))}
    //</div>
  //);
}
