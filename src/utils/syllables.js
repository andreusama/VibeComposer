// ─── Syllable counter — Castellano & Català ────────────────────────────────────
// Heuristic vowel-run scansion: groups consecutive vowels, then splits a group
// into multiple syllables wherever a hiatus occurs (two strong vowels in a row,
// or a written accent/diaeresis on a weak vowel breaking a diphthong).
// This is an approximation, not a full grammar — good enough for a live
// per-line counter, not meant to replace a linguist.

const LANG_RULES = {
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

function stripToLetters(word) {
  return word.toLowerCase().replace(/[^a-zàèéíïòóúüñç']/gi, '');
}

// 'y' is a vowel (sounds like "i") only at the end of a word, after another
// vowel (hoy, rey, muy, ley) — elsewhere it's a consonant (ya, yo, ayuda).
function normalizeY(word) {
  if (word.endsWith('y') && word.length > 1 && /[aeiouàèéíïòóúü]/.test(word[word.length - 2])) {
    return word.slice(0, -1) + 'i';
  }
  return word.replace(/y/g, '');
}

function silenceGuQu(word) {
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

  const runs = word.match(/[aeiouàèéíïòóúü]+/g);
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

  const vowelRe = /[aeiouàèéíïòóúüy]/i;

  for (const token of tokens) {
    const clean = stripToLetters(token);
    if (!clean) continue;

    const count = countWordSyllables(token, lang);
    const startsWithVowel = vowelRe.test(clean[0]);
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
