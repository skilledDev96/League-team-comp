import { describe, expect, it } from 'vitest';
import { RankPoint } from '../models/team.models';
import { amsterdamToday, APEX_BASE, climbLines, dayNumber, ladderValue, rankWords, sparkGeometry, tierLines } from './rank-ladder';

const p = (day: string, tier: string, division: string, lp: number, queue: RankPoint['queue'] = 'solo'): RankPoint => ({ day, queue, tier, division, lp, wins: 0, losses: 0 });

describe('the ladder', () => {
  it('puts Gold II 80 LP forty points under Gold I 20 LP, and the apex tiers on one ladder above Diamond I', () => {
    expect(ladderValue(p('', 'GOLD', 'I', 20))! - ladderValue(p('', 'GOLD', 'II', 80))!).toBe(40);
    expect(ladderValue(p('', 'IRON', 'IV', 0))).toBe(0);
    expect(ladderValue(p('', 'MASTER', '', 0))).toBe(APEX_BASE);
    expect(ladderValue(p('', 'GRANDMASTER', 'I', 350))).toBe(APEX_BASE + 350);
    expect(ladderValue(p('', 'UNKNOWN', 'I', 10))).toBeNull();
  });

  it('says a rank the way a card does', () => {
    expect(rankWords(p('', 'PLATINUM', 'III', 0))).toBe('Platinum III');
    expect(rankWords(p('', 'CHALLENGER', '', 900))).toBe('Challenger');
  });

  it('draws gridlines at the tier boundaries inside the range', () => {
    expect(tierLines(1150, 1700).map((l) => [l.value, l.label])).toEqual([
      [1200, 'Gold'],
      [1600, 'Platinum']
    ]);
  });
});

describe('climbLines', () => {
  it('draws solo when there are two mornings of it, flex otherwise, and nobody with one morning', () => {
    const lines = climbLines(
      [
        { playerId: 'a', name: 'Zac', points: [p('2026-09-10', 'GOLD', 'II', 80), p('2026-09-13', 'GOLD', 'I', 20)] },
        { playerId: 'b', name: 'Vi', points: [p('2026-09-12', 'SILVER', 'I', 50), p('2026-09-11', 'SILVER', 'I', 10, 'flex'), p('2026-09-13', 'GOLD', 'IV', 5, 'flex')] },
        { playerId: 'c', name: 'Mido', points: [p('2026-09-13', 'GOLD', 'I', 0)] }
      ],
      '2026-09-13'
    );
    expect(lines.map((l) => [l.playerId, l.queue, l.delta])).toEqual([
      ['a', 'solo', 40],
      ['b', 'flex', 95]
    ]);
    expect(lines[0].points.map((x) => x.words)).toEqual(['Gold II', 'Gold I']);
  });

  it('leaves out mornings older than the window', () => {
    const lines = climbLines([{ playerId: 'a', name: 'Zac', points: [p('2026-06-01', 'GOLD', 'II', 0), p('2026-09-12', 'GOLD', 'II', 10), p('2026-09-13', 'GOLD', 'II', 30)] }], '2026-09-13', 60);
    expect(lines[0].points.map((x) => x.day)).toEqual(['2026-09-12', '2026-09-13']);
    expect(lines[0].delta).toBe(20);
  });
});

describe('one player in a small box', () => {
  it('draws nothing under two points, and a flat line through the middle of the box', () => {
    expect(sparkGeometry([{ day: '2026-09-13', value: 1250 }], 100, 40).d).toBe('');
    const flat = sparkGeometry([{ day: '2026-09-12', value: 1250 }, { day: '2026-09-13', value: 1250 }], 100, 40);
    expect(flat.first).toEqual({ x: 6, y: 20 });
    expect(flat.last).toEqual({ x: 94, y: 20 });
    expect(flat.d).toBe('M 6 20 L 94 20');
  });

  it('spaces the points by day and draws the tier lines inside the range', () => {
    const g = sparkGeometry([{ day: '2026-09-01', value: 1150 }, { day: '2026-09-03', value: 1180 }, { day: '2026-09-11', value: 1260 }], 100, 40);
    expect(g.grid.map((l) => l.label)).toEqual(['Gold']);
    expect(g.last!.y).toBeLessThan(g.first!.y);
    expect(dayNumber('2026-09-11') - dayNumber('2026-09-01')).toBe(10);
  });

  it('names the day in Amsterdam', () => {
    expect(amsterdamToday(new Date('2026-09-12T22:30:00Z'))).toBe('2026-09-13');
  });
});
