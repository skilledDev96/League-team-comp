/**
 * How a game went, in facts a person or a model can read.
 *
 * The timeline document has the figures; this turns them into the sentences
 * the review is built from — which lanes were won and when they turned,
 * the shape of the gold curve, the fights that cost the most, the deaths
 * nobody was near, the objectives given up with nobody in the river. The
 * same facts go to the drawer on the Games page and into the model's
 * prompt, so what the model says can always be checked against what the
 * team sees (8 Sep 2026).
 *
 * A replay has totals only, so `endOfGameFacts` says what it can from the
 * lane reads and the objective counts and labels itself as such.
 *
 * `compareCurve` is a copy of the one in the frontend's
 * `core/comp-expectation.ts`, on purpose: the browser re-renders it the
 * moment an expectation is edited, the review reads it without a browser.
 * Keep the two identical.
 */
import { CompExpectation } from './daily-refresh';
import { LaneRead, LaneRole, LaneVerdict, PlayerFacts } from './lane-read';
import { GameObjectives } from './objectives';
import { MapZone, MatchTimeline, TimelineObjective } from './timeline-features';

export const FACTS_VERSION = 1;

/** Deaths within this many seconds of each other, in one zone, are one fight. */
export const CLUSTER_SEC = 45;
/** A lead this large, given back, is a throw; a deficit this large, overturned, a comeback. */
export const SWING_GOLD = 3000;
export const EVEN_GOLD = 1000;
/** Lane gold at ten that reads as a lane won or lost when Riot's own read is missing. */
export const LANE_EDGE_GOLD = 500;
/** An objective taken within this many seconds of one given up is a trade. */
export const TRADE_SEC = 90;
export const MAX_LINES = 12;

/** The subset of an analysis game the facts read. */
export interface AnalysisGameLike {
  win: boolean;
  durationSec?: number;
  side?: 'blue' | 'red';
  queue: string;
  players: {
    name: string;
    position: string;
    champion: string;
    deaths: number;
    lane?: LaneRead;
    facts?: PlayerFacts;
    visionScore?: number;
  }[];
  objectives?: GameObjectives;
  kills?: { ours: number; theirs: number };
  lossFactors?: { label: string; detail: string }[];
  winFactors?: { label: string; detail: string }[];
}

export type CurveShape = 'led throughout' | 'trailed throughout' | 'came back' | 'threw' | 'swung' | 'even' | 'unknown';

export interface GameFacts {
  factsVersion: number;
  tier: 'timeline' | 'endOfGame';
  result: 'win' | 'loss';
  durationMin: number;
  side?: 'blue' | 'red';
  curve: {
    at10?: number;
    at15?: number;
    at20?: number;
    at25?: number;
    peakLead?: { gold: number; minute: number };
    worstDeficit?: { gold: number; minute: number };
    shape: CurveShape;
  };
  lanes: {
    seat: LaneRole;
    name?: string;
    champion: string;
    theirChampion: string;
    verdict: LaneVerdict;
    goldAt10?: number;
    csAt10?: number;
    xpAt10?: number;
    flippedAt?: number;
    line: string;
  }[];
  firsts: MatchTimeline['firsts'];
  objectives: {
    minute: number;
    type: TimelineObjective['type'];
    subType?: string;
    side: 'us' | 'them';
    ourNearCount: number;
    ourInvolved: LaneRole[];
    setup: 'taken' | 'contested' | 'uncontested' | 'traded';
    line: string;
  }[];
  deathClusters: { fromMinute: number; toMinute: number; zone: MapZone; ours: number; theirs: number; seats: LaneRole[]; line: string }[];
  soloDeaths: { minute: number; seat: LaneRole; zone: MapZone; warded: boolean; theirSide: boolean; line: string }[];
  vision: { seat: LaneRole; name?: string; placedPer5: number[]; darkDeaths: number; line: string }[];
  spend: { seat: LaneRole; firstItemMinute?: number; backs: number }[];
  /** At most MAX_LINES, in a fixed order: result, lanes, objectives, fights, solo deaths, vision. */
  lines: string[];
}

