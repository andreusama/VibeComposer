import { useState } from 'react';

// The one FAB-with-pills pattern, reused wherever a screen needs more than
// one quick action without permanently spending screen space on fixed
// icons (the note editor's old chords/muse/tools bar) or scattering
// several small affordances around the layout (the song thread's old
// between-card insert circles). Same component, different `pills` — never
// two separate implementations for what's visually and behaviorally one
// pattern.
//
// `pills` is ordered top-to-bottom as they'll stack (first entry farthest
// from the FAB, last entry closest to it) — the stagger animation reverses
// that order on purpose (closest-to-FAB pill animates in first, like it's
// "leading" the ones behind it).
export default function FabMenu({ pills }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      {open && <div className="fab-menu-scrim" onClick={close} />}
      {open && (
        <div className="fab-menu-pills">
          {pills.map((pill, i) => (
            <button
              key={pill.label}
              className={`fab-menu-pill${pill.dark ? ' fab-menu-pill-dark' : ''}`}
              style={{ animationDelay: `${(pills.length - 1 - i) * 60}ms` }}
              disabled={pill.disabled}
              title={pill.disabled ? 'coming soon' : undefined}
              onClick={() => { pill.onClick(); close(); }}
            >
              <span className={`fab-menu-pill-icon${pill.iconVariant ? ` fab-menu-pill-icon-${pill.iconVariant}` : ''}`}>{pill.icon}</span>
              <span className="fab-menu-pill-label">{pill.label}</span>
            </button>
          ))}
        </div>
      )}
      <button
        className={`fab-menu-btn${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={open ? 'close' : 'menu'}
      >
        +
      </button>
    </>
  );
}
