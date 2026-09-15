import { describe, expect, it } from 'vitest';
import { championMatches, matchRank, pickerAdd, pickerRemove } from './champion-picker.component';

describe('matchRank', () => {
  it('puts the champion typed ahead of names that merely contain it, so Enter on "Vi" takes Vi', () => {
    const names = ['Anivia', 'Vi', 'Viego', 'Vladimir'].filter((n) => championMatches(n, 'vi'));
    const sorted = [...names].sort((a, b) => matchRank(a, 'vi') - matchRank(b, 'vi') || a.localeCompare(b));
    expect(sorted).toEqual(['Vi', 'Viego', 'Anivia']);
    expect(matchRank("Kai'Sa", 'kaisa')).toBe(0);
  });
});

describe('a seated picker (a game saved by the draft room, 15 Sep 2026)', () => {
  const half = ['Sion', '', 'Ahri', '', ''];

  it('fills the first empty seat, so a pick never lands behind the blanks', () => {
    expect(pickerAdd(half, 'Vi', true)).toEqual(['Sion', 'Vi', 'Ahri', '', '']);
    expect(pickerAdd(['Sion', 'Vi'], 'Ahri', true)).toEqual(['Sion', 'Vi', 'Ahri']);
  });

  it('empties the seat of a removed pick instead of shifting the rest into the wrong roles', () => {
    expect(pickerRemove(['Sion', 'Vi', 'Ahri', 'Jinx', 'Leona'], 'Vi', true)).toEqual(['Sion', '', 'Ahri', 'Jinx', 'Leona']);
    expect(pickerRemove(half, 'Ahri', true)).toEqual(['Sion']);
  });

  it('an unseated list stays a plain list', () => {
    expect(pickerAdd(['Sion'], 'Vi', false)).toEqual(['Sion', 'Vi']);
    expect(pickerRemove(['Sion', 'Vi', 'Ahri'], 'Vi', false)).toEqual(['Sion', 'Ahri']);
  });
});

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
