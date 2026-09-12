import { describe, expect, it } from 'vitest';
import { Player, TeamObjectives, Tournament } from '../models/team.models';
import { GameRow, PlayerLine, RowPlayer, RowStats, playerLines } from '../pages/games/game-rows';
import { FinishedSeries } from './series-results';
import {
  MIN_GAME_SEC,
  ROLLING_SEASON_DAYS,
  TREND_WINDOW,
  headline,
  mainChampionOf,
  objectiveControl,
  rankLabelOf,
  recordsToBeat,
  seasonRows,
  seasonWindow,
  streaks,
  winRateTrend
} from './team-season';

const DAY = 86_400_000;
/** Midday on 13 Sep 2026, local time: every window below is read from here. */
const NOW = new Date(2026, 8, 13, 12, 0, 0).getTime();
/** An evening in September 2026, local time; day 0 is 31 August. */
const sep = (d: number) => new Date(2026, 8, d, 19, 0, 0).getTime();

const tournament = (id: string, over: Partial<Tournament> = {}) => ({ id, name: `Cup ${id}`, kind: 'tournament', order: 0, ...over }) as unknown as Tournament;

const row = (id: string, date: number, win: boolean, over: Partial<GameRow> = {}): GameRow => ({
  id,
  source: 'riot',
  label: 'Flex',
  date,
  win,
  ours: [],
  theirs: [],
  ...over
});

const finished = (id: string, result: FinishedSeries['result'], opponent = `Team ${id}`) =>
  ({
    series: { id, tournamentId: 'cup', opponent, bestOf: 3, order: 0 },
    tournament: tournament('cup'),
    games: [],
    score: { wins: 0, losses: 0, played: 0 },
    result,
    incomplete: false,
    endedAt: null
  }) as unknown as FinishedSeries;

const haul = (over: Partial<TeamObjectives> = {}): TeamObjectives => ({
  firstBlood: false,
  firstTower: false,
  dragons: 0,
  barons: 0,
  heralds: 0,
  grubs: 0,
  towers: 0,
  inhibitors: 0,
  ...over
});

const seat = (player: string | null, champion: string, stats?: Partial<RowStats>): RowPlayer => ({
  role: 'Mid',
  champion,
  player,
  ...(stats ? { stats: { kills: 0, deaths: 0, assists: 0, cs: 0, damage: 0, ...stats } } : {})
});

const player = (over: Record<string, unknown> = {}) =>
  ({ id: 'p-mid', name: 'Kai', role: 'Mid', strengths: [], weaknesses: [], top3: [], bans: [], order: 0, ...over }) as unknown as Player;

describe('seasonWindow', () => {
  it('reads all time from zero to now', () => {
    expect(seasonWindow([tournament('cup', { active: true })], NOW, 'all')).toEqual({ mode: 'all', from: 0, to: NOW, label: 'All time' });
  });

  it('prefers a tournament marked active over one whose dates hold today, and never picks the scrims group', () => {
    const tournaments = [
      tournament('scrims', { kind: 'scrims', active: true, startDate: '2026-09-10' }),
      tournament('dated', { startDate: '2026-09-01', endDate: '2026-09-30' }),
      tournament('oryx', { name: 'Oryx Fearless League', active: true, startDate: '2026-08-01', endDate: '2026-10-31' })
    ];
    expect(seasonWindow(tournaments, NOW, 'season')).toEqual({
      mode: 'season',
      from: new Date(2026, 7, 1).getTime(),
      to: NOW,
      label: 'Oryx Fearless League',
      tournamentId: 'oryx'
    });
  });

  it('takes the latest start among several active tournaments', () => {
    const tournaments = [
      tournament('spring', { active: true, startDate: '2026-03-01', endDate: '2026-05-31' }),
      tournament('autumn', { active: true, startDate: '2026-08-15' }),
      tournament('undated', { active: true })
    ];
    const w = seasonWindow(tournaments, NOW, 'season');
    expect(w.tournamentId).toBe('autumn');
    expect(w.from).toBe(new Date(2026, 7, 15).getTime());
  });

  it('falls back to the dates when nothing is marked active, counting the end day whole', () => {
    const w = seasonWindow([tournament('weekend', { startDate: '2026-09-12', endDate: '2026-09-13' })], NOW, 'season');
    expect(w).toMatchObject({ tournamentId: 'weekend', from: new Date(2026, 8, 12).getTime(), to: NOW, label: 'Cup weekend' });
    // An open end does not hold today on its dates alone.
    expect(seasonWindow([tournament('open', { startDate: '2026-09-01' })], NOW, 'season').tournamentId).toBeUndefined();
  });

  it('ends a finished tournament that is still marked active on the last millisecond of its end day', () => {
    const w = seasonWindow([tournament('final', { active: true, startDate: '2026-08-01', endDate: '2026-09-10' })], NOW, 'season');
    expect(w.to).toBe(new Date(2026, 8, 10, 23, 59, 59, 999).getTime());
    expect(w.from).toBe(new Date(2026, 7, 1).getTime());
  });

  it('reaches back ninety days from an active tournament with no start date', () => {
    expect(seasonWindow([tournament('loose', { active: true })], NOW, 'season')).toEqual({
      mode: 'season',
      from: NOW - ROLLING_SEASON_DAYS * DAY,
      to: NOW,
      label: 'Cup loose',
      tournamentId: 'loose'
    });
  });

  it('reads the last ninety days when no tournament is running', () => {
    const tournaments = [tournament('scrims', { kind: 'scrims', active: true }), tournament('old', { startDate: '2026-01-01', endDate: '2026-02-01' })];
    const w = seasonWindow(tournaments, NOW, 'season');
    expect(ROLLING_SEASON_DAYS).toBe(90);
    expect(w).toEqual({ mode: 'season', from: NOW - 90 * DAY, to: NOW, label: 'Last 90 days' });
    expect('tournamentId' in w).toBe(false);
  });
});

