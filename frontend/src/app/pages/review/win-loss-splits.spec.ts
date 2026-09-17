import { describe, expect, it } from 'vitest';
import { AnalysisGame, AnalysisPlayer, SeriesGame, Tournament, TournamentSeries } from '../../models/team.models';
import {
  adviceTopic,
  adviceTopics,
  atSource,
  championKey,
  formatSide,
  gamesWithTheFive,
  missingReplaysFor,
  withoutRemakes,
  hasFullFive,
  practiceInSource,
  ratioSplit,
  DEFAULT_PATTERN_FILTERS,
  gameSource,
  keepDoing,
  killParticipationOf,
  laneTable,
  laneTotals,
  PatternContext,
  PatternFilters,
  patternGames,
  patternInputs,
  patternSourceOf,
  playerSplits,
  readPatternFilters,
  roleFit,
  rosterOrderOf,
  seriousOnly,
  sourceOf,
  split,
  starterCount,
  starterNamesFor,
  teamSplits,
  tournamentMatchIds,
  withRoles,
  withStarters,
  workOn
} from './win-loss-splits';

const player = (name: string, position: string, over: Partial<AnalysisPlayer> = {}): AnalysisPlayer => ({
  name,
  position,
  champion: 'X',
  kills: 2,
  deaths: 3,
  assists: 4,
  cs: 200,
  damage: 10_000,
  ...over
});

const five = (over: (role: string) => Partial<AnalysisPlayer>) =>
  ['Top', 'Jungle', 'Mid', 'ADC', 'Support'].map((role) => player(role.toLowerCase(), role, over(role)));

let seq = 0;
const game = (win: boolean, over: Partial<AnalysisGame> = {}, playerOver: (role: string) => Partial<AnalysisPlayer> = () => ({})): AnalysisGame => ({
  matchId: `m${seq++}`,
  compId: null,
  compName: null,
  win,
  queue: 'Flex',
  date: 0,
  laneData: 'riot',
  players: five(playerOver),
  kills: { ours: win ? 20 : 8, theirs: win ? 8 : 20 },
  objectives: {
    ours: { firstBlood: win, firstTower: win, dragons: win ? 3 : 1, barons: 0, heralds: 0, grubs: 0, towers: 0, inhibitors: 0 },
    theirs: { firstBlood: !win, firstTower: !win, dragons: win ? 1 : 3, barons: 0, heralds: 0, grubs: 0, towers: 0, inhibitors: 0 }
  },
  ...over
});

/** n wins and n losses where bot loses lane in every loss and wins it in every win. */
function botLaneStory(n: number, extra: (win: boolean, role: string) => Partial<AnalysisPlayer> = () => ({})): AnalysisGame[] {
  const games: AnalysisGame[] = [];
  for (let i = 0; i < n; i += 1) {
    for (const win of [true, false]) {
      games.push(
        game(win, {}, (role) => ({
          lane: role === 'ADC' ? { position: 'ADC', theirChampion: 'Kaisa', verdict: win ? 'won' : 'lost', goldPerMinDiff: win ? 40 : -45, csAt10Diff: win ? 9 : -9 } : { position: role, theirChampion: 'Y', verdict: 'even' },
          ...extra(win, role)
        }))
      );
    }
  }
  return games;
}

describe('gameSource and roleFit', () => {
  it('sorts flex, Clash with the scrims, and a replay imported against a tournament game', () => {
    const ids = new Set(['EUW1-1']);
    expect(gameSource(game(true), ids)).toBe('flex');
    expect(gameSource(game(true, { queue: 'Clash' }), ids)).toBe('scrimClash');
    expect(gameSource(game(true, { queue: 'Scrim', matchId: 'EUW1-2' }), ids)).toBe('scrimClash');
    expect(gameSource(game(true, { queue: 'Scrim', matchId: 'EUW1-1' }), ids)).toBe('tournament');
  });

  it('reads a seat as main, second, or anything', () => {
    const roster = [{ name: 'adc', role: 'ADC', secondaryRoles: ['Mid'] }, { name: 'top', role: 'Top' }];
    const g = game(true);
    expect(roleFit(g, roster, 'main')).toBe(true);
    const atMid = { ...g, players: g.players.map((p) => (p.name === 'adc' ? { ...p, position: 'Mid' } : p.name === 'mid' ? { ...p, position: 'ADC' } : p)) };
    expect(roleFit(atMid, roster, 'main')).toBe(false);
    expect(roleFit(atMid, roster, 'second')).toBe(true);
    const atJungle = { ...g, players: g.players.map((p) => (p.name === 'adc' ? { ...p, position: 'Jungle' } : p)) };
    expect(roleFit(atJungle, roster, 'second')).toBe(false);
    expect(roleFit(atJungle, roster, 'any')).toBe(true);
  });
});

describe('split', () => {
  it('means each side over the games that carry the number and leaves the gap off with an empty side', () => {
    const games = [game(true), game(true), game(false)];
    const s = split(games, (g) => g.kills!.ours, 1);
    expect(s).toMatchObject({ wins: { mean: 20, n: 2 }, losses: { mean: 8, n: 1 }, all: { mean: 16, n: 3 }, gap: 12 });
    expect(s.samples!.map((x) => x.value)).toEqual([20, 20, 8]);
    expect(split([game(true)], () => undefined).gap).toBeUndefined();
  });
});

