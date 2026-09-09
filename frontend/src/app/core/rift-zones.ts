import { MapZone, Role } from '../models/team.models';
import { rng, seedOf } from './seed';

/**
 * Where on the Rift image a zone is (9 Sep 2026, the film room). The timeline
 * only knows the zone a thing happened in, so the map draws it somewhere
 * plausible inside that zone: a seeded point, the same on every visit, and
 * every surface that shows one says "approximate, by zone".
 *
 * The space is percent of the image, x to the right and y DOWN. Blue base is
 * bottom-left at (10, 90), red base top-right at (90, 10). Mid runs base to
 * base along x + y = 100; the river runs top-left to bottom-right along
 * y = x, Baron pit near (31, 30), Dragon pit near (69, 69). Blue's half of the
 * map is y > x, red's is y < x. Top lane is the left edge and the top edge,
 * bot lane the bottom edge and the right edge; the jungles are what is left
 * between the lanes on each side of the river.
 *
 * Lanes, the river and mid are absolute and never mirrored. Only the bases
 * and the jungles resolve by which side we were on.
 */

export interface Point {
  x: number;
  y: number;
}

export type RiftSide = 'blue' | 'red';

/** A zone in the image's own terms, before "ours" and "theirs" are resolved. */
export type RiftArea = 'blueBase' | 'redBase' | 'top' | 'mid' | 'bot' | 'river' | 'blueJungle' | 'redJungle';

export interface ZoneRegion {
  bbox: { x0: number; y0: number; x1: number; y1: number };
  inside(x: number, y: number): boolean;
  /** A point inside the region, used as its anchor. Not the geometric centre. */
  centroid: Point;
  label: string;
}

/** The five lane spots per side, as the draft room draws them. The source of truth for every token table on the Rift. */
export const MAP_SPOTS: Record<RiftSide, Record<Role, Point>> = {
  blue: {
    Top: { x: 13, y: 34 },
    Jungle: { x: 26, y: 46 },
    Mid: { x: 42, y: 58 },
    ADC: { x: 62, y: 87 },
    Support: { x: 71, y: 81 }
  },
  red: {
    Top: { x: 30, y: 12 },
    Jungle: { x: 48, y: 26 },
    Mid: { x: 58, y: 42 },
    ADC: { x: 89, y: 38 },
    Support: { x: 83, y: 47 }
  }
};

export const BARON_PIT: Point = { x: 31, y: 30 };
export const DRAGON_PIT: Point = { x: 69, y: 69 };

const BASE: Record<RiftSide, Point> = { blue: { x: 10, y: 90 }, red: { x: 90, y: 10 } };
const BASE_RADIUS = 9;

// ---- The pieces the regions are built from -----------------------------------

type Box = { x0: number; y0: number; x1: number; y1: number };

const inBox = (b: Box, x: number, y: number): boolean => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;

const TOP_LEFT_EDGE: Box = { x0: 7, y0: 20, x1: 18, y1: 74 };
const TOP_TOP_EDGE: Box = { x0: 20, y0: 7, x1: 80, y1: 18 };
/** The bend where the two edges meet, so the lane is one piece. */
const TOP_CORNER: Box = { x0: 7, y0: 7, x1: 20, y1: 20 };
const BOT_BOTTOM_EDGE: Box = { x0: 20, y0: 82, x1: 80, y1: 93 };
const BOT_RIGHT_EDGE: Box = { x0: 82, y0: 26, x1: 93, y1: 80 };
const BOT_CORNER: Box = { x0: 80, y0: 80, x1: 93, y1: 93 };

