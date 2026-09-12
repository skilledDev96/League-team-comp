import { describe, expect, it } from 'vitest';
import { AnalysisGame, TeamObjectives } from '../models/team.models';
import { GameRow, RowPlayer } from '../pages/games/game-rows';
import { ACHIEVEMENTS, Achievement, AchievementSources, achievementsOf } from './achievements';
import { FinishedSeries } from './series-results';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 7, 1);

const row = (id: string, over: Partial<GameRow> = {}): GameRow => ({ id, source: 'riot', label: 'Flex', date: T0, win: true, ours: [], theirs: [], ...over });

const side = (over: Partial<TeamObjectives> = {}): TeamObjectives => ({ firstBlood: false, firstTower: false, dragons: 0, barons: 0, heralds: 0, grubs: 0, towers: 0, inhibitors: 0, ...over });
const objectives = (ours: Partial<TeamObjectives>, theirs: Partial<TeamObjectives> = { towers: 4 }) => ({ ours: side(ours), theirs: side(theirs) });

/** One of ours; without `deaths` the seat carries no figures, as a game typed in from the draft room. */
const seat = (player: string | null, champion: string, deaths?: number): RowPlayer => ({
  role: 'Jungle',
  champion,
  player,
  ...(deaths === undefined ? {} : { stats: { kills: 3, deaths, assists: 8, cs: 160, damage: 11_000 } })
});

const finished = (id: string, bestOf: number, wins: number, losses: number, over: Partial<FinishedSeries> = {}): FinishedSeries =>
  ({
    series: { id, tournamentId: 'cup', opponent: `Team ${id}`, bestOf, order: 0 },
    tournament: { id: 'cup', name: 'Cup', order: 0 },
    games: [],
    score: { wins, losses, played: wins + losses },
    result: wins > losses ? 'won' : losses > wins ? 'lost' : 'drawn',
    incomplete: false,
    endedAt: T0,
    ...over
  }) as unknown as FinishedSeries;

const analysisGame = (matchId: string, over: Partial<AnalysisGame> = {}): AnalysisGame =>
  ({ matchId, compId: null, compName: null, win: true, queue: 'Flex', date: T0, players: [], ...over }) as unknown as AnalysisGame;

const fromBehind = { code: 'comeback' as const, label: 'Won from behind', detail: 'Behind on objectives at 38 minutes and still won' };

const base: AchievementSources = {
  rows: [],
  analysis: [],
  finished: [],
  titlesByName: new Map<string, number>(),
  longestWinStreak: 0,
  window: { from: T0 - 30 * DAY, to: T0 + 30 * DAY, mode: 'season' }
};
const cabinet = (over: Partial<AchievementSources> = {}) => achievementsOf({ ...base, ...over });
const trophy = (over: Partial<AchievementSources>, id: string): Achievement => cabinet(over).find((a) => a.id === id)!;

describe('the cabinet', () => {
  it('lists the sixteen trophies in their fixed order, the counts carrying a target', () => {
    expect(ACHIEVEMENTS.map((a) => a.id)).toEqual([
      'series-won',
      'clean-sweep',
      'comeback',
      'under-25',
      'streak-3',
      'streak-5',
      'streak-8',
      'soul',
      'double-baron',
      'no-tower-lost',
      'deathless',
      'quadra',
      'penta',
      'full-stack-25',
      'century',
      'three-crowns'
    ]);
    expect(ACHIEVEMENTS.filter((a) => a.need !== undefined).map((a) => [a.id, a.need])).toEqual([
      ['streak-3', 3],
      ['streak-5', 5],
      ['streak-8', 8],
      ['full-stack-25', 25],
      ['century', 100],
      ['three-crowns', 3]
    ]);
  });

  it('returns one achievement per trophy in order, every one locked when there is nothing to read', () => {
    const all = cabinet();
    expect(all.map((a) => a.id)).toEqual(ACHIEVEMENTS.map((a) => a.id));
    expect(all.every((a) => !a.unlocked && a.earnedAt === undefined && a.thisSeason === undefined)).toBe(true);
    expect(all.find((a) => a.id === 'century')?.progress).toEqual({ have: 0, need: 100 });
    expect(all.find((a) => a.id === 'streak-3')?.progress).toEqual({ have: 0, need: 3 });
    expect(all.find((a) => a.id === 'series-won')?.progress).toBeUndefined();
  });
});

