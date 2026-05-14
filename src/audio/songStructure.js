// ─── Song structure generator ──────────────────────────────────────────────────
// Builds a VERSE → CHORUS → BRIDGE → CHORUS structure from any 4-chord progression
// using tonicisation for the chorus and modal mixture for the bridge.
// Zero API calls — pure music theory rules.

// ─── Note frequencies (C3 octave) ─────────────────────────────────────────────
const NOTE_HZ = {
  'C': 130.81, 'C#': 138.59, 'Db': 138.59,
  'D': 146.83, 'D#': 155.56, 'Eb': 155.56,
  'E': 164.81, 'F':  174.61, 'F#': 184.99, 'Gb': 184.99,
  'G': 196.00, 'G#': 207.65, 'Ab': 207.65,
  'A': 220.00, 'A#': 233.08, 'Bb': 233.08,
  'B': 246.94,
};

function semitone(hz, steps) { return hz * Math.pow(2, steps / 12); }

function chordFromRoot(rootHz, quality) {
  const bass = rootHz / 2;
  if (quality === 'major') return { bass, notes: [rootHz, semitone(rootHz, 4), semitone(rootHz, 7)] };
  if (quality === 'minor') return { bass, notes: [rootHz, semitone(rootHz, 3), semitone(rootHz, 7)] };
  return { bass, notes: [rootHz, semitone(rootHz, 4), semitone(rootHz, 7)] };
}

// ─── Borrow chords from parallel minor ────────────────────────────────────────
// Given a key root, return ♭III and ♭VII (the two most characteristic borrowed chords)
function getBorrowedChords(keyString) {
  // Extract root note from key string e.g. "Am" → "A", "C" → "C", "F#m" → "F#"
  const root = keyString.replace(/m$/, '').replace(/maj.*$/, '');
  const rootHz = NOTE_HZ[root] || NOTE_HZ['A'];

  // ♭III = minor third above root (3 semitones) → major chord
  const flatIIIhz = semitone(rootHz, 3);
  // ♭VII = minor seventh above root (10 semitones) → major chord
  const flatVIIhz = semitone(rootHz, 10);

  // Find closest note name for display
  const noteNames = Object.entries(NOTE_HZ);
  function closestName(hz) {
    return noteNames.reduce((a, b) =>
      Math.abs(b[1] - hz) < Math.abs(a[1] - hz) ? b : a
    )[0];
  }

  return [
    { name: closestName(flatIIIhz), borrowed: true, fn: '♭III', ...chordFromRoot(flatIIIhz, 'major') },
    { name: closestName(flatVIIhz), borrowed: true, fn: '♭VII', ...chordFromRoot(flatVIIhz, 'major') },
  ];
}

// ─── Main builder ──────────────────────────────────────────────────────────────

