import { describe, expect, it } from 'vitest';
import {
  buildMatchTimeline,
  CachedMatchLike,
  FrameLike,
  isTimelineCurrent,
  MAP_MAX,
  MAX_BYTES,
  RiotTimelineLike,
  TIMELINE_VERSION,
  TimelineEventLike,
  zoneOf
} from './timeline-features';

// ---- A ten-player game: 1–5 blue, 6–10 red, in Riot's seat order ------------

const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

function match(ourTeamId: 100 | 200 = 100): CachedMatchLike {
  return {
    durationSec: 1800,
    participants: Array.from({ length: 10 }, (_, i) => {
      const teamId = i < 5 ? 100 : 200;
      return { puuid: `p${i + 1}`, teamId, teamPosition: POSITIONS[i % 5], championName: `${teamId === ourTeamId ? 'Ours' : 'Theirs'}${i + 1}` };
    })
  };
}

const blueRoster = new Set(['p1', 'p2', 'p3', 'p4', 'p5']);
const redRoster = new Set(['p6', 'p7', 'p8', 'p9', 'p10']);
const names = new Map([
  ['p1', 'Top1'],
  ['p2', 'Jg1'],
  ['p3', 'Mid1'],
  ['p4', 'Adc1'],
  ['p5', 'Sup1'],
  ['p6', 'Top2'],
  ['p7', 'Jg2'],
  ['p8', 'Mid2'],
  ['p9', 'Adc2'],
  ['p10', 'Sup2']
]);

interface Fig {
  gold?: number;
  current?: number;
  xp?: number;
  cs?: number;
  x?: number;
  y?: number;
}

/** One frame at a minute: every participant gets a figure, overrides per pid. */
function frame(minute: number, per: Partial<Record<number, Fig>> = {}, events: TimelineEventLike[] = [], base: Fig = {}): FrameLike {
  const participantFrames: FrameLike['participantFrames'] = {};
  for (let pid = 1; pid <= 10; pid += 1) {
    const f = { gold: 500 + minute * 300, current: 200, xp: minute * 400, cs: minute * 7, x: 1000, y: 1000, ...base, ...(per[pid] ?? {}) };
    participantFrames[String(pid)] = {
      participantId: pid,
      totalGold: f.gold,
      currentGold: f.current,
      xp: f.xp,
      minionsKilled: f.cs,
      jungleMinionsKilled: 0,
      position: { x: f.x, y: f.y }
    };
  }
  return { timestamp: minute * 60_000, participantFrames, events: events.map((e) => ({ ...e, timestamp: e.timestamp ?? minute * 60_000 })) };
}

function timeline(frames: FrameLike[]): RiotTimelineLike {
  return { info: { frameInterval: 60_000, participants: Array.from({ length: 10 }, (_, i) => ({ participantId: i + 1, puuid: `p${i + 1}` })), frames } };
}

const kill = (killerId: number, victimId: number, x: number, y: number, assists: number[] = [], timestamp?: number): TimelineEventLike => ({
  type: 'CHAMPION_KILL',
  timestamp: timestamp as number,
  killerId,
  victimId,
  assistingParticipantIds: assists,
  position: { x, y }
});

const ward = (creatorId: number, wardType = 'YELLOW_TRINKET', timestamp?: number): TimelineEventLike => ({
  type: 'WARD_PLACED',
  timestamp: timestamp as number,
  creatorId,
  wardType
});

/** Events at a minute, stamped with it unless they carry their own time. */
function put(frames: FrameLike[], minute: number, events: TimelineEventLike[]): void {
  frames[minute].events = events.map((e) => ({ ...e, timestamp: e.timestamp ?? minute * 60_000 }));
}

function build(frames: FrameLike[], side: 100 | 200 = 100) {
  return buildMatchTimeline('EUW1_1', timeline(frames), match(side), side === 100 ? blueRoster : redRoster, names, '2026-09-08T00:00:00Z');
}

