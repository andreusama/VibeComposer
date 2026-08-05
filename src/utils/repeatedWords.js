// ─── Repeated words / muletillas detector ──────────────────────────────────────
// On-demand (not live) — scans every note's active text across the whole
// project, not just the one currently open, per spec. Simple frequency count
// with a stopword list; not a full NLP stack, just enough to flag overused
// words a songwriter would want to know about.

const STOPWORDS = new Set([
  // Spanish
  'a', 'al', 'algo', 'algún', 'alguna', 'algunas', 'alguno', 'algunos', 'ante', 'antes',
  'como', 'con', 'contra', 'cual', 'cuando', 'de', 'del', 'desde', 'donde', 'durante',
  'e', 'el', 'ella', 'ellas', 'ello', 'ellos', 'en', 'entre', 'era', 'eres', 'es', 'esa',
  'esas', 'ese', 'eso', 'esos', 'esta', 'estas', 'este', 'esto', 'estos', 'fue', 'ha',
  'hay', 'la', 'las', 'le', 'les', 'lo', 'los', 'más', 'me', 'mi', 'mis', 'mucho', 'muy',
  'nada', 'ni', 'no', 'nos', 'nosotros', 'o', 'os', 'otra', 'otras', 'otro', 'otros',
  'para', 'pero', 'poco', 'por', 'porque', 'que', 'quien', 'se', 'sin', 'sobre', 'somos',
  'son', 'soy', 'su', 'sus', 'también', 'tan', 'te', 'ti', 'tu', 'tus', 'tuve', 'un', 'una',
  'uno', 'unos', 'y', 'ya', 'yo',
  // Catalan
  'amb', 'aquest', 'aquesta', 'aquestes', 'aquests', 'com', 'contra', 'd', 'de', 'del',
  'dels', 'des', 'després', 'durant', 'el', 'ella', 'elles', 'ells', 'els', 'em', 'en',
  'entre', 'era', 'ets', 'és', 'esta', 'et', 'ets', 'fins', 'hi', 'ho', 'i', 'jo', 'l',
  'la', 'les', 'li', 'lo', 'm', 'més', 'meu', 'meva', 'meus', 'meves', 'molt', 'n', 'ni',
  'no', 'nosaltres', 'o', 'per', 'però', 'perquè', 'poc', 'que', 'qui', 'quin', 'quina',
  's', 'se', 'sense', 'seu', 'seva', 'seus', 'seves', 'sobre', 'som', 'sóc', 'són', 't',
  'també', 'tan', 'teu', 'teva', 'teus', 'teves', 'ton', 'tu', 'un', 'una', 'uns',
]);

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFC')
    .match(/[a-zà-ÿ'’]+/gi) || [];
}

/**
 * @param {string[]} texts one entry per note's active text, project-wide
 * @param {{minLength?: number, minCount?: number}} opts
 * @returns {{word: string, count: number}[]} sorted by count desc, ties by word
 */
export function findRepeatedWords(texts, opts = {}) {
  const minLength = opts.minLength ?? 3;
  const minCount = opts.minCount ?? 3;

  const counts = new Map();
  for (const text of texts) {
    for (const raw of tokenize(text)) {
      const word = raw.replace(/['’]/g, '');
      if (word.length < minLength) continue;
      if (STOPWORDS.has(word)) continue;
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word, count]) => ({ word, count }));
}
