// ─── Song structure generator ──────────────────────────────────────────────────
// Builds a VERSE → CHORUS → BRIDGE → CHORUS structure with real voice leading.
// Every section transition is scored by harmonic interval relationships —
// not just collision avoidance, but genuine musicality.
// Zero API calls — pure music theory.

// ─── Note frequencies (C3 octave) ─────────────────────────────────────────────
const NOTE_HZ = {
  'C':130.81,'C#':138.59,'Db':138.59,'D':146.83,'D#':155.56,'Eb':155.56,
  'E':164.81,'F':174.61,'F#':184.99,'Gb':184.99,'G':196.00,'G#':207.65,
  'Ab':207.65,'A':220.00,'A#':233.08,'Bb':233.08,'B':246.94,
};

// Semitone values for interval calculation
const NOTE_ST = {
  'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'F':5,
  'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11,
};

function semitone(hz, steps) { return hz * Math.pow(2, steps / 12); }

function chordFromRoot(rootHz, quality) {
  const bass = rootHz / 2;
  if (quality === 'minor') return { bass, notes: [rootHz, semitone(rootHz, 3), semitone(rootHz, 7)] };
  return { bass, notes: [rootHz, semitone(rootHz, 4), semitone(rootHz, 7)] };
}

// ─── Extract root note from chord name ────────────────────────────────────────
function chordRoot(name) {
  const m = name.match(/^[A-G][b#]?/);
  return m ? m[0] : 'C';
}

// ─── Interval between two chord roots (0-11 semitones) ────────────────────────
function intervalUp(fromName, toName) {
  const from = NOTE_ST[chordRoot(fromName)] ?? 0;
  const to   = NOTE_ST[chordRoot(toName)]   ?? 0;
  return ((to - from) + 12) % 12;
}

// ─── Voice leading score ───────────────────────────────────────────────────────
// Scores how musically satisfying a transition from → to is.
// Context shapes what "good" means at each seam.
//
// Intervals and their harmonic character:
//   0  = unison      → collision, forbidden across seams
//   1  = minor 2nd   → chromatic, jarring
//   2  = major 2nd   → stepwise, smooth but weak
//   3  = minor 3rd   → relative change (I→vi feel), emotionally rich
//   4  = major 3rd   → mediant, dreamy
//   5  = perfect 4th → subdominant (IV→I), warm resolution
//   6  = tritone     → maximum tension
//   7  = perfect 5th → dominant (V→I), strongest resolution in music
//   8  = minor 6th   → softer, contemplative
//   9  = major 6th   → warm, nostalgic
//   10 = minor 7th   → ♭VII→I rock resolution, after modal mixture
//   11 = major 7th   → leading tone, tense

const BASE_INTERVAL_SCORE = {
  0:-100, 1:2, 2:5, 3:8, 4:6, 5:9, 6:3, 7:10, 8:5, 9:7, 10:8, 11:4,
};

function transitionScore(fromChord, toChord, context) {
  if (fromChord.name === toChord.name) return -100; // never same chord across seam

  const interval = intervalUp(fromChord.name, toChord.name);
  let score      = BASE_INTERVAL_SCORE[interval] ?? 0;

  if (context === 'verse_to_chorus') {
    // Want brightness and lift — perfect 5th (V→I) or perfect 4th (IV→I) ideal
    if (interval === 7) score += 5;  // V→I: strongest lift
    if (interval === 5) score += 3;  // IV→I: warm lift
    if (interval === 2) score += 2;  // stepwise up: energetic
    // Prefer major chord for chorus opening (brightness)
    const isMinor = /m(?!aj)/.test(toChord.name.slice(1));
    if (!isMinor) score += 2;
  }

  if (context === 'chorus_to_bridge') {
    // Want contrast and emotional drop — minor 3rd (I→vi) is the classic
    if (interval === 3)  score += 5; // I→vi: the emotional drop
    if (interval === 10) score += 3; // to ♭VII: dark, unexpected
    if (interval === 9)  score += 2; // major 6th: nostalgic shift
    // Minor chord preferred — bridge should feel darker than chorus
    const isMinor = /m(?!aj)/.test(toChord.name.slice(1));
    if (isMinor)         score += 3;
    if (toChord.borrowed) score += 2; // borrowed = maximum contrast
  }

  if (context === 'bridge_to_chorus') {
    // Want maximum resolution — perfect 5th (V→I) is ideal after bridge tension
    if (interval === 7)  score += 6; // V→I: explosion
    if (interval === 10) score += 4; // ♭VII→I: rock resolution after modal mixture
    if (interval === 5)  score += 3; // IV→I: plagal, softer landing
    // Major chord preferred for final chorus arrival
    const isMinor = /m(?!aj)/.test(toChord.name.slice(1));
    if (!isMinor) score += 2;
  }

  return score;
}

// ─── Find the rotation of chords that creates the best seam ───────────────────
function bestRotation(prevChords, candidateChords, context) {
  const lastChord = prevChords[prevChords.length - 1];
  let bestScore = -Infinity;
  let bestIdx   = 0;

  candidateChords.forEach((chord, i) => {
    const score = transitionScore(lastChord, chord, context);
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  });

  return bestIdx;
}

// ─── Rotate array so index i comes first ──────────────────────────────────────
function rotateFrom(arr, startIdx) {
  return [...arr.slice(startIdx), ...arr.slice(0, startIdx)];
}

// ─── Borrowed chords from parallel minor ──────────────────────────────────────
function getBorrowedChords(keyString) {
  const root   = keyString.replace(/m$/, '').replace(/maj.*$/, '');
  const rootHz = NOTE_HZ[root] || NOTE_HZ['A'];

  const flatIIIhz = semitone(rootHz, 3);
  const flatVIIhz = semitone(rootHz, 10);

  const noteNames = Object.entries(NOTE_HZ);
  function closestName(hz) {
    return noteNames.reduce((a, b) =>
      Math.abs(b[1] - hz) < Math.abs(a[1] - hz) ? b : a
    )[0];
  }

  return [
    { name: closestName(flatIIIhz), borrowed: true, fn_bridge: '♭III', ...chordFromRoot(flatIIIhz, 'major') },
    { name: closestName(flatVIIhz), borrowed: true, fn_bridge: '♭VII', ...chordFromRoot(flatVIIhz, 'major') },
  ];
}

// ─── Main builder ──────────────────────────────────────────────────────────────

export function buildSongStructure(progression, key) {

  // Map progression to internal chord objects with frequencies
  const verseChords = progression.map(ch => ({
    name:     ch.chord,
    fn_verse: ch.function,
    feel:     ch.feel,
    borrowed: false,
    ...getFreqs(ch.chord),
  }));

  // ── CHORUS: find rotation with best voice leading from verse end ──────────
  const chorusStartIdx = bestRotation(verseChords, verseChords, 'verse_to_chorus');
  const chorusChords   = rotateFrom(verseChords, chorusStartIdx).map((ch, i) => ({
    ...ch,
    fn_chorus: i === 0 ? 'home (shifted)' : ch.fn_verse,
  }));

  // ── BRIDGE: build pool of candidates, find best start from chorus end ─────
  const borrowed      = getBorrowedChords(key);
  const bridgePool    = [
    { ...verseChords[0], fn_bridge: 'i' },
    { ...verseChords[1], fn_bridge: 'ii' },
    { ...borrowed[0] },
    { ...borrowed[1] },
    { ...chorusChords[0], fn_bridge: 'resolve' },
  ];

  const bridgeStartIdx = bestRotation(chorusChords, bridgePool, 'chorus_to_bridge');

  // Build bridge: best start → borrowed chords → resolve back to chorus
  const bridgeChords = [
    bridgePool[bridgeStartIdx],
    bridgePool[bridgeStartIdx] === borrowed[0] ? borrowed[1] : borrowed[0],
    borrowed[1],
    { ...chorusChords[0], fn_bridge: '↑I (resolve)' },
  ].filter((ch, i, arr) =>
    // Remove duplicates while preserving order
    arr.findIndex(c => c.name === ch.name) === i
  );

  // Pad to 4 chords if deduplication removed any
  while (bridgeChords.length < 4) bridgeChords.push(bridgeChords[bridgeChords.length - 1]);

  // ── FINAL CHORUS: check if bridge end creates good seam ──────────────────
  // If not, adjust which chorus chord leads the final section
  const finalChorusStartIdx = bestRotation(bridgeChords, chorusChords, 'bridge_to_chorus');
  const finalChorusChords   = rotateFrom(chorusChords, finalChorusStartIdx);

  // ── Insight strings ───────────────────────────────────────────────────────
  const verseEnd   = verseChords[verseChords.length - 1].name;
  const chorusEnd  = chorusChords[chorusChords.length - 1].name;
  const bridgeEnd  = bridgeChords[bridgeChords.length - 1].name;
  const interval1  = intervalUp(verseEnd,  chorusChords[0].name);
  const interval2  = intervalUp(chorusEnd, bridgeChords[0].name);
  const interval3  = intervalUp(bridgeEnd, finalChorusChords[0].name);

  const intervalName = i => ({ 3:'minor 3rd',5:'4th',7:'5th',10:'♭VII' }[i] || `${i} semitones`);

  return [
    {
      name: 'VERSE',  tag: 'V1', cls: 'verse',
      chords: verseChords,
      insight: `${verseChords[0].name} anchors the feeling\n${verseChords.map(c=>c.name).join(' · ')}\nthe original emotional centre`,
      db: 'warm', leslie: 0.7,
    },
    {
      name: 'VERSE',  tag: 'V2', cls: 'verse',
      chords: verseChords,
      insight: `same progression again\nbuilding familiarity\nyour ear settles into the gravity`,
      db: 'warm', leslie: 0.7,
    },
    {
      name: 'CHORUS', tag: 'C1', cls: 'chorus',
      chords: chorusChords,
      insight: `${verseEnd} → ${chorusChords[0].name} · ${intervalName(interval1)}\ntonicisation: gravity shifts to ${chorusChords[0].name}\nthe lift is earned`,
      db: 'bright', leslie: 6.1,
    },
    {
      name: 'CHORUS', tag: 'C2', cls: 'chorus',
      chords: chorusChords,
      insight: `same chords · different gravity\nnot a key change — same notes\nyour ear hears a different home`,
      db: 'bright', leslie: 6.1,
    },
    {
      name: 'BRIDGE', tag: 'B1', cls: 'bridge',
      chords: bridgeChords,
      insight: `${chorusEnd} → ${bridgeChords[0].name} · ${intervalName(interval2)}\n${bridgeChords[1].name}: ← borrowed from parallel minor\n${bridgeChords[2]?.name || ''}: ← modal mixture · ♭VII`,
      db: 'bridge', leslie: 5.0,
    },
    {
      name: 'BRIDGE', tag: 'B2', cls: 'bridge',
      chords: bridgeChords,
      insight: `second pass · borrowed chords land harder\nyour ear half-expects them · body still reacts\ntension maximal → resolution incoming`,
      db: 'bridge', leslie: 5.0,
    },
    {
      name: 'CHORUS', tag: 'C3', cls: 'chorus',
      chords: finalChorusChords,
      insight: `${bridgeEnd} → ${finalChorusChords[0].name} · ${intervalName(interval3)}\nresolution earned by the bridge tension\nthe further you went the better this lands`,
      db: 'bright', leslie: 6.1,
    },
    {
      name: 'CHORUS', tag: 'C4', cls: 'chorus',
      chords: finalChorusChords,
      insight: `final chorus · full energy\ntonicisation + modal mixture\ntwo techniques · one arc`,
      db: 'bright', leslie: 6.1,
    },
  ];
}

// ─── Frequency lookup ──────────────────────────────────────────────────────────
const CHORD_FREQS = {
  'C':  {bass:65.41, notes:[261.63,329.63,392.00]}, 'Cm': {bass:65.41, notes:[261.63,311.13,392.00]},
  'D':  {bass:73.42, notes:[293.66,369.99,440.00]}, 'Dm': {bass:73.42, notes:[293.66,349.23,440.00]},
  'E':  {bass:82.41, notes:[329.63,415.30,493.88]}, 'Em': {bass:82.41, notes:[329.63,392.00,493.88]},
  'E7': {bass:82.41, notes:[329.63,415.30,493.88,587.33]},
  'F':  {bass:87.31, notes:[349.23,440.00,523.25]},
  'G':  {bass:98.00, notes:[392.00,493.88,587.33]}, 'Gm': {bass:98.00, notes:[392.00,466.16,587.33]},
  'A':  {bass:110.00,notes:[440.00,554.37,659.25]}, 'Am': {bass:110.00,notes:[440.00,523.25,659.25]},
  'Bb': {bass:116.54,notes:[466.16,587.33,698.46]}, 'B7': {bass:123.47,notes:[493.88,622.25,740.00]},
  'Bm': {bass:123.47,notes:[493.88,587.33,740.00]},
};

function getFreqs(name) {
  if (CHORD_FREQS[name]) return CHORD_FREQS[name];
  const root = name.replace(/[^A-Gb#]/g, '');
  return CHORD_FREQS[root] || CHORD_FREQS['Am'];
}