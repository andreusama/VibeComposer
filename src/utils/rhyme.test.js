import { describe, it, expect } from 'vitest';
import { classifyStanzaRhymes, detectRhymeFriction, classifyWordStress, getWordRhymeKey, lineMeter } from './rhyme.js';
import { stripToLetters, countWordSyllables, countLineSyllables, normalizeY } from './syllables.js';

describe('á handling (regression — á was silently stripped in 5 hand-copied regexes)', () => {
  it('stripToLetters keeps á instead of deleting it', () => {
    expect(stripToLetters('árbol')).toBe('árbol');
    expect(stripToLetters('está')).toBe('está');
  });

  it('counts syllables correctly for á-accented words', () => {
    expect(countWordSyllables('árbol', 'es')).toBe(2);
    expect(countWordSyllables('rápido', 'es')).toBe(3);
  });

  it('classifies stress correctly for á-accented words', () => {
    expect(classifyWordStress('árbol', 'es')).toBe('llana');
    expect(classifyWordStress('rápido', 'es')).toBe('esdrujula');
    expect(classifyWordStress('está', 'es')).toBe('aguda');
    expect(classifyWordStress('papá', 'es')).toBe('aguda');
  });

  it('computes a real rhyme key for á-accented words instead of a mangled one', () => {
    const key = getWordRhymeKey('árbol', 'es');
    expect(key.clean).toBe('árbol');
    expect(key.consonant).toBe('árbol');
  });
});

describe('mid-word consonantal y handling (regression — normalizeY used to delete it)', () => {
  it('keeps a mid-word consonantal y instead of deleting it', () => {
    expect(normalizeY('rayo')).toBe('rayo');
    expect(normalizeY('playa')).toBe('playa');
    expect(normalizeY('ayuda')).toBe('ayuda');
  });

  it('still converts a trailing post-vowel y to i (hoy/rey/muy/ley)', () => {
    expect(normalizeY('hoy')).toBe('hoi');
    expect(normalizeY('rey')).toBe('rei');
    expect(normalizeY('muy')).toBe('mui');
  });

  it('gives words with a real consonantal y the SAME rhyme key as each other', () => {
    expect(getWordRhymeKey('rayo', 'es').consonant).toBe('ayo');
    expect(getWordRhymeKey('mayo', 'es').consonant).toBe('ayo');
    expect(getWordRhymeKey('soslayo', 'es').consonant).toBe('ayo');
  });

  it('does NOT let a consonantal-y word false-rhyme with a real vowel-hiatus word', () => {
    // "rayo" (/ˈra.ʝo/, real consonant) must not collapse onto "cacao"
    // (/kaˈkao/, real vowel hiatus) — they don't actually rhyme.
    const rayo = getWordRhymeKey('rayo', 'es');
    const cacao = getWordRhymeKey('cacao', 'es');
    expect(rayo.consonant).not.toBe(cacao.consonant);
  });

  it('splits the syllable count correctly around a mid-word consonantal y', () => {
    // "ra-yo" — 2 syllables, not 1 (which is what deleting the y produced).
    expect(countWordSyllables('rayo', 'es')).toBe(2);
    expect(countWordSyllables('playa', 'es')).toBe(2);
  });
});

describe('sinalefa across a silent leading h', () => {
  it('elides "una hora" to 3 sung syllables, not 4', () => {
    expect(countLineSyllables('una hora', 'ca')).toBe(3);
    expect(countLineSyllables('una hora', 'es')).toBe(3);
  });

  it('still elides before a longer h-word ("la humanitat")', () => {
    expect(countLineSyllables('la humanitat', 'ca')).toBe(4);
  });

  it('does not over-merge when the previous word ends in a consonant', () => {
    // "un home" — "un" ends in n, no sinalefa: un-ho-me = 3
    expect(countLineSyllables('un home', 'ca')).toBe(3);
  });
});

describe('lineMeter — Catalan counts only up to the last stressed syllable', () => {
  it('drops the post-tonic syllable of a plana ending', () => {
    expect(lineMeter('la lluna plena', 'ca')).toBe(4);       // la-llu-na-PLE(na)
    expect(lineMeter('un cor que batega', 'ca')).toBe(5);     // un-cor-que-ba-TE(ga)
  });

  it('drops two syllables for an esdrúixola ending', () => {
    expect(lineMeter('la màquina', 'ca')).toBe(2);            // la-MÀ(qui-na)
  });

  it('leaves an aguda ending untouched', () => {
    expect(lineMeter('vull cantar', 'ca')).toBe(3);
  });

  it('is a pure passthrough to countLineSyllables for Spanish', () => {
    for (const line of ['quiero cantar', 'la luna llena', 'una casa vieja']) {
      expect(lineMeter(line, 'es')).toBe(countLineSyllables(line, 'es'));
    }
  });
});

describe('detectRhymeFriction', () => {
  it('flags a line that breaks an established consonant scheme', () => {
    // Two lines sharing a real consonant key, one that shares nothing with
    // either.
    const scheme = [
      'El cielo se cae al suelo',       // -elo
      'Todo el mundo pierde el recelo', // -elo, matches line 0
      'Camino solo por la calle',       // -alle, matches neither
    ];
    const rhymeLines = classifyStanzaRhymes(scheme, 'es', 'central');
    expect(rhymeLines[0].type).toBe('consonant');
    expect(rhymeLines[1].type).toBe('consonant');
    expect(rhymeLines[2].type).toBeNull();
    expect(detectRhymeFriction(rhymeLines, 2)).toBe(true);
  });

  it('does not flag a line when no scheme is established yet (all free verse)', () => {
    const lines = ['No sé qué decir', 'Solo miro'];
    const rhymeLines = classifyStanzaRhymes(lines, 'es', 'central');
    expect(rhymeLines.every((l) => l.type === null)).toBe(true);
    expect(detectRhymeFriction(rhymeLines, 0)).toBe(false);
    expect(detectRhymeFriction(rhymeLines, 1)).toBe(false);
  });

  it('does not flag a line that is itself part of the scheme', () => {
    const scheme = ['El cielo se cae al suelo', 'Todo el mundo pierde el recelo'];
    const rhymeLines = classifyStanzaRhymes(scheme, 'es', 'central');
    expect(detectRhymeFriction(rhymeLines, 0)).toBe(false);
    expect(detectRhymeFriction(rhymeLines, 1)).toBe(false);
  });

  it('does not flag an empty/whitespace-only line (nothing written yet)', () => {
    const scheme = ['El cielo se cae al suelo', 'Todo el mundo pierde el recelo', '   '];
    const rhymeLines = classifyStanzaRhymes(scheme, 'es', 'central');
    expect(detectRhymeFriction(rhymeLines, 2)).toBe(false);
  });

  it('returns false for an out-of-range index', () => {
    const rhymeLines = classifyStanzaRhymes(['solo una línea'], 'es', 'central');
    expect(detectRhymeFriction(rhymeLines, 5)).toBe(false);
  });
});