describe('killParticipationOf', () => {
  it('uses the row kills when the source did not compute it', () => {
    const g = game(true);
    expect(killParticipationOf(g.players[0], g)).toBeCloseTo(0.6); // (2+4)/10
    expect(killParticipationOf({ ...g.players[0], killParticipation: 0.9 }, g)).toBe(0.9);
  });
});

describe('laneTable', () => {
  it('counts only known verdicts, and says how many games were skipped or are still waiting', () => {
    const games = [
      ...botLaneStory(2),
      game(false, { laneData: 'none' }, (role) => (role === 'Top' ? { lane: { position: 'Top', theirChampion: 'X', verdict: 'unknown', goldPerMinDiff: 12 } } : {})),
      game(false, { laneData: 'riot' }, (role) => (role === 'Top' ? { lane: { position: 'Top', theirChampion: 'X', verdict: 'unknown' } } : {}))
    ];
    const t = laneTable(games);
    expect(t.read).toBe(4);
    expect(t.total).toBe(6);
    const bot = t.rows.find((r) => r.key === 'ADC')!;
    expect(bot.lostInLosses).toEqual({ games: 2, n: 2, share: 100 });
    expect(bot.wonInWins).toEqual({ games: 2, n: 2, share: 100 });
    expect(bot.lost).toEqual({ games: 2, n: 4, share: 50 }); // over every game with a read
    expect(bot.goldDiff.losses.mean).toBe(-45);
    expect(t.rows.find((r) => r.key === 'Top')!.lostInLosses).toEqual({ games: 0, n: 2, share: 0 });
    expect(t.skipped).toBe(1);
    expect(t.waiting).toBe(1);
  });

  it('by player: one row per person in roster order, whatever seat they sat in, with their usual seat', () => {
    const games = botLaneStory(2);
    // One win with the ADC and the Top swapped: adc sits Top and still wins lane there.
    const swapped = { ...games[0], players: games[0].players.map((p) => (p.name === 'adc' ? { ...p, position: 'Top' } : p.name === 'top' ? { ...p, position: 'ADC' } : p)) };
    const t = laneTable([swapped, ...games.slice(1)], 'player', ['support', 'adc']);
    expect(t.rows.map((r) => r.key)).toEqual(['support', 'adc', 'top', 'jungle', 'mid']);
    const adc = t.rows.find((r) => r.key === 'adc')!;
    expect(adc.seat).toBe('ADC');
    expect(adc.wonInWins).toEqual({ games: 2, n: 2, share: 100 }); // the Top game counts for the person
    expect(workOn(botLaneStory(8), 'player', ['adc']).find((a) => a.key === 'lane-adc')!.strong).toBe('adc (ADC) loses lane in 8 of 8 losses');
  });
});

describe('teamSplits', () => {
  it('reports n per side and the gap sign, and leaves a metric empty when no game carries it', () => {
    const m = new Map(teamSplits([game(true), game(false)]).map((x) => [x.key, x]));
    expect(m.get('dragons')!.split).toMatchObject({ wins: { mean: 3, n: 1 }, losses: { mean: 1, n: 1 }, gap: 2 });
    expect(m.get('killShare')!.split.gap).toBe(0.42); // means rounded first, then the gap
    expect(m.get('vision')!.split).toMatchObject({ wins: { mean: 0, n: 0 }, losses: { mean: 0, n: 0 } });
    expect(m.get('deaths')!.higherIsBetter).toBe(false);
  });
});

describe('workOn', () => {
  it('says nothing below the floor on either side', () => {
    expect(workOn(botLaneStory(7))).toEqual([]);
  });

  it('names the lane that loses lane, with the numbers, once both sides clear the floor', () => {
    const advice = workOn(botLaneStory(8));
    const lane = advice.find((a) => a.key === 'lane-ADC')!;
    expect(lane.strong).toBe('ADC loses lane in 8 of 8 losses');
    expect(lane.rest).toContain('-45 gold/min, -9 cs at 10');
    expect(lane.n).toBe('over 8 losses and 8 wins with a lane read');
    expect(advice.some((a) => a.key === 'lane-Top')).toBe(false);
  });

  it('holds the lane rule at 55% and 25 points', () => {
    // 8 losses: bot lost in 4 (50%) — below the share floor.
    const games = botLaneStory(8).map((g, i) =>
      !g.win && i % 4 === 1 ? { ...g, players: g.players.map((p) => (p.position === 'ADC' ? { ...p, lane: { ...p.lane!, verdict: 'even' as const } } : p)) } : g
    );
    expect(workOn(games).some((a) => a.key === 'lane-ADC')).toBe(false);
  });

  it('reads vision, Teleport and deaths from the facts, and Teleport only when Top takes it most games', () => {
    const games = botLaneStory(8, (win, role) => ({
      facts: {
        visionPerMin: win ? 2.0 : 1.0,
        ...(role === 'Top' ? { hasTeleport: true, tpTakedowns: win ? 3 : 0.2 } : {})
      },
      deaths: win ? 1 : 6
    }));
    const keys = workOn(games).map((a) => a.key);
    expect(keys).toContain('vision');
    expect(keys).toContain('tp');
    expect(keys).toContain('deaths');
    const noTp = games.map((g) => ({ ...g, players: g.players.map((p) => (p.position === 'Top' ? { ...p, facts: { ...p.facts, hasTeleport: false } } : p)) }));
    expect(workOn(noTp).map((a) => a.key)).not.toContain('tp');
  });

  it('ranks by effect and caps at four', () => {
    const games = botLaneStory(8, (win, role) => ({
      facts: { visionPerMin: win ? 2.0 : 1.0, controlWards: win ? 4 : 1, soloKills: win ? 2 : 0, plates: win ? 3 : 0, ...(role === 'Top' ? { hasTeleport: true, tpTakedowns: win ? 2 : 0 } : {}) },
      deaths: win ? 1 : 5
    }));
    const advice = workOn(games);
    expect(advice).toHaveLength(4);
    // Control wards are summed over the five: fifteen a game over a two-ward
    // edge outranks a full vision point over a quarter-point edge.
    expect(advice[0].key).toBe('controlWards');
    expect(advice.map((a) => a.key)).not.toContain('dragons'); // a 2-dragon gap over a 1.0 edge is cut by the cap
  });
});

