import { describe, expect, it } from 'vitest';
import { MapZone, Role } from '../models/team.models';
import {
  BARON_PIT,
  DRAGON_PIT,
  MAP_MAX,
  MAP_SPOTS,
  RIOT_BARON_PIT,
  RIOT_DRAGON_PIT,
  RiftSide,
  areaAt,
  clusterSpot,
  laneSpot,
  objectivePit,
  placeDeath,
  regionFor,
  riotToPercent,
  unitsToPercent,
  zoneAt
} from './rift-zones';

const ZONES: MapZone[] = ['ourBase', 'theirBase', 'top', 'mid', 'bot', 'river', 'ourJungle', 'theirJungle'];
const SIDES: RiftSide[] = ['blue', 'red'];
const SEATS: Role[] = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('regionFor', () => {
  it('has every centroid inside its own region, on both sides', () => {
    for (const side of SIDES) {
      for (const zone of ZONES) {
        const region = regionFor(zone, side);
        expect(region.inside(region.centroid.x, region.centroid.y), `${zone} ${side}`).toBe(true);
        expect(region.centroid.x).toBeGreaterThanOrEqual(region.bbox.x0);
        expect(region.centroid.x).toBeLessThanOrEqual(region.bbox.x1);
        expect(region.centroid.y).toBeGreaterThanOrEqual(region.bbox.y0);
        expect(region.centroid.y).toBeLessThanOrEqual(region.bbox.y1);
      }
    }
  });

  it('keeps lanes and the river identical for blue and red', () => {
    for (const zone of ['top', 'mid', 'bot', 'river'] as MapZone[]) {
      const blue = regionFor(zone, 'blue');
      const red = regionFor(zone, 'red');
      expect(blue).toBe(red);
      expect(blue.bbox).toEqual(red.bbox);
      expect(blue.centroid).toEqual(red.centroid);
    }
  });

  it('resolves ours and theirs by side', () => {
    expect(regionFor('ourBase', 'blue').label).toBe('Blue base');
    expect(regionFor('ourBase', 'red').label).toBe('Red base');
    expect(regionFor('theirBase', 'blue').label).toBe('Red base');
    expect(regionFor('ourJungle', 'red').label).toBe('Red jungle');
    expect(regionFor('theirJungle', 'red').label).toBe('Blue jungle');
    expect(regionFor('ourJungle', 'blue').centroid).toEqual({ x: 30, y: 62 });
    expect(regionFor('theirJungle', 'blue').centroid).toEqual({ x: 62, y: 30 });
  });

  it('never puts a region inside another zone it should not share', () => {
    const blueJungle = regionFor('ourJungle', 'blue');
    const redJungle = regionFor('ourJungle', 'red');
    const top = regionFor('top', 'blue');
    const bot = regionFor('bot', 'blue');
    for (let x = 0; x <= 100; x += 1) {
      for (let y = 0; y <= 100; y += 1) {
        expect(blueJungle.inside(x, y) && redJungle.inside(x, y)).toBe(false);
        expect(blueJungle.inside(x, y) && top.inside(x, y)).toBe(false);
        expect(redJungle.inside(x, y) && bot.inside(x, y)).toBe(false);
      }
    }
  });
});

describe('areaAt and zoneAt', () => {
  it('classifies the known points', () => {
    expect(areaAt(15, 50)).toBe('top');
    expect(areaAt(50, 15)).toBe('top');
    expect(areaAt(85, 50)).toBe('bot');
    expect(areaAt(50, 85)).toBe('bot');
    expect(areaAt(50, 50)).toBe('mid');
    expect(areaAt(31, 30)).toBe('river');
    expect(areaAt(69, 69)).toBe('river');
    // The pits are cut into the wall beside the river: their floor is river ground, the jungle behind them is not.
    expect(areaAt(37, 28)).toBe('river');
    expect(areaAt(65, 72)).toBe('river');
    expect(areaAt(41, 25)).toBe('redJungle');
    expect(areaAt(60, 75)).toBe('blueJungle');
    expect(areaAt(25, 60)).toBe('blueJungle');
    expect(areaAt(60, 75)).toBe('blueJungle');
    expect(areaAt(40, 25)).toBe('redJungle');
    expect(areaAt(75, 40)).toBe('redJungle');
    expect(areaAt(10, 90)).toBe('blueBase');
    expect(areaAt(90, 10)).toBe('redBase');
    expect(areaAt(2, 2)).toBeNull();
  });

  it('names zones for our side', () => {
    expect(zoneAt(10, 90, 'blue')).toBe('ourBase');
    expect(zoneAt(10, 90, 'red')).toBe('theirBase');
    expect(zoneAt(25, 60, 'blue')).toBe('ourJungle');
    expect(zoneAt(25, 60, 'red')).toBe('theirJungle');
    expect(zoneAt(50, 15, 'red')).toBe('top');
    expect(zoneAt(2, 2, 'red')).toBeNull();
  });
});

