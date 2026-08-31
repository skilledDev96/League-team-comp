import { describe, expect, it } from 'vitest';
import { previousPatch, readCounters } from './champion-stats.service';

describe('readCounters', () => {
  it('reads a nested champions map', () => {
    const counts = readCounters({ champions: { Ahri: { games: 27, wins: 14 } } });
    expect(counts.get('ahri')).toEqual({ games: 27, wins: 14 });
  });

  it('reads the flat dotted fields the early crawler wrote', () => {
    // `set()` does not treat a dotted key as a field path — only `update()`
    // does — so those buckets hold literal fields named "champions.Ahri.games"
    // and no champions map at all. The games in them are real.
    const counts = readCounters({
      'champions.Ahri.games': 27,
      'champions.Ahri.wins': 14
    });
    expect(counts.get('ahri')).toEqual({ games: 27, wins: 14 });
  });

  it('adds both shapes together in a bucket written across the change', () => {
    const counts = readCounters({
      champions: { Ahri: { games: 10, wins: 6 } },
      'champions.Ahri.games': 27,
      'champions.Ahri.wins': 14
    });
    expect(counts.get('ahri')).toEqual({ games: 37, wins: 20 });
  });

  it('ignores the bucket metadata sitting alongside the counters', () => {
    const counts = readCounters({ patch: '16.17', tier: 'ALL', matches: 238 });
    expect(counts.size).toBe(0);
  });

  it('ignores a dotted key that is not a champion counter', () => {
    expect(readCounters({ 'something.else.entirely': 5 }).size).toBe(0);
    expect(readCounters({ 'champions.Ahri': 5 }).size).toBe(0);
  });

  it('survives a non-numeric value rather than producing NaN', () => {
    // A NaN win rate renders as "NaN%" and looks like a bug in the draft room.
    const counts = readCounters({ 'champions.Ahri.games': 'lots' as never });
    expect(counts.get('ahri')).toBeUndefined();
  });

  it('has nothing to say about an empty or missing bucket', () => {
    expect(readCounters(null).size).toBe(0);
    expect(readCounters({}).size).toBe(0);
  });

  it('keys champions the way the crawler stripped them', () => {
    // Kai'Sa is stored as KaiSa, because a dot or apostrophe would split the
    // path. A mismatch here is invisible: a missing rate looks exactly like a
    // champion below the sample floor.
    const counts = readCounters({ champions: { KaiSa: { games: 500, wins: 260 } } });
    expect(counts.get('kaisa')).toEqual({ games: 500, wins: 260 });
  });
});

describe('previousPatch', () => {
  it('steps back one minor version', () => {
    expect(previousPatch('16.17')).toBe('16.16');
    expect(previousPatch('16.2')).toBe('16.1');
  });

  it('stops at the first patch of a season rather than inventing 16.0', () => {
    expect(previousPatch('16.1')).toBe('');
  });

  it('has nothing to offer for a patch it cannot read', () => {
    expect(previousPatch('')).toBe('');
    expect(previousPatch('sixteen')).toBe('');
  });
});