const inBase = (side: RiftSide, x: number, y: number): boolean => {
  const b = BASE[side];
  return Math.hypot(x - b.x, y - b.y) <= BASE_RADIUS;
};
const inTop = (x: number, y: number): boolean => inBox(TOP_LEFT_EDGE, x, y) || inBox(TOP_TOP_EDGE, x, y) || inBox(TOP_CORNER, x, y);
const inBot = (x: number, y: number): boolean => inBox(BOT_BOTTOM_EDGE, x, y) || inBox(BOT_RIGHT_EDGE, x, y) || inBox(BOT_CORNER, x, y);
const inMid = (x: number, y: number): boolean => {
  const s = x + y;
  return s >= 94 && s <= 106 && x >= 16 && x <= 84 && !inBase('blue', x, y) && !inBase('red', x, y);
};
const inRiver = (x: number, y: number): boolean => {
  const s = x + y;
  return Math.abs(x - y) <= 6 && s >= 40 && s <= 160;
};
const inJungle = (side: RiftSide, x: number, y: number): boolean => {
  const across = side === 'blue' ? y - x : x - y;
  if (across < 8) return false;
  if (x <= 18 || x >= 82 || y <= 18 || y >= 82) return false;
  return !inTop(x, y) && !inBot(x, y) && !inMid(x, y) && !inRiver(x, y) && !inBase('blue', x, y) && !inBase('red', x, y);
};

const REGIONS: Record<RiftArea, ZoneRegion> = {
  blueBase: {
    bbox: { x0: 1, y0: 81, x1: 19, y1: 99 },
    inside: (x, y) => inBase('blue', x, y),
    centroid: BASE.blue,
    label: 'Blue base'
  },
  redBase: {
    bbox: { x0: 81, y0: 1, x1: 99, y1: 19 },
    inside: (x, y) => inBase('red', x, y),
    centroid: BASE.red,
    label: 'Red base'
  },
  top: {
    bbox: { x0: 7, y0: 7, x1: 80, y1: 74 },
    inside: inTop,
    centroid: { x: 13, y: 13 },
    label: 'Top lane'
  },
  mid: {
    bbox: { x0: 16, y0: 16, x1: 84, y1: 84 },
    inside: inMid,
    centroid: { x: 50, y: 50 },
    label: 'Mid lane'
  },
  bot: {
    bbox: { x0: 20, y0: 26, x1: 93, y1: 93 },
    inside: inBot,
    centroid: { x: 87, y: 87 },
    label: 'Bot lane'
  },
  river: {
    bbox: { x0: 17, y0: 17, x1: 83, y1: 83 },
    inside: inRiver,
    centroid: { x: 50, y: 50 },
    label: 'River'
  },
  blueJungle: {
    bbox: { x0: 18, y0: 26, x1: 74, y1: 82 },
    inside: (x, y) => inJungle('blue', x, y),
    centroid: { x: 30, y: 62 },
    label: 'Blue jungle'
  },
  redJungle: {
    bbox: { x0: 26, y0: 18, x1: 82, y1: 74 },
    inside: (x, y) => inJungle('red', x, y),
    centroid: { x: 62, y: 30 },
    label: 'Red jungle'
  }
};

const other = (side: RiftSide): RiftSide => (side === 'blue' ? 'red' : 'blue');

/** The image's own name for a zone, given which side we were on. */
export function areaOf(zone: MapZone, ourSide: RiftSide): RiftArea {
  switch (zone) {
    case 'ourBase':
      return ourSide === 'blue' ? 'blueBase' : 'redBase';
    case 'theirBase':
      return ourSide === 'blue' ? 'redBase' : 'blueBase';
    case 'ourJungle':
      return ourSide === 'blue' ? 'blueJungle' : 'redJungle';
    case 'theirJungle':
      return ourSide === 'blue' ? 'redJungle' : 'blueJungle';
    default:
      return zone;
  }
}

/** The region a zone maps to. Bases and jungles resolve by our side; top, mid, bot and the river never mirror. */
export function regionFor(zone: MapZone, ourSide: RiftSide): ZoneRegion {
  return REGIONS[areaOf(zone, ourSide)];
}

/** Which area a point of the image falls in, bases first, then lanes, then the river, then the jungles. Null off the map's playable ground. */
export function areaAt(x: number, y: number): RiftArea | null {
  if (inBase('blue', x, y)) return 'blueBase';
  if (inBase('red', x, y)) return 'redBase';
  if (inTop(x, y)) return 'top';
  if (inBot(x, y)) return 'bot';
  if (inMid(x, y)) return 'mid';
  if (inRiver(x, y)) return 'river';
  if (inJungle('blue', x, y)) return 'blueJungle';
  if (inJungle('red', x, y)) return 'redJungle';
  return null;
}

