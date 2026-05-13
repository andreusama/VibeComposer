// ─── Ukulele audio engine using Tone.js ───────────────────────────────────────
// Standard GCEA tuning — open string frequencies in Hz

const OPEN_STRINGS = [
  392.00, // G4 — string 0
  261.63, // C4 — string 1
  329.63, // E4 — string 2
  440.00, // A4 — string 3
];

// Each fret raises pitch by one semitone: freq * 2^(fret/12)
function fretToFreq(openFreq, fret) {
  if (fret < 0) return null; // muted string
  return openFreq * Math.pow(2, fret / 12);
}

// ─── Energy → sound profile ────────────────────────────────────────────────────
// Each energy level shapes the attack, reverb and strum speed differently.
// This is where the vibe literally becomes sound.

const ENERGY_PROFILES = {
  quiet:   { volume: -18, attack: 0.02,  decay: 1.0, sustain: 0.05, release: 2.0, reverb: 0.7, strumMs: 50 },
  mellow:  { volume: -14, attack: 0.01,  decay: 0.7, sustain: 0.08, release: 1.5, reverb: 0.5, strumMs: 30 },
  medium:  { volume: -10, attack: 0.005, decay: 0.5, sustain: 0.1,  release: 1.0, reverb: 0.3, strumMs: 18 },
  vibrant: { volume: -6,  attack: 0.003, decay: 0.4, sustain: 0.15, release: 0.7, reverb: 0.2, strumMs: 10 },
  intense: { volume: -3,  attack: 0.001, decay: 0.3, sustain: 0.2,  release: 0.4, reverb: 0.1, strumMs: 5  },
};

// ─── Singleton instances ───────────────────────────────────────────────────────

let synth   = null;
let reverb  = null;
let ready   = false;
let currentEnergy = 'medium';

function init(energyId) {
  if (ready && energyId === currentEnergy) return;

  // Dispose previous instances
  if (synth)  synth.dispose();
  if (reverb) reverb.dispose();

  currentEnergy = energyId;
  const p = ENERGY_PROFILES[energyId] || ENERGY_PROFILES.medium;

  reverb = new Tone.Reverb({ decay: 2.5, wet: p.reverb }).toDestination();

  synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope:   { attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release },
    volume:     p.volume,
  }).connect(reverb);

  ready = true;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Play a single ukulele chord.
 * @param {number[]} frets   [G, C, E, A] fret numbers
 * @param {string}   energyId  quiet | mellow | medium | vibrant | intense
 */
export async function playChord(frets, energyId = 'medium') {
  await Tone.start(); // requires user gesture — safe to call multiple times
  init(energyId);

  const p    = ENERGY_PROFILES[energyId] || ENERGY_PROFILES.medium;
  const now  = Tone.now();
  const freqs = frets
    .map((fret, i) => fretToFreq(OPEN_STRINGS[i], fret))
    .filter(Boolean);

  // Strum: each string slightly delayed for a natural pluck feel
  freqs.forEach((freq, i) => {
    synth.triggerAttackRelease(freq, '4n', now + (i * p.strumMs / 1000));
  });
}

/**
 * Play the full 4-chord progression in sequence.
 * @param {object[]} progression  Array of chord objects with .ukulele frets
 * @param {string}   energyId
 */
export async function playProgression(progression, energyId = 'medium') {
  await Tone.start();
  init(energyId);

  const p        = ENERGY_PROFILES[energyId] || ENERGY_PROFILES.medium;
  const chordGap = 1.2; // seconds between chords

  progression.forEach((chord, i) => {
    const now   = Tone.now() + i * chordGap;
    const freqs = chord.ukulele
      .map((fret, si) => fretToFreq(OPEN_STRINGS[si], fret))
      .filter(Boolean);

    freqs.forEach((freq, si) => {
      synth.triggerAttackRelease(freq, '4n', now + (si * p.strumMs / 1000));
    });
  });
}
