import { describe, expect, it } from 'vitest';
import { AnalysisGameLike, compareCurve, endOfGameFacts, gameFacts, MAX_LINES } from './game-facts';
import { MatchTimeline } from './timeline-features';

function timeline(over: Partial<MatchTimeline> = {}): MatchTimeline {
  return {
    matchId: 'EUW1_1',
    timelineVersion: 1,
    builtAt: 'now',
    ourSide: 'blue',
    durationSec: 1860,
    frameSec: 60,
    goldDiff: [],
    curve: { at10: 1500, at15: 2500, at20: 4000, at25: 6000, leadAt: {}, biggestLead: { gold: 6200, minute: 28 }, biggestDeficit: { gold: -200, minute: 3 } },
    lanes: [
      { seat: 'Top', name: 'Ruan', champion: 'Ornn', theirChampion: 'Darius', at10: { gold: 800, xp: 300, cs: 12 } },
      { seat: 'Mid', name: 'Dan', champion: 'Ahri', theirChampion: 'Syndra', at10: { gold: -900, xp: -200, cs: -10 }, flippedAt: 7 },
      { seat: 'ADC', champion: 'Jinx', theirChampion: 'Kaisa', at10: { gold: 100, xp: 0, cs: 1 } }
    ],
    firsts: { blood: { minute: 4, side: 'us' } },
    objectives: [],
    plates: { ours: { top: 0, mid: 0, bot: 0 }, theirs: { top: 0, mid: 0, bot: 0 } },
    deaths: [],
    theirDeaths: [],
    vision: [],
    spend: [],
    bytes: 0,
    ...over
  };
}

const game = (over: Partial<AnalysisGameLike> = {}): AnalysisGameLike => ({
  win: true,
  durationSec: 1860,
  side: 'blue',
  queue: 'Flex',
  players: [
    { name: 'Ruan', position: 'Top', champion: 'Ornn', deaths: 2 },
    { name: 'Dan', position: 'Mid', champion: 'Ahri', deaths: 4, lane: { position: 'Mid', theirChampion: 'Syndra', verdict: 'even' } },
    { name: 'Sam', position: 'ADC', champion: 'Jinx', deaths: 1 }
  ],
  ...over
});

