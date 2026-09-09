// ─── Rhyme scheme — Castellano & Català ─────────────────────────────────────
// Same heuristic-scansion spirit as syllables.js: good enough for a live
// per-line rhyme reading, not a substitute for a linguist. Reuses that
// file's vowel/hiatus rules directly, since finding a word's stressed
// syllable is the same underlying scan as counting its syllables — the
// only new thing here is keeping *where* each syllable starts instead of
// just how many there are.
//
// Algorithm, in order:
//  1. Clean each word the same way syllables.js does (strip punctuation,
//     normalize y, silence qu/gu's mute u).
//  2. Find its syllable nuclei (vowel runs, split on hiatus) and their
//     start positions in the cleaned word.
//  3. Pick the stressed nucleus: a written accent wins outright; otherwise
//     the standard default rule (ends in vowel/n/s → penultimate, else
//     final — same rule shape in both languages, just each one's own
//     accent set).
//  4. Slice from the stressed vowel to the end of the word — that's the
//     consonant-rhyme key. Reduce it to vowels only (normalizing the
//     *unstressed* vowels per language) for the assonant-rhyme key.
//  5. Group a stanza's lines by exact key match, consonant groups first;
//     assign letters (uppercase consonant / lowercase assonant) in order
//     of each group's first appearance. A key that never recurs isn't a
//     rhyme, it's free verse — no letter.

import { LANG_RULES, stripToLetters, normalizeY, silenceGuQu, ACCENT_VOWELS, ACCENT_LETTERS, countLineSyllables } from './syllables.js';

export const DIALECTS = {
  es: ['central'],
  ca: ['oriental', 'occidental'],
};

// Built from the same shared ACCENT_VOWELS/ACCENT_LETTERS constants
// syllables.js's stripToLetters uses — see its comment for why these can't
// be hand-copied literals (á went missing from four of these
// independently). Vowel-only matching uses ACCENT_VOWELS (ñ/ç aren't
// vowels); general letter-boundary trimming uses the full ACCENT_LETTERS.
const VOWEL_RUN_RE = new RegExp(`[aeiou${ACCENT_VOWELS}]+`, 'g');
const VOWEL_RE = new RegExp(`[aeiou${ACCENT_VOWELS}]`);
const wordBoundaryTrimRe = () => new RegExp(`^[^a-z${ACCENT_LETTERS}]+|[^a-z${ACCENT_LETTERS}]+$`, 'gi');
const nonLetterRe = () => new RegExp(`[^a-z${ACCENT_LETTERS}]`, 'gi');

// Written accents that mark STRESS. Catalan's diaeresis (ï, ü) is excluded
// on purpose — it marks a hiatus, not necessarily the stressed syllable,
// unlike syllables.js's hiatus scan where the two are the same event.
const STRESS_ACCENTS = {
  es: new Set(['á', 'é', 'í', 'ó', 'ú']),
  ca: new Set(['à', 'è', 'é', 'í', 'ò', 'ó', 'ú']),
};

// Endings that default to penultimate-syllable stress (llana/plana) —
// anything else defaults to final-syllable stress (aguda). A written
// accent always overrides this, handled separately in findStress.
const PENULTIMATE_ENDING = {
  es: /[aeiouáéíóú]$|[ns]$/,
  ca: /[aeiouàèéíòóúï]$|s$/,
};