/** A plain twenty-minute game where blue leads by 200 a player a minute from minute one. */
function plainFrames(minutes = 20): FrameLike[] {
  return Array.from({ length: minutes + 1 }, (_, m) =>
    frame(m, { 1: { gold: 500 + m * 340 }, 2: { gold: 500 + m * 340 }, 3: { gold: 500 + m * 340 }, 4: { gold: 500 + m * 340 }, 5: { gold: 500 + m * 340 } })
  );
}

describe('zoneOf', () => {
  it('names the bases from our side', () => {
    expect(zoneOf(200, 200, 'blue')).toBe('ourBase');
    expect(zoneOf(200, 200, 'red')).toBe('theirBase');
    expect(zoneOf(14600, 14600, 'blue')).toBe('theirBase');
    expect(zoneOf(14600, 14600, 'red')).toBe('ourBase');
  });

  it('reads the lanes, the river and the jungles', () => {
    expect(zoneOf(7400, 7400, 'blue')).toBe('mid');
    expect(zoneOf(2000, 9000, 'blue')).toBe('top');
    expect(zoneOf(7000, 13500, 'blue')).toBe('top');
    expect(zoneOf(9800, 4400, 'blue')).toBe('river');
    expect(zoneOf(4000, 6000, 'blue')).toBe('ourJungle');
    expect(zoneOf(4000, 6000, 'red')).toBe('theirJungle');
    expect(zoneOf(11000, 8000, 'blue')).toBe('theirJungle');
    expect(zoneOf(10000, 9000, 'blue')).toBe('mid');
  });
});

