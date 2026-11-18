// Escape closes the top-most open sheet. Every sheet already closes when its
// dimmed backdrop is clicked (onClick={onClose}), so this presses that same
// backdrop instead of each sheet growing its own key handler — one place, and
// a sheet added later gets it for free as long as it uses one of these classes.
const BACKDROPS = '.ts-backdrop, .baul-sheet-scrim, .mp-scrim, .fab-menu-scrim, .thread-menu-backdrop';

export function topBackdrop(root = document) {
  // A backdrop that is mid-drag (a chord being carried out of its sheet) must
  // stay put; Escape there cancels the drag itself (useLineDragDrop).
  const open = [...root.querySelectorAll(BACKDROPS)].filter((el) => !el.className.includes('scrim-dragging'));
  return open[open.length - 1] ?? null;
}

export function installEscapeCloses() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const backdrop = topBackdrop();
    if (backdrop) backdrop.click();
  });
}
