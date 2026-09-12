import { describe, expect, it } from 'vitest';
import { AnalysisGame, AnalysisPlayer } from '../../models/team.models';
import { DEFAULT_PATTERN_FILTERS, gameSource, keepDoing, killParticipationOf, laneTable, laneTotals, PatternFilters, playerSplits, readPatternFilters, roleFit, sourceOf, split, starterCount, teamSplits, workOn } from './win-loss-splits';

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
