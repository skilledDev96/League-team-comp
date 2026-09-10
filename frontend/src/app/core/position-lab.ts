import { Role, TimelineWardType } from '../models/team.models';
import { FilmFramePlace } from './film-model';
import { areaAt, MAP_MAX, Point, RiftArea, RiftSide, unitsToPercent } from './rift-zones';

export { MAP_MAX } from './rift-zones';

/**
 * The position lab's arithmetic (Part C, 10 Sep 2026). The lead asked for a
 * way "to see where we could have been better positioned" from a point on
 * the tape, and "based on our wards placed, where do we have vision, safe
 * zones and danger zones, almost like a heat map". Everything here is pure
 * and in the Rift image's percent space (x right, y down, blue base
 * bottom-left), the space the frames and the wards already arrive in.
 *
 * What the data can honestly carry shapes every number: Riot's timeline
 * places everyone once a minute, a ward event carries no position (its spot
 * is the placer's at the nearest frame), and nothing carries cooldowns or
 * pace. So a reach is REACH_SECONDS of walking, further only when the net
 * displacement between two frames says they moved faster than a walk (a
 * teleport, a recall), a sight is a circle of about 900 units, and every
 * surface that draws them says approximate. None of this decides anything;
 * it shades the map and reads one line off it.
 *
 * Units and percent go through `rift-zones.ts` (10 Sep 2026): its
 * `unitsToPercent` carries the fit that puts Riot's pits on the image's, so
 * a ward the lab puts down draws the same circle as one the game placed
 * (`wardsOf` sizes those with the same call), and a reach measured off two
 * frames is read back in the units the frames came in.
 */

/** How far ahead the lab looks: their reach is the ground each of theirs could cover in this many seconds, about what a gank takes to arrive out of the fog. */
export const REACH_SECONDS = 8;
/**
 * A champion's pace on foot with boots, in units a second: what a reach is
 * sized off, since the timeline carries no speed. The first cut (10 Sep 2026)
 * sized the circle off net displacement over a minute and called it thirty
 * seconds, which floored at four seconds of walking; the second fix pass the
 * same day made the circle what the legend says it is.
 */
export const WALK_UNITS_PER_SEC = 350;
/** A reach never shrinks below REACH_SECONDS of walking (standing still is the least the lab can claim of them) nor grows past this (a teleport would otherwise cover half the map). Units. */
export const REACH_MIN_UNITS = WALK_UNITS_PER_SEC * REACH_SECONDS;
export const REACH_MAX_UNITS = 4500;
/** Frames are sixty seconds apart, so a measured speed is displacement over a minute: the net, never the path. The lab passes the real gap when the frames it holds are closer. */
export const FRAME_GAP_SEC = 60;
/** A trinket or a control ward sees about this far. */
export const SIGHT_UNITS = 900;
/** A stealth ward from a trinket lives this long when placed early; the lab uses one number for every trinket and for 'other', since nothing it draws knows the level. */
export const STEALTH_WARD_SEC = 90;
/** The shading grid's cell, in percent of the map: 4 gives 625 cells, few enough to draw and fine enough to follow a circle. */
export const SHADE_STEP = 4;
/** A drawn arrow shorter than this, in percent, was a tap and is dropped. */
export const MIN_ARROW_PCT = 3;

export type LabShade = 'safe' | 'danger' | 'sight' | 'none';

/** A circle on the map: a ward's sight or one of theirs' reach. Radius in percent. */
export interface LabCircle extends Point {
  r: number;
  seat?: Role;
  champion?: string;
  type?: TimelineWardType;
}

/** One of theirs' reach: the circle, the pace it was sized off (units per second) and where they were a frame before, when known. */
export interface LabReach extends LabCircle {
  seat: Role;
  speed: number;
  from: Point | null;
}

/** A ward the lab can shade by: the film's own wards (`FilmWard`) fit, and so do the ones the lab places (`placedWard`). */
export interface LabWard extends Point {
  sec: number;
  untilSec: number;
  type: TimelineWardType;
  /** Sight radius in percent. */
  r: number;
  seat?: Role;
}