describe('seasonRows', () => {
  const cup = seasonWindow([tournament('cup', { active: true, startDate: '2026-09-01' })], NOW, 'season');
  const o = { practice: new Set(['m-practice']), seriesTournament: new Map([['s-cup', 'cup'], ['s-old', 'old']]) };
  const rows = [
    row('late', NOW, true),
    row('practice', sep(12), true, { matchId: 'm-practice' }),
    row('kept', sep(10), false, { matchId: 'm-kept' }),
    row('undated-cup', 0, true, { source: 'tournament', seriesId: 's-cup' }),
    row('undated-old', 0, true, { source: 'tournament', seriesId: 's-old' }),
    row('undated-loose', 0, false, { source: 'scrim' }),
    row('first-day', cup.from, true),
    row('before', sep(0), true)
  ];

  it('keeps the dated games inside the window, both ends included, and an undated game only for its own tournament', () => {
    expect(seasonRows(rows, cup, o).map((r) => r.id)).toEqual(['late', 'kept', 'undated-cup', 'first-day']);
  });

  it('keeps every game but the practice ones over all time, in the order they came', () => {
    expect(seasonRows(rows, seasonWindow([], NOW, 'all'), o).map((r) => r.id)).toEqual([
      'late',
      'kept',
      'undated-cup',
      'undated-old',
      'undated-loose',
      'first-day',
      'before'
    ]);
  });

  it('drops every undated game from a rolling window, which belongs to no tournament', () => {
    expect(seasonRows(rows, seasonWindow([], NOW, 'season'), o).map((r) => r.id)).toEqual(['late', 'kept', 'first-day', 'before']);
  });
});

describe('headline', () => {
  it('counts the games and the finished series', () => {
    const rows = [row('a', sep(4), true), row('b', sep(3), true), row('c', sep(2), false), row('d', 0, true)];
    const series = [finished('s1', 'won'), finished('s2', 'lost'), finished('s3', 'drawn')];
    expect(headline(rows, series)).toEqual({ games: 4, wins: 3, losses: 1, winRate: 75, seriesWon: 1, seriesPlayed: 3 });
  });

  it('gives zero across the board with nothing played', () => {
    expect(headline([], [])).toEqual({ games: 0, wins: 0, losses: 0, winRate: 0, seriesWon: 0, seriesPlayed: 0 });
  });
});