describe('laneSpot and objectivePit', () => {
  it('gives the draft room spots and a fresh object each time', () => {
    for (const side of SIDES) {
      for (const seat of SEATS) {
        const spot = laneSpot(seat, side);
        expect(spot).toEqual(MAP_SPOTS[side][seat]);
        expect(spot).not.toBe(MAP_SPOTS[side][seat]);
      }
    }
    expect(laneSpot('Top', 'blue')).toEqual({ x: 13, y: 34 });
    expect(laneSpot('ADC', 'red')).toEqual({ x: 89, y: 38 });
  });

  it('puts dragons at the Dragon pit and Baron at the Baron pit', () => {
    expect(objectivePit('dragon')).toEqual(DRAGON_PIT);
    expect(objectivePit('elder')).toEqual(DRAGON_PIT);
    expect(objectivePit('atakhan')).toEqual(DRAGON_PIT);
    expect(objectivePit('baron')).toEqual(BARON_PIT);
    expect(objectivePit('herald')).toEqual(BARON_PIT);
    expect(objectivePit('grubs')).toEqual(BARON_PIT);
    expect(areaAt(BARON_PIT.x, BARON_PIT.y)).toBe('river');
    expect(areaAt(DRAGON_PIT.x, DRAGON_PIT.y)).toBe('river');
  });
});

