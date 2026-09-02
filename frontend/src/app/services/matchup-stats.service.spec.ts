import { describe, expect, it } from 'vitest';
import { MIN_MATCHUP_GAMES, pairKeyFor, rateFrom } from './matchup-stats.service';

describe('pairKeyFor', () => {
  it('produces the same key whichever way round the pair is given', () => {
    const ours = pairKeyFor('Darius', 'Nasus');
    const theirs = pairKeyFor('Nasus', 'Darius');
    expect(ours.key).toBe('Darius_Nasus');
    expect(theirs.key).toBe('Darius_Nasus');
  });

  it('reports which side sorted first, which is what the stored wins belong to', () => {
    expect(pairKeyFor('Darius', 'Nasus').oursIsA).toBe(true);
    expect(pairKeyFor('Nasus', 'Darius').oursIsA).toBe(false);
  });

  it('strips the punctuation Firestore field paths cannot carry', () => {
    // "Kai'Sa" arrives from Riot as the id "Kaisa", but a display name reaching
    // here unresolved must still not produce a key with an apostrophe in it.
    expect(pairKeyFor("Kai'Sa", 'Kalista').key).toBe('KaiSa_Kalista');
    expect(pairKeyFor('Dr. Mundo', 'Sion').key).toBe('DrMundo_Sion');
  });

  it('orders on the raw names before stripping, matching the crawler', () => {
    // The crawler sorts with localeCompare on the name Riot sent and strips
    // afterwards. Stripping first can move a punctuated name past its
    // neighbour, producing a key that is never found in the document.
    const { key } = pairKeyFor('Dr. Mundo', 'Draven');
    const mirrored = pairKeyFor('Draven', 'Dr. Mundo');
    expect(key).toBe(mirrored.key);
  });
});

describe('rateFrom', () => {
  it('reads the stored wins directly when ours sorted first', () => {
    expect(rateFrom(200, 116, true, false)).toEqual({
      games: 200,
      wins: 116,
      winRate: 58,
      combined: false
    });
  });

  it('flips the wins when ours sorted second', () => {
    // The same cell read from the other side: 116 of 200 for them is 84 for us.
    expect(rateFrom(200, 116, false, false)).toEqual({
      games: 200,
      wins: 84,
      winRate: 42,
      combined: false
    });
  });

  it('the two sides of one cell always add to a hundred', () => {
    const a = rateFrom(347, 189, true, false).winRate;
    const b = rateFrom(347, 189, false, false).winRate;
    expect(a + b).toBeCloseTo(100, 1);
  });

  it('carries the combined flag through, so a view can say what it got', () => {
    expect(rateFrom(200, 100, true, true).combined).toBe(true);
  });

  it('rounds to one decimal rather than showing a full float', () => {
    expect(rateFrom(3, 1, true, false).winRate).toBe(33.3);
  });
});

describe('MIN_MATCHUP_GAMES', () => {
  it('is high enough that a lopsided matchup separates from even', () => {
    // The interval half-width on a proportion is about 0.98/sqrt(n) points.
    // The floor has to be tight enough that a 57% matchup clears 50%.
    const halfWidth = 98 / Math.sqrt(MIN_MATCHUP_GAMES);
    expect(57 - halfWidth).toBeGreaterThan(50);
  });

  it('is above the floor the backend prunes at, so the index always has spare', () => {
    // api/src/matchup-index.ts prunes at 50 purely to keep the document small.
    // If this ever drops below that, the UI would ask for pairings the index
    // has already thrown away and they would silently never appear.
    expect(MIN_MATCHUP_GAMES).toBeGreaterThanOrEqual(50);
  });
});
