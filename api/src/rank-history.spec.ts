import { describe, expect, it } from 'vitest';
import { amsterdamDay, appendRankPoints, RankPoint, rankPointsFrom } from './rank-history';

const point = (day: string, queue: RankPoint['queue'], lp = 50): RankPoint => ({ day, queue, tier: 'GOLD', division: 'II', lp, wins: 10, losses: 8 });

describe('rankPointsFrom', () => {
  it('reads solo and flex off the stored queue stats, the apex tiers without a division', () => {
    const stats = {
      solo: { rank: { queueType: 'RANKED_SOLO_5x5', tier: 'gold', rank: 'II', leaguePoints: 61, wins: 30, losses: 25 } },
      flex: { rank: { queueType: 'RANKED_FLEX_SR', tier: 'MASTER', rank: 'I', leaguePoints: 120, wins: 40, losses: 30 } }
    };
    expect(rankPointsFrom(stats, '2026-09-13')).toEqual([
      { day: '2026-09-13', queue: 'solo', tier: 'GOLD', division: 'II', lp: 61, wins: 30, losses: 25 },
      { day: '2026-09-13', queue: 'flex', tier: 'MASTER', division: '', lp: 120, wins: 40, losses: 30 }
    ]);
  });

  it('gives nothing for a queue Riot has not ranked them in, or for no stats at all', () => {
    expect(rankPointsFrom({ solo: { matches: {} }, flex: { rank: { tier: '' } } }, '2026-09-13')).toEqual([]);
    expect(rankPointsFrom(undefined, '2026-09-13')).toEqual([]);
  });
});

describe('appendRankPoints', () => {
  it('replaces a second run on the same day instead of adding to it, and keeps the days in order', () => {
    const existing = [point('2026-09-11', 'solo'), point('2026-09-12', 'solo', 40)];
    const { points, added } = appendRankPoints(existing, [point('2026-09-12', 'solo', 45), point('2026-09-13', 'solo', 70)]);
    expect(points.map((p) => [p.day, p.lp])).toEqual([
      ['2026-09-11', 50],
      ['2026-09-12', 45],
      ['2026-09-13', 70]
    ]);
    expect(added).toBe(1);
  });

  it('drops the oldest past the cap', () => {
    const existing = ['2026-09-10', '2026-09-11', '2026-09-12'].map((d) => point(d, 'flex'));
    expect(appendRankPoints(existing, [point('2026-09-13', 'flex')], 3).points.map((p) => p.day)).toEqual(['2026-09-11', '2026-09-12', '2026-09-13']);
  });
});

describe('amsterdamDay', () => {
  it('names the day in Amsterdam, where the morning run is scheduled', () => {
    expect(amsterdamDay(new Date('2026-09-12T22:30:00Z'))).toBe('2026-09-13');
    expect(amsterdamDay(new Date('2026-09-13T04:30:00Z'))).toBe('2026-09-13');
  });
});