describe('placeDeath', () => {
  it('lands inside the zone for every zone, both sides, every hint, over 50 seeded runs', () => {
    const hints = [
      {},
      { theirSide: true },
      { objectiveNear: true },
      { executed: true },
      { theirSide: true, objectiveNear: true },
      { executed: true, objectiveNear: true }
    ];
    for (const side of SIDES) {
      for (const zone of ZONES) {
        const region = regionFor(zone, side);
        for (let run = 0; run < 50; run++) {
          for (const hint of hints) {
            for (const ordinal of [0, 1, 2, 3, 5]) {
              const p = placeDeath({ matchId: 'EUW1_' + run, sec: 60 + run * 37, seat: SEATS[run % 5], zone, ourSide: side, ordinal, ...hint });
              expect(region.inside(p.x, p.y), `${zone} ${side} run ${run} ${JSON.stringify(hint)} ordinal ${ordinal} -> ${p.x},${p.y}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it('is the same for the same args and differs by second and seat', () => {
    const a = placeDeath({ matchId: 'EUW1_1', sec: 600, seat: 'Mid', zone: 'mid', ourSide: 'blue' });
    const b = placeDeath({ matchId: 'EUW1_1', sec: 600, seat: 'Mid', zone: 'mid', ourSide: 'blue' });
    expect(a).toEqual(b);
    expect(placeDeath({ matchId: 'EUW1_1', sec: 601, seat: 'Mid', zone: 'mid', ourSide: 'blue' })).not.toEqual(a);
    expect(placeDeath({ matchId: 'EUW1_1', sec: 600, seat: 'Top', zone: 'mid', ourSide: 'blue' })).not.toEqual(a);
  });

  it('places a lane death the same for blue and red when no hint says which half', () => {
    for (const zone of ['top', 'mid', 'bot', 'river'] as MapZone[]) {
      for (let run = 0; run < 20; run++) {
        const args = { matchId: 'EUW1_9', sec: 100 + run * 41, seat: SEATS[run % 5], zone };
        expect(placeDeath({ ...args, ourSide: 'blue' })).toEqual(placeDeath({ ...args, ourSide: 'red' }));
      }
    }
  });

  it('puts a top-lane death on their half on the top edge for blue and the left edge for red', () => {
    for (let run = 0; run < 50; run++) {
      const args = { matchId: 'EUW1_' + run, sec: 200 + run * 29, seat: 'Top' as Role, zone: 'top' as MapZone, theirSide: true };
      const blue = placeDeath({ ...args, ourSide: 'blue' });
      expect(blue.y, `blue run ${run}`).toBeLessThanOrEqual(18);
      expect(blue.x).toBeGreaterThanOrEqual(20);
      const red = placeDeath({ ...args, ourSide: 'red' });
      expect(red.x, `red run ${run}`).toBeLessThanOrEqual(18);
      expect(red.y).toBeGreaterThanOrEqual(20);
    }
  });

  it('puts a bot-lane death on their half on the right edge for blue and the bottom edge for red', () => {
    for (let run = 0; run < 50; run++) {
      const args = { matchId: 'EUW1_' + run, sec: 200 + run * 29, seat: 'ADC' as Role, zone: 'bot' as MapZone, theirSide: true };
      expect(placeDeath({ ...args, ourSide: 'blue' }).x).toBeGreaterThanOrEqual(82);
      expect(placeDeath({ ...args, ourSide: 'red' }).y).toBeGreaterThanOrEqual(82);
    }
  });

  it('puts an executed death in the outer third of the lane on their side', () => {
    for (let run = 0; run < 50; run++) {
      const args = { matchId: 'EUW1_' + run, sec: 300 + run * 31, seat: 'Mid' as Role, executed: true };
      expect(placeDeath({ ...args, zone: 'top', ourSide: 'blue' }).x).toBeGreaterThanOrEqual(60);
      expect(placeDeath({ ...args, zone: 'top', ourSide: 'red' }).y).toBeGreaterThanOrEqual(54);
      expect(placeDeath({ ...args, zone: 'mid', ourSide: 'blue' }).x).toBeGreaterThanOrEqual(70);
      expect(placeDeath({ ...args, zone: 'mid', ourSide: 'red' }).x).toBeLessThanOrEqual(30);
      expect(placeDeath({ ...args, zone: 'bot', ourSide: 'blue' }).y).toBeLessThanOrEqual(44);
      expect(placeDeath({ ...args, zone: 'bot', ourSide: 'red' }).x).toBeLessThanOrEqual(38);
    }
  });

  it('snaps a river death near an objective to within 4 of a pit', () => {
    for (let run = 0; run < 50; run++) {
      for (const side of SIDES) {
        const p = placeDeath({ matchId: 'EUW1_' + run, sec: 900 + run * 23, seat: 'Jungle', zone: 'river', ourSide: side, objectiveNear: true });
        expect(Math.min(dist(p, BARON_PIT), dist(p, DRAGON_PIT)), `${side} run ${run}`).toBeLessThanOrEqual(4);
      }
    }
  });

  it('sends a river death on their half toward the pit whose wall is in their jungle', () => {
    for (let run = 0; run < 30; run++) {
      const args = { matchId: 'EUW1_' + run, sec: 700 + run * 19, seat: 'Support' as Role, zone: 'river' as MapZone, theirSide: true, objectiveNear: true };
      expect(dist(placeDeath({ ...args, ourSide: 'blue' }), DRAGON_PIT)).toBeLessThanOrEqual(4);
      expect(dist(placeDeath({ ...args, ourSide: 'red' }), BARON_PIT)).toBeLessThanOrEqual(4);
    }
  });

  it('steps later deaths in the same zone apart along a spiral', () => {
    const base = { matchId: 'EUW1_5', sec: 1200, seat: 'ADC' as Role, zone: 'river' as MapZone, ourSide: 'blue' as RiftSide, objectiveNear: true };
    const first = placeDeath({ ...base, ordinal: 0 });
    const second = placeDeath({ ...base, ordinal: 1 });
    const third = placeDeath({ ...base, ordinal: 2 });
    expect(dist(first, second)).toBeCloseTo(1.8, 0);
    expect(dist(first, third)).toBeGreaterThan(1.5);
    expect(dist(second, third)).toBeGreaterThan(1);
  });

  it('rounds to a tenth of a percent', () => {
    const p = placeDeath({ matchId: 'EUW1_2', sec: 90, seat: 'Top', zone: 'ourJungle', ourSide: 'red' });
    expect(p.x).toBe(Math.round(p.x * 10) / 10);
    expect(p.y).toBe(Math.round(p.y * 10) / 10);
  });
});

describe('clusterSpot', () => {
  it('sits inside the zone near the anchor, the same for the same match', () => {
    for (const side of SIDES) {
      for (const zone of ZONES) {
        const region = regionFor(zone, side);
        const a = clusterSpot(zone, side, 'EUW1_3');
        expect(region.inside(a.x, a.y), `${zone} ${side}`).toBe(true);
        expect(dist(a, region.centroid)).toBeLessThanOrEqual(3);
        expect(clusterSpot(zone, side, 'EUW1_3')).toEqual(a);
      }
    }
    expect(clusterSpot('river', 'blue', 'EUW1_3')).not.toEqual(clusterSpot('river', 'blue', 'EUW1_4'));
  });
});

describe('riotToPercent and unitsToPercent', () => {
  it('lands Riot\'s two pits on the table\'s own pits, in the river', () => {
    const baron = riotToPercent(RIOT_BARON_PIT.x, RIOT_BARON_PIT.y);
    const dragon = riotToPercent(RIOT_DRAGON_PIT.x, RIOT_DRAGON_PIT.y);
    expect(dist(baron, BARON_PIT)).toBeLessThanOrEqual(0.5);
    expect(dist(dragon, DRAGON_PIT)).toBeLessThanOrEqual(0.5);
    expect(areaAt(baron.x, baron.y)).toBe('river');
    expect(areaAt(dragon.x, dragon.y)).toBe('river');
  });

  it('puts the blue corner bottom-left inside the image near (3, 98) and the red corner top-right near (99, 2), clamping only beyond them', () => {
    // Inside, not on the edge (10 Sep 2026, second fix pass): the first fit put both corners off the image, and a clamped 0 passed as "near 2".
    const blue = riotToPercent(0, 0);
    expect(blue.x).toBeGreaterThan(1);
    expect(blue.x).toBeLessThan(5);
    expect(blue.y).toBeGreaterThan(95);
    expect(blue.y).toBeLessThan(99.5);
    const red = riotToPercent(MAP_MAX, MAP_MAX);
    expect(red.x).toBeGreaterThan(97);
    expect(red.x).toBeLessThan(99.9);
    expect(red.y).toBeGreaterThan(0.5);
    expect(red.y).toBeLessThan(4);
    expect(riotToPercent(-2000, -2000)).toEqual({ x: 0, y: 100 });
    expect(riotToPercent(30000, 30000)).toEqual({ x: 100, y: 0 });
  });

  it('lands the fountains in the bases and the outer towers on their lanes, with one scale for both axes', () => {
    // Riot's own spots: the blue fountain, the red one, and the tier-one towers the timeline's building kills carry.
    const blueFountain = riotToPercent(554, 581);
    expect(areaAt(blueFountain.x, blueFountain.y)).toBe('blueBase');
    const redFountain = riotToPercent(14300, 14400);
    expect(areaAt(redFountain.x, redFountain.y)).toBe('redBase');
    const blueTopTower = riotToPercent(981, 10441);
    expect(areaAt(blueTopTower.x, blueTopTower.y)).toBe('top');
    const redBotTower = riotToPercent(13866, 4505);
    expect(areaAt(redBotTower.x, redBotTower.y)).toBe('bot');
    const blueMidTower = riotToPercent(5846, 6396);
    expect(areaAt(blueMidTower.x, blueMidTower.y)).toBe('mid');
    // One scale: 900 units across is 900 units up, so a ward's sight is one round circle.
    const across = riotToPercent(7435 + 900, 7435).x - riotToPercent(7435, 7435).x;
    const up = riotToPercent(7435, 7435).y - riotToPercent(7435, 7435 + 900).y;
    expect(Math.abs(across - up)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(across - unitsToPercent(900))).toBeLessThanOrEqual(0.15);
    expect(unitsToPercent(900)).toBeGreaterThan(5.5);
    expect(unitsToPercent(900)).toBeLessThan(6.5);
  });

  it('keeps the middle in the middle, x running right and Riot\'s y running up the image', () => {
    // The map's centre sits a hair right of the PNG's (the nexuses' midpoint is near (51, 49)), so within a percent and a half.
    const mid = riotToPercent(MAP_MAX / 2, MAP_MAX / 2);
    expect(dist(mid, { x: 50, y: 50 })).toBeLessThanOrEqual(1.5);
    expect(areaAt(mid.x, mid.y)).toBe('mid');
    expect(riotToPercent(10000, 7435).x).toBeGreaterThan(riotToPercent(5000, 7435).x);
    expect(riotToPercent(7435, 10000).y).toBeLessThan(riotToPercent(7435, 5000).y);
  });

  it('rounds to a tenth of a percent and hands back a fresh point', () => {
    const p = riotToPercent(1234, 5678);
    expect(p.x).toBe(Math.round(p.x * 10) / 10);
    expect(p.y).toBe(Math.round(p.y * 10) / 10);
    expect(riotToPercent(1234, 5678)).not.toBe(p);
  });

  it('makes a 900-unit sight radius about six percent of the map, a shade more after the fit, on the x axis\'s own scale', () => {
    const r = unitsToPercent(900);
    expect(r).toBeGreaterThan(5.5);
    expect(r).toBeLessThan(7.5);
    expect(unitsToPercent(0)).toBe(0);
    expect(unitsToPercent(1800)).toBeCloseTo(r * 2, 6);
    // 900 units left of the pit is that many percent left of it on the image.
    const at = riotToPercent(RIOT_BARON_PIT.x, RIOT_BARON_PIT.y);
    const left = riotToPercent(RIOT_BARON_PIT.x - 900, RIOT_BARON_PIT.y);
    expect(at.x - left.x).toBeCloseTo(r, 0);
  });
});