// ---- Words ---------------------------------------------------------------------

const ZONE_WORDS: Record<MapZone, string> = {
  ourBase: 'our base',
  theirBase: 'their base',
  top: 'top lane',
  mid: 'mid lane',
  bot: 'bot lane',
  river: 'the river',
  ourJungle: 'our jungle',
  theirJungle: 'their jungle'
};

const OBJECTIVE_WORDS: Record<TimelineObjective['type'], string> = {
  dragon: 'dragon',
  herald: 'herald',
  grubs: 'grubs',
  baron: 'baron',
  elder: 'elder dragon',
  atakhan: 'Atakhan'
};

export function k(gold: number): string {
  const abs = Math.abs(gold);
  return abs >= 1000 ? `${(abs / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(abs);
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function seatName(seat: LaneRole, names: ReadonlyMap<LaneRole, string>): string {
  const name = names.get(seat);
  return name ? `${name} (${seat})` : seat;
}

// ---- The curve -----------------------------------------------------------------

function shapeOf(win: boolean, peak: number, worst: number): CurveShape {
  if (win && worst <= -SWING_GOLD) return 'came back';
  if (!win && peak >= SWING_GOLD) return 'threw';
  if (peak >= EVEN_GOLD && worst > -EVEN_GOLD) return 'led throughout';
  if (worst <= -EVEN_GOLD && peak < EVEN_GOLD) return 'trailed throughout';
  if (peak >= EVEN_GOLD && worst <= -EVEN_GOLD) return 'swung';
  return 'even';
}

function resultLine(facts: GameFacts): string {
  const won = facts.result === 'win';
  const head = `${won ? 'Won' : 'Lost'} in ${facts.durationMin} minutes`;
  const peak = facts.curve.peakLead;
  const worst = facts.curve.worstDeficit;
  switch (facts.curve.shape) {
    case 'led throughout':
      return `${head}, ahead all game: the biggest lead was ${k(peak?.gold ?? 0)} at ${peak?.minute}.`;
    case 'trailed throughout':
      return `${head}, behind all game: the worst deficit was ${k(worst?.gold ?? 0)} at ${worst?.minute}.`;
    case 'came back':
      return `${head} from ${k(worst?.gold ?? 0)} down at ${worst?.minute}: a comeback.`;
    case 'threw':
      return `${head} after leading by ${k(peak?.gold ?? 0)} at ${peak?.minute}: a throw.`;
    case 'swung':
      return `${head}; the gold swung both ways, up ${k(peak?.gold ?? 0)} at ${peak?.minute} and down ${k(worst?.gold ?? 0)} at ${worst?.minute}.`;
    case 'even':
      return `${head}, and the gold never got past a thousand either way.`;
    default:
      return `${head}. Totals only, from the replay: no minute-by-minute figures.`;
  }
}

// ---- The build -----------------------------------------------------------------

export function gameFacts(timeline: MatchTimeline, game: AnalysisGameLike): GameFacts {
  const names = new Map<LaneRole, string>();
  for (const l of timeline.lanes) if (l.name) names.set(l.seat, l.name);
  for (const p of game.players) if (p.position && !names.has(p.position as LaneRole)) names.set(p.position as LaneRole, p.name);
  const readBySeat = new Map<string, LaneRead>();
  for (const p of game.players) if (p.lane) readBySeat.set(p.position, p.lane);

  const durationMin = Math.round((game.durationSec ?? timeline.durationSec) / 60);
  const peak = timeline.curve.biggestLead;
  const worst = timeline.curve.biggestDeficit;

  const lanes: GameFacts['lanes'] = timeline.lanes.map((l) => {
    const read = readBySeat.get(l.seat);
    const gold = l.at10?.gold;
    const verdict: LaneVerdict =
      read && read.verdict !== 'unknown'
        ? read.verdict
        : gold === undefined
          ? 'unknown'
          : gold >= LANE_EDGE_GOLD
            ? 'won'
            : gold <= -LANE_EDGE_GOLD
              ? 'lost'
              : 'even';
    const who = seatName(l.seat, names);
    const at10 = gold === undefined ? '' : ` ${gold >= 0 ? 'up' : 'down'} ${k(gold)} at ten`;
    const flip = l.flippedAt !== undefined ? `, and the lead changed hands at ${l.flippedAt}` : '';
    const line =
      verdict === 'unknown'
        ? `${who} on ${l.champion} into ${l.theirChampion}: no read.`
        : `${who} on ${l.champion} ${verdict === 'won' ? 'won' : verdict === 'lost' ? 'lost' : 'went even in'} the lane into ${l.theirChampion}${at10}${flip}.`;
    return {
      seat: l.seat,
      ...(l.name && { name: l.name }),
      champion: l.champion,
      theirChampion: l.theirChampion,
      verdict,
      ...(gold !== undefined && { goldAt10: gold }),
      ...(l.at10 && { csAt10: l.at10.cs, xpAt10: l.at10.xp }),
      ...(l.flippedAt !== undefined && { flippedAt: l.flippedAt }),
      line
    };
  });

  const objectives: GameFacts['objectives'] = timeline.objectives.map((o) => {
    const word = `${OBJECTIVE_WORDS[o.type]}${o.subType ? ` (${o.subType})` : ''}`;
    let setup: GameFacts['objectives'][number]['setup'] = 'taken';
    let line: string;
    if (o.side === 'us') {
      const on = o.ourInvolved.length ? ` — ${list(o.ourInvolved)} on it` : '';
      line = `Minute ${o.minute}: our ${word}${on}.`;
    } else {
      const traded = timeline.objectives.some((x) => x !== o && x.side === 'us' && Math.abs(x.minute - o.minute) * 60 <= TRADE_SEC);
      setup = traded ? 'traded' : o.ourNear.length >= 3 ? 'contested' : o.ourNear.length <= 1 ? 'uncontested' : 'contested';
      line =
        setup === 'traded'
          ? `Minute ${o.minute}: their ${word}, traded for one of ours.`
          : setup === 'uncontested'
            ? `Minute ${o.minute}: their ${word}, ${o.ourNear.length === 0 ? 'nobody of ours near' : `only ${o.ourNear[0]} near`}.`
            : `Minute ${o.minute}: their ${word}, contested with ${o.ourNear.length} of ours near.`;
    }
    return { minute: o.minute, type: o.type, ...(o.subType && { subType: o.subType }), side: o.side, ourNearCount: o.ourNear.length, ourInvolved: o.ourInvolved, setup, line };
  });

  // Fights: every death, both sides, grouped by time and place.
  type Death = { sec: number; zone: MapZone; ours: boolean; seat?: LaneRole };
  const all: Death[] = [
    ...timeline.deaths.map((d) => ({ sec: d.sec, zone: d.zone, ours: true, seat: d.seat })),
    ...timeline.theirDeaths.map((d) => ({ sec: d.sec, zone: d.zone, ours: false }))
  ].sort((a, b) => a.sec - b.sec);
  const clusters: Death[][] = [];
  for (const d of all) {
    const last = clusters[clusters.length - 1];
    if (last && d.sec - last[last.length - 1].sec <= CLUSTER_SEC && last[0].zone === d.zone) last.push(d);
    else clusters.push([d]);
  }
  const deathClusters: GameFacts['deathClusters'] = clusters
    .filter((c) => c.length >= 2)
    .map((c) => {
      const ours = c.filter((d) => d.ours).length;
      const theirs = c.length - ours;
      const seats = [...new Set(c.filter((d) => d.ours && d.seat).map((d) => d.seat as LaneRole))];
      const fromMinute = Math.round(c[0].sec / 60);
      const toMinute = Math.round(c[c.length - 1].sec / 60);
      const when = fromMinute === toMinute ? `Minute ${fromMinute}` : `Minutes ${fromMinute}–${toMinute}`;
      const score = ours === 0 ? `we took ${theirs} for nothing` : theirs === 0 ? `we lost ${ours} for nothing` : `${theirs} for ${ours}`;
      const fell = seats.length ? ` — ${list(seats)} fell` : '';
      return { fromMinute, toMinute, zone: c[0].zone, ours, theirs, seats, line: `${when}, ${ZONE_WORDS[c[0].zone]}: a fight went ${score}${fell}.` };
    });

  const soloDeaths: GameFacts['soloDeaths'] = timeline.deaths
    .filter((d) => d.killers <= 1)
    .map((d) => ({
      minute: d.minute,
      seat: d.seat,
      zone: d.zone,
      warded: d.warded,
      theirSide: d.theirSide,
      line: `Minute ${d.minute}: ${seatName(d.seat, names)} died alone in ${ZONE_WORDS[d.zone]}${d.executed ? ' to a tower or a monster' : ''}, ${d.warded ? 'with a ward nearby' : 'with no ward nearby'}.`
    }));

  const vision: GameFacts['vision'] = timeline.vision.map((v) => {
    const dark = timeline.deaths.filter((d) => d.seat === v.seat && !d.warded && !d.executed).length;
    const deaths = timeline.deaths.filter((d) => d.seat === v.seat).length;
    const per5 = v.placed.join(', ');
    return {
      seat: v.seat,
      ...(names.has(v.seat) && { name: names.get(v.seat) }),
      placedPer5: v.placed,
      darkDeaths: dark,
      line: `${seatName(v.seat, names)} placed ${per5 || 'no'} wards per five minutes${deaths ? `; ${dark} of ${deaths} deaths had no ward nearby` : ''}.`
    };
  });

  const spend: GameFacts['spend'] = timeline.spend.map((s) => ({ seat: s.seat, ...(s.firstItemMinute !== undefined && { firstItemMinute: s.firstItemMinute }), backs: s.backs.length }));

  const facts: GameFacts = {
    factsVersion: FACTS_VERSION,
    tier: 'timeline',
    result: game.win ? 'win' : 'loss',
    durationMin,
    ...(timeline.ourSide && { side: timeline.ourSide }),
    curve: {
      ...(timeline.curve.at10 !== undefined && { at10: timeline.curve.at10 }),
      ...(timeline.curve.at15 !== undefined && { at15: timeline.curve.at15 }),
      ...(timeline.curve.at20 !== undefined && { at20: timeline.curve.at20 }),
      ...(timeline.curve.at25 !== undefined && { at25: timeline.curve.at25 }),
      peakLead: peak,
      worstDeficit: worst,
      shape: shapeOf(game.win, peak.gold, worst.gold)
    },
    lanes,
    firsts: timeline.firsts,
    objectives,
    deathClusters,
    soloDeaths,
    vision,
    spend,
    lines: []
  };

  const lines: string[] = [resultLine(facts)];
  for (const l of lanes) if (l.verdict !== 'unknown') lines.push(l.line);
  const givenUp = objectives.filter((o) => o.side === 'them' && o.setup === 'uncontested').slice(0, 2);
  for (const o of givenUp) lines.push(o.line);
  const worstFights = [...deathClusters].sort((a, b) => b.ours - a.ours || a.theirs - b.theirs).slice(0, 2);
  for (const f of worstFights) if (f.ours >= 2) lines.push(f.line);
  for (const d of soloDeaths.filter((x) => !x.warded).slice(0, 2)) lines.push(d.line);
  const darkest = [...vision].sort((a, b) => b.darkDeaths - a.darkDeaths)[0];
  if (darkest && darkest.darkDeaths >= 2) lines.push(darkest.line);
  facts.lines = lines.slice(0, MAX_LINES);
  return facts;
}

/** What a replay can say: lane verdicts from the totals, the objective counts, the kills. */
export function endOfGameFacts(game: AnalysisGameLike): GameFacts {
  const durationMin = Math.round((game.durationSec ?? 0) / 60);
  const lanes: GameFacts['lanes'] = game.players
    .filter((p) => p.lane)
    .map((p) => {
      const read = p.lane as LaneRead;
      const who = `${p.name} (${read.position})`;
      const line =
        read.verdict === 'unknown'
          ? `${who} on ${p.champion} into ${read.theirChampion}: totals only, no lane read.`
          : `${who} on ${p.champion} ${read.verdict === 'won' ? 'won' : read.verdict === 'lost' ? 'lost' : 'went even in'} the lane into ${read.theirChampion}.`;
      return { seat: read.position, name: p.name, champion: p.champion, theirChampion: read.theirChampion, verdict: read.verdict, line };
    });
  const facts: GameFacts = {
    factsVersion: FACTS_VERSION,
    tier: 'endOfGame',
    result: game.win ? 'win' : 'loss',
    durationMin,
    ...(game.side && { side: game.side }),
    curve: { shape: 'unknown' },
    lanes,
    firsts: {},
    objectives: [],
    deathClusters: [],
    soloDeaths: [],
    vision: [],
    spend: [],
    lines: []
  };
  const lines = [resultLine(facts)];
  if (game.objectives) {
    const o = game.objectives;
    lines.push(`Dragons ${o.ours.dragons}–${o.theirs.dragons}, towers ${o.ours.towers}–${o.theirs.towers}, barons ${o.ours.barons}–${o.theirs.barons}, grubs ${o.ours.grubs}–${o.theirs.grubs}.`);
  }
  if (game.kills) lines.push(`Kills ${game.kills.ours}–${game.kills.theirs}.`);
  for (const l of lanes) if (l.verdict !== 'unknown') lines.push(l.line);
  for (const f of [...(game.lossFactors ?? []), ...(game.winFactors ?? [])]) lines.push(`${f.label}: ${f.detail}`);
  facts.lines = lines.slice(0, MAX_LINES);
  return facts;
}

/** Mirror of `compareCurve` in the frontend's `core/comp-expectation.ts`. Keep identical. */
export const CURVE_EDGE = 1000;

export function compareCurve(expect: CompExpectation | null | undefined, curve: { at10?: number; at15?: number; at25?: number }): string[] {
  if (!expect) return [];
  const lines: string[] = [];
  const at10 = curve.at10;
  if (at10 !== undefined && Math.abs(at10) >= CURVE_EDGE) {
    const up = at10 > 0;
    if (expect.early === 'high') lines.push(up ? `The strong early game came: up ${k(at10)} at ten.` : `Expected a strong early game, but was down ${k(at10)} at ten.`);
    else if (expect.early === 'low') lines.push(up ? `Expected a slow start and was up ${k(at10)} at ten anyway.` : `Down ${k(at10)} at ten, which a slow-starting comp expects; the question is what came after.`);
  }
  const at25 = curve.at25;
  if (at25 !== undefined && Math.abs(at25) >= CURVE_EDGE) {
    const up = at25 > 0;
    if (expect.scaling === 'high') lines.push(up ? `The scaling paid: up ${k(at25)} at twenty-five.` : `Expected to scale, but was down ${k(at25)} at twenty-five.`);
    else if (expect.scaling === 'low') lines.push(up ? `Up ${k(at25)} at twenty-five on a comp that does not scale: the lead was kept.` : `Down ${k(at25)} at twenty-five on a comp that does not scale: the game went too long.`);
  }
  return lines;
}
