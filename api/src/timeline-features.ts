/**
 * A Riot match timeline, reduced to what a review can use.
 *
 * Match-V5 serves a second document per game: one frame a minute with every
 * participant's gold, XP, CS, level and map position, and an event log —
 * kills with coordinates, wards placed and cleared, item purchases, elite
 * monsters, buildings and plates. A thirty-minute game is one to three
 * megabytes of it. The whole payload is read here once, reduced to the
 * figures below, and dropped; nothing raw is ever stored (8 Sep 2026).
 *
 * What this can honestly say, and what it cannot:
 * - Frames are sixty seconds apart, so any position-based read — who was
 *   near a dragon, whether a ward covered a death — is approximate by
 *   construction and is labelled so wherever it is shown.
 * - Ward events carry no position. "Warded" means one of ours placed a ward
 *   shortly before the death and was standing near where it happened.
 * - There is no recall event. A back is a cluster of purchases; gold spent
 *   comes off the frame arithmetic, so a "first item" is a first item's worth
 *   of gold, not a named item.
 * - Nothing about the other team's players leaves this module except a
 *   champion in a seat and where their deaths fell. No puuids, no names.
 *
 * Version 2 (9 Sep 2026) reads, for each death of ours, who was where: their
 * jungler on the kill, our jungler's distance and zone at the nearest frame,
 * their jungler's distance a frame earlier, how many of ours stood near, and
 * whether an elite monster fell within the same minute. It also keeps which
 * of our seats were on each of their deaths, and damage to champions dealt
 * and taken per five minutes. All of it feeds the death ledger in
 * `game-facts.ts`: the jungler's question "could I have been there".
 *
 * Version 3 (10 Sep 2026, Part C: the lead asked to see where our vision was
 * and to work on a position from a second of the tape) keeps the positions:
 * every participant's spot once a minute, keyed by seat on both sides, and
 * every ward of ours at the placer's spot. Both are layers for the film's
 * Rift, never read by the facts, and both are approximate by a minute; the
 * ward's spot doubly so, because a ward event carries no position at all.
 *
 * Version 4 (11 Sep 2026, the lead: "the approximate meters are a bit off,
 * can we tighten that") keeps the position a kill or an elite monster kill
 * carries on the event itself, on each death of ours, each of theirs and
 * each objective. These are not approximate at all — Riot logs the spot the
 * kill happened on — so the film stops sampling a point inside the zone
 * bucket for a death it has an event for, and says which of the two it drew.
 * A few hundred bytes on a document; the trim order below is untouched.
 *
 * Pure. The fetch and the write live in index.ts.
 */
import { LaneRole, POSITION_ROLE } from './lane-read';

/**
 * Bump when the derived shape changes; entries below this are rebuilt inside
 * the budget: the morning refresh rebuilds twenty a run, so a bump refills
 * the prep games over a few mornings, newest first. 4 since 11 Sep 2026, for
 * the event positions on the deaths and the objectives — twenty documents a
 * morning are rebuilt until the prep games have caught up, and until a game
 * has, its film places the deaths by zone as it did before.
 */
export const TIMELINE_VERSION = 4;
export const FRAME_SEC = 60;
/** Summoner's Rift, both axes; blue base at the origin. */
export const MAP_MAX = 14870;
export const BASE_RADIUS = 3000;
export const RIVER_BAND = 1200;
export const LANE_EDGE = 2500;
export const MID_BAND = 1500;
export const WARD_RADIUS = 2000;
export const WARD_TRINKET_SEC = 90;
export const WARD_CONTROL_SEC = 300;
export const OBJECTIVE_RADIUS = 4000;
/** About a screen: our jungler this close to a death could have been in it. */
export const JUNGLE_REACH = 6000;
/** Their jungler this close a frame before a gank was already on that side of the map: a call could have gone out. */
export const THEIR_JUNGLE_WARNING = 7000;
/** One of ours this close to a death was in it, or right there. */
export const ALLY_RADIUS = 2500;
/** An elite monster this close in time to a death: the objective fight, or the jungler was on it. */
export const OBJECTIVE_WINDOW_SEC = 45;
export const DAMAGE_BUCKET_MIN = 5;
/** Under this, the two teams are even. */
export const TEAM_EVEN_GOLD = 1000;
/** About a first legendary item. */
export const ITEM_SPIKE_GOLD = 2500;
export const BACK_CLUSTER_SEC = 10;
export const MAX_DEATHS = 60;
export const MAX_BACKS = 12;
/** The document has to stay small: two hundred of these are read by the app. */
export const MAX_BYTES = 40_000;
/** Positions are kept to this grid (10 Sep 2026): a frame is a minute wide, so a hundred units is nothing beside it, and it keeps ten seats over forty frames near 4 KB. */
export const POSITION_GRID = 100;
/**
 * The longest a placed ward other than a control ward lives: the support
 * item's sight ward, 150 s (a trinket is 90 to 120 s by level). A kill later
 * than that after the placing cannot be that ward, so it is left for a later
 * one when kills are matched to wards (10 Sep 2026).
 */
export const WARD_LIFE_MAX_SEC = 150;

export type MapZone = 'ourBase' | 'theirBase' | 'top' | 'mid' | 'bot' | 'river' | 'ourJungle' | 'theirJungle';
export type Side = 'us' | 'them';
export type LaneName = 'top' | 'mid' | 'bot';

