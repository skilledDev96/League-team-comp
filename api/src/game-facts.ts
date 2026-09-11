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
 * The death ledger (9 Sep 2026) is one verdict per death of ours: how it
 * happened and what would have stopped it — our jungler a screen away, a
 * ward, a call about their jungler, or standing alone on their side. The
 * tags are rules over the timeline's figures, so a player can check every
 * one against the drawer; the model only reads them.
 *
 * A solo death is not a vision problem (10 Sep 2026): the ledger has only
 * ever tagged `ward` when two or more came in, but the vision line counted
 * every unwarded death as "no ward nearby" and the solo lines said so too,
 * and a review prescribed a ward for a laner who died one-on-one. Now a dark
 * death needs two or more killers, and a solo death says "one-on-one".
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
import { JUNGLE_REACH, MapZone, MatchTimeline, THEIR_JUNGLE_WARNING, TimelineObjective } from './timeline-features';

export const FACTS_VERSION = 2;

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

export type DeathHow = 'executed' | 'solo' | 'gank' | 'fight';
/** What would have stopped it: our jungler's pathing, a ward, a call about their jungler, or not standing alone on their side. */
export type DeathCould = 'jungle' | 'ward' | 'call' | 'position';

export interface DeathVerdict {
  minute: number;
  seat: LaneRole;
  name?: string;
  zone: MapZone;
  how: DeathHow;
  could: DeathCould[];
  line: string;
}

export interface LedgerSummary {
  deaths: number;
  ganks: number;
  /** No ward nearby. */
  dark: number;
  /** Our jungler within JUNGLE_REACH. */
  inReach: number;
  /** Alone on their side of the map. */
  alone: number;
}

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
  /** Deaths with at most one killer; `warded` is kept for the record, the line no longer says it (10 Sep 2026). */
  soloDeaths: { minute: number; seat: LaneRole; zone: MapZone; warded: boolean; theirSide: boolean; line: string }[];
  /** `darkDeaths` counts deaths to two or more with no ward nearby; a solo death or an execution is never dark (10 Sep 2026). */
  vision: { seat: LaneRole; name?: string; placedPer5: number[]; darkDeaths: number; line: string }[];
  spend: { seat: LaneRole; firstItemMinute?: number; backs: number }[];
  /** One verdict per death of ours, in time order. Absent on the replay tier and on facts before version 2. */
  ledger?: DeathVerdict[];
  ledgerSummary?: LedgerSummary;
  /** Our jungler on our kills. Absent when the timeline predates it. */
  presence?: { kills: number; ofKills: number; before15: number; ofBefore15: number; line: string };
  /** At most MAX_LINES, in a fixed order: result, the ledger, lanes, objectives, fights, solo deaths, vision. */
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

// ---- The ledger ------------------------------------------------------------------

const LANE_ZONES: ReadonlySet<MapZone> = new Set<MapZone>(['top', 'mid', 'bot']);
/** Where a jungler a screen away could have turned up. */
const REACH_ZONES: ReadonlySet<MapZone> = new Set<MapZone>(['top', 'mid', 'bot', 'river', 'ourJungle']);

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function deathLedger(timeline: MatchTimeline, names: ReadonlyMap<LaneRole, string>): DeathVerdict[] {
  return timeline.deaths.map((d) => {
    const laner = d.seat !== 'Jungle';
    const how: DeathHow = d.executed ? 'executed' : d.theirJungleIn && laner && LANE_ZONES.has(d.zone) ? 'gank' : d.killers >= 3 ? 'fight' : 'solo';
    const could: DeathCould[] = [];
    if (how !== 'executed' && d.ourJungleDist !== undefined && d.ourJungleDist <= JUNGLE_REACH && !d.objectiveNear && REACH_ZONES.has(d.zone)) could.push('jungle');
    if (!d.warded && !d.executed && d.killers >= 2) could.push('ward');
    if (how === 'gank' && d.theirJungleDistBefore !== undefined && d.theirJungleDistBefore <= THEIR_JUNGLE_WARNING) could.push('call');
    if (how !== 'executed' && d.theirSide && d.alliesNear === 0) could.push('position');
    const howWords =
      how === 'executed' ? 'to a tower or a monster' : how === 'gank' ? 'to a gank with their jungler on it' : how === 'fight' ? `in a fight against ${d.killers}` : 'to one of them';
    const bits: string[] = [];
    if (could.includes('ward')) bits.push('no ward nearby');
    if (could.includes('call')) bits.push('their jungler was already close a minute before');
    if (could.includes('jungle')) bits.push(`our jungler was ${k(d.ourJungleDist ?? 0)} away in ${ZONE_WORDS[d.ourJungleZone ?? 'ourJungle']}`);
    if (could.includes('position')) bits.push('alone on their side of the map');
    const line = `Around minute ${d.minute}: ${seatName(d.seat, names)} died ${howWords} in ${ZONE_WORDS[d.zone]}${bits.length ? ` — ${bits.join('; ')}` : ''}.`;
    return { minute: d.minute, seat: d.seat, ...(names.has(d.seat) && { name: names.get(d.seat) }), zone: d.zone, how, could, line };
  });
}