describe('gameFacts', () => {
  it('names the shape of the curve for each outcome', () => {
    const shape = (win: boolean, peak: number, worst: number) =>
      gameFacts(timeline({ curve: { leadAt: {}, biggestLead: { gold: peak, minute: 20 }, biggestDeficit: { gold: worst, minute: 5 } } }), game({ win })).curve.shape;
    expect(shape(true, 6200, -200)).toBe('led throughout');
    expect(shape(false, 300, -5000)).toBe('trailed throughout');
    expect(shape(true, 4000, -3500)).toBe('came back');
    expect(shape(false, 4100, -6000)).toBe('threw');
    expect(shape(true, 1500, -1500)).toBe('swung');
    expect(shape(false, 400, -600)).toBe('even');
  });

  it('opens with the result line, in words that name the minute', () => {
    const f = gameFacts(timeline(), game());
    expect(f.lines[0]).toBe('Won in 31 minutes, ahead all game: the biggest lead was 6.2k at 28.');
    const threw = gameFacts(timeline({ curve: { leadAt: {}, biggestLead: { gold: 4100, minute: 18 }, biggestDeficit: { gold: -6000, minute: 33 } } }), game({ win: false }));
    expect(threw.lines[0]).toBe('Lost in 31 minutes after leading by 4.1k at 18: a throw.');
  });

  it('reads the lanes from Riot when it has a verdict, else from the gold at ten', () => {
    const f = gameFacts(timeline(), game());
    expect(f.lanes.map((l) => [l.seat, l.verdict])).toEqual([
      ['Top', 'won'],
      ['Mid', 'even'],
      ['ADC', 'even']
    ]);
    expect(f.lanes[0].line).toBe('Ruan (Top) on Ornn won the lane into Darius up 800 at ten.');
    expect(f.lanes[1].line).toBe('Dan (Mid) on Ahri went even in the lane into Syndra down 900 at ten, and the lead changed hands at 7.');
    expect(f.lanes[2].name).toBeUndefined();
    expect(f.lanes[2].line).toContain('Sam (ADC)');
  });

  it('groups deaths into fights by time and place, and names who fell', () => {
    const t = timeline({
      deaths: [
        { sec: 840, minute: 14, seat: 'Top', zone: 'theirJungle', theirSide: true, killers: 3, executed: false, warded: false },
        { sec: 860, minute: 14, seat: 'Mid', zone: 'theirJungle', theirSide: true, killers: 2, executed: false, warded: false },
        { sec: 884, minute: 15, seat: 'ADC', zone: 'theirJungle', theirSide: true, killers: 2, executed: false, warded: true },
        { sec: 1500, minute: 25, seat: 'Top', zone: 'top', theirSide: false, killers: 1, executed: false, warded: false }
      ],
      theirDeaths: [
        { sec: 850, minute: 14, zone: 'theirJungle' },
        { sec: 930, minute: 16, zone: 'theirJungle' },
        { sec: 1200, minute: 20, zone: 'river' },
        { sec: 1210, minute: 20, zone: 'river' }
      ]
    });
    const f = gameFacts(t, game({ win: false }));
    expect(f.deathClusters).toHaveLength(2);
    expect(f.deathClusters[0]).toMatchObject({ fromMinute: 14, toMinute: 15, zone: 'theirJungle', ours: 3, theirs: 1, seats: ['Top', 'Mid', 'ADC'] });
    expect(f.deathClusters[0].line).toBe('Minutes 14–15, their jungle: a fight went 1 for 3 — Top, Mid and ADC fell.');
    expect(f.deathClusters[1]).toMatchObject({ zone: 'river', ours: 0, theirs: 2 });
    expect(f.deathClusters[1].line).toBe('Minute 20, the river: a fight went we took 2 for nothing.');
    // A death 46 seconds after the last one is its own event.
    expect(f.soloDeaths).toHaveLength(1);
    expect(f.soloDeaths[0].line).toBe('Minute 25: Ruan (Top) died alone in top lane, one-on-one.');
  });

  it('splits a cluster at the forty-five second boundary and at a zone change', () => {
    const t = timeline({
      deaths: [
        { sec: 600, minute: 10, seat: 'Top', zone: 'river', theirSide: false, killers: 2, executed: false, warded: false },
        { sec: 644, minute: 11, seat: 'Mid', zone: 'river', theirSide: false, killers: 2, executed: false, warded: false },
        { sec: 690, minute: 12, seat: 'ADC', zone: 'river', theirSide: false, killers: 2, executed: false, warded: false },
        { sec: 700, minute: 12, seat: 'Support', zone: 'mid', theirSide: false, killers: 2, executed: false, warded: false }
      ]
    });
    const f = gameFacts(t, game());
    expect(f.deathClusters.map((c) => c.ours)).toEqual([2]);
  });

  it('classifies objectives given up as uncontested, contested or traded', () => {
    const t = timeline({
      objectives: [
        { minute: 8, type: 'dragon', subType: 'infernal', side: 'them', ourInvolved: [], ourNear: [] },
        { minute: 20, type: 'baron', side: 'them', ourInvolved: [], ourNear: ['Top', 'Mid', 'ADC', 'Support'] },
        { minute: 26, type: 'dragon', side: 'them', ourInvolved: [], ourNear: ['Jungle'] },
        { minute: 27, type: 'herald', side: 'us', ourInvolved: ['Jungle', 'Top'], ourNear: ['Jungle', 'Top'] }
      ]
    });
    const f = gameFacts(t, game());
    expect(f.objectives.map((o) => o.setup)).toEqual(['uncontested', 'contested', 'traded', 'taken']);
    expect(f.objectives[0].line).toBe('Minute 8: their dragon (infernal), nobody of ours near.');
    expect(f.objectives[1].line).toBe('Minute 20: their baron, contested with 4 of ours near.');
    expect(f.objectives[3].line).toBe('Minute 27: our herald — Jungle and Top on it.');
  });

  it('reads vision per seat with the deaths in the dark, and caps and orders the lines', () => {
    const t = timeline({
      vision: [{ seat: 'Support', placed: [3, 4, 2], killed: [0, 1, 0] }],
      deaths: [
        { sec: 300, minute: 5, seat: 'Support', zone: 'river', theirSide: false, killers: 1, executed: false, warded: false },
        { sec: 900, minute: 15, seat: 'Support', zone: 'bot', theirSide: true, killers: 2, executed: false, warded: false },
        { sec: 1200, minute: 20, seat: 'Support', zone: 'bot', theirSide: true, killers: 3, executed: false, warded: false }
      ]
    });
    const f = gameFacts(t, game({ players: [...game().players, { name: 'Sup', position: 'Support', champion: 'Lulu', deaths: 3 }] }));
    // The one-on-one death at 5 is not dark; the two to a pair and a trio with no ward nearby are.
    expect(f.vision[0]).toMatchObject({ seat: 'Support', name: 'Sup', darkDeaths: 2 });
    expect(f.vision[0].line).toBe('Sup (Support) placed 3, 4, 2 wards per five minutes; 2 of 3 deaths had no ward nearby.');
    expect(f.lines.length).toBeLessThanOrEqual(MAX_LINES);
    expect(f.lines[0]).toMatch(/^Won in/);
    expect(f.lines[f.lines.length - 1]).toBe(f.vision[0].line);
    expect(f.lines.some((l) => l.includes('died alone'))).toBe(true);
  });

  it('never counts a solo death or an execution against a seat\'s vision, and says one-on-one on the solo line', () => {
    // 10 Sep 2026: a ward does not stop a one-on-one death, so it is a wave-state or trade choice and no evidence about vision.
    const t = timeline({
      vision: [{ seat: 'Top', placed: [1, 1, 1], killed: [0, 0, 0] }],
      deaths: [
        { sec: 300, minute: 5, seat: 'Top', zone: 'top', theirSide: false, killers: 1, executed: false, warded: false },
        { sec: 600, minute: 10, seat: 'Top', zone: 'top', theirSide: false, killers: 1, executed: false, warded: false },
        { sec: 900, minute: 15, seat: 'Top', zone: 'top', theirSide: false, killers: 0, executed: true, warded: false },
        { sec: 1500, minute: 25, seat: 'Top', zone: 'theirJungle', theirSide: true, killers: 1, executed: false, warded: true }
      ]
    });
    const f = gameFacts(t, game({ win: false }));
    expect(f.vision[0]).toMatchObject({ seat: 'Top', darkDeaths: 0 });
    expect(f.vision[0].line).toBe('Ruan (Top) placed 1, 1, 1 wards per five minutes; 0 of 4 deaths had no ward nearby.');
    // The ledger agrees, as it always has: no solo death carries the ward tag.
    expect(f.ledger!.every((d) => !d.could.includes('ward'))).toBe(true);
    expect(f.soloDeaths.map((d) => d.line)).toEqual([
      'Minute 5: Ruan (Top) died alone in top lane, one-on-one.',
      'Minute 10: Ruan (Top) died alone in top lane, one-on-one.',
      'Minute 15: Ruan (Top) died alone in top lane to a tower or a monster.',
      'Minute 25: Ruan (Top) died alone in their jungle, one-on-one.'
    ]);
    expect(f.soloDeaths.map((d) => d.line).join(' ')).not.toMatch(/ward/);
    // One death to a pair with no ward nearby is dark; the solo deaths beside it still are not.
    const pair = gameFacts(timeline({ ...t, deaths: [...t.deaths, { sec: 1700, minute: 28, seat: 'Top', zone: 'river', theirSide: false, killers: 2, executed: false, warded: false }] }), game({ win: false }));
    expect(pair.vision[0]).toMatchObject({ darkDeaths: 1 });
    expect(pair.vision[0].line).toContain('1 of 5 deaths had no ward nearby');
  });

  it('says a laner killed by their jungler alone died to their jungler, never one-on-one, so the solo line agrees with the ledger\'s gank', () => {
    // 10 Sep 2026, second fix pass: one killer who was their jungler is a gank the ledger already calls one; "one-on-one" would have
    // read as the lane opponent and told the model to withhold the ward advice exactly where a ward was the answer.
    const t = timeline({
      vision: [{ seat: 'Top', placed: [1, 1, 1], killed: [0, 0, 0] }],
      deaths: [
        { sec: 420, minute: 7, seat: 'Top', zone: 'top', theirSide: false, killers: 1, executed: false, warded: false, theirJungleIn: true },
        { sec: 900, minute: 15, seat: 'Top', zone: 'top', theirSide: false, killers: 1, executed: false, warded: false, theirJungleIn: false }
      ]
    });
    const f = gameFacts(t, game({ win: false }));
    expect(f.soloDeaths.map((d) => d.line)).toEqual([
      'Minute 7: Ruan (Top) died alone in top lane to their jungler alone.',
      'Minute 15: Ruan (Top) died alone in top lane, one-on-one.'
    ]);
    expect(f.ledger![0]).toMatchObject({ minute: 7, how: 'gank' });
    expect(f.ledger![1]).toMatchObject({ minute: 15, how: 'solo' });
    // The vision count keeps the ledger's bar (two or more killers) for the ward tag, so the gank by one is not dark either.
    expect(f.vision[0]).toMatchObject({ darkDeaths: 0 });
  });
});

