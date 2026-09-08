import { describe, expect, it } from 'vitest';
import { AnalysisGame, AnalysisPlayer } from '../models/team.models';
import { healthChecks, healthTotals } from './health-checks';

const five = (over: Partial<AnalysisPlayer> = {}): AnalysisPlayer[] =>
  ['Top', 'Jungle', 'Mid', 'ADC', 'Support'].map((position) => ({
    name: position, position, champion: 'X', kills: 2, deaths: 1, assists: 3, cs: 100, damage: 5000, ...over
  }));

const game = (over: Partial<AnalysisGame> = {}): AnalysisGame => ({
  matchId: 'EUW1_1', compId: null, compName: null, win: true, queue: 'Flex', date: 1, durationSec: 1800,
  players: five(), kills: { ours: 10, theirs: 4 },
  objectives: { ours: { firstBlood: true, firstTower: true, dragons: 2, barons: 0, heralds: 0, grubs: 0, towers: 5, inhibitors: 1 }, theirs: { firstBlood: false, firstTower: false, dragons: 1, barons: 0, heralds: 0, grubs: 0, towers: 2, inhibitors: 0 } },
  cacheVersion: 5,
  ...over
});

describe('healthChecks', () => {
  it('passes a sound v5 game with a lane read', () => {
    const row = healthChecks(game({ players: five({ facts: { goldPerMin: 400 }, lane: { position: 'Top', theirChampion: 'Y', verdict: 'won' } }) }));
    expect(row.flags).toEqual([]);
    expect(row).toMatchObject({ players: 5, killsSum: 10, killsTally: 10, hasExtras: true, hasLanes: true, cacheVersion: 5 });
  });

  it('flags a v5 Riot game with no lane read, but not a replay', () => {
    expect(healthChecks(game()).flags).toEqual(['v5 Riot game with no lane read']);
    expect(healthChecks(game({ queue: 'Scrim' })).flags).toEqual([]);
  });

  it('flags kills that do not add up, a short game, missing objectives, and an old cache entry', () => {
    const row = healthChecks(game({ kills: { ours: 12, theirs: 4 }, durationSec: 300, objectives: undefined, cacheVersion: 3 }));
    expect(row.flags).toEqual([
      'player kills add to 10, tally says 12',
      'only 5 minutes long',
      'no objectives stored',
      'cache v3, waiting on the backfill'
    ]);
    expect(healthChecks(game({ cacheVersion: undefined, players: five().slice(0, 4) })).flags).toEqual([
      '4 of ours in the game, not five',
      'player kills add to 8, tally says 10',
      'no cache version stamped'
    ]);
  });

  it('totals the rows by cache state and flags', () => {
    const rows = [
      healthChecks(game({ players: five({ lane: { position: 'Top', theirChampion: 'Y', verdict: 'even' } }) })),
      healthChecks(game({ cacheVersion: 4 })),
      healthChecks(game({ cacheVersion: undefined }))
    ];
    expect(healthTotals(rows)).toEqual({ games: 3, current: 1, behind: 1, unstamped: 1, flagged: 2 });
  });
});
