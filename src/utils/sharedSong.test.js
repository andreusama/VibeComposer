import { describe, it, expect, beforeEach } from 'vitest';
import { snapshotToView, sharedSongErrorMessage } from './sharedSong.js';
import { guestName, GUEST_NAMES } from './guestNames.js';

const snapshot = {
  title: 'Mi canción',
  view_only: false,
  notes: [
    { id: 'n1', type: 'verse', custom_label: null, thread_index: 10, lines: [{ id: 'l1', text: 'verso' }] },
    { id: 'n2', type: 'chorus', custom_label: null, thread_index: 20, lines: [{ id: 'l2', text: 'estribillo' }] },
    { id: 'n3', type: 'verse', custom_label: null, thread_index: 20, lines: [{ id: 'l3', text: 'variante' }] },
    { id: 'n4', type: 'bridge', custom_label: null, thread_index: null, lines: [{ id: 'l4', text: 'puente' }] },
  ],
  chords: [
    { id: 'c2', line_id: 'l1', line_index: 0, position: 1, chord_name: 'G' },
    { id: 'c1', line_id: 'l1', line_index: 0, position: 0, chord_name: 'Am' },
    { id: 'c3', line_id: 'l1', line_index: 2, position: 0, chord_name: 'C' },
  ],
};

describe('snapshotToView', () => {
  it('buckets Parts in thread order, variants together, unindexed Parts last', () => {
    const { groups } = snapshotToView(snapshot);
    expect(groups.map((g) => g.members.map((m) => m.id))).toEqual([['n1'], ['n2', 'n3'], ['n4']]);
  });

  it('keys chords by line row and line index, sorted by position', () => {
    const { chordsByLineId } = snapshotToView(snapshot);
    expect(chordsByLineId.l1[0].map((c) => c.chordName)).toEqual(['Am', 'G']);
    expect(chordsByLineId.l1[2].map((c) => c.chordName)).toEqual(['C']);
  });

  it('carries the title and the view-only flag, and survives an empty snapshot', () => {
    expect(snapshotToView({ ...snapshot, view_only: true }).viewOnly).toBe(true);
    expect(snapshotToView(snapshot).title).toBe('Mi canción');
    expect(snapshotToView(null)).toEqual({ title: '', viewOnly: false, groups: [], chordsByLineId: {} });
  });
});

describe('sharedSongErrorMessage', () => {
  it('speaks Spanish for each way a link can be dead', () => {
    expect(sharedSongErrorMessage('invite not found')).toMatch(/no es válido/);
    expect(sharedSongErrorMessage('invite revoked')).toMatch(/desactivado/);
    expect(sharedSongErrorMessage('invite expired')).toMatch(/caducado/);
    expect(sharedSongErrorMessage('invite already used')).toMatch(/ya se ha usado/);
    expect(sharedSongErrorMessage('boom')).toMatch(/No se pudo/);
  });
});

describe('guestName', () => {
  // Vitest runs in Node, which has no localStorage — a minimal stand-in.
  beforeEach(() => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
    };
  });

  it('picks from the pool and keeps the same name for the same browser', () => {
    const first = guestName(() => 0.5);
    expect(GUEST_NAMES).toContain(first);
    expect(guestName(() => 0.99)).toBe(first);
  });

  it('never indexes past the end of the pool', () => {
    expect(guestName(() => 1)).toBe(GUEST_NAMES[GUEST_NAMES.length - 1]);
  });

  it('is not tripped up by a stale or unknown stored name', () => {
    localStorage.setItem('vibecomposer_guest_name', 'nobody');
    expect(GUEST_NAMES).toContain(guestName(() => 0));
  });
});