describe('buildMatchTimeline', () => {
  it('reads the team gold curve from our side, and the marks at 10, 15 and 20', () => {
    const t = build(plainFrames())!;
    expect(t.ourSide).toBe('blue');
    expect(t.goldDiff[10]).toBe(2000);
    expect(t.curve.at10).toBe(2000);
    expect(t.curve.at15).toBe(3000);
    expect(t.curve.leadAt).toEqual({ '10': 'us', '15': 'us', '20': 'us' });
    expect(t.curve.at25).toBeUndefined();
    expect(t.curve.biggestLead).toEqual({ gold: 4000, minute: 20 });
    expect(t.curve.biggestDeficit).toEqual({ gold: 0, minute: 0 });
  });

  it('flips the sign when we are the red side', () => {
    const t = build(plainFrames(), 200)!;
    expect(t.ourSide).toBe('red');
    expect(t.curve.at10).toBe(-2000);
    expect(t.curve.leadAt['10']).toBe('them');
  });

  it('calls under a thousand gold even', () => {
    const frames = Array.from({ length: 11 }, (_, m) => frame(m, { 1: { gold: 500 + m * 300 + 40 * m } }));
    const t = build(frames)!;
    expect(t.curve.at10).toBe(400);
    expect(t.curve.leadAt['10']).toBe('even');
  });

  it('pairs each lane by seat, reads the diffs at 5, 10 and 15, and notes the last flip', () => {
    const frames = Array.from({ length: 16 }, (_, m) =>
      frame(m, {
        1: { gold: 500 + m * 300 + (m < 8 ? 200 : -300), xp: m * 400 + 100, cs: m * 7 + 5 }
      })
    );
    const t = build(frames)!;
    const top = t.lanes.find((l) => l.seat === 'Top')!;
    expect(top.name).toBe('Top1');
    expect(top.champion).toBe('Ours1');
    expect(top.theirChampion).toBe('Theirs6');
    expect(top.at5).toEqual({ gold: 200, xp: 100, cs: 5 });
    expect(top.at10).toEqual({ gold: -300, xp: 100, cs: 5 });
    expect(top.flippedAt).toBe(8);
    expect(t.lanes.map((l) => l.seat)).toEqual(['Top', 'Jungle', 'Mid', 'ADC', 'Support']);
  });

  it('leaves a lane out when their seat is missing, never a zero', () => {
    const m = match();
    m.participants[5].teamPosition = '';
    const t = buildMatchTimeline('EUW1_1', timeline(plainFrames()), m, blueRoster, names, 'now')!;
    expect(t.lanes.find((l) => l.seat === 'Top')).toBeUndefined();
    expect(t.lanes).toHaveLength(4);
  });

  it('records our deaths with the zone, the side of the map, the killers, and executes', () => {
    const frames = plainFrames(12);
    put(frames, 8, [kill(6, 1, 11000, 8000, [7]), kill(0, 3, 7400, 7400)]);
    const t = build(frames)!;
    expect(t.deaths).toHaveLength(2);
    expect(t.deaths[0]).toMatchObject({ minute: 8, seat: 'Top', zone: 'theirJungle', theirSide: true, killers: 2, executed: false, warded: false });
    expect(t.deaths[1]).toMatchObject({ seat: 'Mid', zone: 'mid', killers: 0, executed: true });
    expect(t.firsts.blood).toEqual({ minute: 8, side: 'them' });
  });

  it('counts their deaths by minute and zone, and which of our seats were on them', () => {
    const frames = plainFrames(12);
    put(frames, 6, [kill(1, 6, 2000, 9000, [2])]);
    const t = build(frames)!;
    expect(t.theirDeaths).toEqual([{ sec: 360, minute: 6, zone: 'top', ourInvolved: ['Top', 'Jungle'] }]);
    expect(t.firsts.blood).toEqual({ minute: 6, side: 'us' });
    expect(JSON.stringify(t)).not.toContain('Top2');
    expect(JSON.stringify(t)).not.toContain('p6');
  });

  it('reads a gank with their jungler on it, our jungler a screen away, and who stood near', () => {
    const frames = plainFrames(12);
    // Top dies in top lane at minute 8; our jungler is in our jungle 3.2k away, the support beside him;
    // their jungler was 1.4k from the spot a minute earlier.
    frames[8].participantFrames['2'].position = { x: 4000, y: 6500 };
    frames[8].participantFrames['5'].position = { x: 2200, y: 8800 };
    frames[7].participantFrames['7'].position = { x: 3000, y: 10000 };
    put(frames, 8, [kill(6, 1, 2000, 9000, [7])]);
    const t = build(frames)!;
    expect(t.deaths[0]).toMatchObject({
      seat: 'Top',
      zone: 'top',
      theirJungleIn: true,
      ourJungleDist: 3200,
      ourJungleZone: 'ourJungle',
      theirJungleDistBefore: 1400,
      alliesNear: 1,
      objectiveNear: false
    });
  });

  it('marks a death in the objective window, and reads no jungler distance when the jungler is the victim', () => {
    const frames = plainFrames(12);
    const at = (m: number, s: number) => m * 60_000 + s * 1000;
    put(frames, 10, [
      { type: 'ELITE_MONSTER_KILL', timestamp: at(10, 0), killerId: 7, killerTeamId: 200, monsterType: 'DRAGON', monsterSubType: 'INFERNAL_DRAGON', position: { x: 9800, y: 4400 } },
      kill(6, 2, 9900, 4500, [], at(10, 20)),
      kill(6, 3, 7400, 7400, [], at(11, 30))
    ]);
    const t = build(frames)!;
    expect(t.deaths[0]).toMatchObject({ seat: 'Jungle', objectiveNear: true, theirJungleIn: false, alliesNear: 0 });
    expect(t.deaths[0].ourJungleDist).toBeUndefined();
    expect(t.deaths[1]).toMatchObject({ seat: 'Mid', objectiveNear: false });
    expect(t.deaths[1].ourJungleDist).toBeGreaterThan(0);
  });

  it('buckets damage dealt and taken per five minutes, and leaves it empty without the figures', () => {
    const frames = plainFrames(12);
    expect(build(frames)!.damage).toEqual([]);
    for (const f of frames) {
      const m = f.timestamp / 60_000;
      f.participantFrames['1'].damageStats = { totalDamageDoneToChampions: m * 1000, totalDamageTaken: m * 500 };
    }
    const t = build(frames)!;
    expect(t.damage).toEqual([{ seat: 'Top', dealt: [5000, 5000, 2000], taken: [2500, 2500, 1000] }]);
  });

  it('reads a death as warded only when a ward went down nearby and recently', () => {
    const frames = plainFrames(12);
    // Our support at the dragon pit at minute 9 and 10.
    for (const f of frames) f.participantFrames['5'].position = { x: 9800, y: 4400 };
    const at = (m: number, s: number) => m * 60_000 + s * 1000;
    put(frames, 10, [ward(5, 'YELLOW_TRINKET', at(9, 40)), kill(6, 4, 9900, 4500, [], at(10, 0))]);
    put(frames, 12, [ward(5, 'YELLOW_TRINKET', at(8, 0)), kill(6, 4, 9900, 4500, [], at(12, 0))]);
    const t = build(frames)!;
    expect(t.deaths[0].warded).toBe(true);
    // The nearest ward is over two minutes old: a trinket ward has expired.
    expect(t.deaths[1].warded).toBe(false);
  });

  it('gives a control ward five minutes, and needs the placer to have been near', () => {
    const frames = plainFrames(12);
    for (const f of frames) f.participantFrames['5'].position = { x: 9800, y: 4400 };
    const at = (m: number, s: number) => m * 60_000 + s * 1000;
    put(frames, 10, [ward(5, 'CONTROL_WARD', at(6, 0)), kill(6, 4, 9900, 4500, [], at(10, 0)), kill(6, 1, 2000, 9000, [], at(10, 30))]);
    const t = build(frames)!;
    expect(t.deaths[0].warded).toBe(true);
    // The top death is across the map from where the support stood.
    expect(t.deaths[1].warded).toBe(false);
  });

  it('reads elite monsters with the side, the subtype, who was credited and who was near', () => {
    const frames = plainFrames(25);
    for (const f of frames) {
      f.participantFrames['2'].position = { x: 9500, y: 4800 };
      f.participantFrames['4'].position = { x: 1500, y: 5000 };
    }
    put(frames, 8, [{ type: 'ELITE_MONSTER_KILL', timestamp: 8 * 60_000, killerId: 2, killerTeamId: 100, monsterType: 'DRAGON', monsterSubType: 'AIR_DRAGON', position: { x: 9866, y: 4414 } }]);
    put(frames, 6, [{ type: 'ELITE_MONSTER_KILL', timestamp: 6 * 60_000, killerId: 7, killerTeamId: 200, monsterType: 'HORDE', position: { x: 5000, y: 10400 } }]);
    put(frames, 20, [{ type: 'ELITE_MONSTER_KILL', timestamp: 20 * 60_000, killerId: 7, killerTeamId: 200, monsterType: 'BARON_NASHOR', assistingParticipantIds: [2], position: { x: 5000, y: 10400 } }]);
    const t = build(frames)!;
    expect(t.objectives).toHaveLength(3);
    expect(t.objectives[0]).toMatchObject({ minute: 6, type: 'grubs', side: 'them', ourInvolved: [], ourNear: [] });
    expect(t.objectives[1]).toMatchObject({ minute: 8, type: 'dragon', subType: 'air', side: 'us', ourInvolved: ['Jungle'] });
    expect(t.objectives[1].ourNear).toEqual(['Jungle']);
    expect(t.objectives[2]).toMatchObject({ type: 'baron', side: 'them', ourInvolved: ['Jungle'] });
    expect(t.firsts.dragon).toEqual({ minute: 8, side: 'us' });
    expect(t.firsts.grubs).toEqual({ minute: 6, side: 'them' });
  });

  it('reads the first tower from the owner, and the plates per lane', () => {
    const frames = plainFrames(15);
    put(frames, 9, [
      { type: 'TURRET_PLATE_DESTROYED', timestamp: 9 * 60_000, teamId: 200, laneType: 'BOT_LANE' },
      { type: 'TURRET_PLATE_DESTROYED', timestamp: 9 * 60_000, teamId: 200, laneType: 'BOT_LANE' },
      { type: 'TURRET_PLATE_DESTROYED', timestamp: 9 * 60_000, teamId: 100, laneType: 'TOP_LANE' }
    ]);
    put(frames, 14, [{ type: 'BUILDING_KILL', timestamp: 14 * 60_000, teamId: 200, buildingType: 'TOWER_BUILDING', laneType: 'BOT_LANE' }]);
    const t = build(frames)!;
    expect(t.plates.ours).toEqual({ top: 0, mid: 0, bot: 2 });
    expect(t.plates.theirs).toEqual({ top: 1, mid: 0, bot: 0 });
    expect(t.firsts.tower).toEqual({ minute: 14, side: 'us', lane: 'bot' });
  });

  it('buckets wards placed and cleared per five minutes, ignoring undefined wards', () => {
    const frames = plainFrames(12);
    put(frames, 2, [ward(5), ward(5, 'UNDEFINED')]);
    put(frames, 7, [ward(5, 'CONTROL_WARD'), { type: 'WARD_KILL', timestamp: 7 * 60_000, killerId: 5, wardType: 'YELLOW_TRINKET' }, ward(9)]);
    const t = build(frames)!;
    const sup = t.vision.find((v) => v.seat === 'Support')!;
    expect(sup.placed).toEqual([1, 1]);
    expect(sup.killed).toEqual([0, 1]);
    expect(t.vision.find((v) => v.seat === 'ADC')).toBeUndefined();
  });

  it('reads gold spent off the frames and clusters purchases into backs', () => {
    // Top earns 300 a minute, holds 200, and spends everything at 5, 9 and 14.
    const frames = Array.from({ length: 16 }, (_, m) => {
      const spentSoFar = m >= 14 ? 3900 : m >= 9 ? 2400 : m >= 5 ? 1200 : 0;
      return frame(m, { 1: { gold: 500 + m * 300, current: 500 + m * 300 - spentSoFar } });
    });
    put(frames, 0, [{ type: 'ITEM_PURCHASED', timestamp: 5_000, participantId: 1 }]);
    put(frames, 5, [{ type: 'ITEM_PURCHASED', timestamp: 5 * 60_000, participantId: 1 }, { type: 'ITEM_PURCHASED', timestamp: 5 * 60_000 + 3_000, participantId: 1 }]);
    put(frames, 9, [{ type: 'ITEM_PURCHASED', timestamp: 9 * 60_000, participantId: 1 }]);
    put(frames, 14, [{ type: 'ITEM_PURCHASED', timestamp: 14 * 60_000, participantId: 1 }]);
    const t = build(frames)!;
    const top = t.spend.find((s) => s.seat === 'Top')!;
    expect(top.backs).toEqual([5, 9, 14]);
    expect(top.firstItemMinute).toBe(14);
    expect(top.secondItemMinute).toBeUndefined();
  });

  it('survives a remake with nothing at ten', () => {
    const t = build(plainFrames(3))!;
    expect(t.curve.at10).toBeUndefined();
    expect(t.curve.leadAt).toEqual({});
    expect(t.lanes[0].at10).toBeUndefined();
  });

  it('returns null with one frame, or with none of ours in the game', () => {
    expect(build(plainFrames(0))).toBeNull();
    expect(buildMatchTimeline('EUW1_1', timeline(plainFrames()), match(), new Set(['nobody']), names, 'now')).toBeNull();
  });

  it('stays under the size cap on a long, bloody game', () => {
    const frames = plainFrames(45);
    for (let m = 5; m < 45; m += 1) {
      put(frames, m, [kill(6, (m % 5) + 1, 7000 + m * 10, 7000, [7, 8]), kill(1, 6 + (m % 5), 7000, 7000 + m * 10, [2]), ward(5), ward(2, 'CONTROL_WARD')]);
    }
    const t = build(frames)!;
    expect(t.deaths).toHaveLength(40);
    expect(t.bytes).toBeLessThan(MAX_BYTES);
    expect(JSON.stringify(t).length).toBe(t.bytes);
    expect(JSON.stringify(t)).not.toMatch(/"puuid"/);
  });

  it('stamps the version and knows a stale document', () => {
    const t = build(plainFrames())!;
    expect(t.timelineVersion).toBe(TIMELINE_VERSION);
    expect(isTimelineCurrent(t)).toBe(true);
    expect(isTimelineCurrent({ timelineVersion: 0 })).toBe(false);
    expect(isTimelineCurrent(undefined)).toBe(false);
    expect(t.durationSec).toBe(1800);
    expect(MAP_MAX).toBeGreaterThan(14000);
  });
});