function cleanWord(rawWord, lang) {
  let word = stripToLetters(rawWord).replace(/'/g, '');
  if (!word) return '';
  word = normalizeY(word);
  word = silenceGuQu(word);
  return word;
}

// Mirrors countWordSyllables' vowel-run + hiatus scan, but records where
// each resulting syllable nucleus starts instead of just counting them —
// that position is what lets the rest of this module slice out "from the
// stressed vowel to the end of the word".
function findSyllableNuclei(clean, lang) {
  const rules = LANG_RULES[lang] || LANG_RULES.es;
  const nuclei = [];
  let match;
  while ((match = VOWEL_RUN_RE.exec(clean))) {
    const run = match[0];
    let pieceStart = match.index;
    let pieceText = run[0];
    for (let i = 0; i < run.length - 1; i++) {
      const a = run[i], b = run[i + 1];
      const bothStrong = rules.strong.has(a) && rules.strong.has(b);
      const accentBreak = rules.accentedWeak.has(a) || rules.accentedWeak.has(b);
      if (bothStrong || accentBreak) {
        nuclei.push({ start: pieceStart, text: pieceText });
        pieceStart = match.index + i + 1;
        pieceText = '';
      }
      pieceText += b;
    }
    nuclei.push({ start: pieceStart, text: pieceText });
  }
  return nuclei;
}

// Within an unsplit diphthong nucleus (e.g. "ió", "ai"), the strong vowel
// (a/e/o) is always the syllabic core and the weak one (i/u) just a glide,
// regardless of writing order — this is what picks out the actual sound
// that carries the rhyme, not just the first letter of the nucleus.
function coreVowelIndex(nucleus, lang) {
  const rules = LANG_RULES[lang] || LANG_RULES.es;
  for (let i = 0; i < nucleus.text.length; i++) {
    if (rules.strong.has(nucleus.text[i])) return nucleus.start + i;
  }
  // All-weak diphthong (rare: "viu", "diu") — the second element is
  // conventionally the nucleus.
  return nucleus.start + nucleus.text.length - 1;
}

// Finds the absolute index (in `clean`) of the stressed vowel.
function findStress(clean, lang) {
  const nuclei = findSyllableNuclei(clean, lang);
  if (!nuclei.length) return null;

  const accents = STRESS_ACCENTS[lang] || STRESS_ACCENTS.es;
  for (let i = nuclei.length - 1; i >= 0; i--) {
    if ([...nuclei[i].text].some((ch) => accents.has(ch))) {
      return coreVowelIndex(nuclei[i], lang);
    }
  }

  if (nuclei.length === 1) return coreVowelIndex(nuclei[0], lang);

  const endsPenultimate = (PENULTIMATE_ENDING[lang] || PENULTIMATE_ENDING.es).test(clean);
  const stressedNucleus = endsPenultimate ? nuclei[nuclei.length - 2] : nuclei[nuclei.length - 1];
  return coreVowelIndex(stressedNucleus, lang);
}

// Unstressed-vowel normalization applied only to the trailing (unstressed)
// vowels of the assonant key — never the stressed core itself, since both
// languages' vowel-simplification conventions are specifically about
// unstressed position.
function normalizeAssonantVowel(v, lang, dialect) {
  if (lang === 'es') {
    if (v === 'i' || v === 'í') return 'e';
    if (v === 'u' || v === 'ú') return 'o';
    return v;
  }
  // Catalan: dialect changes which unstressed vowels actually sound alike.
  // Oriental collapses unstressed a/e toward schwa and o/u toward [u];
  // Occidental keeps all four distinct — see rhyme strategy discussion.
  if (dialect === 'oriental') {
    if (v === 'a' || v === 'e' || v === 'à' || v === 'è' || v === 'é') return 'ə';
    if (v === 'o' || v === 'u' || v === 'ò' || v === 'ó') return 'u';
  }
  return v;
}

// The two rhyme keys for one word: everything from the stressed vowel
// onward (consonant rhyme), and just the vowels from that point, per-
// language normalized (assonant rhyme).
function rhymeKeys(rawWord, lang, dialect) {
  const clean = cleanWord(rawWord, lang);
  if (!clean) return null;
  const stressIdx = findStress(clean, lang);
  if (stressIdx === null) return null;

  const consonant = clean.slice(stressIdx);
  const assonant = [...consonant]
    .filter((ch) => VOWEL_RE.test(ch))
    .map((ch, i) => (i === 0 ? ch : normalizeAssonantVowel(ch, lang, dialect)))
    .join('');

  return { consonant, assonant, clean };
}

// Punctuation-stripped words of a line, in order, keeping their original
// text for display alongside the computed keys.
function wordsOf(line) {
  return (line || '').trim().split(/\s+/).filter(Boolean).map((raw) => ({
    raw,
    clean: raw.toLowerCase().replace(wordBoundaryTrimRe(), ''),
  }));
}

// The two exports below exist for the muse's rhyme-suggestion feature: it
// needs to know what a line (or a single target word) actually rhymes with
// by this module's own rules, and to check a candidate word against that —
// the same primitives classifyStanzaRhymes already uses internally, just
// exposed for a single word instead of a whole stanza.

// Standard aguda/llana/esdrújula classification (which syllable, counting
// from the end, carries the stress) — reuses the exact same stress-finding
// logic the rhyme keys themselves are built on (findSyllableNuclei/
// findStress above), so a word's stress_type always agrees with its own
// rhyme_key. Used by scripts/seed-lexicon-kaikki.ts; exposed here rather than
// duplicated so the seed data and the live app can never drift apart.
export function classifyWordStress(rawWord, lang = 'es') {
  const clean = cleanWord(rawWord, lang);
  if (!clean) return null;
  const nuclei = findSyllableNuclei(clean, lang);
  if (!nuclei.length) return null;
  const stressIdx = findStress(clean, lang);
  if (stressIdx === null) return null;
  const stressedNucleusIndex = nuclei.findIndex((n) => stressIdx >= n.start && stressIdx < n.start + n.text.length);
  const fromEnd = nuclei.length - 1 - stressedNucleusIndex; // 0 = last syllable
  if (fromEnd === 0) return 'aguda';
  if (fromEnd === 1) return 'llana';
  return 'esdrujula';
}

// Metric length of a verse — what the gutter counter should show.
//
//  - Spanish: the singable-syllable count (raw syllables + sinalefa), exactly
//    what countLineSyllables already returns — unchanged.
//  - Catalan: the traditional convention counts syllables ONLY up to the last
//    stressed one, so the post-tonic syllables of the final word don't count
//    ("la lluna plena" is a tetrasíl·lab: la-llu-na-PLE·na → 4, not 5). A line
//    ending in an aguda word loses nothing, a plana loses 1, an esdrúixola 2.
//
// The final word never gets a sinalefa reduction (nothing follows it), so its
// post-tonic tail is still fully present in `base` and subtracting it is exact.
export function lineMeter(line, lang = 'es', dialect = 'central') {
  const base = countLineSyllables(line, lang);
  if (lang !== 'ca' || !base) return base;

  const words = wordsOf(line);
  const last = words[words.length - 1];
  if (!last) return base;

  const clean = cleanWord(last.clean, lang);
  const nuclei = findSyllableNuclei(clean, lang);
  const stressIdx = findStress(clean, lang);
  if (!nuclei.length || stressIdx === null) return base;

  const stressedNucleus = nuclei.findIndex(
    (n) => stressIdx >= n.start && stressIdx < n.start + n.text.length
  );
  if (stressedNucleus === -1) return base;

  const postTonic = nuclei.length - 1 - stressedNucleus; // 0 aguda · 1 plana · 2 esdrúixola
  return Math.max(0, base - postTonic);
}

// The rhyme key a *line* ends on — its last word's tail, by the same rule
// classifyStanzaRhymes uses to group lines.
export function getLineRhymeKey(line, lang = 'es', dialect = 'central') {
  const words = wordsOf(line);
  const lastWord = words[words.length - 1];
  return lastWord ? rhymeKeys(lastWord.clean, lang, dialect) : null;
}

// The rhyme key of a single bare word (e.g. one the user typed as "rhyme
// with this"), not a whole line.
export function getWordRhymeKey(word, lang = 'es', dialect = 'central') {
  const clean = (word || '').toLowerCase().replace(nonLetterRe(), '');
  return clean ? rhymeKeys(clean, lang, dialect) : null;
}

// Does a candidate word/short phrase actually rhyme with a target key?
// Checked against the candidate's own last word, consonant match or
// assonant match either counts. A word trivially "matches" its own rhyme
// key (same word → same key), but repeating the exact word you were asked
// to rhyme with isn't a rhyme at all — rima repetida doesn't count in
// either language's convention — so that case is rejected explicitly
// rather than left to slip through as a false positive.
export function wordMatchesRhyme(candidate, targetKey, lang = 'es', dialect = 'central') {
  if (!targetKey) return false;
  const words = wordsOf(candidate);
  const lastWord = words[words.length - 1];
  if (!lastWord) return false;
  const keys = rhymeKeys(lastWord.clean, lang, dialect);
  if (!keys) return false;
  if (keys.clean === targetKey.clean) return false;
  return keys.consonant === targetKey.consonant || keys.assonant === targetKey.assonant;
}

// One stanza (one note) at a time — letters restart at A for every note,
// since each note already represents one structural block of the song.
export function classifyStanzaRhymes(lines, lang = 'es', dialect = 'central') {
  const perLine = lines.map((line) => {
    const words = wordsOf(line);
    const lastWord = words[words.length - 1];
    const keys = lastWord ? rhymeKeys(lastWord.clean, lang, dialect) : null;
    return { line, words, keys };
  });

  // Pass 1: greedily group by exact consonant key (2+ members only).
  const consonantGroups = [];
  perLine.forEach((entry, i) => {
    if (!entry.keys) return;
    let group = consonantGroups.find((g) => g.key === entry.keys.consonant);
    if (!group) {
      group = { key: entry.keys.consonant, members: [] };
      consonantGroups.push(group);
    }
    group.members.push(i);
  });

  const claimed = new Set(consonantGroups.filter((g) => g.members.length > 1).flatMap((g) => g.members));

  // Pass 2: remaining lines grouped by assonant key (2+ members only).
  const assonantGroups = [];
  perLine.forEach((entry, i) => {
    if (!entry.keys || claimed.has(i)) return;
    let group = assonantGroups.find((g) => g.key === entry.keys.assonant);
    if (!group) {
      group = { key: entry.keys.assonant, members: [] };
      assonantGroups.push(group);
    }
    group.members.push(i);
  });

  const realGroups = [
    ...consonantGroups.filter((g) => g.members.length > 1).map((g) => ({ ...g, type: 'consonant' })),
    ...assonantGroups.filter((g) => g.members.length > 1).map((g) => ({ ...g, type: 'assonant' })),
  ].sort((a, b) => a.members[0] - b.members[0]);

  const letterByIndex = new Map();
  const typeByIndex = new Map();
  realGroups.forEach((group, gi) => {
    const letter = String.fromCharCode(65 + (gi % 26)); // A, B, C… wraps past Z rather than crash
    group.members.forEach((i) => {
      letterByIndex.set(i, group.type === 'consonant' ? letter : letter.toLowerCase());
      typeByIndex.set(i, group.type);
    });
  });

  return perLine.map((entry, i) => ({
    line: entry.line,
    letter: letterByIndex.get(i) ?? null,
    type: typeByIndex.get(i) ?? null,
    internalRhymeWords: findInternalRhymes(entry.words, lang, dialect),
  }));
}

// Content-driven Socratic trigger (deliberately NOT a "user paused typing"
// timer — the writer needs room to think in silence, that's a real product
// call, not an oversight). A line "breaks" the stanza's established scheme
// when sibling lines already form a real rhyme group — classifyStanzaRhymes
// only assigns a type once 2+ lines share a key, so any OTHER line with a
// non-null type already proves a scheme exists — but this line joined none
// of them. Pure and local: no API call, just whether to show the gutter
// nudge; the actual SOCRATIC call only fires if the user taps it.
export function detectRhymeFriction(rhymeLines, index) {
  const entry = rhymeLines[index];
  if (!entry || !entry.line?.trim() || entry.type) return false;
  return rhymeLines.some((other, i) => i !== index && other.type);
}

// Lightweight heuristic, not a full echo/Leonine classification (see
// rhyme strategy notes) — flags a word that shares a rhyme key with
// another word in the same line, including the line's own end word.
// Short function words are skipped: their vowel endings recur constantly
// and would just be noise, not a meaningful poetic device.
function findInternalRhymes(words, lang, dialect) {
  const hits = new Set();
  const keyed = words.map((w) => (w.clean.length >= 3 ? rhymeKeys(w.clean, lang, dialect) : null));

  for (let i = 0; i < keyed.length; i++) {
    if (!keyed[i]) continue;
    for (let j = i + 1; j < keyed.length; j++) {
      if (!keyed[j]) continue;
      if (keyed[i].consonant === keyed[j].consonant || keyed[i].assonant === keyed[j].assonant) {
        hits.add(i);
        hits.add(j);
      }
    }
  }
  return hits;
}