describe('the death ledger', () => {
  it('writes a verdict per death: how it happened and what would have stopped it', () => {
    const t = timeline({
      deaths: [
        { sec: 420, minute: 7, seat: 'Top', zone: 'top', theirSide: false, killers: 2, executed: false, warded: false, theirJungleIn: true, ourJungleDist: 3200, ourJungleZone: 'ourJungle', theirJungleDistBefore: 1400, alliesNear: 0, objectiveNear: false },
        { sec: 540, minute: 9, seat: 'Mid', zone: 'mid', theirSide: false, killers: 0, executed: true, warded: false, theirJungleIn: false, ourJungleDist: 1000, ourJungleZone: 'mid', alliesNear: 1, objectiveNear: false },
        { sec: 1200, minute: 20, seat: 'ADC', zone: 'theirJungle', theirSide: true, killers: 4, executed: false, warded: true, theirJungleIn: true, ourJungleDist: 8000, ourJungleZone: 'ourJungle', alliesNear: 0, objectiveNear: false },
        { sec: 1500, minute: 25, seat: 'Mid', zone: 'theirJungle', theirSide: true, killers: 1, executed: false, warded: false, theirJungleIn: false, ourJungleDist: 2000, ourJungleZone: 'river', alliesNear: 0, objectiveNear: true }
      ]
    });
    const f = gameFacts(t, game({ win: false }));
    expect(f.ledger!.map((d) => d.how)).toEqual(['gank', 'executed', 'fight', 'solo']);
    expect(f.ledger!.map((d) => d.could)).toEqual([['jungle', 'ward', 'call'], [], ['position'], ['position']]);
    expect(f.ledger![0].line).toBe(
      'Around minute 7: Ruan (Top) died to a gank with their jungler on it in top lane — no ward nearby; their jungler was already close a minute before; our jungler was 3.2k away in our jungle.'
    );
    expect(f.ledger![1].line).toBe('Around minute 9: Dan (Mid) died to a tower or a monster in mid lane.');
    expect(f.ledger![3].line).toBe('Around minute 25: Dan (Mid) died to one of them in their jungle — alone on their side of the map.');
    expect(f.ledgerSummary).toEqual({ deaths: 4, ganks: 1, dark: 1, inReach: 1, alone: 2 });
    expect(f.lines[1]).toBe('4 deaths: 1 to a gank, 1 with no ward nearby, 1 with our jungler a screen away, 2 alone on their side.');
  });

  it('tags nothing on a version-one death, and counts the jungler on our kills', () => {
    const t = timeline({
      deaths: [{ sec: 420, minute: 7, seat: 'Top', zone: 'top', theirSide: false, killers: 2, executed: false, warded: true }],
      theirDeaths: [
        { sec: 300, minute: 5, zone: 'top', ourInvolved: ['Top', 'Jungle'] },
        { sec: 600, minute: 10, zone: 'bot', ourInvolved: ['ADC', 'Support'] },
        { sec: 1200, minute: 20, zone: 'river', ourInvolved: ['Jungle', 'Mid'] }
      ]
    });
    const f = gameFacts(t, game());
    expect(f.ledger![0]).toMatchObject({ how: 'solo', could: [] });
    expect(f.presence).toMatchObject({ kills: 2, ofKills: 3, before15: 1, ofBefore15: 2 });
    expect(f.presence!.line).toBe('Jungle was on 2 of 3 kills, 1 of 2 before fifteen.');
    expect(f.lines[2]).toBe(f.presence!.line);
    expect(gameFacts(timeline(), game()).presence).toBeUndefined();
    expect(gameFacts(timeline(), game()).ledger).toEqual([]);
  });
});