describe('multikill trophies', () => {
  const carry = (facts: Record<string, number>) => [{ name: 'SkilledScarecrow', position: 'ADC', champion: 'Jinx', kills: 12, deaths: 1, assists: 4, cs: 250, damage: 30_000, facts }];

  it('earns a Pentakill off the earliest game with one, naming who and on what, and says what it was counted over', () => {
    const analysis = [
      analysisGame('m-old', { date: T0 - 40 * DAY, players: [] }),
      analysisGame('m-quad', { date: T0 + DAY, players: carry({ largestMultiKill: 4, quadraKills: 1, pentaKills: 0 }) as never }),
      analysisGame('m-penta', { date: T0 + 2 * DAY, players: carry({ largestMultiKill: 5, quadraKills: 1, pentaKills: 1 }) as never }),
      analysisGame('m-replay', { queue: 'Scrim', players: [] })
    ];
    const penta = trophy({ analysis }, 'penta');
    expect(penta).toMatchObject({ unlocked: true, by: 'SkilledScarecrow', champion: 'Jinx', earnedAt: T0 + 2 * DAY, coverage: { read: 2, of: 3 } });
    expect(trophy({ analysis }, 'quadra')).toMatchObject({ unlocked: true, earnedAt: T0 + DAY });
  });

  it('stays locked over games that carry no multikills, and says how few were read', () => {
    expect(trophy({ analysis: [analysisGame('m1'), analysisGame('m2')] }, 'penta')).toMatchObject({ unlocked: false, coverage: { read: 0, of: 2 } });
  });
});

describe('series trophies', () => {
  it('keeps Series won locked on a lost or drawn series, and dates it by the earliest dated win', () => {
    expect(trophy({ finished: [finished('a', 3, 0, 2), finished('b', 2, 1, 1)] }, 'series-won').unlocked).toBe(false);
    const won = trophy(
      {
        finished: [
          finished('late', 3, 2, 1, { endedAt: T0 + 5 * DAY }),
          finished('undated', 3, 2, 0, { endedAt: null }),
          finished('early', 3, 2, 0, { endedAt: T0 + 2 * DAY })
        ]
      },
      'series-won'
    );
    expect(won).toMatchObject({ unlocked: true, earnedAt: T0 + 2 * DAY, opponent: 'Team early' });
  });

  it('still unlocks on a won series nobody dated, and gives it no date', () => {
    const won = trophy({ finished: [finished('undated', 1, 1, 0, { endedAt: null })] }, 'series-won');
    expect(won).toMatchObject({ unlocked: true, opponent: 'Team undated' });
    expect(won.earnedAt).toBeUndefined();
  });

  it('gives a clean sweep only for a best-of-three or longer taken without dropping a game', () => {
    const sweep = (f: FinishedSeries) => trophy({ finished: [f] }, 'clean-sweep').unlocked;
    expect(sweep(finished('two-nil', 3, 2, 0))).toBe(true);
    expect(sweep(finished('three-nil', 5, 3, 0))).toBe(true);
    expect(sweep(finished('dropped-one', 3, 2, 1))).toBe(false);
    expect(sweep(finished('best-of-one', 1, 1, 0))).toBe(false);
    expect(sweep(finished('left-at-one-nil', 3, 1, 0, { incomplete: true }))).toBe(false);
  });
});