describe('streaks', () => {
  it('reads the run at the newest end whatever order the rows came in, and gives a tied longest run to the later one', () => {
    // Oldest first: W W L W W L L, and one undated win that belongs to neither run.
    const rows = [
      row('u', 0, true),
      row('d5', sep(5), true),
      row('d1', sep(1), true),
      row('d7', sep(7), false),
      row('d3', sep(3), false),
      row('d2', sep(2), true),
      row('d6', sep(6), false),
      row('d4', sep(4), true)
    ];
    expect(streaks(rows)).toEqual({ current: { result: 'loss', length: 2 }, longestWin: { length: 2, from: sep(4), to: sep(5) } });
  });

  it('counts a winning run we are still on, and an undated loss does not break it', () => {
    const rows = [row('a', sep(4), true), row('b', sep(3), true), row('c', sep(2), true), row('d', sep(1), false), row('u', 0, false)];
    expect(streaks(rows)).toEqual({ current: { result: 'win', length: 3 }, longestWin: { length: 3, from: sep(2), to: sep(4) } });
  });

  it('has no current run without a dated game, and no longest win without a win', () => {
    expect(streaks([row('u', 0, true)])).toEqual({ current: null, longestWin: null });
    expect(streaks([row('a', sep(2), false), row('b', sep(1), false)])).toEqual({ current: { result: 'loss', length: 2 }, longestWin: null });
  });
});

describe('winRateTrend', () => {
  it('rolls the win rate over the window oldest first, and counts undated games apart', () => {
    // Oldest first: W L L W W.
    const rows = [row('g5', sep(5), true), row('g4', sep(4), true), row('g3', sep(3), false), row('g2', sep(2), false), row('g1', sep(1), true), row('u', 0, true)];
    const trend = winRateTrend(rows, [], 3);
    expect(trend.points.map((p) => [p.i, p.rowId, p.rate])).toEqual([
      [0, 'g1', 100],
      [1, 'g2', 50],
      [2, 'g3', 33],
      [3, 'g4', 33],
      [4, 'g5', 67]
    ]);
    expect(trend.points[0]).toEqual({ i: 0, date: sep(1), win: true, rate: 100, rowId: 'g1' });
    expect(trend.undated).toBe(1);
    expect(trend.markers).toEqual([]);
  });

  it('reads ten games back by default', () => {
    const rows = [row('g0', sep(1), false), ...Array.from({ length: 10 }, (_, k) => row(`g${k + 1}`, sep(k + 2), true))];
    const { points } = winRateTrend(rows, []);
    expect(TREND_WINDOW).toBe(10);
    expect(points[0].rate).toBe(0);
    expect(points[9].rate).toBe(90);
    // The loss has fallen out of the last ten.
    expect(points[10].rate).toBe(100);
  });

  it('flags each finished series at its last dated game, and skips a series with none', () => {
    const rows = [
      row('d', 0, true, { seriesId: 's3' }),
      row('c', sep(3), false),
      row('b', sep(2), true, { seriesId: 's1' }),
      row('a', sep(1), true, { seriesId: 's1' })
    ];
    const trend = winRateTrend(rows, [finished('s1', 'won', 'Team Red'), finished('s2', 'lost'), finished('s3', 'drawn')]);
    expect(trend.markers).toEqual([{ i: 1, opponent: 'Team Red', result: 'won' }]);
    expect(trend.undated).toBe(1);
  });
});