describe('endOfGameFacts', () => {
  it('says what a replay can, and labels the rest as totals only', () => {
    const f = endOfGameFacts(
      game({
        queue: 'Scrim',
        win: false,
        durationSec: 2000,
        objectives: {
          ours: { firstBlood: false, firstTower: false, dragons: 1, barons: 0, heralds: 0, grubs: 3, towers: 4, inhibitors: 0 },
          theirs: { firstBlood: false, firstTower: false, dragons: 3, barons: 1, heralds: 1, grubs: 3, towers: 9, inhibitors: 2 }
        },
        kills: { ours: 12, theirs: 25 },
        lossFactors: [{ label: 'Lost the fights', detail: '12 kills to 25' }]
      })
    );
    expect(f.tier).toBe('endOfGame');
    expect(f.curve.shape).toBe('unknown');
    expect(f.lines[0]).toBe('Lost in 33 minutes. Totals only, from the replay: no minute-by-minute figures.');
    expect(f.lines[1]).toBe('Dragons 1–3, towers 4–9, barons 0–1, grubs 3–3.');
    expect(f.lines[2]).toBe('Kills 12–25.');
    expect(f.lines[3]).toBe('Dan (Mid) on Ahri went even in the lane into Syndra.');
    expect(f.lines[4]).toBe('Lost the fights: 12 kills to 25');
    expect(f.deathClusters).toEqual([]);
  });
});

describe('compareCurve (mirror of the frontend)', () => {
  const strongEarly = { early: 'high', scaling: 'low', objectives: 'mid', teamfight: 'mid' } as const;
  const scaler = { early: 'low', scaling: 'high', objectives: 'mid', teamfight: 'mid' } as const;

  it('matches the frontend spec line for line', () => {
    expect(compareCurve(strongEarly, { at10: -1200 })).toEqual(['Expected a strong early game, but was down 1.2k at ten.']);
    expect(compareCurve(strongEarly, { at10: 2500 })).toEqual(['The strong early game came: up 2.5k at ten.']);
    expect(compareCurve(scaler, { at10: -1500, at25: 3000 })).toEqual([
      'Down 1.5k at ten, which a slow-starting comp expects; the question is what came after.',
      'The scaling paid: up 3k at twenty-five.'
    ]);
    expect(compareCurve(scaler, { at25: -4000 })).toEqual(['Expected to scale, but was down 4k at twenty-five.']);
    expect(compareCurve(strongEarly, { at10: 400 })).toEqual([]);
    expect(compareCurve(null, { at10: -3000 })).toEqual([]);
  });
});
