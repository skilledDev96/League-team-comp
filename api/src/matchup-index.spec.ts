import { describe, expect, it } from 'vitest';
import { INDEX_MIN_GAMES, buildIndex, indexDocPath, splitIndexId } from './matchup-index';

const AT = '2026-09-02T00:00:00.000Z';

describe('buildIndex', () => {
  it('keeps pairings at or above the floor and drops the rest', () => {
    const index = buildIndex(
      {
        pairs: {
          Darius_Nasus: { games: 120, winsA: 70 },
          Garen_Teemo: { games: INDEX_MIN_GAMES, winsA: 25 },
          Aatrox_Zaahen: { games: 3, winsA: 2 }
        }
      },
      '16.17',
      'TOP',
      AT
    );

    expect(Object.keys(index.pairs).sort()).toEqual(['Darius_Nasus', 'Garen_Teemo']);
    expect(index.pairsSeen).toBe(3);
    expect(index.pairsPublished).toBe(2);
  });

  it('drops a pairing with more wins than games rather than publishing a rate over 100%', () => {
    const index = buildIndex({ pairs: { Ahri_Zed: { games: 80, winsA: 90 } } }, '16.17', 'MIDDLE', AT);
    expect(index.pairs).toEqual({});
    // Still counted as seen: the pairing exists, it is the counts that are wrong.
    expect(index.pairsSeen).toBe(1);
  });

  it('drops a negative win count', () => {
    const index = buildIndex({ pairs: { Ahri_Zed: { games: 80, winsA: -1 } } }, '16.17', 'MIDDLE', AT);
    expect(index.pairs).toEqual({});
  });

  it('keeps a shutout, which is unlikely but not impossible', () => {
    const index = buildIndex({ pairs: { Ahri_Zed: { games: 60, winsA: 60 } } }, '16.17', 'MIDDLE', AT);
    expect(index.pairs.Ahri_Zed).toEqual({ games: 60, winsA: 60 });
  });

  it('survives a missing or empty document', () => {
    expect(buildIndex(null, '16.17', 'TOP', AT).pairs).toEqual({});
    expect(buildIndex({}, '16.17', 'TOP', AT).pairsSeen).toBe(0);
    expect(buildIndex({ pairs: {} }, '16.17', 'TOP', AT).pairsPublished).toBe(0);
  });

  it('ignores a malformed entry without losing the good ones beside it', () => {
    const index = buildIndex(
      {
        pairs: {
          Darius_Nasus: { games: 120, winsA: 70 },
          Broken_Pair: undefined,
          Missing_Counts: {},
          NaN_Counts: { games: Number.NaN, winsA: 5 }
        }
      },
      '16.17',
      'TOP',
      AT
    );
    expect(Object.keys(index.pairs)).toEqual(['Darius_Nasus']);
  });

  it('honours an explicit floor, so the threshold can be moved without a code change', () => {
    const raw = { pairs: { A_B: { games: 10, winsA: 5 } } };
    expect(buildIndex(raw, '16.17', 'TOP', AT, 5).pairsPublished).toBe(1);
    expect(buildIndex(raw, '16.17', 'TOP', AT, 20).pairsPublished).toBe(0);
  });

  it('records what it was built from', () => {
    const index = buildIndex({ pairs: {} }, '16.17', 'BOTTOM', AT);
    expect(index).toMatchObject({ patch: '16.17', lane: 'BOTTOM', builtAt: AT });
  });
});

describe('indexDocPath', () => {
  it('writes to its own collection, never over the raw tallies', () => {
    expect(indexDocPath('16.17', 'TOP')).toBe('matchupIndex/16.17_TOP');
    expect(indexDocPath('16.17', 'TOP')).not.toContain('matchupStats');
  });
});

describe('splitIndexId', () => {
  it('splits a well-formed id', () => {
    expect(splitIndexId('16.17_TOP')).toEqual({ patch: '16.17', lane: 'TOP' });
    expect(splitIndexId('16.17_UTILITY')).toEqual({ patch: '16.17', lane: 'UTILITY' });
  });

  it('refuses anything that is not one of the five lanes', () => {
    // A bucket id from the champion counters, which live in a different
    // collection and must never be indexed as if they were matchups.
    expect(splitIndexId('16.17_ALL')).toBeNull();
    expect(splitIndexId('16.17_CHALLENGER')).toBeNull();
  });

  it('refuses a malformed id rather than guessing', () => {
    expect(splitIndexId('16.17')).toBeNull();
    expect(splitIndexId('_TOP')).toBeNull();
    expect(splitIndexId('16.17_')).toBeNull();
    expect(splitIndexId('')).toBeNull();
  });
});
