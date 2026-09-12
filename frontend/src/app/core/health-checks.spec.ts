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
  cacheVersion: 6,
  ...over
});

describe('healthChecks', () => {
  it('passes a sound v6 game with a lane read', () => {
    const row = healthChecks(game({ players: five({ facts: { goldPerMin: 400 }, lane: { position: 'Top', theirChampion: 'Y', verdict: 'won' } }) }));
    expect(row.flags).toEqual([]);
    expect(row).toMatchObject({ players: 5, killsSum: 10, killsTally: 10, hasExtras: true, hasLanes: true, cacheVersion: 6 });
  });

  it('flags a v6 Riot game with no lane read, but not a replay, and a v5 one waiting on the backfill as well', () => {
    expect(healthChecks(game()).flags).toEqual(['v6 Riot game with no lane read']);
    expect(healthChecks(game({ cacheVersion: 5 })).flags).toEqual(['cache v5, waiting on the backfill', 'v5 Riot game with no lane read']);
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
    // A sub in: the tally counts the fifth, the players do not, so kills may differ.
    expect(healthChecks(game({ cacheVersion: undefined, players: five().slice(0, 4) })).flags).toEqual([
      '4 of ours in the game, not five',
      'no cache version stamped'
    ]);
    // A remake has no lane to read, so that flag stays quiet.
    expect(healthChecks(game({ durationSec: 200 })).flags).toEqual(['only 3 minutes long']);
  });

  it('totals the rows by cache state and flags', () => {
    const rows = [
      healthChecks(game({ players: five({ lane: { position: 'Top', theirChampion: 'Y', verdict: 'even' } }) })),
      healthChecks(game({ cacheVersion: 4 })),
      healthChecks(game({ cacheVersion: undefined }))
    ];
    expect(healthTotals(rows)).toEqual({ games: 3, current: 1, behind: 1, unstamped: 1, flagged: 2, withTimeline: 0, waitingTimeline: 3 });
  });

  it('counts the timelines written and the Riot games still waiting, never a replay', () => {
    const rows = [
      healthChecks(game({ timelineData: 'riot' })),
      healthChecks(game({ queue: 'Scrim', timelineData: 'none' })),
      healthChecks(game())
    ];
    expect(rows[0].hasTimeline).toBe(true);
    expect(healthTotals(rows)).toMatchObject({ withTimeline: 1, waitingTimeline: 1 });
  });
});
