import { describe, expect, it } from 'vitest';
import { championMatches } from './champion-picker.component';

describe('championMatches', () => {
  it('finds a champion by any part of the name', () => {
    expect(championMatches('Lillia', 'lil')).toBe(true);
    expect(championMatches("Kai'Sa", 'kaisa')).toBe(true);
    expect(championMatches('Master Yi', 'yi')).toBe(true);
  });

  it('forgives a missed double letter, which is how Lillia went unsaved', () => {
    expect(championMatches('Lillia', 'Lilia')).toBe(true);
    expect(championMatches('Annie', 'anie')).toBe(true);
    expect(championMatches('Kassadin', 'kasadin')).toBe(true);
  });

  it('still says no to a different champion', () => {
    expect(championMatches('Lillia', 'lux')).toBe(false);
    expect(championMatches('Braum', 'brand')).toBe(false);
  });

  it('matches everything on an empty query, so the role-sorted list shows', () => {
    expect(championMatches('Zac', '')).toBe(true);
  });
});