function ledgerSummaryOf(ledger: readonly DeathVerdict[]): LedgerSummary {
  return {
    deaths: ledger.length,
    ganks: ledger.filter((d) => d.how === 'gank').length,
    dark: ledger.filter((d) => d.could.includes('ward')).length,
    inReach: ledger.filter((d) => d.could.includes('jungle')).length,
    alone: ledger.filter((d) => d.could.includes('position')).length
  };
}

function ledgerLine(s: LedgerSummary): string {
  const parts = [
    s.ganks ? `${s.ganks} to ${s.ganks === 1 ? 'a gank' : 'ganks'}` : '',
    s.dark ? `${s.dark} with no ward nearby` : '',
    s.inReach ? `${s.inReach} with our jungler a screen away` : '',
    s.alone ? `${s.alone} alone on their side` : ''
  ].filter(Boolean);
  return parts.length ? `${plural(s.deaths, 'death', 'deaths')}: ${parts.join(', ')}.` : `${plural(s.deaths, 'death', 'deaths')}, none to a gank, in the dark or alone on their side.`;
}

function presenceOf(timeline: MatchTimeline, names: ReadonlyMap<LaneRole, string>): GameFacts['presence'] | undefined {
  const kills = timeline.theirDeaths.filter((d) => d.ourInvolved);
  if (!kills.length) return undefined;
  const on = kills.filter((d) => d.ourInvolved?.includes('Jungle'));
  const early = kills.filter((d) => d.minute < 15);
  const earlyOn = early.filter((d) => d.ourInvolved?.includes('Jungle'));
  return {
    kills: on.length,
    ofKills: kills.length,
    before15: earlyOn.length,
    ofBefore15: early.length,
    line: `${seatName('Jungle', names)} was on ${on.length} of ${plural(kills.length, 'kill', 'kills')}${early.length ? `, ${earlyOn.length} of ${early.length} before fifteen` : ''}.`
  };
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

  // A solo death is a wave-state or trade choice, so the line says "one-on-one" and nothing about wards (10 Sep 2026):
  // "with no ward nearby" on a one-on-one death read as a vision problem, and the review prescribed a ward for it.
  // The line is worded off who the one killer was (10 Sep 2026, second fix pass): their jungler alone is a gank the
  // ledger already calls one, so the line says so rather than "one-on-one", which the prompt's rule reads as the lane
  // opponent and would have told the model to withhold the ward advice exactly where a ward was the answer.
  const soloDeaths: GameFacts['soloDeaths'] = timeline.deaths
    .filter((d) => d.killers <= 1)
    .map((d) => ({
      minute: d.minute,
      seat: d.seat,
      zone: d.zone,
      warded: d.warded,
      theirSide: d.theirSide,
      line: `Minute ${d.minute}: ${seatName(d.seat, names)} died alone in ${ZONE_WORDS[d.zone]}${d.executed ? ' to a tower or a monster' : d.theirJungleIn ? ' to their jungler alone' : ', one-on-one'}.`
    }));

  const vision: GameFacts['vision'] = timeline.vision.map((v) => {
    // Only a death to two or more can be dark, the same bar the ledger sets for its `ward` tag (10 Sep 2026): a ward does
    // not stop a one-on-one death or an execution, so neither counts against the seat's vision. A laner killed by their
    // jungler alone stays out too, on purpose: the ledger tags no `ward` on it either, and the ledger's rules are the one
    // place the tags are argued, so this count never says more than the ledger does (10 Sep 2026, second fix pass).
    const dark = timeline.deaths.filter((d) => d.seat === v.seat && !d.warded && !d.executed && d.killers >= 2).length;
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
  const ledger = deathLedger(timeline, names);
  const ledgerSummary = ledgerSummaryOf(ledger);
  const presence = presenceOf(timeline, names);

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
    ledger,
    ledgerSummary,
    ...(presence && { presence }),
    lines: []
  };

  const lines: string[] = [resultLine(facts)];
  if (ledger.length) lines.push(ledgerLine(ledgerSummary));
  if (presence) lines.push(presence.line);
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
    // Heralds belong here as much as the rest, and were missing until 12 Sep 2026. The count was
    // carried on the objectives all along and simply never printed, so a review of a recorded game
    // saw a herald in a frame's top bar, had no figure to check it against, and reported OUR herald
    // as theirs. A tally the prompt does not print is a tally the model will read off a picture.
    lines.push(
      `Dragons ${o.ours.dragons}–${o.theirs.dragons}, towers ${o.ours.towers}–${o.theirs.towers}, barons ${o.ours.barons}–${o.theirs.barons}, heralds ${o.ours.heralds}–${o.theirs.heralds}, grubs ${o.ours.grubs}–${o.theirs.grubs}.`
    );
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