describe('replays', () => {
  /** A replay: totals only, no lane, no per-minute figures, objectives without first blood or tower. */
  const replay = (win: boolean, over: Partial<AnalysisGame> = {}): AnalysisGame => ({
    ...game(win, { queue: 'Scrim', laneData: 'none', durationSec: 1800 }, () => ({ visionScore: win ? 40 : 20, facts: { goldPerMin: win ? 400 : 300 } })),
    objectives: {
      ours: { firstBlood: false, firstTower: false, dragons: win ? 3 : 1, barons: win ? 1 : 0, heralds: 0, grubs: 0, towers: win ? 9 : 3, inhibitors: 0 },
      theirs: { firstBlood: false, firstTower: false, dragons: 1, barons: 0, heralds: 0, grubs: 0, towers: 2, inhibitors: 0 }
    },
    ...over
  });
  const story = (n: number) => { const out: AnalysisGame[] = []; for (let i = 0; i < n; i += 1) out.push(replay(true), replay(false)); return out; };

  it('tells the sources apart, and keeps only the figures a replay carries', () => {
    expect(sourceOf(replay(true))).toBe('replay');
    expect(sourceOf(game(true))).toBe('riot');
    const keys = teamSplits(story(1), undefined, 'replay').map((m) => m.key);
    expect(keys).toContain('visionScore');
    expect(keys).toContain('towers');
    expect(keys).not.toContain('firstBlood');
    expect(keys).not.toContain('controlWards');
    expect(keys).not.toContain('tpTop');
    expect(teamSplits(story(1)).map((m) => m.key)).toContain('firstBlood');
  });

  it('reads lane totals per player from the end-of-game figures', () => {
    const rows = laneTotals(story(2), ['top', 'adc']);
    expect(rows.map((r) => r.key)).toEqual(['top', 'adc', 'jungle', 'mid', 'support']);
    expect(rows[0].goldShare.wins).toEqual({ mean: 0.2, n: 2 });
    expect(rows[0].csPerMin.wins.mean).toBeCloseTo(6.7, 1);
    expect(rows[0].deaths.losses.n).toBe(2);
    expect(rows[0].kda.wins.n).toBe(2);
    expect(rows[0].kda.wins.mean).toBeGreaterThan(0);
  });

  it('advises from towers, vision score and barons on replays, and never from a lane', () => {
    const keys = workOn(story(8), 'player', ['top'], 'replay').map((a) => a.key);
    expect(keys).toContain('towers');
    expect(keys).toContain('visionScore');
    expect(keys).toContain('barons');
    expect(keys.some((k) => k.startsWith('lane-'))).toBe(false);
    expect(keepDoing(story(8), 'player', ['top'], 'replay').map((a) => a.key)).toContain('towers');
  });
});

describe('evidence', () => {
  it('lists the games a line was averaged over, newest first and capped at twelve', () => {
    const games = botLaneStory(8, (win) => ({ deaths: win ? 1 : 6 })).map((g, i) => ({ ...g, date: i }));
    const deaths = workOn(games).find((a) => a.key === 'deaths')!;
    expect(deaths.evidence).toHaveLength(12);
    expect(deaths.evidenceUnit).toBe('count');
    expect(deaths.evidence![0].date).toBe(15);
    expect(deaths.evidence!.find((e) => !e.win)!.value).toBe(30); // five players at six deaths
    const lane = workOn(games).find((a) => a.key === 'lane-ADC')!;
    expect(lane.evidence!.every((e) => !e.win)).toBe(true); // the losses where the lane was lost
    expect(lane.evidence![0].value).toBe(-45);
    expect(lane.evidenceUnit).toBe('diff');
  });

  it('says what each figure counts, because a column of bare numbers does not', () => {
    const games = botLaneStory(8, (win) => ({ deaths: win ? 1 : 6 })).map((g, i) => ({ ...g, date: i }));
    expect(workOn(games).find((a) => a.key === 'deaths')!.evidenceLabel).toBe('deaths');
    expect(workOn(games).find((a) => a.key === 'lane-ADC')!.evidenceLabel).toBe('gold/min');
  });
});

/**
 * Two rules read vision: one over the clock (Riot's vision score per minute) and one over the
 * whole game. Both used to print the headline "Vision drops in losses", so the tab could give the
 * same advice twice and the reader could not tell which figure either line was quoting.
 */
