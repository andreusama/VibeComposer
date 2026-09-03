// ─── Syllable counter — Castellano & Català ────────────────────────────────────
// Heuristic vowel-run scansion: groups consecutive vowels, then splits a group
// into multiple syllables wherever a hiatus occurs (two strong vowels in a row,
// or a written accent/diaeresis on a weak vowel breaking a diphthong).
// This is an approximation, not a full grammar — good enough for a live
// per-line counter, not meant to replace a linguist.

// Exported so rhyme.js can scan the same vowel runs / hiatus rules to find
// each word's stressed syllable, instead of re-deriving its own — a
// hiatus break for syllable-counting purposes is the same event as a
// syllable boundary for stress-placement purposes.
export const LANG_RULES = {
  es: {
    strong: new Set(['a', 'e', 'o', 'á', 'é', 'ó']),
    // í/ú are weak but an explicit accent on them always forces a hiatus.
    weak:        new Set(['i', 'u', 'í', 'ú', 'ü']),
    accentedWeak: new Set(['í', 'ú']),
    vowels() { return new Set([...this.strong, ...this.weak]); },
  },
  ca: {
    strong: new Set(['a', 'e', 'o', 'à', 'è', 'é', 'ò', 'ó']),
    weak:        new Set(['i', 'u', 'í', 'ú', 'ï', 'ü']),
    // In Catalan the diaeresis (ï/ü) exists specifically to mark hiatus.
    accentedWeak: new Set(['í', 'ú', 'ï', 'ü']),
    vowels() { return new Set([...this.strong, ...this.weak]); },
  },
};

// The UNION of both languages' accented VOWELS — á is Spanish-only
// (Catalan has no á), which is why it can't be left out even though this
// whole set reads Catalan-shaped otherwise. This used to be hand-copied as
// a regex literal in FOUR separate places across syllables.js/rhyme.js,
// and á had silently gone missing from every one of them — corrupting
// syllable/hiatus/stress/rhyme detection for any Spanish word that has one
// (está, árbol, días, rápido, ...), since it got stripped as if the letter
// didn't exist. Single shared source of truth now, so that class of bug
// can't recur — see rhyme.js's VOWEL_RUN_RE/VOWEL_RE for reuse. ñ/ç are
// NOT vowels, so they're added separately in ACCENT_LETTERS below, not
// folded into this set.
export const ACCENT_VOWELS = 'àáèéíïòóúü';
export const ACCENT_LETTERS = ACCENT_VOWELS + 'ñç';

export function stripToLetters(word) {
  return word.toLowerCase().replace(new RegExp(`[^a-z${ACCENT_LETTERS}']`, 'gi'), '');
}

const VOWEL_RUN_RE = new RegExp(`[aeiou${ACCENT_VOWELS}]+`, 'g');
const vowelCharRe = () => new RegExp(`[aeiou${ACCENT_VOWELS}]`);

// 'y' is a vowel (sounds like "i") only at the end of a word, after another
// vowel (hoy, rey, muy, ley) — elsewhere it's a consonant (ya, yo, ayuda) and
// must be LEFT ALONE, not deleted: a consonant naturally isn't matched by
// the vowel-run regexes downstream, so keeping it is what correctly keeps
// two separate vowel runs separate. Deleting it (the previous behavior)
// silently fused them into one — "rayo" became "rao", merging its two
// vowel runs into a false diphthong and computing the exact same rhyme_key
// as "cacao"/"bacalao"/"sarao", none of which actually rhyme with it.
// Affects any word with a mid-word consonantal y: mayo, rayo, playa,
// ayuda, apoyo, hoyo, proyecto, desayuno, ensayo, arroyo, yema, cayado...
export function normalizeY(word) {
  if (word.endsWith('y') && word.length > 1 && vowelCharRe().test(word[word.length - 2])) {
    return word.slice(0, -1) + 'i';
  }
  return word;
}

export function silenceGuQu(word) {
  // "qu"/"gu" + e/i → the u doesn't form its own syllable (que, qui, gue, gui).
  // A diéresis (güe/güi) means the u IS pronounced, so those are left alone.
  return word.replace(/(qu|gu)([ei])/g, (_, c, v) => c[0] + v);
}

export function countWordSyllables(rawWord, lang = 'es') {
  const rules = LANG_RULES[lang] || LANG_RULES.es;
  const vowels = rules.vowels();

  let word = stripToLetters(rawWord).replace(/'/g, '');
  if (!word) return 0;
  word = normalizeY(word);
  word = silenceGuQu(word);

  const runs = word.match(VOWEL_RUN_RE);
  if (!runs) return 0;

  let syllables = 0;
  for (const run of runs) {
    const letters = [...run].filter((ch) => vowels.has(ch));
    if (!letters.length) continue;

    let count = 1;
    for (let i = 0; i < letters.length - 1; i++) {
      const a = letters[i], b = letters[i + 1];
      const bothStrong = rules.strong.has(a) && rules.strong.has(b);
      const accentBreak = rules.accentedWeak.has(a) || rules.accentedWeak.has(b);
      if (bothStrong || accentBreak) count++;
    }
    syllables += count;
  }
  return syllables;
}

/**
 * Syllable count for a full line, approximating sinalefa: when a word ends in
 * a vowel and the next word (no punctuation between them) starts with a vowel,
 * they merge into a single sung syllable — standard in Spanish/Catalan metric
 * scansion, and something songwriters counting singable syllables expect.
 */
export function countLineSyllables(line, lang = 'es') {
  if (!line || !line.trim()) return 0;

  const tokens = line.trim().split(/\s+/);
  let total = 0;
  let prevEndedInVowelNoPunct = false;

  const vowelRe = new RegExp(`[aeiouy${ACCENT_VOWELS}]`, 'i');

  for (const token of tokens) {
    const clean = stripToLetters(token);
    if (!clean) continue;

    const count = countWordSyllables(token, lang);
    // A leading h is mute in both Spanish and Catalan, so a word like "hora"
    // / "home" / "hierba" behaves as vowel-initial for sinalefa purposes —
    // "una hora" is sung as three syllables, not four. Strip it before the
    // test (guarding the all-h edge case so an empty head isn't matched).
    const head = clean.replace(/^h+/, '');
    const startsWithVowel = head.length > 0 && vowelRe.test(head[0]);
    const endsWithPunctBefore = /^[,;.:!?—–-]/.test(token.trim());

    if (prevEndedInVowelNoPunct && startsWithVowel && !endsWithPunctBefore && count > 0) {
      total += count - 1; // sinalefa: merge with previous word's final vowel
    } else {
      total += count;
    }

    const endsWithPunctAfter = /[,;.:!?—–-]$/.test(token.trim());
    prevEndedInVowelNoPunct = !endsWithPunctAfter && vowelRe.test(clean[clean.length - 1]);
  }

  return total;
}
