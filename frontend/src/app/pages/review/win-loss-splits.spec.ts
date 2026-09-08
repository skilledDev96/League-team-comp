import { describe, expect, it } from 'vitest';
import { AnalysisGame, AnalysisPlayer } from '../../models/team.models';
import { keepDoing, killParticipationOf, laneTable, playerSplits, split, teamSplits, workOn } from './win-loss-splits';

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

describe('split', () => {
  it('means each side over the games that carry the number and leaves the gap off with an empty side', () => {
    const games = [game(true), game(true), game(false)];
    const s = split(games, (g) => g.kills!.ours, 1);
    expect(s).toEqual({ wins: { mean: 20, n: 2 }, losses: { mean: 8, n: 1 }, gap: 12 });
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
      game(false, { laneData: 'none' }),
      game(false, { laneData: 'riot' })
    ];
    const t = laneTable(games);
    const bot = t.rows.find((r) => r.role === 'ADC')!;
    expect(bot.lostInLosses).toEqual({ games: 2, n: 2, share: 100 });
    expect(bot.wonInWins).toEqual({ games: 2, n: 2, share: 100 });
    expect(bot.goldDiff.losses.mean).toBe(-45);
    expect(t.rows.find((r) => r.role === 'Top')!.lostInLosses).toEqual({ games: 0, n: 2, share: 0 });
    expect(t.skipped).toBe(1);
    expect(t.waiting).toBe(1);
  });
});

describe('teamSplits', () => {
  it('reports n per side and the gap sign, and leaves a metric empty when no game carries it', () => {
    const m = new Map(teamSplits([game(true), game(false)]).map((x) => [x.key, x]));
    expect(m.get('dragons')!.split).toEqual({ wins: { mean: 3, n: 1 }, losses: { mean: 1, n: 1 }, gap: 2 });
    expect(m.get('killShare')!.split.gap).toBe(0.42); // means rounded first, then the gap
    expect(m.get('vision')!.split).toEqual({ wins: { mean: 0, n: 0 }, losses: { mean: 0, n: 0 } });
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
    expect(adc.metrics.find((m) => m.key === 'deaths')!.split).toEqual({ wins: { mean: 1, n: 2 }, losses: { mean: 5, n: 2 }, gap: -4 });
    expect(adc.metrics.find((m) => m.key === 'goldDiff')!.split.losses.mean).toBe(-45);
    expect(playerSplits(games.filter((g) => g.win))[0].metrics[0].split.losses.n).toBe(0);
  });
});