describe('one line per subject', () => {
  const visionBoth = (n: number) =>
    botLaneStory(n, (win) => ({ facts: { visionPerMin: win ? 2.0 : 1.0 }, visionScore: win ? 40 : 18 }));

  it('keeps the stronger of two rules reading the same thing', () => {
    const keys = workOn(visionBoth(8)).map((a) => a.key);
    expect(keys.filter((k) => k === 'vision' || k === 'visionScore')).toHaveLength(1);
  });

  it('names the figure each vision line is quoting', () => {
    const workOnLine = workOn(visionBoth(8)).find((a) => a.key === 'vision' || a.key === 'visionScore')!;
    expect(workOnLine.strong).toMatch(/^Vision (per minute|score) drops in losses$/);
    const keepLine = keepDoing(visionBoth(8)).find((a) => a.key === 'visionScore');
    if (keepLine) expect(keepLine.strong).toBe('Vision score comes with the wins');
  });

  it('never prints the same headline twice', () => {
    const advice = [...workOn(visionBoth(8)), ...keepDoing(visionBoth(8))];
    for (const list of [workOn(visionBoth(8)), keepDoing(visionBoth(8))]) {
      expect(new Set(list.map((a) => a.strong)).size).toBe(list.length);
    }
    expect(advice.length).toBeGreaterThan(0);
  });
});

describe('keepDoing', () => {
  it('mirrors the lane rule and the early game from the wins', () => {
    const advice = keepDoing(botLaneStory(8));
    expect(advice.find((a) => a.key === 'lane-ADC')!.strong).toBe('ADC wins lane in 8 of 8 wins');
    expect(advice.find((a) => a.key === 'early')!.strong).toBe('First blood in 100% of wins');
  });
});

describe('playerSplits', () => {
  it('lists every player in seat order with their own splits, and re-counts a filtered set', () => {
    const games = botLaneStory(2, (win) => ({ deaths: win ? 1 : 5 }));
    const rows = playerSplits(games);
    expect(rows.map((r) => r.role)).toEqual(['Top', 'Jungle', 'Mid', 'ADC', 'Support']);
    const adc = rows.find((r) => r.role === 'ADC')!;
    expect(adc.metrics.find((m) => m.key === 'deaths')!.split).toMatchObject({ wins: { mean: 1, n: 2 }, losses: { mean: 5, n: 2 }, gap: -4 });
    expect(adc.metrics.find((m) => m.key === 'goldDiff')!.split.losses.mean).toBe(-45);
    expect(playerSplits(games.filter((g) => g.win))[0].metrics[0].split.losses.n).toBe(0);
  });

  it('counts every game a player played, and breaks the seats out once a seat has enough games', () => {
    // Sixteen games; in eight losses the ADC and Top swap seats, so adc is Top in 8 and ADC in 8.
    const games = botLaneStory(8, (win) => ({ deaths: win ? 1 : 5 })).map((g) =>
      !g.win ? { ...g, players: g.players.map((p) => (p.name === 'adc' ? { ...p, position: 'Top', deaths: 9 } : p.name === 'top' ? { ...p, position: 'ADC' } : p)) } : g
    );
    const rows = playerSplits(games);
    const adc = rows.find((r) => r.name === 'adc')!;
    expect(adc.games).toBe(16);
    expect(adc.metrics.find((m) => m.key === 'deaths')!.split).toMatchObject({ wins: { mean: 1, n: 8 }, losses: { mean: 9, n: 8 }, gap: -8 });
    expect(adc.seats.map((s) => s.role + ':' + s.games)).toEqual(['Top:8', 'ADC:8']);
    expect(adc.seats[0].metrics.find((m) => m.key === 'deaths')!.split.losses).toEqual({ mean: 9, n: 8 });
    expect(adc.seats[1].metrics.find((m) => m.key === 'deaths')!.split.wins).toEqual({ mean: 1, n: 8 });
    // The jungler never moved: one seat, every game, so no breakdown is needed but it is still listed.
    const jg = rows.find((r) => r.name === 'jungle')!;
    expect(jg.seats.map((s) => s.role + ':' + s.games)).toEqual(['Jungle:16']);
  });
});

/**
 * Reading the Patterns filters back (12 Sep 2026).
 *
 * The point of storing them is that a reader who set Tournament / everything / Any last week sees
 * those numbers again this week. The point of validating them is that a key which outlives a
 * renamed option must not leave the page filtering on a value it can no longer draw — so each
 * field falls back on its own rather than the whole selection being thrown away.
 */
describe('the stored Patterns filters', () => {
  const stored = (filters: Partial<PatternFilters>) => readPatternFilters(JSON.stringify(filters));

  it('starts at Flex, Prep, A team, Main when nothing was ever stored', () => {
    expect(readPatternFilters(null)).toEqual(DEFAULT_PATTERN_FILTERS);
  });

  it('gives back what was chosen', () => {
    expect(stored({ source: 'tournament', prep: false, roles: 'any', comp: 'comp-7' })).toEqual({
      source: 'tournament',
      prep: false,
      starters: 'team',
      custom: [],
      roles: 'any',
      comp: 'comp-7'
    });
  });

  it('keeps a hand-picked five, and the mode that uses it', () => {
    const back = stored({ starters: 'custom', custom: ['Ruan', 'Milio'] });
    expect(back.starters).toBe('custom');
    expect(back.custom).toEqual(['Ruan', 'Milio']);
  });

  it('drops back to the A team when the hand-picked five is empty', () => {
    // Otherwise 'custom' with nobody ticked counts every game — not what the reader chose.
    expect(stored({ starters: 'custom', custom: [] }).starters).toBe('team');
  });

  it('falls back one field at a time when a value is no longer an option', () => {
    const back = stored({ source: 'scrim' as never, roles: 'support' as never, comp: 'comp-7' });
    expect(back.source).toBe('flex');
    expect(back.roles).toBe('main');
    expect(back.comp).toBe('comp-7');
  });

  it('survives a half-written or hostile key', () => {
    expect(readPatternFilters('{"source":')).toEqual(DEFAULT_PATTERN_FILTERS);
    expect(readPatternFilters('"flex"')).toEqual(DEFAULT_PATTERN_FILTERS);
    expect(readPatternFilters(JSON.stringify({ prep: 'yes', custom: [1, 'Ruan', null] }))).toEqual({
      ...DEFAULT_PATTERN_FILTERS,
      custom: ['Ruan']
    });
  });
});