/** `areaAt`, resolved to the timeline's zone names for our side. */
export function zoneAt(x: number, y: number, ourSide: RiftSide): MapZone | null {
  const area = areaAt(x, y);
  if (!area) return null;
  switch (area) {
    case 'blueBase':
      return ourSide === 'blue' ? 'ourBase' : 'theirBase';
    case 'redBase':
      return ourSide === 'red' ? 'ourBase' : 'theirBase';
    case 'blueJungle':
      return ourSide === 'blue' ? 'ourJungle' : 'theirJungle';
    case 'redJungle':
      return ourSide === 'red' ? 'ourJungle' : 'theirJungle';
    default:
      return area;
  }
}

/** Where a seat stands on its side of the map. */
export function laneSpot(seat: Role, side: RiftSide): Point {
  return { ...MAP_SPOTS[side][seat] };
}

export type PitObjective = 'dragon' | 'elder' | 'baron' | 'herald' | 'grubs' | 'atakhan';

/** The pit an objective is taken in: dragons, elder and Atakhan in the bottom river, Baron, Herald and grubs in the top river. */
export function objectivePit(type: PitObjective): Point {
  return type === 'dragon' || type === 'elder' || type === 'atakhan' ? { ...DRAGON_PIT } : { ...BARON_PIT };
}

// ---- Placing a death -----------------------------------------------------------

/** A part of a region a hint prefers: its own box to sample in, and its own test. */
interface Part {
  bbox: Box;
  inside(x: number, y: number): boolean;
}

const boxPart = (b: Box): Part => ({ bbox: b, inside: (x, y) => inBox(b, x, y) });

/**
 * The half of a lane or the river nearer their base. On top and bot that is
 * the edge their base sits on. On the river the two bases are the same
 * distance from every point, so "their side" is the pit whose back wall is
 * in their jungle: Dragon when they are red, Baron when they are blue.
 */
function theirHalf(area: RiftArea, ourSide: RiftSide): Part | null {
  const theirs = other(ourSide);
  switch (area) {
    case 'top':
      return boxPart(theirs === 'red' ? TOP_TOP_EDGE : TOP_LEFT_EDGE);
    case 'bot':
      return boxPart(theirs === 'red' ? BOT_RIGHT_EDGE : BOT_BOTTOM_EDGE);
    case 'mid':
      return theirs === 'red'
        ? { bbox: { x0: 50, y0: 16, x1: 84, y1: 50 }, inside: (x) => x >= 50 }
        : { bbox: { x0: 16, y0: 50, x1: 50, y1: 84 }, inside: (x) => x <= 50 };
    case 'river':
      return theirs === 'red'
        ? { bbox: { x0: 50, y0: 50, x1: 83, y1: 83 }, inside: (x, y) => x + y > 100 }
        : { bbox: { x0: 17, y0: 17, x1: 50, y1: 50 }, inside: (x, y) => x + y < 100 };
    default:
      return null;
  }
}

/** The outer third of a lane on their side: where a death under their tower lands. */
function theirOuterThird(area: RiftArea, ourSide: RiftSide): Part | null {
  const theirs = other(ourSide);
  switch (area) {
    case 'top':
      return boxPart(theirs === 'red' ? { x0: 60, y0: 7, x1: 80, y1: 18 } : { x0: 7, y0: 54, x1: 18, y1: 74 });
    case 'bot':
      return boxPart(theirs === 'red' ? { x0: 82, y0: 26, x1: 93, y1: 44 } : { x0: 20, y0: 82, x1: 38, y1: 93 });
    case 'mid':
      return theirs === 'red'
        ? { bbox: { x0: 70, y0: 16, x1: 84, y1: 30 }, inside: (x) => x >= 70 }
        : { bbox: { x0: 16, y0: 70, x1: 30, y1: 84 }, inside: (x) => x <= 30 };
    default:
      return null;
  }
}

