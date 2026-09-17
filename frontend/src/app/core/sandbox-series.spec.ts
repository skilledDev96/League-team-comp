import { describe, expect, it } from 'vitest';
import { isSandboxSeries, looksLikeTestSeries, sandboxMatchIds, sandboxSeriesIds } from './sandbox-series';

describe('sandbox series', () => {
  it('is a sandbox only when the flag says true', () => {
    expect(isSandboxSeries({ sandbox: true })).toBe(true);
    expect(isSandboxSeries({ sandbox: false })).toBe(false);
    expect(isSandboxSeries({})).toBe(false);
    expect(isSandboxSeries(undefined)).toBe(false);
  });

  it('lists the sandbox series and the replays filed under their games', () => {
    const series = [
      { id: 'real', sandbox: false },
      { id: 'test', sandbox: true },
      { id: 'plain' }
    ];
    const games = [
      { seriesId: 'real', matchId: 'EUW1-1' },
      { seriesId: 'test', matchId: 'r-test' },
      { seriesId: 'test' },
      { seriesId: 'plain', matchId: 'r-plain' }
    ];
    expect([...sandboxSeriesIds(series)]).toEqual(['test']);
    expect([...sandboxMatchIds(series, games)]).toEqual(['r-test']);
    expect(sandboxMatchIds([{ id: 'real' }], games).size).toBe(0);
  });

  it('only suggests marking a series whose name starts with test and is not one already', () => {
    expect(looksLikeTestSeries({ opponent: 'test' })).toBe(true);
    expect(looksLikeTestSeries({ opponent: ' Test 2' })).toBe(true);
    expect(looksLikeTestSeries({ opponent: 'test', sandbox: true })).toBe(false);
    expect(looksLikeTestSeries({ opponent: 'Contest Kings' })).toBe(false);
    expect(looksLikeTestSeries({ opponent: 'Paradox Requiem' })).toBe(false);
  });
});