/**
 * The Patterns selection as steps (13 Sep 2026).
 *
 * The tab counts what each filter leaves out, and Home reads the same selection without the tab. So
 * each step has to remove exactly what the tab removed, and the composition has to be those steps in
 * the order the tab runs them.
 */
describe('the Patterns selection, step by step', () => {
  const at = 1_757_750_400_000; // 13 Sep 2026
  const flex = game(true, { matchId: 'EUW1-100', date: at });
  const practice = game(false, { matchId: 'EUW1-101', date: at - 60_000 });
  const clash = game(true, { matchId: 'EUW1-102', queue: 'Clash', date: at - 120_000 });
  const scrim = game(false, { matchId: 'scrim-103', queue: 'Scrim', laneData: 'none', date: at - 180_000 });
  const tournament = game(true, { matchId: 'scrim-104', queue: 'Scrim', laneData: 'none', date: at - 240_000 });
  // The bench player sat Support, so one of the A team missed it.
  const subIn = game(false, { matchId: 'EUW1-105', date: at - 300_000 }, (role) => (role === 'Support' ? { name: 'bench' } : {}));
  // The ADC sat Mid and the Mid sat ADC: each in a second seat, neither in their main one.
  const offRole = game(true, { matchId: 'EUW1-106', date: at - 360_000 }, (role) => (role === 'Mid' ? { name: 'adc' } : role === 'ADC' ? { name: 'mid' } : {}));
  const all = [flex, practice, clash, scrim, tournament, subIn, offRole];

  const roster: PatternContext['roster'] = [
    { name: 'bench', role: 'Support', sub: true },
    { name: 'support', role: 'Support' },
    { name: 'adc', role: 'ADC', secondaryRoles: ['Mid'] },
    { name: 'mid', role: 'Mid', secondaryRoles: ['ADC'] },
    { name: 'jungle', role: 'Jungle' },
    { name: 'top', role: 'Top' }
  ];
  const ctx: PatternContext = { practice: new Set([practice.matchId]), tournamentIds: new Set([tournament.matchId]), roster };
  const ids = (games: readonly AnalysisGame[]) => games.map((g) => g.matchId);
  const without = (...gone: AnalysisGame[]) => ids(all.filter((g) => !gone.includes(g)));

  it('leaves out the game tagged as practice and nothing else', () => {
    expect(ids(seriousOnly(all, ctx.practice))).toEqual(without(practice));
    expect(seriousOnly(all, new Set<string>())).toEqual(all);
  });

  it('sorts every game into exactly one source', () => {
    expect(ids(atSource(all, 'flex', ctx.tournamentIds))).toEqual(ids([flex, practice, subIn, offRole]));
    expect(ids(atSource(all, 'scrimClash', ctx.tournamentIds))).toEqual(ids([clash, scrim]));
    expect(ids(atSource(all, 'tournament', ctx.tournamentIds))).toEqual(ids([tournament]));
    // With no series game carrying it, the tournament replay is a scrim.
    expect(ids(atSource(all, 'scrimClash', new Set<string>()))).toEqual(ids([clash, scrim, tournament]));
  });

  it('names the A team without the bench, or the ticked set once each', () => {
    expect(starterNamesFor('team', ['bench'], roster)).toEqual(['support', 'adc', 'mid', 'jungle', 'top']);
    expect(starterNamesFor('custom', ['top', 'bench', 'top'], roster)).toEqual(['top', 'bench']);
  });

  it('leaves out the game a starter missed, and nothing when nobody is named', () => {
    expect(ids(withStarters(all, starterNamesFor('team', [], roster)))).toEqual(without(subIn));
    expect(ids(withStarters(all, ['top', 'bench']))).toEqual(ids([subIn]));
    expect(withStarters(all, [])).toEqual(all);
  });

  it('leaves out the off-role game on Main, keeps it on a second seat, and keeps every game on Any', () => {
    expect(ids(withRoles(all, roster, 'main'))).toEqual(without(offRole));
    expect(withRoles(all, roster, 'second')).toEqual(all);
    expect(withRoles(all, roster, 'any')).toEqual(all);
  });

  it('with the default filters, is the steps run by hand in the order the tab runs them', () => {
    const byHand = withRoles(
      withStarters(atSource(seriousOnly(all, ctx.practice), 'flex', ctx.tournamentIds), starterNamesFor('team', [], roster)),
      roster,
      'main'
    );
    expect(patternGames(all, DEFAULT_PATTERN_FILTERS, ctx)).toEqual(byHand);
    expect(ids(byHand)).toEqual(ids([flex]));
  });

  it('follows a stored selection, and never reads the comp filter', () => {
    const everyGame: PatternFilters = { ...DEFAULT_PATTERN_FILTERS, prep: false, roles: 'second', starters: 'custom', custom: ['top', 'mid'] };
    expect(ids(patternGames(all, everyGame, ctx))).toEqual(ids([flex, practice, subIn, offRole]));
    expect(ids(patternGames(all, { ...DEFAULT_PATTERN_FILTERS, source: 'tournament' }, ctx))).toEqual(ids([tournament]));
    expect(patternGames(all, { ...DEFAULT_PATTERN_FILTERS, comp: 'comp-7' }, ctx)).toEqual(patternGames(all, DEFAULT_PATTERN_FILTERS, ctx));
  });

  it('orders the roster the way the rows by player do: the A team by seat, then the bench', () => {
    expect(rosterOrderOf(roster)).toEqual(['top', 'jungle', 'mid', 'adc', 'support', 'bench']);
    // Two in one seat keep the roster order, and a seat nobody knows sorts last.
    expect(rosterOrderOf([{ name: 'b', role: 'Mid' }, { name: 'x', role: 'Coach' }, { name: 'a', role: 'Mid' }])).toEqual(['b', 'a', 'x']);
  });

  it('reads the Riot figures when any Riot game is selected, and the replay figures otherwise', () => {
    expect(patternSourceOf([scrim, flex])).toBe('riot');
    expect(patternSourceOf([scrim, tournament])).toBe('replay');
    expect(patternSourceOf([])).toBe('replay');
  });

  it('hands Home the selection with the roster order and the source the tab passes to workOn', () => {
    const inputs = patternInputs(all, { ...DEFAULT_PATTERN_FILTERS, source: 'scrimClash' }, ctx);
    expect(ids(inputs.games)).toEqual(ids([clash, scrim]));
    expect(inputs.roster).toEqual(['top', 'jungle', 'mid', 'adc', 'support', 'bench']);
    expect(inputs.source).toBe('riot'); // the Clash game is a Riot game
    expect(patternInputs(all, { ...DEFAULT_PATTERN_FILTERS, source: 'tournament' }, ctx).source).toBe('replay');
  });

  it('counts the replays imported against a tournament game, and never the scrims group or a game with no replay', () => {
    const tournaments = [{ id: 'cup', kind: 'tournament' }, { id: 'scrims', kind: 'scrims' }] as unknown as Tournament[];
    const series = [{ id: 's-cup', tournamentId: 'cup' }, { id: 's-scrim', tournamentId: 'scrims' }] as unknown as TournamentSeries[];
    const seriesGames = [
      { seriesId: 's-cup', matchId: 'scrim-104' },
      { seriesId: 's-cup' },
      { seriesId: 's-scrim', matchId: 'scrim-103' }
    ] as unknown as SeriesGame[];
    expect([...tournamentMatchIds(tournaments, series, seriesGames)]).toEqual(['scrim-104']);
    // Before a scrims group exists, every series belongs to a tournament.
    expect([...tournamentMatchIds([], series, seriesGames)]).toEqual(['scrim-104', 'scrim-103']);
  });
});