const TRIES = 32;

/** A seeded point inside the region, preferring the part when one is given. The centroid when nothing lands. */
function sample(region: ZoneRegion, part: Part | null, r: () => number): Point {
  const draw = (b: Box): Point => ({ x: b.x0 + r() * (b.x1 - b.x0), y: b.y0 + r() * (b.y1 - b.y0) });
  if (part) {
    for (let i = 0; i < TRIES; i++) {
      const p = draw(part.bbox);
      if (region.inside(p.x, p.y) && part.inside(p.x, p.y)) return p;
    }
  }
  for (let i = 0; i < TRIES; i++) {
    const p = draw(region.bbox);
    if (region.inside(p.x, p.y)) return p;
  }
  return { ...region.centroid };
}

const round = (p: Point): Point => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });

export interface PlaceDeathArgs {
  matchId: string;
  sec: number;
  seat: Role;
  zone: MapZone;
  ourSide: RiftSide;
  /** The death was on their half of the lane or river. */
  theirSide?: boolean;
  /** A dragon, Baron or the like was up nearby: snaps to the pit in the river, leans toward it elsewhere. */
  objectiveNear?: boolean;
  /** Died under their tower: the outer third of the lane on their side. */
  executed?: boolean;
  /** Which death this is in the same zone, from 0; later ones step out along a small spiral so pips never stack. */
  ordinal?: number;
}

/**
 * A point inside the zone for one death of ours, the same every time for the
 * same match, second and seat. Approximate by construction: the timeline
 * knows the zone, not the spot.
 */
export function placeDeath(args: PlaceDeathArgs): Point {
  const area = areaOf(args.zone, args.ourSide);
  const region = REGIONS[area];
  const r = rng(seedOf(args.matchId + ':' + args.sec + ':' + args.seat));
  const part = (args.executed && theirOuterThird(area, args.ourSide)) || (args.theirSide && theirHalf(area, args.ourSide)) || null;
  let p = sample(region, part, r);

  if (args.objectiveNear) {
    if (area === 'river') {
      const pit = p.x + p.y < 100 ? BARON_PIT : DRAGON_PIT;
      p = { x: pit.x + (r() * 2 - 1) * 2, y: pit.y + (r() * 2 - 1) * 2 };
    } else if (!args.executed) {
      const pit = Math.hypot(p.x - BARON_PIT.x, p.y - BARON_PIT.y) <= Math.hypot(p.x - DRAGON_PIT.x, p.y - DRAGON_PIT.y) ? BARON_PIT : DRAGON_PIT;
      for (const f of [0.5, 0.25]) {
        const q = { x: p.x + (pit.x - p.x) * f, y: p.y + (pit.y - p.y) * f };
        if (region.inside(q.x, q.y)) {
          p = q;
          break;
        }
      }
    }
  }

  const n = Math.max(0, Math.floor(args.ordinal ?? 0));
  if (n > 0) {
    const angle = n * 2.4;
    for (const radius of [1.8 * n, 0.9 * n]) {
      const q = { x: p.x + Math.cos(angle) * radius, y: p.y + Math.sin(angle) * radius };
      if (region.inside(q.x, q.y)) {
        p = q;
        break;
      }
    }
  }

  return settle(region, region.inside(p.x, p.y) ? p : region.centroid);
}

/** Rounded to a tenth of a percent, unless rounding would nudge it over the region's edge. */
function settle(region: ZoneRegion, p: Point): Point {
  const q = round(p);
  return region.inside(q.x, q.y) ? q : p;
}

/** Where a fight cluster in a zone sits: the region's anchor, nudged a little by the match so two films do not line up. */
export function clusterSpot(zone: MapZone, ourSide: RiftSide, matchId: string): Point {
  const region = regionFor(zone, ourSide);
  const r = rng(seedOf(matchId + ':cluster:' + zone));
  const p = { x: region.centroid.x + (r() * 2 - 1) * 2, y: region.centroid.y + (r() * 2 - 1) * 2 };
  return settle(region, region.inside(p.x, p.y) ? p : region.centroid);
}