// ---- What Riot sends, the parts read here -----------------------------------

export interface ParticipantFrameLike {
  participantId?: number;
  totalGold?: number;
  currentGold?: number;
  xp?: number;
  minionsKilled?: number;
  jungleMinionsKilled?: number;
  level?: number;
  position?: { x: number; y: number };
  /** Cumulative to this frame. */
  damageStats?: { totalDamageDoneToChampions?: number; totalDamageTaken?: number };
}

export interface TimelineEventLike {
  type: string;
  timestamp: number;
  participantId?: number;
  killerId?: number;
  victimId?: number;
  assistingParticipantIds?: number[];
  creatorId?: number;
  wardType?: string;
  killerTeamId?: number;
  teamId?: number;
  monsterType?: string;
  monsterSubType?: string;
  buildingType?: string;
  laneType?: string;
  position?: { x: number; y: number };
}

export interface FrameLike {
  timestamp: number;
  participantFrames: Record<string, ParticipantFrameLike>;
  events: TimelineEventLike[];
}

export interface RiotTimelineLike {
  info: {
    frameInterval?: number;
    participants?: { participantId: number; puuid: string }[];
    frames: FrameLike[];
  };
}

/** The cached match, as far as this module reads it. */
export interface CachedMatchLike {
  durationSec?: number;
  participants: { puuid: string; teamId: number; teamPosition: string; championName: string }[];
}

// ---- What is stored -----------------------------------------------------------

export interface Mark {
  minute: number;
  side: Side;
}

export interface LaneDiff {
  gold: number;
  xp: number;
  cs: number;
}

export interface TimelineLane {
  seat: LaneRole;
  name?: string;
  champion: string;
  theirChampion: string;
  at5?: LaneDiff;
  at10?: LaneDiff;
  at15?: LaneDiff;
  /** The last minute, up to twenty, at which the gold lead changed hands. */
  flippedAt?: number;
}

export interface TimelineObjective {
  minute: number;
  type: 'dragon' | 'herald' | 'grubs' | 'baron' | 'elder' | 'atakhan';
  subType?: string;
  side: Side;
  /** Our seats credited on the kill. */
  ourInvolved: LaneRole[];
  /** Our seats within OBJECTIVE_RADIUS at the nearest frame: approximate. */
  ourNear: LaneRole[];
  /**
   * Where the monster fell, in Riot units to POSITION_GRID (version 4,
   * 11 Sep 2026): the ELITE_MONSTER_KILL event's own position, not a pit the
   * film assumed and not a sample inside a zone. Absent below version 4, and
   * on an event Riot sent without one.
   */
  x?: number;
  y?: number;
}

export interface TimelineDeath {
  sec: number;
  minute: number;
  seat: LaneRole;
  zone: MapZone;
  /** On their half of the map. */
  theirSide: boolean;
  /** Enemies credited: the killer plus assists. */
  killers: number;
  /** Killed by a minion, a tower or a monster. */
  executed: boolean;
  /** A friendly ward went down nearby shortly before: approximate. */
  warded: boolean;
  /** Their jungler was credited, killer or assist. Absent below version 2. */
  theirJungleIn?: boolean;
  /** Our jungler's distance to the death at the nearest frame, to the hundred; absent when the jungler is the victim or has no frame. Approximate by a minute. */
  ourJungleDist?: number;
  ourJungleZone?: MapZone;
  /** Their jungler's distance to the spot at the frame before: were they already on this side of the map. */
  theirJungleDistBefore?: number;
  /** Our other seats within ALLY_RADIUS at the nearest frame. Absent below version 2. */
  alliesNear?: number;
  /** An elite monster fell within OBJECTIVE_WINDOW_SEC of the death. Absent below version 2. */
  objectiveNear?: boolean;
  /**
   * Where the kill happened, in Riot units to POSITION_GRID (version 4,
   * 11 Sep 2026): the CHAMPION_KILL event's own position. The one figure on
   * this row that is not approximate by a minute — the log carries the spot —
   * so the film draws the pin here instead of sampling inside `zone`. Absent
   * below version 4, and on a kill Riot sent without a position.
   */
  x?: number;
  y?: number;
}

/**
 * Where everyone stood, once a minute (version 3, 10 Sep 2026). `minutes[i]`
 * is the frame's minute and each seat's track one flat list of pairs,
 * `[x0, y0, x1, y1, ...]`, so frame i sits at `track[2 * i]`, `track[2 * i + 1]`
 * in Riot units (0 to MAP_MAX on both axes, blue base at the origin, y up),
 * rounded to POSITION_GRID; a seat with no position that frame carries
 * NO_POSITION twice, never a guess. Flat because the first shape, a list of
 * [x, y] pairs, was an array inside an array, which Firestore refuses on a
 * write (10 Sep 2026, second fix pass: the dev road never touched Firestore,
 * so nothing caught it); `nestedArrayPath` guards the rule. Theirs are
 * keyed by seat through the same seat map as the lanes: a champion in a
 * seat, no puuid, no name. Mirrors the app's `TimelinePositions`.
 */
export interface TimelinePositions {
  minutes: number[];
  ours: Partial<Record<LaneRole, number[]>>;
  theirs: Partial<Record<LaneRole, number[]>>;
}

/** Both halves of a frame's pair when the seat had no position: never a grid value, since toGrid rounds to hundreds. */
export const NO_POSITION = -1;