describe('objectiveControl', () => {
  it('totals each objective over the games that carry counts, and reads the firsts off Riot games only', () => {
    const rows = [
      row('r1', sep(4), true, {
        objectives: {
          ours: haul({ firstBlood: true, dragons: 3, barons: 1, heralds: 1, grubs: 3, towers: 8, inhibitors: 1 }),
          theirs: haul({ firstTower: true, dragons: 1, grubs: 3, towers: 4 })
        }
      }),
      row('r2', sep(3), false, {
        objectives: {
          ours: haul({ firstTower: true, towers: 2 }),
          theirs: haul({ firstBlood: true, dragons: 4, barons: 1, heralds: 1, grubs: 6, towers: 11, inhibitors: 3 })
        }
      }),
      // A replay always stores both firsts as false; counted, it would read as a scrim with no first blood.
      row('scrim', sep(2), false, {
        source: 'scrim',
        objectives: { ours: haul({ dragons: 2, towers: 5 }), theirs: haul({ dragons: 2, barons: 1, towers: 9, inhibitors: 1 }) }
      }),
      row('typed', sep(1), true, { source: 'tournament' })
    ];
    const out = objectiveControl(rows);
    expect(out.shares.map((s) => s.key)).toEqual(['dragons', 'barons', 'heralds', 'grubs', 'towers', 'inhibitors']);
    const by = (key: string) => out.shares.find((s) => s.key === key)!;
    expect(by('dragons')).toEqual({ key: 'dragons', ours: 5, theirs: 7, share: 5 / 12, games: 3 });
    expect(by('barons')).toMatchObject({ ours: 1, theirs: 2, games: 3 });
    expect(by('barons').share).toBeCloseTo(1 / 3);
    expect(by('heralds').share).toBe(0.5);
    expect(by('grubs').share).toBe(0.25);
    expect(by('towers')).toMatchObject({ ours: 15, theirs: 24 });
    expect(by('inhibitors').share).toBeCloseTo(0.2);
    expect(out.firstBlood).toEqual({ hit: 1, of: 2 });
    expect(out.firstTower).toEqual({ hit: 1, of: 2 });
  });

  it('leaves a count a stored game lacks out of that key alone, and has no share where neither side took one', () => {
    const older = { ...haul({ dragons: 1 }), grubs: undefined } as unknown as TeamObjectives;
    const rows = [
      row('a', sep(2), true, { objectives: { ours: older, theirs: haul({ dragons: 2, grubs: 2 }) } }),
      row('b', sep(1), false, { source: 'scrim', objectives: { ours: haul({ grubs: 1 }), theirs: haul() } })
    ];
    const out = objectiveControl(rows);
    expect(out.shares.find((s) => s.key === 'grubs')).toEqual({ key: 'grubs', ours: 1, theirs: 0, share: 1, games: 1 });
    expect(out.shares.find((s) => s.key === 'dragons')).toMatchObject({ ours: 1, theirs: 2, games: 2 });
    expect(out.shares.find((s) => s.key === 'barons')).toEqual({ key: 'barons', ours: 0, theirs: 0, share: null, games: 2 });
    expect(out.firstBlood).toEqual({ hit: 0, of: 1 });
  });

  it('has nothing to share over games that carry no counts', () => {
    const out = objectiveControl([row('typed', sep(1), true, { source: 'tournament' })]);
    expect(out.shares.every((s) => s.ours === 0 && s.theirs === 0 && s.share === null && s.games === 0)).toBe(true);
    expect(out.firstBlood).toEqual({ hit: 0, of: 0 });
    expect(out.firstTower).toEqual({ hit: 0, of: 0 });
  });
});

describe('recordsToBeat', () => {
  // By construction their players are always null; an obviously fake name here proves nothing reads them.
  const FAKE = 'ZZ-Fake-Opponent-Name';
  const enemy: RowPlayer = { role: 'Mid', champion: 'Syndra', player: FAKE, stats: { kills: 30, deaths: 0, assists: 0, cs: 400, damage: 90_000, vision: 150 } };
  const rows = [
    row('remake', sep(9), true, { durationSec: 420, opponent: 'Team Remake', ours: [seat('Zed', 'Ahri', { kills: 1, vision: 3 })], theirs: [enemy] }),
    row('late-tie', sep(8), true, {
      durationSec: 1500,
      opponent: 'Team Late',
      ours: [seat('Zed', 'Ahri', { kills: 12, vision: 40 }), seat(null, 'Yasuo', { kills: 20, vision: 90 })],
      theirs: [enemy]
    }),
    row('loss-short', sep(7), false, { durationSec: 900, ours: [seat('Kai', 'Orianna', { kills: 3 })], theirs: [enemy] }),
    row('early-tie', sep(5), true, { durationSec: 1320, label: 'Clash', opponent: 'Team Early', ours: [seat('Kai', 'Orianna', { kills: 12, vision: 41 })], theirs: [enemy] }),
    row('no-length', sep(3), true, { ours: [seat('Kai', 'Orianna')], theirs: [enemy] }),
    row('slow', sep(2), true, { durationSec: 2400, theirs: [enemy] }),
    row('typed', 0, true, { source: 'tournament', ours: [seat('Zed', 'Ahri')], theirs: [{ role: 'Mid', champion: 'Syndra', player: null }] })
  ];

  it('gives a tied kill record to the game that set it first, and never counts a seat nobody on the roster held', () => {
    expect(recordsToBeat(rows).mostKills).toEqual({ value: 12, rowId: 'early-tie', date: sep(5), label: 'Clash', opponent: 'Team Early', player: 'Kai', champion: 'Orianna' });
  });

  it('takes the fastest win of ten minutes or more, so a remake is not a record and a loss never is', () => {
    expect(recordsToBeat(rows).fastestWin).toEqual({ value: 1320, rowId: 'early-tie', date: sep(5), label: 'Clash', opponent: 'Team Early' });
    expect(MIN_GAME_SEC).toBe(600);
    expect(recordsToBeat([row('ten', sep(1), true, { durationSec: MIN_GAME_SEC }), row('remake', sep(2), true, { durationSec: 300 })]).fastestWin?.rowId).toBe('ten');
  });

  it('reads the vision record only where the game carried a vision score', () => {
    expect(recordsToBeat(rows).mostVision).toMatchObject({ value: 41, rowId: 'early-tie', player: 'Kai' });
  });

  it('carries the longest run of wins as the streak record', () => {
    const out = recordsToBeat(rows);
    expect(out.longestWinStreak).toEqual(streaks(rows).longestWin);
    expect(out.longestWinStreak).toEqual({ length: 3, from: sep(2), to: sep(5) });
  });

  it('never reads their side, however big their figures', () => {
    const text = JSON.stringify(recordsToBeat(rows));
    expect(text).not.toContain(FAKE);
    expect(text).not.toContain('Syndra');
  });

  it('holds no record over no games', () => {
    expect(recordsToBeat([])).toEqual({ mostKills: null, fastestWin: null, longestWinStreak: null, mostVision: null });
  });
});