/**
 * The data audit of 14 Sep 2026, each case built on the figures the team's own data printed.
 */
describe('one gap, one column', () => {
  /**
   * The default Patterns view as the snapshot read it: 13 wins and 12 losses where plates (12.3 against 4
   * credited per player), solo kills (8.4 against 5), towers (9.2 against 2.5), deaths (28.2 against 43.3),
   * dragons (2.6 against 0.6) and barons (1.2 against 0.2) all clear their gap.
   */
  const defaultView = () => {
    const games: AnalysisGame[] = [];
    const side = (win: boolean) =>
      game(
        win,
        {
          objectives: {
            ours: { firstBlood: false, firstTower: false, dragons: win ? 2.6 : 0.6, barons: win ? 1.2 : 0.2, heralds: 0, grubs: 0, towers: win ? 9.2 : 2.5, inhibitors: 0 },
            theirs: { firstBlood: false, firstTower: false, dragons: 1, barons: 0, heralds: 0, grubs: 0, towers: 3, inhibitors: 0 }
          }
        },
        () => ({ deaths: win ? 5.64 : 8.66, facts: { plates: win ? 12.3 : 4, soloKills: win ? 1.68 : 1 } })
      );
    for (let i = 0; i < 13; i += 1) games.push(side(true));
    for (let i = 0; i < 12; i += 1) games.push(side(false));
    return games;
  };

  it('fired plates, solo kills and towers in both columns before, and keeps each in Work on now', () => {
    const games = defaultView();
    const work = workOn(games);
    expect(work.map((a) => a.key)).toEqual(['plates', 'deaths', 'solo', 'towers']);
    // Without the exclusion the same three gaps were printed as strengths as well.
    const both = keepDoing(games).map((a) => a.key);
    expect(both).toEqual(expect.arrayContaining(['plates', 'solo', 'towers']));
    const keep = keepDoing(games, 'seat', [], 'riot', adviceTopics(work));
    expect(keep.map((a) => a.key)).toEqual(['dragons', 'barons']);
    expect(keep.some((a) => work.some((w) => w.key === a.key))).toBe(false);
  });

  it('drops the excluded subjects before the cap of four, so what is left can still fill the column', () => {
    const games = defaultView();
    // Barons are fifth without the exclusion and cut; with it they are in.
    expect(keepDoing(games).map((a) => a.key)).not.toContain('barons');
    expect(keepDoing(games, 'seat', [], 'riot', new Set(['plates', 'solo', 'towers'])).map((a) => a.key)).toContain('barons');
  });

  it('treats both vision rules as one subject', () => {
    expect(adviceTopic('visionScore')).toBe('vision');
    expect([...adviceTopics([{ key: 'visionScore' }, { key: 'lane-top' }])]).toEqual(['vision', 'lane-top']);
    const visionBoth = botLaneStory(8, (win) => ({ facts: { visionPerMin: win ? 2.0 : 1.0 }, visionScore: win ? 40 : 18 }));
    const keep = keepDoing(visionBoth, 'seat', [], 'riot', adviceTopics(workOn(visionBoth)));
    expect(keep.some((a) => a.key === 'vision' || a.key === 'visionScore')).toBe(false);
  });

  it('says plates are credits, not plates destroyed', () => {
    const games = defaultView();
    expect(workOn(games).find((a) => a.key === 'plates')!.strong).toBe('12.3 turret plates credited per player in wins, 4 in losses');
    expect(keepDoing(games).find((a) => a.key === 'plates')!.strong).toBe('12.3 turret plates credited per player in wins');
    expect(teamSplits(games).find((m) => m.key === 'plates')!.label).toBe('Turret plates credited per player');
  });
});

