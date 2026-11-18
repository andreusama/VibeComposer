import { describe, it, expect } from 'vitest';
import { inputModeFromPointerType } from './inputMode.js';

describe('inputModeFromPointerType', () => {
  it('a mouse is mouse mode', () => {
    expect(inputModeFromPointerType('mouse')).toBe('mouse');
  });

  it('a finger or a pen is touch mode', () => {
    expect(inputModeFromPointerType('touch')).toBe('touch');
    expect(inputModeFromPointerType('pen')).toBe('touch');
  });

  it('anything unrecognised falls back to touch, the safe, proven path', () => {
    expect(inputModeFromPointerType(undefined)).toBe('touch');
    expect(inputModeFromPointerType('')).toBe('touch');
  });
});