describe('mainChampionOf', () => {
  it('takes the champion played most for the team, before anything Riot says', () => {
    const rows = [
      row('a', sep(1), true, { ours: [seat('Kai', 'Orianna')] }),
      row('b', sep(2), false, { ours: [seat('Kai', 'Syndra')] }),
      row('c', sep(3), true, { ours: [seat('Kai', 'Syndra')] })
    ];
    const lines = playerLines(rows);
    expect(mainChampionOf(player({ queueStats: { flex: { matches: { top3: ['Ahri'] } } } }), lines)).toBe('Syndra');
    expect(mainChampionOf(player({ name: ' kai ' }), lines)).toBe('Syndra');
  });

  it('falls back to flex, then solo, then the written pool, then nothing', () => {
    const other = [{ name: 'Zed', champions: [{ champion: 'Ahri', games: 3, wins: 2 }] }] as unknown as PlayerLine[];
    const both = { flex: { matches: { top3: ['Viktor'] } }, solo: { matches: { top3: ['Azir'] } } };
    expect(mainChampionOf(player({ queueStats: both, top3: ['Galio'] }), other)).toBe('Viktor');
    expect(mainChampionOf(player({ queueStats: { solo: { matches: { top3: ['Azir'] } } }, top3: ['Galio'] }), other)).toBe('Azir');
    expect(mainChampionOf(player({ top3: ['Galio'] }), other)).toBe('Galio');
    expect(mainChampionOf(player(), [])).toBeNull();
  });
});

describe('rankLabelOf', () => {
  const rank = (tier: string, division: string) => ({ tier, rank: division, leaguePoints: 50, wins: 20, losses: 18, winRate: 53 });

  it('prefers solo and title-cases the tier', () => {
    expect(rankLabelOf(player({ queueStats: { solo: { rank: rank('GOLD', 'II') }, flex: { rank: rank('PLATINUM', 'IV') } } }))).toEqual({ label: 'Gold II', queue: 'Solo' });
  });

  it('reads flex when solo carries no rank', () => {
    expect(rankLabelOf(player({ queueStats: { solo: { matches: { top3: [] } }, flex: { rank: rank('EMERALD', 'I') } } }))).toEqual({ label: 'Emerald I', queue: 'Flex' });
  });

  it('prints an apex tier without its division', () => {
    expect(rankLabelOf(player({ queueStats: { solo: { rank: rank('GRANDMASTER', 'I') } } }))).toEqual({ label: 'Grandmaster', queue: 'Solo' });
    expect(rankLabelOf(player({ queueStats: { flex: { rank: rank('CHALLENGER', 'I') } } }))).toEqual({ label: 'Challenger', queue: 'Flex' });
    expect(rankLabelOf(player({ queueStats: { solo: { rank: rank('MASTER', 'I') } } }))?.label).toBe('Master');
  });

  it('is null when neither queue has a rank', () => {
    expect(rankLabelOf(player())).toBeNull();
    expect(rankLabelOf(player({ queueStats: { flex: { matches: { top3: ['Ahri'] } } } }))).toBeNull();
  });
});