export function buildSongStructure(progression, key) {
  const chords = progression.map((ch, i) => ({
    name:     ch.chord,
    fn_verse: ch.function,
    feel:     ch.feel,
    borrowed: false,
    ...require_chord_freqs(ch),
  }));

  // Chorus: rotate so the chord with the most "major" character leads
  // Simple rule: start on index 2 (typically the relative major or a lift chord)
  const chorusRotation = 2;
  const chorusOrder = [
    ...chords.slice(chorusRotation),
    ...chords.slice(0, chorusRotation),
  ];

  // Bridge: ii chord (use chord 0, the tonic minor) + 2 borrowed chords + resolve (chord 2)
  const borrowed = getBorrowedChords(key);
  const bridgeChords = [
    { ...chords[0], fn_bridge: 'ii',   borrowed: false },
    { ...borrowed[0], fn_bridge: '♭III' },
    { ...borrowed[1], fn_bridge: '♭VII' },
    { ...chorusOrder[0], fn_bridge: '↑I (resolve)' },
  ];

  return [
    {
      name: 'VERSE',  tag: 'V1', cls: 'verse',
      chords: chords,
      insight: `${chords[0].name} anchors the feeling\n${chords.map(c => c.name).join(' · ')}\nthe original emotional centre`,
      db: 'warm', leslie: 0.7,
    },
    {
      name: 'VERSE',  tag: 'V2', cls: 'verse',
      chords: chords,
      insight: `same progression again\nbuilding familiarity\nyour ear settles in`,
      db: 'warm', leslie: 0.7,
    },
    {
      name: 'CHORUS', tag: 'C1', cls: 'chorus',
      chords: chorusOrder,
      insight: `same chords · ${chorusOrder[0].name} comes first\ntonicisation: gravity shifts\n${chorusOrder[0].fn_verse} → home: the lift`,
      db: 'bright', leslie: 6.1,
    },
    {
      name: 'CHORUS', tag: 'C2', cls: 'chorus',
      chords: chorusOrder,
      insight: `notice the lift\nnot a key change — same notes\njust a different centre of gravity`,
      db: 'bright', leslie: 6.1,
    },
    {
      name: 'BRIDGE', tag: 'B1', cls: 'bridge',
      chords: bridgeChords,
      insight: `${bridgeChords[0].name}: familiar shadow\n${bridgeChords[1].name}: ← borrowed from parallel minor\n${bridgeChords[2].name}: ← modal mixture · ♭VII\nresolve → final chorus`,
      db: 'bridge', leslie: 5.0,
    },
    {
      name: 'BRIDGE', tag: 'B2', cls: 'bridge',
      chords: bridgeChords,
      insight: `second pass · ${bridgeChords[1].name} lands harder\nyour ear half-expects it · body still reacts\ntension maximal → explosion incoming`,
      db: 'bridge', leslie: 5.0,
    },
    {
      name: 'CHORUS', tag: 'C3', cls: 'chorus',
      chords: chorusOrder,
      insight: `after the borrowed chords ${chorusOrder[0].name} explodes\nthe further you go the better the return\nthat's modal mixture doing its job`,
      db: 'bright', leslie: 6.1,
    },
    {
      name: 'CHORUS', tag: 'C4', cls: 'chorus',
      chords: chorusOrder,
      insight: `final chorus · full energy\ntonicisation + modal mixture\ntwo techniques · one song`,
      db: 'bright', leslie: 6.1,
    },
  ];
}

// Helper: get frequencies from CHORD_FREQS lookup (imported inline to avoid circular deps)
const CHORD_FREQS = {
  'C':  { bass:65.41,  notes:[261.63,329.63,392.00] },
  'Cm': { bass:65.41,  notes:[261.63,311.13,392.00] },
  'D':  { bass:73.42,  notes:[293.66,369.99,440.00] },
  'Dm': { bass:73.42,  notes:[293.66,349.23,440.00] },
  'E':  { bass:82.41,  notes:[329.63,415.30,493.88] },
  'Em': { bass:82.41,  notes:[329.63,392.00,493.88] },
  'E7': { bass:82.41,  notes:[329.63,415.30,493.88,587.33] },
  'F':  { bass:87.31,  notes:[349.23,440.00,523.25] },
  'G':  { bass:98.00,  notes:[392.00,493.88,587.33] },
  'Gm': { bass:98.00,  notes:[392.00,466.16,587.33] },
  'A':  { bass:110.00, notes:[440.00,554.37,659.25] },
  'Am': { bass:110.00, notes:[440.00,523.25,659.25] },
  'Bb': { bass:116.54, notes:[466.16,587.33,698.46] },
  'B7': { bass:123.47, notes:[493.88,622.25,740.00] },
  'Bm': { bass:123.47, notes:[493.88,587.33,740.00] },
};

function require_chord_freqs(ch) {
  const name = ch.chord;
  if (CHORD_FREQS[name]) return CHORD_FREQS[name];
  const root = name.replace(/[^A-Gb#]/g, '');
  return CHORD_FREQS[root] || CHORD_FREQS['Am'];
}