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

import { LANG_RULES, stripToLetters, normalizeY, silenceGuQu } from './syllables.js';

export const DIALECTS = {
  es: ['central'],
  ca: ['oriental', 'occidental'],
};

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
  const runRe = /[aeiouàèéíïòóúü]+/g;
  let match;
  while ((match = runRe.exec(clean))) {
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

const VOWEL_RE = /[aeiouàèéíïòóúü]/;

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
    clean: raw.toLowerCase().replace(/^[^a-zàèéíïòóúüñç]+|[^a-zàèéíïòóúüñç]+$/gi, ''),
  }));
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