/**
 * The first array nested in an array, as a path, or null when there is
 * none. Firestore rejects an array element that is itself an array, and the
 * Admin SDK does not check it before the write, so the reducer's output is
 * walked once in its spec; exported so a future shape can be checked the
 * same way.
 */
export function nestedArrayPath(value: unknown, path = '$'): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (Array.isArray(value[i])) return `${path}[${i}]`;
      const inner = nestedArrayPath(value[i], `${path}[${i}]`);
      if (inner) return inner;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const inner = nestedArrayPath(v, `${path}.${k}`);
      if (inner) return inner;
    }
  }
  return null;
}

/** A trinket (the yellow trinket or the support item's sight ward), a control ward, or anything else Riot logs (a farsight ward, a zombie ward). */
export type TimelineWardType = 'trinket' | 'control' | 'other';

/**
 * One ward of ours (version 3): when, who, which kind, and where the placer
 * stood at the nearest frame, to POSITION_GRID — a ward event carries no
 * position, so this is approximate by a minute and every surface drawing it
 * says so. `killedSec` is the earliest kill of the same Riot ward type after
 * it by someone not ours, once per kill; the log carries no ward id, so that
 * is a guess too, and absent when no kill fits (a trinket that timed out, a
 * control ward that stood to the end). Mirrors the app's `TimelineWard`.
 */
export interface TimelineWard {
  sec: number;
  seat: LaneRole;
  type: TimelineWardType;
  x: number;
  y: number;
  killedSec?: number;
}

export interface MatchTimeline {
  matchId: string;
  timelineVersion: number;
  builtAt: string;
  ourSide: 'blue' | 'red';
  durationSec: number;
  frameSec: number;
  /** Index is the minute; ours minus theirs, team totals. */
  goldDiff: number[];
  curve: {
    at10?: number;
    at15?: number;
    at20?: number;
    at25?: number;
    leadAt: Partial<Record<'10' | '15' | '20' | '25', Side | 'even'>>;
    biggestLead: { gold: number; minute: number };
    biggestDeficit: { gold: number; minute: number };
  };
  lanes: TimelineLane[];
  firsts: {
    blood?: Mark;
    tower?: Mark & { lane: LaneName };
    dragon?: Mark;
    grubs?: Mark;
    herald?: Mark;
  };
  objectives: TimelineObjective[];
  plates: { ours: Record<LaneName, number>; theirs: Record<LaneName, number> };
  deaths: TimelineDeath[];
  /** Only enough for fight clusters, which of our seats were on the kill (absent below version 2), and where it happened off the event (absent below version 4). */
  theirDeaths: { sec: number; minute: number; zone: MapZone; ourInvolved?: LaneRole[]; x?: number; y?: number }[];
  /** Per five-minute bucket. */
  vision: { seat: LaneRole; placed: number[]; killed: number[] }[];
  spend: { seat: LaneRole; firstItemMinute?: number; secondItemMinute?: number; backs: number[] }[];
  /** Damage to champions dealt and taken per five-minute bucket, our five only. Absent below version 2. */
  damage?: { seat: LaneRole; dealt: number[]; taken: number[] }[];
  /** Where the ten stood, once a minute. Absent below version 3, and when the size cap took the layers. */
  positions?: TimelinePositions;
  /** Our wards at the placer's position, in time order. Absent below version 3, and when the size cap took the layers. */
  wards?: TimelineWard[];
  /** The facts read off the figures above (`game-facts.ts`), stored beside them. */
  facts?: unknown;
  bytes: number;
}

export function isTimelineCurrent(doc: { timelineVersion?: number } | undefined): boolean {
  return doc?.timelineVersion === TIMELINE_VERSION;
}

// ---- The map --------------------------------------------------------------------

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Where on the Rift a point is, from our side's point of view. Bases first,
 * then the two side lanes along the map's edges, mid along the diagonal, the
 * river across it, and whatever is left is a jungle, ours or theirs by which
 * side of the river it sits on.
 */
export function zoneOf(x: number, y: number, ourSide: 'blue' | 'red'): MapZone {
  const blueBase = dist(x, y, 0, 0) < BASE_RADIUS;
  const redBase = dist(x, y, MAP_MAX, MAP_MAX) < BASE_RADIUS;
  if (blueBase) return ourSide === 'blue' ? 'ourBase' : 'theirBase';
  if (redBase) return ourSide === 'red' ? 'ourBase' : 'theirBase';
  if (x < LANE_EDGE || y > MAP_MAX - LANE_EDGE) return 'top';
  if (y < LANE_EDGE || x > MAP_MAX - LANE_EDGE) return 'bot';
  if (Math.abs(x - y) < MID_BAND) return 'mid';
  if (Math.abs(x + y - MAP_MAX) < RIVER_BAND) return 'river';
  const blueHalf = x + y < MAP_MAX;
  return blueHalf === (ourSide === 'blue') ? 'ourJungle' : 'theirJungle';
}

function onTheirHalf(x: number, y: number, ourSide: 'blue' | 'red'): boolean {
  const blueHalf = x + y < MAP_MAX;
  return blueHalf !== (ourSide === 'blue');
}

// ---- Helpers ---------------------------------------------------------------------

const LANE_OF: Record<string, LaneName> = { TOP_LANE: 'top', MID_LANE: 'mid', BOT_LANE: 'bot' };