export interface LabCell {
  x: number;
  y: number;
  w: number;
  h: number;
  tag: LabShade;
}

/** What `readingOf` reads: their places now and a frame before, every live sight and the lab's own placed ones, the reaches, and where ours were moved to (last moved last). */
export interface LabScene {
  ourSide: RiftSide;
  theirs: FilmFramePlace[];
  previous: FilmFramePlace[] | null;
  sights: LabCircle[];
  placed: LabCircle[];
  reaches: LabReach[];
  moved: { seat: Role; x: number; y: number }[];
}

/** Percent of the image per Riot unit, with the Rift's fit; the inverse takes a drawn distance back to units. */
const PCT_PER_UNIT = unitsToPercent(1);
export const unitsToPct = (units: number): number => units * PCT_PER_UNIT;
export const pctToUnits = (pct: number): number => pct / PCT_PER_UNIT;
/** A ward's sight, in percent of the map (about 7 with the fit). */
export const SIGHT_PCT = Math.round(unitsToPct(SIGHT_UNITS) * 100) / 100;

const clampUnits = (u: number): number => Math.min(REACH_MAX_UNITS, Math.max(REACH_MIN_UNITS, u));

const inside = (p: Point, c: LabCircle): boolean => Math.hypot(p.x - c.x, p.y - c.y) <= c.r;

/** Distance from a point to the segment a→b, in the same space. */
function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * A reach circle per enemy: `seconds` of walking, or of their pace between
 * the previous frame and this one when that beat a walk (units per second,
 * net displacement over `gapSec`: a teleport, a recall), capped. Without a
 * previous frame (the first frame, or a seat the frame lost) the walking
 * floor stands: standing still is the least the lab can claim of them. A gap
 * of zero or less reads as no pace at all, so two frames at one minute never
 * divide by nothing. The pace and the frame before are kept on the reach
 * either way: the reading line reads the way they came off them.
 */
export function reachOf(theirs: FilmFramePlace[], previous: FilmFramePlace[] | null, seconds = REACH_SECONDS, gapSec = FRAME_GAP_SEC): LabReach[] {
  return theirs.map((t) => {
    const before = previous?.find((p) => p.seat === t.seat) ?? null;
    const units = before ? Math.hypot(pctToUnits(t.x - before.x), pctToUnits(t.y - before.y)) : 0;
    const speed = before && gapSec > 0 ? units / gapSec : 0;
    const r = clampUnits(Math.max(WALK_UNITS_PER_SEC, speed) * seconds);
    return {
      seat: t.seat,
      champion: t.champion,
      x: t.x,
      y: t.y,
      r: unitsToPct(r),
      speed,
      from: before ? { x: before.x, y: before.y } : null
    };
  });
}

/** The sight circles of the wards live at the second: placed by then and not yet gone. */
export function sightOf(wards: LabWard[], sec: number): LabCircle[] {
  return wards.filter((w) => w.sec <= sec && sec < w.untilSec).map((w) => ({ x: w.x, y: w.y, r: w.r, seat: w.seat, type: w.type }));
}

/** A ward the lab puts down at the second: a trinket (or 'other') for 90 s, a control ward until the game ends, which the lab has no end for, so it never ends. */
export function placedWard(type: TimelineWardType, x: number, y: number, sec: number): LabWard {
  return { sec, untilSec: type === 'control' ? Number.POSITIVE_INFINITY : sec + STEALTH_WARD_SEC, type, x, y, r: SIGHT_PCT };
}

/** Inside any of their reaches. */
export function dangerAt(point: Point, reaches: LabCircle[]): boolean {
  return reaches.some((r) => inside(point, r));
}

/** Inside a sight and outside every reach. */
export function safeAt(point: Point, sights: LabCircle[], reaches: LabCircle[]): boolean {
  return sights.some((s) => inside(point, s)) && !dangerAt(point, reaches);
}

/**
 * The four shades: 'safe' is seen and out of reach, 'danger' is in reach and
 * unseen, 'sight' is in reach but seen (they can get there, and a ward would
 * show them coming, which is the whole point of the ward), 'none' is the
 * rest of the map.
 */
