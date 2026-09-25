// Pure helpers for drag-to-reorder on the projects/album lists. No DOM, no
// Supabase — the screens feed in measured row rectangles and get back what a
// drop means, so the geometry is testable without a browser.

// Moves the item `dragId` to just before/after `targetId`. Returns the same
// array (by reference) when nothing would change, so callers can cheaply
// detect a no-op drop.
export function moveInList(items, dragId, targetId, position) {
  if (dragId === targetId) return items;
  const dragged = items.find((i) => i.id === dragId);
  if (!dragged) return items;
  const rest = items.filter((i) => i.id !== dragId);
  const targetIdx = rest.findIndex((i) => i.id === targetId);
  if (targetIdx < 0) return items;
  rest.splice(position === 'after' ? targetIdx + 1 : targetIdx, 0, dragged);
  const unchanged = rest.every((item, i) => item === items[i]);
  return unchanged ? items : rest;
}

// What dropping at vertical position `y` means. `rows` are the measured cards
// ({ id, kind, top, bottom }). The nearest row wins, so the gaps between cards
// resolve to a sensible neighbour instead of "nothing". The middle half of an
// album row means "file it inside" (only when a single is being dragged — a
// song can't be put inside a song, and an album can't nest); its outer quarters,
// and every other row, mean "insert before/after".
export function dropIntentAt(rows, y, { dragId, canJoinAlbum }) {
  let best = null;
  let bestDist = Infinity;
  for (const r of rows) {
    if (r.id === dragId) continue;
    const dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (dist < bestDist) { best = r; bestDist = dist; }
  }
  if (!best) return null;

  const height = best.bottom - best.top;
  if (canJoinAlbum && best.kind === 'album' && y >= best.top + height * 0.25 && y <= best.bottom - height * 0.25) {
    return { type: 'into', id: best.id };
  }
  return { type: 'reorder', id: best.id, position: y < (best.top + best.bottom) / 2 ? 'before' : 'after' };
}

export function sameIntent(a, b) {
  return a === b || (!!a && !!b && a.type === b.type && a.id === b.id && a.position === b.position);
}

// Sort key for the mixed singles+albums list: the stored manual order first
// (everything starts at 0), most recently touched first among equals — which
// is exactly how the list behaved before manual ordering existed.
export function compareProjects(a, b) {
  return (a.sortOrder || 0) - (b.sortOrder || 0) || new Date(b.updated) - new Date(a.updated);
}