describe('the lane line in Work on', () => {
  /** RULUKUKULUKU in the Custom view: lane lost in 7 of 8 losses at -206 gold/min, the eighth even. */
  const topStory = () => {
    const games: AnalysisGame[] = [];
    const lane = (verdict: 'won' | 'lost' | 'even', gold: number, cs: number) => (role: string) =>
      role === 'Top' ? { lane: { position: 'Top', theirChampion: 'Y', verdict, goldPerMinDiff: gold, csAt10Diff: cs } } : {};
    for (let i = 0; i < 7; i += 1) games.push(game(false, { date: i }, lane('lost', -206, -26.4)));
    games.push(game(false, { date: 7 }, lane('even', 40, 10)));
    for (let i = 0; i < 7; i += 1) games.push(game(true, { date: 10 + i }, lane('won', 60, 8)));
    for (let i = 0; i < 2; i += 1) games.push(game(true, { date: 20 + i }, lane('lost', -90, -5)));
    return games;
  };

  it('prints the deficit over the losses where the lane was lost, not over every loss', () => {
    const line = workOn(topStory()).find((a) => a.key === 'lane-Top')!;
    expect(line.strong).toBe('Top loses lane in 7 of 8 losses');
    // Over all eight losses the same line read -175 gold/min and -21.8 cs.
    expect(line.rest).toContain('-206 gold/min, -26.4 cs at 10 in those losses');
  });

  it('shows the games the figure is over: the losses with the lane lost, and no win', () => {
    const line = workOn(topStory()).find((a) => a.key === 'lane-Top')!;
    expect(line.evidence!.length).toBe(7);
    expect(line.evidence!.every((e) => !e.win && e.value === -206)).toBe(true);
    const kept = keepDoing(topStory()).find((a) => a.key === 'lane-Top');
    if (kept) expect(kept.evidence!.every((e) => e.win)).toBe(true);
  });
});

describe('figures that add the five up', () => {
  it('leave out a game with only four of ours on record', () => {
    const four = (win: boolean) => ({ ...game(win, {}, () => ({ deaths: 2, facts: { soloKills: 1, controlWards: 1 } })), players: five(() => ({ deaths: 2, facts: { soloKills: 1, controlWards: 1 } })).slice(0, 4) });
    const games = [game(true, {}, () => ({ deaths: 1, facts: { soloKills: 2, controlWards: 3 } })), game(false, {}, () => ({ deaths: 8, facts: { soloKills: 0, controlWards: 1 } })), four(true), four(false)];
    expect(hasFullFive(games[0])).toBe(true);
    expect(hasFullFive(games[2])).toBe(false);
    const m = new Map(teamSplits(games).map((x) => [x.key, x.split]));
    expect(m.get('deaths')).toMatchObject({ wins: { mean: 5, n: 1 }, losses: { mean: 40, n: 1 } });
    expect(m.get('soloKills')).toMatchObject({ wins: { mean: 10, n: 1 }, losses: { mean: 0, n: 1 } });
    expect(m.get('controlWards')).toMatchObject({ wins: { mean: 15, n: 1 }, losses: { mean: 5, n: 1 } });
    // A per-player figure is still a fair read of four.
    expect(m.get('killShare')!.wins.n).toBe(2);
  });
});

describe('KDA', () => {
  it('is the Roster’s: kills and assists over deaths summed over the games, printed to one decimal', () => {
    // 12/0/10 and 1/5/1: a mean of the two ratios is 11.2, the Roster's sum is 24 over 5.
    const games = [game(true, {}, (role) => (role === 'ADC' ? { kills: 12, deaths: 0, assists: 10 } : {})), game(false, {}, (role) => (role === 'ADC' ? { kills: 1, deaths: 5, assists: 1 } : {}))];
    const kda = playerSplits(games, 1).find((r) => r.name === 'adc')!.metrics.find((m) => m.key === 'kda')!;
    expect(kda.unit).toBe('ratio');
    expect(kda.split.all).toEqual({ mean: 4.8, n: 2 });
    expect(kda.split.wins).toEqual({ mean: 22, n: 1 });
    expect(kda.split.losses).toEqual({ mean: 0.4, n: 1 });
    expect(formatSide(kda.split.all, kda.unit)).toBe('4.8');
    expect(formatSide({ mean: 4, n: 3 }, 'ratio')).toBe('4.0');
    expect(laneTotals(games, ['adc']).find((r) => r.key === 'adc')!.kda.all).toEqual({ mean: 4.8, n: 2 });
  });

  it('divides by one at least when nobody died', () => {
    expect(ratioSplit([game(true)], () => ({ num: 7, den: 0 })).wins).toEqual({ mean: 7, n: 1 });
  });
});