export function shadeAt(point: Point, sights: LabCircle[], reaches: LabCircle[]): LabShade {
  const seen = sights.some((s) => inside(point, s));
  const reach = dangerAt(point, reaches);
  if (reach) return seen ? 'sight' : 'danger';
  return seen ? 'safe' : 'none';
}

/** The percent grid, each cell tagged by its centre; the caller drops the 'none' cells before drawing. */
export function gridShade(sights: LabCircle[], reaches: LabCircle[], step = SHADE_STEP): LabCell[] {
  const cells: LabCell[] = [];
  if (!(step > 0)) return cells;
  for (let y = 0; y < 100; y += step) {
    for (let x = 0; x < 100; x += step) {
      const w = Math.min(step, 100 - x);
      const h = Math.min(step, 100 - y);
      cells.push({ x, y, w, h, tag: shadeAt({ x: x + w / 2, y: y + h / 2 }, sights, reaches) });
    }
  }
  return cells;
}

/** The words for where a path came from, resolved to our side so a jungle reads as ours or theirs. */
export function areaWords(area: RiftArea | null, ourSide: RiftSide): string | null {
  switch (area) {
    case 'top':
      return 'top lane';
    case 'mid':
      return 'mid lane';
    case 'bot':
      return 'bot lane';
    case 'river':
      return 'the river';
    case 'blueJungle':
      return ourSide === 'blue' ? 'our jungle' : 'their jungle';
    case 'redJungle':
      return ourSide === 'red' ? 'our jungle' : 'their jungle';
    case 'blueBase':
      return ourSide === 'blue' ? 'our base' : 'their base';
    case 'redBase':
      return ourSide === 'red' ? 'our base' : 'their base';
    default:
      return null;
  }
}

/** Their jungler first, since theirs is the path that decides most ganks; the rest in the frame's order. */
function junglerFirst(theirs: FilmFramePlace[]): FilmFramePlace[] {
  return [...theirs].sort((a, b) => (a.seat === 'Jungle' ? -1 : 0) - (b.seat === 'Jungle' ? -1 : 0));
}

/**
 * One line that reads the difference the lab's changes make, in this order:
 * a placed ward that covers one of theirs where they stand or the way they
 * came (the segment from the frame before), then the last moved token of
 * ours (inside a reach; out of reach and in sight; out of reach and unseen),
 * then a placed ward that sees nobody, and a nudge when nothing was changed.
 * The wards win because a ward is what the lead asked about first ("did we
 * have to place a ward there or not"). One of theirs is named by champion
 * when the frame carries it ("their Vi's path"), the seat otherwise: a
 * champion in a seat is what the tokens already show and what the Riot rule
 * allows, never a name.
 */
export function readingOf(scene: LabScene): string {
  const who = (t: { seat: Role; champion?: string }): string => `their ${t.champion ?? t.seat}`;
  for (const t of junglerFirst(scene.theirs)) {
    const before = scene.previous?.find((p) => p.seat === t.seat) ?? null;
    const covered = scene.placed.some((w) => (before ? distToSegment(w, before, t) <= w.r : inside(t, w)));
    if (!covered) continue;
    const from = before ? areaWords(areaAt(before.x, before.y), scene.ourSide) : null;
    if (before && from) return `From here, ${who(t)}'s path from ${from} would have been in sight`;
    if (before) return `From here, ${who(t)}'s path would have been in sight`;
    return `From here, ${who(t)} would have been in sight`;
  }
  const last = scene.moved[scene.moved.length - 1];
  if (last) {
    const inReach = scene.reaches.filter((r) => inside(last, r)).sort((a, b) => Math.hypot(a.x - last.x, a.y - last.y) - Math.hypot(b.x - last.x, b.y - last.y))[0];
    if (inReach) return `Still inside ${who(inReach)}'s reach`;
    return safeAt(last, scene.sights, scene.reaches) ? 'Out of reach and in sight' : 'Out of reach, but nothing sees the way in';
  }
  if (scene.placed.length) return 'That ward sees none of theirs at this minute';
  return 'Drag one of ours, or put a ward down, and this line reads the difference';
}