function minuteOf(timestampMs: number): number {
  return Math.round(timestampMs / 1000 / FRAME_SEC);
}

function bucketOf(timestampMs: number): number {
  return Math.floor(timestampMs / 1000 / 60 / 5);
}

function round(n: number): number {
  return Math.round(n);
}

interface Ids {
  ourSide: 'blue' | 'red';
  ourTeamId: number;
  ours: Set<number>;
  seatOf: Map<number, LaneRole>;
  championOf: Map<number, string>;
  nameOf: Map<number, string>;
  positionOf: Map<number, string>;
}

/**
 * Who is who. Riot numbers participants 1–10; the timeline names them by that
 * number, the cached match by puuid. Riot's own participant list bridges the
 * two; older payloads without it fall back to the match's order, which is
 * Riot's order too.
 */
function identify(
  raw: RiotTimelineLike,
  match: CachedMatchLike,
  rosterPuuids: ReadonlySet<string>,
  nameByPuuid: ReadonlyMap<string, string>
): Ids | null {
  const pidOf = new Map<string, number>();
  for (const p of raw.info.participants ?? []) pidOf.set(p.puuid, p.participantId);
  match.participants.forEach((p, i) => {
    if (!pidOf.has(p.puuid)) pidOf.set(p.puuid, i + 1);
  });
  const rosterTeams = match.participants.filter((p) => rosterPuuids.has(p.puuid)).map((p) => p.teamId);
  if (!rosterTeams.length) return null;
  const ourTeamId = rosterTeams.filter((t) => t === 100).length >= rosterTeams.length / 2 ? 100 : 200;
  const ids: Ids = {
    ourSide: ourTeamId === 100 ? 'blue' : 'red',
    ourTeamId,
    ours: new Set(),
    seatOf: new Map(),
    championOf: new Map(),
    nameOf: new Map(),
    positionOf: new Map()
  };
  for (const p of match.participants) {
    const pid = pidOf.get(p.puuid);
    if (pid === undefined) continue;
    ids.championOf.set(pid, p.championName);
    ids.positionOf.set(pid, p.teamPosition);
    const seat = POSITION_ROLE[p.teamPosition];
    if (seat) ids.seatOf.set(pid, seat);
    if (p.teamId === ourTeamId) {
      ids.ours.add(pid);
      const name = nameByPuuid.get(p.puuid);
      if (name) ids.nameOf.set(pid, name);
    }
  }
  return ids;
}

function frameAt(frames: FrameLike[], timestampMs: number): FrameLike {
  let best = frames[0];
  for (const f of frames) {
    if (Math.abs(f.timestamp - timestampMs) < Math.abs(best.timestamp - timestampMs)) best = f;
  }
  return best;
}

function positionIn(frame: FrameLike, pid: number): { x: number; y: number } | undefined {
  const pf = frame.participantFrames[String(pid)];
  return pf?.position;
}

function seatsNear(frame: FrameLike, pids: Iterable<number>, seatOf: Map<number, LaneRole>, at: { x: number; y: number }, radius: number): LaneRole[] {
  const out: LaneRole[] = [];
  for (const pid of pids) {
    const pos = positionIn(frame, pid);
    const seat = seatOf.get(pid);
    if (pos && seat && dist(pos.x, pos.y, at.x, at.y) <= radius) out.push(seat);
  }
  return out;
}

// ---- The build --------------------------------------------------------------------