describe('game trophies', () => {
  it('reads a comeback off the win reasons and tells it through the matching row', () => {
    const closedFast = analysisGame('m1', { winFactors: [{ code: 'closed_fast', label: 'Closed it out early', detail: 'Won in 22 minutes' }] });
    expect(trophy({ analysis: [closedFast] }, 'comeback').unlocked).toBe(false);
    expect(trophy({ analysis: [analysisGame('m4', { win: false, winFactors: [fromBehind] })] }, 'comeback').unlocked).toBe(false);

    const analysis = [analysisGame('m2', { date: T0 + 3 * DAY, winFactors: [fromBehind] }), analysisGame('m3', { date: 0, winFactors: [fromBehind] })];
    const rows = [row('series-g1', { matchId: 'm3', date: T0 + DAY, opponent: 'Oryx Five' }), row('riot-m2', { matchId: 'm2', date: T0 + 3 * DAY })];
    expect(trophy({ analysis, rows }, 'comeback')).toMatchObject({ unlocked: true, earnedAt: T0 + DAY, opponent: 'Oryx Five' });
  });

  it('counts a win under 25 minutes, but never a remake, a loss or a game with no length', () => {
    const quick = (over: Partial<GameRow>) => trophy({ rows: [row('g', over)] }, 'under-25').unlocked;
    expect(quick({ durationSec: 1380 })).toBe(true);
    expect(quick({ durationSec: 600 })).toBe(true);
    expect(quick({ durationSec: 240 })).toBe(false);
    expect(quick({ durationSec: 1500 })).toBe(false);
    expect(quick({ durationSec: 1380, win: false })).toBe(false);
    expect(quick({})).toBe(false);
  });

  it('dates Quick close by the earliest qualifying game and names that opponent', () => {
    const rows = [
      row('newer', { date: T0 + 6 * DAY, durationSec: 1300, opponent: 'Late Team' }),
      row('undated', { date: 0, durationSec: 1300, opponent: 'Nobody Knows' }),
      row('older', { date: T0 + 2 * DAY, durationSec: 1300, opponent: 'Early Team' })
    ];
    expect(trophy({ rows }, 'under-25')).toMatchObject({ unlocked: true, earnedAt: T0 + 2 * DAY, opponent: 'Early Team' });
  });

  it('gives Dragon soul for four dragons in a win, and Double Baron for two Barons in a game', () => {
    const one = (over: Partial<GameRow>, id: string) => trophy({ rows: [row('g', { durationSec: 1900, ...over })] }, id).unlocked;
    expect(one({ objectives: objectives({ dragons: 4 }) }, 'soul')).toBe(true);
    expect(one({ objectives: objectives({ dragons: 3 }) }, 'soul')).toBe(false);
    expect(one({ objectives: objectives({ dragons: 5 }), win: false }, 'soul')).toBe(false);
    expect(one({}, 'soul')).toBe(false);
    expect(one({ objectives: objectives({ barons: 2 }) }, 'double-baron')).toBe(true);
    expect(one({ objectives: objectives({ barons: 1 }) }, 'double-baron')).toBe(false);
  });

  it('gives Untouched for a win where they took no tower, never for a remake or a game without objectives', () => {
    const one = (over: Partial<GameRow>) => trophy({ rows: [row('g', over)] }, 'no-tower-lost').unlocked;
    expect(one({ durationSec: 1700, objectives: objectives({ towers: 9 }, { towers: 0 }) })).toBe(true);
    expect(one({ durationSec: 1700, objectives: objectives({ towers: 9 }, { towers: 1 }) })).toBe(false);
    expect(one({ durationSec: 200, objectives: objectives({}, { towers: 0 }) })).toBe(false);
    expect(one({ durationSec: 1700, win: false, objectives: objectives({}, { towers: 0 }) })).toBe(false);
    expect(one({ durationSec: 1700 })).toBe(false);
  });

  it('names who went deathless and on what, from the earliest win that had one', () => {
    const rows = [
      row('newer', { date: T0 + 4 * DAY, durationSec: 1800, opponent: 'Late Team', ours: [seat('Zac', 'Ornn', 0)] }),
      row('older', { date: T0 + DAY, durationSec: 1800, opponent: 'Early Team', ours: [seat(null, 'Lulu', 0), seat('Go10x', 'Vi', 0), seat('Zac', 'Aatrox', 2)] })
    ];
    expect(trophy({ rows }, 'deathless')).toMatchObject({ unlocked: true, earnedAt: T0 + DAY, by: 'Go10x', champion: 'Vi', opponent: 'Early Team' });
  });

  it('does not read a seat with no figures as a seat with no deaths, and does not count a loss or a remake', () => {
    expect(trophy({ rows: [row('typed-in', { ours: [seat('Go10x', 'Vi')] })] }, 'deathless').unlocked).toBe(false);
    expect(trophy({ rows: [row('lost', { win: false, durationSec: 1800, ours: [seat('Go10x', 'Vi', 0)] })] }, 'deathless').unlocked).toBe(false);
    expect(trophy({ rows: [row('remake', { durationSec: 180, ours: [seat('Go10x', 'Vi', 0)] })] }, 'deathless').unlocked).toBe(false);
  });
});

