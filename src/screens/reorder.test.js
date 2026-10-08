import { describe, it, expect } from 'vitest';
import { moveInList, dropIntentAt, compareProjects } from './reorder.js';

const list = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const ids = (items) => items.map((i) => i.id).join('');

describe('moveInList', () => {
  it('moves an item before / after a target', () => {
    expect(ids(moveInList(list, 'd', 'b', 'before'))).toBe('adbc');
    expect(ids(moveInList(list, 'a', 'c', 'after'))).toBe('bcad');
    expect(ids(moveInList(list, 'a', 'd', 'after'))).toBe('bcda');
    expect(ids(moveInList(list, 'd', 'a', 'before'))).toBe('dabc');
  });

  it('returns the same array for a no-op drop', () => {
    expect(moveInList(list, 'b', 'b', 'before')).toBe(list);
    expect(moveInList(list, 'b', 'a', 'after')).toBe(list); // already right after a
    expect(moveInList(list, 'a', 'b', 'before')).toBe(list); // already right before b
    expect(moveInList(list, 'zzz', 'a', 'before')).toBe(list);
    expect(moveInList(list, 'a', 'zzz', 'before')).toBe(list);
  });
});

describe('dropIntentAt', () => {
  const rows = [
    { id: 's1', kind: 'single', top: 0, bottom: 100 },
    { id: 'al', kind: 'album', top: 113, bottom: 213 },
    { id: 's2', kind: 'single', top: 226, bottom: 326 },
  ];

  it('files a single into an album when over its middle', () => {
    expect(dropIntentAt(rows, 163, { dragId: 's1', canJoinAlbum: true })).toEqual({ type: 'into', id: 'al' });
  });

  it('reorders when over an album edge, or when joining is not allowed', () => {
    expect(dropIntentAt(rows, 118, { dragId: 's1', canJoinAlbum: true })).toEqual({ type: 'reorder', id: 'al', position: 'before' });
    expect(dropIntentAt(rows, 163, { dragId: 's1', canJoinAlbum: false })).toEqual({ type: 'reorder', id: 'al', position: 'after' });
  });

  it('resolves the gap between cards and the ends of the list to the nearest row', () => {
    expect(dropIntentAt(rows, 219, { dragId: 's1', canJoinAlbum: true })).toEqual({ type: 'reorder', id: 'al', position: 'after' });
    expect(dropIntentAt(rows, -50, { dragId: 's2', canJoinAlbum: true })).toEqual({ type: 'reorder', id: 's1', position: 'before' });
    expect(dropIntentAt(rows, 900, { dragId: 's1', canJoinAlbum: true })).toEqual({ type: 'reorder', id: 's2', position: 'after' });
  });

  it('never targets the dragged row itself, and handles an empty list', () => {
    expect(dropIntentAt([rows[0]], 50, { dragId: 's1', canJoinAlbum: true })).toBeNull();
    expect(dropIntentAt([], 50, { dragId: 'x', canJoinAlbum: true })).toBeNull();
  });
});

describe('compareProjects', () => {
  it('orders by stored order, then most recently edited', () => {
    const a = { sortOrder: 0, updated: '2026-01-01' };
    const b = { sortOrder: 0, updated: '2026-02-01' };
    const c = { sortOrder: -1, updated: '2025-01-01' };
    expect([a, b, c].sort(compareProjects)).toEqual([c, b, a]);
  });
});