/** Null when there is nothing to read: under two frames, or none of ours in the game. */
export function buildMatchTimeline(
  matchId: string,
  raw: RiotTimelineLike,
  match: CachedMatchLike,
  rosterPuuids: ReadonlySet<string>,
  nameByPuuid: ReadonlyMap<string, string>,
  now: string
): MatchTimeline | null {
  const frames = [...(raw.info.frames ?? [])].sort((a, b) => a.timestamp - b.timestamp);
  if (frames.length < 2) return null;
  const ids = identify(raw, match, rosterPuuids, nameByPuuid);
  if (!ids) return null;
  const theirs = [...ids.championOf.keys()].filter((pid) => !ids.ours.has(pid));
  const ourJungle = [...ids.ours].find((pid) => ids.seatOf.get(pid) === 'Jungle');
  const theirJungle = theirs.find((pid) => ids.seatOf.get(pid) === 'Jungle');
  const last = frames[frames.length - 1];
  const durationSec = match.durationSec ?? Math.round(last.timestamp / 1000);

  // Team gold, one figure a minute.
  const goldDiff: number[] = [];
  for (const f of frames) {
    let ours = 0;
    let them = 0;
    for (const [key, pf] of Object.entries(f.participantFrames)) {
      const pid = pf.participantId ?? Number(key);
      const gold = pf.totalGold ?? 0;
      if (ids.ours.has(pid)) ours += gold;
      else if (ids.championOf.has(pid)) them += gold;
    }
    goldDiff[minuteOf(f.timestamp)] = ours - them;
  }
  for (let m = 0; m < goldDiff.length; m += 1) if (goldDiff[m] === undefined) goldDiff[m] = goldDiff[m - 1] ?? 0;

  const at = (m: number): number | undefined => (m < goldDiff.length ? goldDiff[m] : undefined);
  const leadOf = (g: number | undefined): Side | 'even' | undefined =>
    g === undefined ? undefined : Math.abs(g) < TEAM_EVEN_GOLD ? 'even' : g > 0 ? 'us' : 'them';
  let biggestLead = { gold: 0, minute: 0 };
  let biggestDeficit = { gold: 0, minute: 0 };
  goldDiff.forEach((g, m) => {
    if (g > biggestLead.gold) biggestLead = { gold: g, minute: m };
    if (g < biggestDeficit.gold) biggestDeficit = { gold: g, minute: m };
  });
  const leadAt: MatchTimeline['curve']['leadAt'] = {};
  for (const m of [10, 15, 20, 25] as const) {
    const l = leadOf(at(m));
    if (l) leadAt[String(m) as '10'] = l;
  }
  const curve: MatchTimeline['curve'] = {
    ...(at(10) !== undefined && { at10: at(10) }),
    ...(at(15) !== undefined && { at15: at(15) }),
    ...(at(20) !== undefined && { at20: at(20) }),
    ...(at(25) !== undefined && { at25: at(25) }),
    leadAt,
    biggestLead,
    biggestDeficit
  };

  // Lanes: our seat against theirs, with the same pairing the lane read uses.
  const lanes: TimelineLane[] = [];
  const frameByMinute = new Map<number, FrameLike>();
  for (const f of frames) frameByMinute.set(minuteOf(f.timestamp), f);
  const laneDiff = (m: number, ours: number, them: number): LaneDiff | undefined => {
    const f = frameByMinute.get(m);
    const a = f?.participantFrames[String(ours)];
    const b = f?.participantFrames[String(them)];
    if (!a || !b) return undefined;
    return {
      gold: (a.totalGold ?? 0) - (b.totalGold ?? 0),
      xp: (a.xp ?? 0) - (b.xp ?? 0),
      cs: (a.minionsKilled ?? 0) + (a.jungleMinionsKilled ?? 0) - (b.minionsKilled ?? 0) - (b.jungleMinionsKilled ?? 0)
    };
  };
  for (const pid of ids.ours) {
    const seat = ids.seatOf.get(pid);
    if (!seat) continue;
    const position = ids.positionOf.get(pid);
    const rival = theirs.find((t) => ids.positionOf.get(t) === position);
    if (rival === undefined) continue;
    let flippedAt: number | undefined;
    let lastSign = 0;
    for (let m = 1; m <= Math.min(20, goldDiff.length - 1); m += 1) {
      const d = laneDiff(m, pid, rival);
      if (!d) continue;
      const s = Math.sign(d.gold);
      if (s !== 0 && lastSign !== 0 && s !== lastSign) flippedAt = m;
      if (s !== 0) lastSign = s;
    }
    lanes.push({
      seat,
      ...(ids.nameOf.has(pid) && { name: ids.nameOf.get(pid) }),
      champion: ids.championOf.get(pid) ?? '',
      theirChampion: ids.championOf.get(rival) ?? '',
      ...(laneDiff(5, pid, rival) && { at5: laneDiff(5, pid, rival) }),
      ...(laneDiff(10, pid, rival) && { at10: laneDiff(10, pid, rival) }),
      ...(laneDiff(15, pid, rival) && { at15: laneDiff(15, pid, rival) }),
      ...(flippedAt !== undefined && { flippedAt })
    });
  }

  // Events, in time order.
  const events = frames.flatMap((f) => f.events ?? []).sort((a, b) => a.timestamp - b.timestamp);
  const sideOfTeam = (teamId: number | undefined): Side => (teamId === ids.ourTeamId ? 'us' : 'them');
  const sideOfPid = (pid: number | undefined): Side | undefined =>
    pid === undefined || pid === 0 ? undefined : ids.ours.has(pid) ? 'us' : 'them';
  const monsterTimes = events.filter((e) => e.type === 'ELITE_MONSTER_KILL' && monsterKind(e.monsterType, e.monsterSubType)).map((e) => e.timestamp);
  const toHundred = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.round(dist(a.x, a.y, b.x, b.y) / 100) * 100;

  const wards = events.filter((e) => e.type === 'WARD_PLACED' && e.creatorId !== undefined && ids.ours.has(e.creatorId) && e.wardType !== 'UNDEFINED');
  const warded = (death: TimelineEventLike): boolean => {
    if (!death.position) return false;
    for (const w of wards) {
      const age = (death.timestamp - w.timestamp) / 1000;
      const window = w.wardType === 'CONTROL_WARD' ? WARD_CONTROL_SEC : WARD_TRINKET_SEC;
      if (age < 0 || age > window) continue;
      const pos = positionIn(frameAt(frames, w.timestamp), w.creatorId as number);
      if (pos && dist(pos.x, pos.y, death.position.x, death.position.y) <= WARD_RADIUS) return true;
    }
    return false;
  };

  const firsts: MatchTimeline['firsts'] = {};
  const objectives: TimelineObjective[] = [];
  const plates = { ours: { top: 0, mid: 0, bot: 0 }, theirs: { top: 0, mid: 0, bot: 0 } };
  const deaths: TimelineDeath[] = [];
  const theirDeaths: MatchTimeline['theirDeaths'] = [];
  const vision = new Map<LaneRole, { placed: number[]; killed: number[] }>();
  const visionOf = (seat: LaneRole) => {
    let v = vision.get(seat);
    if (!v) {
      v = { placed: [], killed: [] };
      vision.set(seat, v);
    }
    return v;
  };
  const bump = (arr: number[], bucket: number) => {
    while (arr.length <= bucket) arr.push(0);
    arr[bucket] += 1;
  };
  const purchases = new Map<number, number[]>();

  for (const e of events) {
    const minute = minuteOf(e.timestamp);
    switch (e.type) {
      case 'CHAMPION_KILL': {
        const victim = e.victimId;
        if (victim === undefined) break;
        const victimSide = sideOfPid(victim);
        if (!firsts.blood && victimSide) firsts.blood = { minute, side: victimSide === 'us' ? 'them' : 'us' };
        if (!e.position) break;
        const at = e.position;
        const zone = zoneOf(at.x, at.y, ids.ourSide);
        const credited = [e.killerId ?? 0, ...(e.assistingParticipantIds ?? [])];
        if (victimSide === 'us') {
          const seat = ids.seatOf.get(victim);
          if (seat && deaths.length < MAX_DEATHS) {
            const nearFrame = frameAt(frames, e.timestamp);
            const before = frameAt(frames, e.timestamp - FRAME_SEC * 1000);
            const jg = ourJungle !== undefined && ourJungle !== victim ? positionIn(nearFrame, ourJungle) : undefined;
            const theirJg = theirJungle !== undefined ? positionIn(before, theirJungle) : undefined;
            deaths.push({
              sec: Math.round(e.timestamp / 1000),
              minute,
              seat,
              zone,
              // The event's own spot (version 4, 11 Sep 2026). A kill without a
              // position never reaches here — the break above drops it — so both
              // figures are always written together or not at all.
              x: toGrid(at.x),
              y: toGrid(at.y),
              theirSide: onTheirHalf(at.x, at.y, ids.ourSide),
              killers: (e.killerId ? 1 : 0) + (e.assistingParticipantIds?.length ?? 0),
              executed: !e.killerId,
              warded: warded(e),
              theirJungleIn: theirJungle !== undefined && credited.includes(theirJungle),
              ...(jg && { ourJungleDist: toHundred(jg, at), ourJungleZone: zoneOf(jg.x, jg.y, ids.ourSide) }),
              ...(theirJg && { theirJungleDistBefore: toHundred(theirJg, at) }),
              alliesNear: seatsNear(nearFrame, [...ids.ours].filter((pid) => pid !== victim), ids.seatOf, at, ALLY_RADIUS).length,
              objectiveNear: monsterTimes.some((t) => Math.abs(t - e.timestamp) <= OBJECTIVE_WINDOW_SEC * 1000)
            });
          }
        } else if (victimSide === 'them') {
          const ourInvolved = credited.filter((pid) => ids.ours.has(pid)).map((pid) => ids.seatOf.get(pid)).filter((x): x is LaneRole => !!x);
          theirDeaths.push({ sec: Math.round(e.timestamp / 1000), minute, zone, ourInvolved, x: toGrid(at.x), y: toGrid(at.y) });
        }
        break;
      }
      case 'ELITE_MONSTER_KILL': {
        const type = monsterKind(e.monsterType, e.monsterSubType);
        if (!type) break;
        const side = sideOfTeam(e.killerTeamId);
        if (type === 'dragon' && !firsts.dragon) firsts.dragon = { minute, side };
        if (type === 'grubs' && !firsts.grubs) firsts.grubs = { minute, side };
        if (type === 'herald' && !firsts.herald) firsts.herald = { minute, side };
        const credited = [e.killerId ?? 0, ...(e.assistingParticipantIds ?? [])].filter((pid) => ids.ours.has(pid));
        const ourInvolved = credited.map((pid) => ids.seatOf.get(pid)).filter((s): s is LaneRole => !!s);
        const ourNear = e.position ? seatsNear(frameAt(frames, e.timestamp), ids.ours, ids.seatOf, e.position, OBJECTIVE_RADIUS) : [];
        objectives.push({
          minute,
          type,
          ...(type === 'dragon' && e.monsterSubType && { subType: e.monsterSubType.replace(/_DRAGON$/, '').toLowerCase() }),
          side,
          ourInvolved,
          ourNear,
          // Where the monster fell (version 4, 11 Sep 2026); an event without a position keeps neither figure.
          ...(e.position && { x: toGrid(e.position.x), y: toGrid(e.position.y) })
        });
        break;
      }
      case 'BUILDING_KILL': {
        if (e.buildingType !== 'TOWER_BUILDING' || firsts.tower) break;
        const lane = LANE_OF[e.laneType ?? ''];
        if (!lane) break;
        // teamId is the owner of what fell, so the taker is the other side.
        firsts.tower = { minute, side: e.teamId === ids.ourTeamId ? 'them' : 'us', lane };
        break;
      }
      case 'TURRET_PLATE_DESTROYED': {
        const lane = LANE_OF[e.laneType ?? ''];
        if (!lane) break;
        if (e.teamId === ids.ourTeamId) plates.theirs[lane] += 1;
        else plates.ours[lane] += 1;
        break;
      }
      case 'WARD_PLACED': {
        if (e.creatorId === undefined || !ids.ours.has(e.creatorId) || e.wardType === 'UNDEFINED') break;
        const seat = ids.seatOf.get(e.creatorId);
        if (seat) bump(visionOf(seat).placed, bucketOf(e.timestamp));
        break;
      }
      case 'WARD_KILL': {
        if (e.killerId === undefined || !ids.ours.has(e.killerId)) break;
        const seat = ids.seatOf.get(e.killerId);
        if (seat) bump(visionOf(seat).killed, bucketOf(e.timestamp));
        break;
      }
      case 'ITEM_PURCHASED': {
        if (e.participantId === undefined || !ids.ours.has(e.participantId)) break;
        const list = purchases.get(e.participantId) ?? [];
        list.push(e.timestamp);
        purchases.set(e.participantId, list);
        break;
      }
      default:
        break;
    }
  }

  // Spend and backs, per seat.
  const spend: MatchTimeline['spend'] = [];
  for (const pid of ids.ours) {
    const seat = ids.seatOf.get(pid);
    if (!seat) continue;
    let cumulative = 0;
    let firstItemMinute: number | undefined;
    let secondItemMinute: number | undefined;
    let prev: ParticipantFrameLike | undefined;
    for (const f of frames) {
      const pf = f.participantFrames[String(pid)];
      if (!pf) continue;
      if (prev && pf.totalGold !== undefined && prev.totalGold !== undefined && pf.currentGold !== undefined && prev.currentGold !== undefined) {
        const spent = prev.currentGold + (pf.totalGold - prev.totalGold) - pf.currentGold;
        if (spent > 0) cumulative += spent;
        const minute = minuteOf(f.timestamp);
        if (firstItemMinute === undefined && cumulative >= ITEM_SPIKE_GOLD) firstItemMinute = minute;
        if (secondItemMinute === undefined && cumulative >= ITEM_SPIKE_GOLD * 2) secondItemMinute = minute;
      }
      prev = pf;
    }
    const backs: number[] = [];
    let clusterStart: number | undefined;
    for (const t of purchases.get(pid) ?? []) {
      if (clusterStart === undefined || t - clusterStart > BACK_CLUSTER_SEC * 1000) {
        clusterStart = t;
        // Starting items are not a back.
        if (t >= FRAME_SEC * 1000 && backs.length < MAX_BACKS) backs.push(minuteOf(t));
      }
    }
    spend.push({
      seat,
      ...(firstItemMinute !== undefined && { firstItemMinute }),
      ...(secondItemMinute !== undefined && { secondItemMinute }),
      backs
    });
  }

  // Damage to champions, dealt and taken, per five minutes: the frames are
  // cumulative, so each is the step from the frame before. Bucket k is minutes
  // 5k+1 to 5k+5. A payload without the figures leaves the list empty.
  const damage: NonNullable<MatchTimeline['damage']> = [];
  const add = (arr: number[], bucket: number, n: number) => {
    while (arr.length <= bucket) arr.push(0);
    arr[bucket] += Math.max(0, n);
  };
  for (const pid of ids.ours) {
    const seat = ids.seatOf.get(pid);
    if (!seat) continue;
    const dealt: number[] = [];
    const taken: number[] = [];
    let prev: { dealt: number; taken: number } | undefined;
    for (const f of frames) {
      const d = f.participantFrames[String(pid)]?.damageStats;
      if (!d) continue;
      const cur = { dealt: d.totalDamageDoneToChampions ?? 0, taken: d.totalDamageTaken ?? 0 };
      if (prev) {
        const bucket = Math.floor(Math.max(0, minuteOf(f.timestamp) - 1) / DAMAGE_BUCKET_MIN);
        add(dealt, bucket, cur.dealt - prev.dealt);
        add(taken, bucket, cur.taken - prev.taken);
      }
      prev = cur;
    }
    if (prev) damage.push({ seat, dealt: dealt.map(round), taken: taken.map(round) });
  }

  // Where everyone stood, once a minute (version 3, 10 Sep 2026). One seat
  // per side through the same seat map the lanes use, first participant in
  // Riot's order when two share one; a participant without a seat is not
  // drawn at all. Nothing of theirs but the seat leaves here. The frames are
  // read through `frameByMinute`, so two frames rounding to one minute (the
  // last frame lands where the game ended) resolve as goldDiff does: the
  // later one wins, and `minutes` stays strictly increasing.
  const seatPids = (pids: Iterable<number>): [LaneRole, number][] => {
    const taken = new Map<LaneRole, number>();
    for (const pid of pids) {
      const seat = ids.seatOf.get(pid);
      if (seat && !taken.has(seat)) taken.set(seat, pid);
    }
    return [...taken.entries()].sort((a, b) => SEAT_ORDER[a[0]] - SEAT_ORDER[b[0]]);
  };
  const minuteFrames = [...frameByMinute.entries()];
  // One flat list per seat, a pair a frame (see `TimelinePositions`): a
  // list of pairs is an array in an array, and Firestore refuses the write.
  const placeOf = (frame: FrameLike, pid: number): [number, number] => {
    const pos = positionIn(frame, pid);
    return pos ? [toGrid(pos.x), toGrid(pos.y)] : [NO_POSITION, NO_POSITION];
  };
  const track = (seats: [LaneRole, number][]): TimelinePositions['ours'] => {
    const out: TimelinePositions['ours'] = {};
    for (const [seat, pid] of seats) out[seat] = minuteFrames.flatMap(([, f]) => placeOf(f, pid));
    return out;
  };
  const positions: TimelinePositions = {
    minutes: minuteFrames.map(([m]) => m),
    ours: track(seatPids(ids.ours)),
    theirs: track(seatPids(theirs))
  };

  // Our wards with where the placer stood (version 3). A ward event carries
  // no position, so the spot is the placer's at the nearest frame — the same
  // read `warded()` makes, approximate by a minute — and a ward whose placer
  // has no position that frame is left out rather than placed on a guess.
  // The log carries no ward id either, so a kill is matched by type: the
  // earliest WARD_KILL of the same Riot wardType at or after the placing, by
  // someone not ours, not already claimed by an earlier ward, and for
  // anything but a control ward within WARD_LIFE_MAX_SEC (a kill later than
  // the ward could have lived is someone else's). A control ward's window
  // ends where its placer's next control ward begins (10 Sep 2026, second
  // fix pass): a player holds one on the map, so the next placing removes
  // the last, and a kill after it is the replacement's. Teemo's shrooms are
  // traps, not vision, and 'UNDEFINED' is Riot's placeholder: neither is a
  // ward here.
  const wardKills = events.filter(
    (e) => e.type === 'WARD_KILL' && e.killerId !== undefined && e.killerId !== 0 && !ids.ours.has(e.killerId) && !!e.wardType
  );
  const claimed = new Set<TimelineEventLike>();
  const wardList: TimelineWard[] = [];
  const nextControlBy = (pid: number, after: number): number =>
    wards.reduce((next, o) => (o.creatorId === pid && o.wardType === 'CONTROL_WARD' && o.timestamp > after && o.timestamp < next ? o.timestamp : next), Number.POSITIVE_INFINITY);
  for (const w of wards) {
    if (w.wardType === 'TEEMO_MUSHROOM') continue;
    const pid = w.creatorId as number;
    const seat = ids.seatOf.get(pid);
    const pos = positionIn(frameAt(frames, w.timestamp), pid);
    if (!seat || !pos) continue;
    const type = wardKindOf(w.wardType);
    const until = type === 'control' ? nextControlBy(pid, w.timestamp) : w.timestamp + WARD_LIFE_MAX_SEC * 1000;
    const kill = wardKills.find((k) => !claimed.has(k) && k.wardType === w.wardType && k.timestamp >= w.timestamp && k.timestamp <= until);
    if (kill) claimed.add(kill);
    wardList.push({
      sec: Math.round(w.timestamp / 1000),
      seat,
      type,
      x: toGrid(pos.x),
      y: toGrid(pos.y),
      ...(kill && { killedSec: Math.round(kill.timestamp / 1000) })
    });
  }

  const doc: MatchTimeline = {
    matchId,
    timelineVersion: TIMELINE_VERSION,
    builtAt: now,
    ourSide: ids.ourSide,
    durationSec,
    frameSec: Math.round((raw.info.frameInterval ?? FRAME_SEC * 1000) / 1000),
    goldDiff: goldDiff.map(round),
    curve,
    lanes: lanes.sort((a, b) => SEAT_ORDER[a.seat] - SEAT_ORDER[b.seat]),
    firsts,
    objectives,
    plates,
    deaths,
    theirDeaths,
    vision: [...vision.entries()].map(([seat, v]) => ({ seat, ...v })).sort((a, b) => SEAT_ORDER[a.seat] - SEAT_ORDER[b.seat]),
    spend: spend.sort((a, b) => SEAT_ORDER[a.seat] - SEAT_ORDER[b.seat]),
    damage: damage.sort((a, b) => SEAT_ORDER[a.seat] - SEAT_ORDER[b.seat]),
    positions,
    wards: wardList,
    bytes: 0
  };
  doc.bytes = measure(doc);
  if (doc.bytes > MAX_BYTES) {
    // The fight clusters are the first thing to go; the deaths of ours stay.
    doc.theirDeaths = [];
    doc.bytes = measure(doc);
  }
  if (doc.bytes > MAX_BYTES) {
    // Still over: the layers go (10 Sep 2026). The facts and the reads never
    // read them, and the app draws a document without them as it draws one
    // written before version 3. A thirty-five-minute game is nowhere near
    // this; it is the guard for a game that ran an hour.
    delete doc.positions;
    delete doc.wards;
    doc.bytes = measure(doc);
  }
  return doc;
}