describe('practice games left out, per source', () => {
  it('counts the tagged games of the source picked, not every tagged game', () => {
    const tagged = [game(true, { matchId: 'EUW1-1' }), game(false, { matchId: 'EUW1-2' })];
    const scrims = [game(true, { matchId: 'scrim-1', queue: 'Scrim', laneData: 'none' }), game(false, { matchId: 'scrim-2', queue: 'Scrim', laneData: 'none' })];
    const practice = new Set(['EUW1-1', 'EUW1-2']);
    const all = [...tagged, ...scrims];
    expect(practiceInSource(all, practice, 'flex', new Set())).toBe(2);
    expect(practiceInSource(all, practice, 'scrimClash', new Set())).toBe(0);
    expect(practiceInSource(all, practice, 'tournament', new Set(['scrim-2']))).toBe(0);
    expect(practiceInSource(all, new Set(['scrim-2']), 'tournament', new Set(['scrim-2']))).toBe(1);
  });
});

describe('a player with the main five', () => {
  const starters = ['top', 'jungle', 'mid', 'adc', 'support'];

  it('leaves out practice, a sub game and another queue', () => {
    const played = game(true, { matchId: 'EUW1-1' });
    const practiced = game(true, { matchId: 'EUW1-2' });
    const clash = game(false, { matchId: 'EUW1-3', queue: 'Clash' });
    const subbed = game(false, { matchId: 'EUW1-4' }, (role) => (role === 'Mid' || role === 'Jungle' ? { name: `bench-${role}` } : {}));
    const games = [played, practiced, clash, subbed];
    expect(gamesWithTheFive(games, 'adc', starters, 'Flex', new Set(['EUW1-2'])).map((g) => g.matchId)).toEqual(['EUW1-1']);
    expect(gamesWithTheFive(games, 'adc', starters, null, new Set(['EUW1-2'])).map((g) => g.matchId)).toEqual(['EUW1-1', 'EUW1-3']);
    // Fewer than five starters named: nothing is asked of the others.
    expect(gamesWithTheFive(games, 'adc', ['adc'], 'Flex', new Set()).map((g) => g.matchId)).toEqual(['EUW1-1', 'EUW1-2', 'EUW1-4']);
  });

  it('counts one champion under both of its spellings', () => {
    expect(championKey('FiddleSticks')).toBe(championKey('Fiddlesticks'));
    const games = [game(true, {}, (role) => (role === 'Top' ? { champion: 'FiddleSticks' } : {})), game(false, {}, (role) => (role === 'Top' ? { champion: 'Fiddlesticks' } : {}))];
    expect(playerSplits(games, 1).find((r) => r.name === 'top')!.champions).toEqual([{ champion: 'FiddleSticks', games: 2, wins: 1 }]);
  });
});

describe('remakes and missing replays on Patterns (14 Sep 2026)', () => {
  const g = (matchId: string, durationSec: number) => ({ matchId, durationSec, queue: 'Flex', players: [] }) as unknown as AnalysisGame;

  it('leaves out a game under ten minutes and keeps one whose length is unknown', () => {
    expect(withoutRemakes([g('a', 162), g('b', 600), g('c', 0), g('d', 1800)]).map((x) => x.matchId)).toEqual(['b', 'c', 'd']);
  });

  it('lists a result with no replay only under the source its series belongs to', () => {
    const series = [
      { id: 's1', tournamentId: 'oryx', opponent: 'MAD Synergy' },
      { id: 's2', tournamentId: 'scrims', opponent: 'MOSS' }
    ] as unknown as TournamentSeries[];
    const games = [
      { id: 'g1', seriesId: 's1', gameNumber: 1, win: true },
      { id: 'g2', seriesId: 's2', gameNumber: 2, win: false },
      { id: 'g3', seriesId: 's1', gameNumber: 2, win: false, matchId: 'EUW1-1' }
    ] as unknown as SeriesGame[];
    // Grouped the way the app groups them: the scrims group by its kind, every other group a tournament. (The set the
    // component holds for sources is of MATCH ids, which is what the first version wrongly compared against.)
    const groups = [{ id: 'oryx', kind: 'tournament' }, { id: 'scrims', kind: 'scrims' }] as unknown as Tournament[];
    expect(missingReplaysFor(games, series, groups, 'tournament')).toEqual([{ id: 'g1', label: 'MAD Synergy game 1' }]);
    expect(missingReplaysFor(games, series, groups, 'scrimClash')).toEqual([{ id: 'g2', label: 'MOSS game 2' }]);
    expect(missingReplaysFor(games, series, groups, 'flex')).toEqual([]);
  });

  it('never lists a rehearsal in a sandbox series as a missing replay (17 Sep 2026)', () => {
    const series = [
      { id: 's1', tournamentId: 'oryx', opponent: 'MAD Synergy' },
      { id: 'test', tournamentId: 'oryx', opponent: 'test', sandbox: true }
    ] as unknown as TournamentSeries[];
    const games = [
      { id: 'g1', seriesId: 's1', gameNumber: 1, win: true },
      { id: 't1', seriesId: 'test', gameNumber: 1, win: false }
    ] as unknown as SeriesGame[];
    const groups = [{ id: 'oryx', kind: 'tournament' }] as unknown as Tournament[];
    expect(missingReplaysFor(games, series, groups, 'tournament')).toEqual([{ id: 'g1', label: 'MAD Synergy game 1' }]);
  });
});
