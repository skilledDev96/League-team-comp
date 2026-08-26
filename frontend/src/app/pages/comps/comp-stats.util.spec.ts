import { describe, expect, it } from 'vitest';
import { AnalysisGame, CompPerformance } from '../../models/team.models';
import { compVerdict, formatDamage, winLossRecord } from './comp-stats.util';

function perf(games: number, winRate: number): CompPerformance {
  const wins = Math.round((winRate / 100) * games);
  return { compId: 'x', compName: 'X', games, wins, losses: games - wins, winRate };
}

function game(win: boolean): AnalysisGame {
  return { matchId: 'm', compId: null, compName: null, win, queue: 'Flex', date: 0, players: [] };
}

describe('compVerdict', () => {
  it('flags a small sample regardless of win rate', () => {
    expect(compVerdict(perf(2, 100))).toEqual({ label: 'Low sample', tone: 'neutral' });
    expect(compVerdict(perf(1, 0))).toEqual({ label: 'Low sample', tone: 'neutral' });
  });

  it('keeps comps at 60%+ with enough games', () => {
    expect(compVerdict(perf(10, 70))).toEqual({ label: 'Keep', tone: 'good' });
    expect(compVerdict(perf(3, 60))).toEqual({ label: 'Keep', tone: 'good' });
  });

  it('drops comps below 40%', () => {
    expect(compVerdict(perf(8, 25))).toEqual({ label: 'Drop', tone: 'warn' });
    expect(compVerdict(perf(5, 39))).toEqual({ label: 'Drop', tone: 'warn' });
  });

  it('marks the middle band as work on', () => {
    expect(compVerdict(perf(6, 50))).toEqual({ label: 'Work on', tone: 'neutral' });
    expect(compVerdict(perf(10, 40))).toEqual({ label: 'Work on', tone: 'neutral' });
  });
});

describe('formatDamage', () => {
  it('compacts thousands to one decimal + k', () => {
    expect(formatDamage(24312)).toBe('24.3k');
    expect(formatDamage(9800)).toBe('9.8k');
    expect(formatDamage(1000)).toBe('1.0k');
  });

  it('leaves sub-thousand values as-is', () => {
    expect(formatDamage(999)).toBe('999');
    expect(formatDamage(0)).toBe('0');
  });
});

describe('winLossRecord', () => {
  it('tallies wins and losses', () => {
    expect(winLossRecord([game(true), game(false), game(true)])).toEqual({ wins: 2, losses: 1 });
  });

  it('handles an empty list', () => {
    expect(winLossRecord([])).toEqual({ wins: 0, losses: 0 });
  });
});