describe('counted trophies', () => {
  it('unlocks the streaks off the longest streak and dates each by the win that first reached it', () => {
    const results = [true, true, false, true, true, true, true, true];
    const rows = results.map((win, n) => row(`g${n}`, { win, date: T0 + n * DAY })).reverse();
    const all = cabinet({ rows, longestWinStreak: 5 });
    const get = (id: string) => all.find((a) => a.id === id)!;
    expect(get('streak-3')).toMatchObject({ unlocked: true, progress: { have: 5, need: 3 }, earnedAt: T0 + 5 * DAY, thisSeason: true });
    expect(get('streak-5')).toMatchObject({ unlocked: true, progress: { have: 5, need: 5 }, earnedAt: T0 + 7 * DAY });
    expect(get('streak-8')).toMatchObject({ unlocked: false, progress: { have: 5, need: 8 } });
    expect(get('streak-8').earnedAt).toBeUndefined();
  });

  it('lets the streak number decide even when the rows cannot date it', () => {
    const streak = trophy({ longestWinStreak: 3 }, 'streak-3');
    expect(streak).toMatchObject({ unlocked: true, thisSeason: false });
    expect(streak.earnedAt).toBeUndefined();
    expect(trophy({ longestWinStreak: 3, window: { ...base.window, mode: 'all' } }, 'streak-3').thisSeason).toBe(true);
  });

  it('counts only full-stack games toward Full stack, and dates it by the twenty-fifth', () => {
    const stack = (n: number) => Array.from({ length: n }, (_, k) => row(`s${k}`, { rosterCount: 5, date: T0 + k * DAY })).reverse();
    const others = [row('three-of-us', { rosterCount: 3 }), row('not-said')];
    expect(trophy({ rows: [...stack(24), ...others] }, 'full-stack-25')).toMatchObject({ unlocked: false, progress: { have: 24, need: 25 } });
    expect(trophy({ rows: stack(30) }, 'full-stack-25')).toMatchObject({ unlocked: true, progress: { have: 30, need: 25 }, earnedAt: T0 + 24 * DAY });
  });

  it('counts every game toward Century, and dates it by the hundredth', () => {
    const games = (n: number) => Array.from({ length: n }, (_, k) => row(`g${k}`, { win: k % 2 === 0, date: T0 + k * HOUR })).reverse();
    expect(trophy({ rows: games(99) }, 'century')).toMatchObject({ unlocked: false, progress: { have: 99, need: 100 } });
    expect(trophy({ rows: games(100) }, 'century')).toMatchObject({ unlocked: true, progress: { have: 100, need: 100 }, earnedAt: T0 + 99 * HOUR });
  });

  it('takes Three crowns off the player with the most titles, ties going to the name that sorts first', () => {
    const locked = trophy({ titlesByName: new Map([['Go10x', 2], ['Zac', 1]]) }, 'three-crowns');
    expect(locked).toMatchObject({ unlocked: false, progress: { have: 2, need: 3 } });
    expect(locked.by).toBeUndefined();
    const won = trophy({ titlesByName: new Map([['Zac', 3], ['Go10x', 3], ['SkilledScarecrow', 1]]) }, 'three-crowns');
    expect(won).toMatchObject({ unlocked: true, progress: { have: 3, need: 3 }, by: 'Go10x' });
    expect(won.earnedAt).toBeUndefined();
    expect(trophy({}, 'three-crowns').progress).toEqual({ have: 0, need: 3 });
  });
});

describe('this season', () => {
  it('marks a trophy earned inside the window, not one earned before it, and every earned one when reading everything', () => {
    const inside = [row('inside', { durationSec: 1300, date: T0 + 2 * DAY })];
    const before = [row('before', { durationSec: 1300, date: T0 - 60 * DAY })];
    expect(trophy({ rows: inside }, 'under-25').thisSeason).toBe(true);
    expect(trophy({ rows: before }, 'under-25').thisSeason).toBe(false);
    expect(trophy({ rows: before, window: { ...base.window, mode: 'all' } }, 'under-25').thisSeason).toBe(true);
    expect(trophy({ rows: [], window: { ...base.window, mode: 'all' } }, 'under-25').thisSeason).toBeUndefined();
  });
});

describe('the other team', () => {
  it('earns every game trophy without ever opening their side of a row', () => {
    const game = row('m1', {
      matchId: 'm1',
      durationSec: 1320,
      rosterCount: 5,
      opponent: 'Oryx Five',
      objectives: objectives({ dragons: 4, barons: 2, towers: 11 }, { towers: 0 }),
      ours: [seat('Go10x', 'Vi', 0)]
    });
    Object.defineProperty(game, 'theirs', {
      get: () => {
        throw new Error('the other side was read');
      }
    });
    const all = cabinet({ rows: [game], analysis: [analysisGame('m1', { winFactors: [fromBehind] })] });
    expect(all.filter((a) => a.unlocked).map((a) => a.id)).toEqual(['comeback', 'under-25', 'soul', 'double-baron', 'no-tower-lost', 'deathless']);
    expect(all.find((a) => a.id === 'deathless')).toMatchObject({ by: 'Go10x', champion: 'Vi', opponent: 'Oryx Five' });
  });

  it('never hands back a name planted on their side', () => {
    const planted = row('g', {
      durationSec: 1320,
      ours: [seat('Go10x', 'Vi', 0)],
      theirs: [{ role: 'Mid', champion: 'Ahri', player: 'PlantedName', stats: { kills: 0, deaths: 0, assists: 0, cs: 0, damage: 0 } }]
    });
    expect(JSON.stringify(cabinet({ rows: [planted] }))).not.toContain('PlantedName');
  });
});
