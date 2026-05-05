// ─── Color utilities ───────────────────────────────────────────────────────────

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, s * 100, l * 100];
}

export function moodFromHsl(h, s, l) {
  if (s < 15)             return 'melancholic';
  if (l < 18)             return 'mysterious';
  if (l > 80)             return 'dreamy';
  if (h < 15 || h >= 345) return s > 60 ? 'angry'  : 'romantic';
  if (h < 40)             return s > 55 ? 'happy'   : 'nostalgic';
  if (h < 75)             return 'happy';
  if (h < 165)            return 'hopeful';
  if (h < 210)            return 'dreamy';
  if (h < 255)            return 'melancholic';
  if (h < 300)            return 'mysterious';
  return 'romantic';
}

export function paletteFromRgb(r, g, b) {
  const hex  = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  const toH  = (r, g, b) => `#${hex(r)}${hex(g)}${hex(b)}`;
  const mix  = (v, t, f) => v + (t - v) * f;
  return [
    toH(r, g, b),
    toH(mix(r, 255, .4), mix(g, 255, .4), mix(b, 255, .4)),
    toH(r * .5, g * .5, b * .5),
    toH(r * .2, g * .2, b * .2),
  ];
}

export function rgbToHex(r, g, b) {
  const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function energyIdFromValue(v) {
  if (v < 21) return 'quiet';
  if (v < 43) return 'mellow';
  if (v < 65) return 'medium';
  if (v < 87) return 'vibrant';
  return 'intense';
}

// ─── Tag taxonomy ─────────────────────────────────────────────────────────────

export const DIMENSIONS = {
  flavour: {
    label:  'Flavour',
    accent: '#5ac49a',
    tags:   ['folk', 'jazz', 'blues', 'pop', 'indie', 'latin', 'flamenco', 'bossa nova'],
  },
  texture: {
    label:  'Texture',
    accent: '#b57ac4',
    tags:   ['sparse', 'lush', 'crunchy', 'smooth', 'bright', 'dark'],
  },
};

export const ENERGY_LABELS = [
  { id: 'quiet',   center: 10 },
  { id: 'mellow',  center: 32 },
  { id: 'medium',  center: 54 },
  { id: 'vibrant', center: 76 },
  { id: 'intense', center: 98 },
];

// ─── Claude system prompt ──────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are a chord composition assistant for ukulele players.
Given a JSON vibe profile, generate a 4-chord progression for a 4/4 song.

The profile includes a "phrase" — the emotional anchor of the song written by the user.
This is the most important input. Let it guide the harmonic mood deeply.
If a "place" is included, let its geography subtly inform the flavour.

Return ONLY raw JSON. No markdown, no backticks, no explanation text.

Schema:
{
  "key": "Am",
  "title": "short evocative title (2-4 words, lowercase, inspired by the phrase)",
  "summary": "one sentence describing the feeling of this progression, referencing the phrase's emotion",
  "progression": [
    { "chord": "Am", "function": "i",   "feel": "somber, open",    "ukulele": [2, 0, 0, 0] },
    { "chord": "G",  "function": "VII", "feel": "hopeful release", "ukulele": [0, 2, 3, 2] },
    { "chord": "F",  "function": "VI",  "feel": "warm, tender",    "ukulele": [2, 0, 1, 0] },
    { "chord": "E",  "function": "V",   "feel": "tension, pull",   "ukulele": [1, 4, 0, 2] }
  ]
}

The ukulele array is [G-string, C-string, E-string, A-string] fret numbers.
0 = open string. -1 = muted / do not play.

BEGINNER MODE (apply when easyMode is true):
Use ONLY these open-position chords. All four must come from this list:
  C  [0, 0, 0, 3]
  G  [0, 2, 3, 2]
  Am [2, 0, 0, 0]
  F  [2, 0, 1, 0]
  Dm [2, 2, 1, 0]
  D  [2, 2, 2, 0]
  A  [2, 1, 0, 0]
  E7 [1, 2, 0, 2]
Prefer Am, C, F, G — the most beginner-friendly shapes.`;