function toGrid(n: number): number {
  return Math.round(n / POSITION_GRID) * POSITION_GRID;
}

/** Riot's ward types folded to the three the film draws: sight for 90 s, a control ward until it is killed, and the rest. */
function wardKindOf(wardType: string | undefined): TimelineWardType {
  switch (wardType) {
    case 'YELLOW_TRINKET':
    case 'SIGHT_WARD':
      return 'trinket';
    case 'CONTROL_WARD':
      return 'control';
    default:
      return 'other';
  }
}

/** The size as stored, the figure itself included: a second pass settles its digits. */
function measure(doc: MatchTimeline): number {
  doc.bytes = JSON.stringify(doc).length;
  return JSON.stringify(doc).length;
}

const SEAT_ORDER: Record<LaneRole, number> = { Top: 0, Jungle: 1, Mid: 2, ADC: 3, Support: 4 };

function monsterKind(type: string | undefined, subType: string | undefined): TimelineObjective['type'] | null {
  switch (type) {
    case 'DRAGON':
      return subType === 'ELDER_DRAGON' ? 'elder' : 'dragon';
    case 'RIFTHERALD':
      return 'herald';
    case 'BARON_NASHOR':
      return 'baron';
    case 'HORDE':
      return 'grubs';
    case 'ATAKHAN':
      return 'atakhan';
    default:
      return null;
  }
}
