import {
  AnalysisGame,
  AnalysisPlayer,
  DeathVerdict,
  GameFacts,
  GameReview,
  LaneName,
  LedgerSummary,
  MapZone,
  MatchTimeline,
  REVIEW_THEMES,
  ReviewMoment,
  ReviewPoint,
  Role,
  ROLES,
  TimelineDeath,
  TimelineObjective,
  TimelineSide
} from '../models/team.models';
import { mentionedSeat } from './champion-mention';
import { FilmBoard, FilmCall, FilmCard, FilmChapter, FilmDeathPin, FilmMap, FilmModel, FilmMoment, FilmOneThing, FilmSeat, FilmTape, FilmTapeCall, FilmTapeEvent, FilmTitle } from './film-model';
import { askOf, playerStatLine, scoreline } from './review-view';
import { clusterSpot, laneSpot, objectivePit, placeDeath, PlaceDeathArgs, Point, regionFor, RiftSide } from './rift-zones';
import { pick, seedOf, shuffle } from './seed';

/**
 * The film room's model, built once from the review, the analysed game and
 * the timeline (9 Sep 2026). Everything is decided here so the chapters stay
 * templates: which seat the title card shows, the four themes to call, the
 * A/B the first work-on offers, the card's asks. Every draw is seeded by the
 * match id and salted by what it is for, so a film reads the same on every
 * visit. Nothing reads the clock.
 */

export interface FilmPrevious {
  review: GameReview;
  game?: AnalysisGame;
  timeline?: MatchTimeline | null;
}

/** Riot's positions and the seat words both appear on `AnalysisPlayer.position`, depending on the source. */
const POSITION_SEAT: Record<string, Role> = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MIDDLE: 'Mid',
  BOTTOM: 'ADC',
  UTILITY: 'Support',
  Top: 'Top',
  Jungle: 'Jungle',
  Mid: 'Mid',
  ADC: 'ADC',
  Support: 'Support'
};

const BLANK_POINT: ReviewPoint = { text: '', evidence: '', minute: null };

const seatIndex = (seat: Role) => ROLES.indexOf(seat);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function firstSentence(text: string): string {
  const m = text.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : text).trim();
}

function seatOf(player: AnalysisPlayer): Role | undefined {
  return POSITION_SEAT[player.position];
}

/** The seat whose champion the headline names as a whole word, when it names one of ours; the first in lane order when it names two. */
function headlineSeat(headline: string, review: GameReview): Role | undefined {
  return mentionedSeat(
    headline,
    review.players.slice().sort((a, b) => seatIndex(a.seat) - seatIndex(b.seat))
  );
}

/**
 * Our MVP by the line: kills and assists over deaths, the share of the team's
 * damage, kill participation. A plain score, the same on every game, so the
 * poster fronts the one who carried rather than the one who died most.
 */
function mvpSeat(game: AnalysisGame): Role | undefined {
  const teamDamage = game.players.reduce((sum, p) => sum + (p.damage ?? 0), 0);
  const scored = game.players
    .map((p) => {
      const seat = seatOf(p);
      const share = teamDamage ? (p.damage ?? 0) / teamDamage : 0;
      const score = p.kills * 3 + p.assists * 1.5 - p.deaths * 2 + share * 12 + (p.killParticipation ?? 0) * 6;
      return { seat, score };
    })
    .filter((p): p is { seat: Role; score: number } => !!p.seat)
    .sort((a, b) => b.score - a.score || seatIndex(a.seat) - seatIndex(b.seat));
  return scored[0]?.seat;
}

/** The seat's player in the analysed game: by position first, then by name, then by champion. */
function gamePlayerFor(game: AnalysisGame | undefined, seat: Role, name: string, champion: string): AnalysisPlayer | undefined {
  if (!game) return undefined;
  return game.players.find((p) => seatOf(p) === seat) ?? game.players.find((p) => p.name === name) ?? game.players.find((p) => p.champion === champion);
}

/**
 * The two choices a work-on offers. "the fact; either X or Y" splits on the
 * either/or; "the fact, so next time X, or Y" splits on the last ", or" with
 * the first choice starting after the last semicolon or ", so". A ", or"
 * before that boundary is part of the fact ("no plates, or dragons, so next
 * time rotate bot") and never a choice. A clause shorter than a phrase or
 * longer than a card means the sentence was not really offering a choice,
 * and the chapter shows one Commit card instead.
 */
export function splitOptions(text: string): [string, string] | undefined {
  const trim = (s: string) =>
    capitalise(
      s
        .trim()
        .replace(/[.!?;,]+$/, '')
        .replace(/^(next time|next game|going forward),?\s+/i, '')
        .trim()
    );
  const ok = (s: string) => s.length >= 8 && s.length <= 120;
  const either = /(?:^|\s)either\s+([\s\S]+?)\s+or\s+([\s\S]+)$/i.exec(text);
  if (either) {
    const a = trim(either[1]);
    const b = trim(either[2]);
    return ok(a) && ok(b) ? [a, b] : undefined;
  }
  const lower = text.toLowerCase();
  const semi = lower.lastIndexOf('; ');
  const so = lower.lastIndexOf(', so ');
  const start = Math.max(semi >= 0 ? semi + 2 : 0, so >= 0 ? so + 5 : 0);
  const orAt = lower.lastIndexOf(', or ');
  if (orAt < start) return undefined;
  const a = trim(text.slice(start, orAt));
  const b = trim(text.slice(orAt + 5));
  return ok(a) && ok(b) ? [a, b] : undefined;
}

function buildTitle(review: GameReview, game: AnalysisGame | undefined, facts: GameFacts | undefined, previous: FilmPrevious | null, opponent: string | undefined, seed: number): FilmTitle {
  const team = review.team;
  const headline = team.headline || firstSentence(team.summary) || 'Game review';
  // A review carries no result of its own; without the game or the facts the card says loss rather than guess.
  const win = game ? game.win : facts ? facts.result === 'win' : false;
  const ledger = facts?.ledger ?? [];

  // The face of the film is our MVP: the champion the headline names when it
  // names one of ours, else the best line of the five (9 Sep 2026: it used to
  // be the seat that died most, which put Vi on a game Aphelios carried).
  let seat: Role | undefined = headlineSeat(headline, review);
  if (!seat && game?.players.length) seat = mvpSeat(game);
  seat ??= review.players[0]?.seat ?? 'Mid';
  const reviewed = review.players.find((p) => p.seat === seat);
  const gamePlayer = game?.players.find((p) => seatOf(p) === seat);
  const protagonist = { seat, champion: reviewed?.champion ?? gamePlayer?.champion ?? '', name: reviewed?.name ?? gamePlayer?.name };

  const first = team.workOn[0];
  let titleCall: FilmCall | undefined;
  if (first?.theme) {
    const taken = new Set(team.workOn.map((w) => w.theme).filter(Boolean));
    const distractors = shuffle(
      seed,
      REVIEW_THEMES.filter((t) => !taken.has(t)),
      'title'
    ).slice(0, 3);
    const options = shuffle(seed, [first.theme, ...distractors], 'title-order');
    // The options are theme ids, not words: the chapter draws each as a chip with its icon.
    titleCall = { key: 'title', question: 'What decided this game?', options: [...options], answer: options.indexOf(first.theme), why: first.text, theme: first.theme };
  }

  const durationMin = game?.durationSec ? Math.round(game.durationSec / 60) : facts?.durationMin;
  const lowerThird: FilmTitle['lowerThird'] = {
    date: game?.date ?? (Date.parse(review.reviewedAt) || 0),
    compName: review.compName,
    compVerdict: team.compVerdict,
    compWhy: team.compWhy,
    tier: review.tier
  };
  if (opponent) lowerThird.opponent = opponent;
  if (durationMin) lowerThird.durationMin = durationMin;
  if (game?.kills) lowerThird.kills = { ours: game.kills.ours, theirs: game.kills.theirs };

  let lastTime: FilmTitle['lastTime'];
  const prevFirst = previous?.review.team.workOn[0];
  if (previous && prevFirst?.text) {
    lastTime = { matchId: previous.review.matchId, text: askOf(prevFirst.text) };
    if (facts?.ledger) {
      if (prevFirst.theme === 'vision') {
        const n = ledger.filter((d) => d.could.includes('ward')).length;
        lastTime.recurrence = `This game: ${plural(n, 'death', 'deaths')} with no ward nearby`;
      } else if (prevFirst.theme === 'macro') {
        const n = ledger.filter((d) => d.could.includes('call')).length;
        lastTime.recurrence = `This game: ${plural(n, 'death', 'deaths')} their jungler was already close for`;
      }
    }
  }

  const title: FilmTitle = { headline, win, protagonist, lowerThird };
  if (titleCall) title.call = titleCall;
  if (lastTime) title.lastTime = lastTime;
  return title;
}

function buildOneThing(review: GameReview): FilmOneThing {
  const { workOn, keepDoing } = review.team;
  const point = workOn[0] ?? BLANK_POINT;
  const out: FilmOneThing = {
    point,
    rest: [...workOn.slice(1).map((p) => ({ kind: 'workOn' as const, point: p })), ...keepDoing.map((p) => ({ kind: 'keepDoing' as const, point: p }))]
  };
  const options = splitOptions(point.text);
  if (options) out.options = options;
  return out;
}

function buildSeats(review: GameReview, game: AnalysisGame | undefined, facts: GameFacts | undefined): FilmSeat[] {
  const ledger = facts?.ledger ?? [];
  return review.players
    .slice()
    .sort((a, b) => seatIndex(a.seat) - seatIndex(b.seat))
    .map((p) => {
      const seat: FilmSeat = {
        seat: p.seat,
        name: p.name,
        champion: p.champion,
        statLine: playerStatLine(gamePlayerFor(game, p.seat, p.name, p.champion)),
        strength: p.strength,
        workOn: p.workOn,
        more: p.more ?? [],
        deaths: deathsFor(ledger, p.seat)
      };
      if (p.seat === 'Jungle' && facts?.presence) {
        seat.presence = { kills: facts.presence.kills, ofKills: facts.presence.ofKills, line: facts.presence.line };
      }
      return seat;
    });
}

function buildCard(review: GameReview, game: AnalysisGame | undefined, headline: string): FilmCard {
  const first = review.team.workOn[0];
  const card: FilmCard = {
    headline,
    scoreline: scoreline(game),
    oneThing: first?.text ? askOf(first.text) : '',
    asks: review.players
      .slice()
      .sort((a, b) => seatIndex(a.seat) - seatIndex(b.seat))
      .filter((p) => p.workOn.text)
      .map((p) => ({ name: p.name, seat: p.seat, champion: p.champion, ask: askOf(p.workOn.text) }))
  };
  const keep = review.team.keepDoing[0]?.text;
  if (keep) card.keepDoing = keep;
  return card;
}

// ---- The tape, the board, the map ------------------------------------------------
//
// Positions are percent-space on the Rift image, placed inside the zone bucket
// the timeline put them in by `rift-zones.ts`. Every one is approximate by
// zone, and the tape and the map read the same table so a death sits in one
// spot in both.

const other = (side: RiftSide): RiftSide => (side === 'blue' ? 'red' : 'blue');

/** Thousands as "6.2k", under a thousand as the number; the same as the facts' own lines. */
function k(gold: number): string {
  const abs = Math.abs(gold);
  return abs >= 1000 ? `${(abs / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(abs);
}

const OBJECTIVE_WORDS: Record<TimelineObjective['type'], string> = {
  dragon: 'dragon',
  herald: 'herald',
  grubs: 'grubs',
  baron: 'baron',
  elder: 'elder dragon',
  atakhan: 'Atakhan'
};

const LANE_SEAT: Record<LaneName, Role> = { top: 'Top', mid: 'Mid', bot: 'ADC' };

/** The minute plates fall on their own; the timeline keeps a count per lane, not a time. */
const PLATES_FALL_MINUTE = 14;
const MAX_BACKS = 24;
const MAX_OBJECTIVE_CALLS = 4;
const MAX_TAPE_CALLS = 6;
const EVEN_SWING_GOLD = 300;
/** Eight or more deaths in the ledger puts the map before the tape. */
const MAP_FIRST_DEATHS = 8;

const deathKey = (minute: number, seat: Role) => `d:${minute}:${seat}`;

/** Where one death of ours sits: the zone's seeded spot, stepped out by how many of ours already fell in that zone. Approximate by zone. */
export function placeOurDeath(matchId: string, ourSide: RiftSide, death: Pick<TimelineDeath, 'sec' | 'seat' | 'zone'> & Partial<Pick<TimelineDeath, 'theirSide' | 'objectiveNear' | 'executed'>>, ordinal: number): Point {
  const args: PlaceDeathArgs = { matchId, sec: death.sec, seat: death.seat, zone: death.zone, ourSide, ordinal };
  if (death.theirSide) args.theirSide = true;
  if (death.objectiveNear) args.objectiveNear = true;
  if (death.executed) args.executed = true;
  return placeDeath(args);
}

/**
 * Every death of ours placed once, in time order, with the ordinal counting
 * the deaths already placed in the same zone. Keyed by the ledger key so the
 * tape's tokens and the map's pins agree.
 */
function placeOurDeaths(timeline: MatchTimeline): Map<string, Point> {
  const out = new Map<string, Point>();
  const perZone = new Map<MapZone, number>();
  for (const d of (timeline.deaths ?? []).slice().sort((a, b) => a.sec - b.sec)) {
    const key = deathKey(d.minute, d.seat);
    if (out.has(key)) continue;
    const n = perZone.get(d.zone) ?? 0;
    perZone.set(d.zone, n + 1);
    out.set(key, placeOurDeath(timeline.matchId, timeline.ourSide, d, n));
  }
  return out;
}

/**
 * Their deaths placed likewise. The timeline writes their zones in our terms
 * too (their death in "ourJungle" fell in our jungle), so the same side
 * resolves them; only the seed differs, salted by the side so a death of
 * theirs never lands on one of ours at the same second.
 */
function placeTheirDeaths(timeline: MatchTimeline): Point[] {
  const perZone = new Map<MapZone, number>();
  return (timeline.theirDeaths ?? [])
    .slice()
    .sort((a, b) => a.sec - b.sec)
    .map((d) => {
      const n = perZone.get(d.zone) ?? 0;
      perZone.set(d.zone, n + 1);
      return placeDeath({ matchId: timeline.matchId + ':them', sec: d.sec, seat: 'Mid', zone: d.zone, ourSide: timeline.ourSide, ordinal: n });
    });
}

function objectiveLabel(o: Pick<TimelineObjective, 'type' | 'subType' | 'side'>): string {
  const word = OBJECTIVE_WORDS[o.type] + (o.subType ? ` (${o.subType})` : '');
  return `${o.side === 'us' ? 'Our' : 'Their'} ${word}`;
}

function withConsequence(m: ReviewMoment, goldDiff: number[]): FilmMoment {
  const out: FilmMoment = { minute: m.minute, text: m.text, swing: m.swing };
  const from = goldDiff[m.minute];
  const to = goldDiff[m.minute + 3];
  if (typeof from === 'number' && typeof to === 'number') {
    const delta = to - from;
    out.consequence = Math.abs(delta) <= EVEN_SWING_GOLD ? 'Over the next three minutes: about even' : `Over the next three minutes: ${delta > 0 ? '+' : '-'}${k(delta)}`;
  }
  return out;
}

/** Where it turned: the earliest lane flip on a swing, the worst deficit on a loss, the biggest lead on a win. */
/** A lead or deficit this large is a game that has broken open. */
const TURN_EDGE_GOLD = 1000;

/**
 * Where it turned: the minute the gold changed hands for good, read off the
 * curve. A win that was ever behind turned at the last minute it was still
 * behind or level; a win that never trailed turned when the lead first
 * passed a thousand. A loss reads the same way from the other side. A game
 * that swung both ways turned at the first lane that changed hands. The
 * biggest lead was tried first (9 Sep 2026) and on a won game it is nearly
 * always the last minute, which tells nobody anything.
 */
function turnOf(timeline: MatchTimeline, win: boolean): FilmTape['turn'] {
  const facts = timeline.facts;
  if (facts?.curve.shape === 'swung') {
    const flips = [...(timeline.lanes ?? []), ...(facts.lanes ?? [])]
      .filter((l) => typeof l.flippedAt === 'number')
      .sort((a, b) => a.flippedAt! - b.flippedAt! || seatIndex(a.seat) - seatIndex(b.seat));
    const first = flips[0];
    if (first) return { minute: first.flippedAt!, why: `It swung both ways; ${first.seat} changed hands first, around minute ${first.flippedAt}` };
  }
  const gold = timeline.goldDiff ?? [];
  if (gold.length < 2) return null;
  // Read from our side: a loss is a win for them.
  const ours = win ? gold : gold.map((g) => -g);
  // Minute zero is always level, so the question starts at minute one.
  const lowest = Math.min(...ours.slice(1));
  if (lowest <= 0) {
    // Ever behind or level: the last minute it still was.
    let last = -1;
    for (let m = 1; m < ours.length; m += 1) if (ours[m] <= 0) last = m;
    if (last < 0 || last >= ours.length - 1) return null;
    const from = k(Math.min(...ours.slice(0, last + 1)));
    return win
      ? { minute: last, why: `In front for good after minute ${last}, from ${from} down` }
      : { minute: last, why: `Behind for good after minute ${last}, from ${from} up` };
  }
  const edge = ours.findIndex((g) => g >= TURN_EDGE_GOLD);
  if (edge < 0) return null;
  return win
    ? { minute: edge, why: `Never behind; it broke open around minute ${edge}, up ${k(ours[edge])}` }
    : { minute: edge, why: `Never in front; it broke open around minute ${edge}, down ${k(ours[edge])}` };
}

/** Who sits where, for a token's label and icon: the review's players, or the analysed game's before a review exists. */
export interface TapePlayer {
  seat: Role;
  name?: string;
  champion?: string;
}

/**
 * The tape's events straight off a timeline, before any review exists: the
 * takeover's reel plays these while the coach writes. `buildFilm` reads the
 * same function, so a death sits where the reel dropped it.
 */
export function tapeEventsOf(timeline: MatchTimeline, players: TapePlayer[] = []): FilmTapeEvent[] {
  return buildTapeEvents(players, timeline, placeOurDeaths(timeline));
}

/** The reel's counters at one second: our deaths so far, how many fell with no ward nearby, how many with their jungler already close. Approximate by a minute, like the flags they read. */
export function reelTallyOf(timeline: MatchTimeline, untilSec: number): { deaths: number; dark: number; close: number } {
  const ledger = timeline.facts?.ledger ?? [];
  const out = { deaths: 0, dark: 0, close: 0 };
  for (const d of timeline.deaths ?? []) {
    if (d.sec > untilSec) continue;
    out.deaths++;
    const row = ledger.find((r) => r.minute === d.minute && r.seat === d.seat);
    if (row ? row.could.includes('ward') : !d.warded) out.dark++;
    if (row ? row.could.includes('call') : !!d.theirJungleIn) out.close++;
  }
  return out;
}

function buildTapeEvents(tapePlayers: TapePlayer[], timeline: MatchTimeline, ourSpots: Map<string, Point>): FilmTapeEvent[] {
  const ourSide = timeline.ourSide;
  const theirSide = other(ourSide);
  const sideOf = (s: TimelineSide): RiftSide => (s === 'us' ? ourSide : theirSide);
  const players = new Map(tapePlayers.map((p) => [p.seat, p]));
  const events: FilmTapeEvent[] = [];

  for (const d of timeline.deaths ?? []) {
    const key = deathKey(d.minute, d.seat);
    const spot = ourSpots.get(key) ?? placeOurDeath(timeline.matchId, ourSide, d, 0);
    const p = players.get(d.seat);
    const champion = p?.champion ?? (timeline.lanes ?? []).find((l) => l.seat === d.seat)?.champion;
    const ev: FilmTapeEvent = { sec: d.sec, kind: 'ourDeath', label: `${p?.name || d.seat} died`, side: 'us', seat: d.seat, zone: d.zone, x: spot.x, y: spot.y, key };
    if (champion) ev.champion = champion;
    events.push(ev);
  }

  const theirSpots = placeTheirDeaths(timeline);
  (timeline.theirDeaths ?? [])
    .slice()
    .sort((a, b) => a.sec - b.sec)
    .forEach((d, i) => {
      const spot = theirSpots[i];
      events.push({ sec: d.sec, kind: 'theirDeath', label: 'One of theirs died', side: 'them', zone: d.zone, x: spot.x, y: spot.y });
    });

  for (const o of timeline.objectives ?? []) {
    const pit = objectivePit(o.type);
    // How many of ours were near rides on the label: "Their dragon (infernal), 2 of ours near".
    const near = o.ourNear?.length ?? 0;
    const label = near > 0 ? `${objectiveLabel(o)}, ${near} of ours near` : objectiveLabel(o);
    events.push({ sec: o.minute * 60, kind: 'objective', label, side: o.side, x: pit.x, y: pit.y });
  }

  const { blood, tower } = timeline.firsts ?? {};
  if (blood) {
    // The timeline keeps no spot for first blood, so it sits on mid, the one lane every game crosses.
    const mid = regionFor('mid', ourSide).centroid;
    events.push({ sec: blood.minute * 60, kind: 'first', label: `First blood, ${blood.side === 'us' ? 'ours' : 'theirs'}`, side: blood.side, x: mid.x, y: mid.y });
  }
  if (tower) {
    // The tower that fell belonged to the other side.
    const lost = sideOf(tower.side === 'us' ? 'them' : 'us');
    const spot = laneSpot(LANE_SEAT[tower.lane], lost);
    events.push({ sec: tower.minute * 60, kind: 'first', label: `First tower, ${tower.side === 'us' ? 'ours' : 'theirs'}`, side: tower.side, x: spot.x, y: spot.y });
  }

  // Plates are a count per lane, not a time: they show at the minute plates fall, on the tower that lost them, and the label says "by" so the minute never reads as a fact.
  for (const taker of ['us', 'them'] as const) {
    const counts = taker === 'us' ? timeline.plates?.ours : timeline.plates?.theirs;
    const lost = sideOf(taker === 'us' ? 'them' : 'us');
    for (const lane of ['top', 'mid', 'bot'] as const) {
      const n = counts?.[lane] ?? 0;
      if (n <= 0) continue;
      const spot = laneSpot(LANE_SEAT[lane], lost);
      const count = n === 1 ? `Plate down, ${lane}` : `${n} plates down, ${lane}`;
      events.push({ sec: PLATES_FALL_MINUTE * 60, kind: 'plate', label: `${count}, by ${PLATES_FALL_MINUTE} min`, side: taker, x: spot.x, y: spot.y });
    }
  }

  const base = regionFor('ourBase', ourSide).centroid;
  const backs = (timeline.spend ?? [])
    .flatMap((s) => (s.backs ?? []).map((minute) => ({ minute, seat: s.seat })))
    .sort((a, b) => a.minute - b.minute || seatIndex(a.seat) - seatIndex(b.seat))
    .slice(0, MAX_BACKS);
  for (const b of backs) {
    events.push({ sec: b.minute * 60, kind: 'back', label: `${b.seat} backed`, side: 'us', seat: b.seat, x: base.x, y: base.y });
  }

  // Stable: ties keep the order they were pushed in, so deaths lead the second they share with a back.
  return events.map((e, i) => ({ e, i })).sort((a, b) => a.e.sec - b.e.sec || a.i - b.i).map((x) => x.e);
}

function buildTapeCalls(timeline: MatchTimeline): FilmTapeCall[] {
  const facts = timeline.facts;
  const calls: FilmTapeCall[] = [];
  const seen = new Set<string>();

  const objectives = (timeline.objectives ?? []).slice().sort((a, b) => a.minute - b.minute);
  for (const o of objectives) {
    if (calls.length >= MAX_OBJECTIVE_CALLS) break;
    const key = `tape:o:${o.minute}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const line = facts?.objectives.find((f) => f.minute === o.minute && f.type === o.type && f.side === o.side)?.line;
    calls.push({
      key,
      question: `Whose ${OBJECTIVE_WORDS[o.type]} is this?`,
      options: ['Ours', 'Theirs'],
      answer: o.side === 'us' ? 0 : 1,
      why: line ?? `${objectiveLabel(o)} at minute ${o.minute}`,
      atSec: Math.max(0, (o.minute - 1) * 60),
      revealSec: o.minute * 60
    });
  }

  for (const c of facts?.deathClusters ?? []) {
    if (c.ours < 2) continue;
    const key = `tape:f:${c.fromMinute}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // The reveal is the first of ours to fall in the cluster: the deaths drop at their own seconds, so the answer must not be on the map before the sheet says so.
    const first = (timeline.deaths ?? []).filter((d) => d.minute >= c.fromMinute && d.minute <= c.toMinute).reduce<number | null>((min, d) => (min === null || d.sec < min ? d.sec : min), null);
    calls.push({
      key,
      question: 'How many of ours fall here?',
      options: ['1', '2', '3 or more'],
      answer: Math.min(c.ours, 3) - 1,
      why: c.line,
      atSec: Math.max(0, c.fromMinute * 60 - 60),
      revealSec: first ?? c.fromMinute * 60
    });
  }

  return calls.sort((a, b) => a.atSec - b.atSec || a.revealSec - b.revealSec).slice(0, MAX_TAPE_CALLS);
}

function buildTape(review: GameReview, timeline: MatchTimeline, win: boolean, ourSpots: Map<string, Point>): FilmTape {
  const goldDiff = timeline.goldDiff ?? [];
  return {
    durationSec: timeline.durationSec,
    ourSide: timeline.ourSide,
    goldDiff: goldDiff.slice(),
    turn: turnOf(timeline, win),
    moments: (review.team.moments ?? []).map((m) => withConsequence(m, goldDiff)),
    events: buildTapeEvents(review.players, timeline, ourSpots),
    calls: buildTapeCalls(timeline)
  };
}

/**
 * The board's counts and its one call off a game's totals, before any review
 * exists: the takeover's totals reel asks it for a replay, and `buildFilm`
 * reads the same function, so the option the reel stored is the board's.
 */
export function boardCountsOf(game: AnalysisGame | undefined, matchId: string): Pick<FilmBoard, 'tallies' | 'call'> {
  const tallies: FilmBoard['tallies'] = [];
  const add = (label: string, ours: number | undefined, theirs: number | undefined) => {
    if (!ours && !theirs) return;
    tallies.push({ label, ours: ours ?? 0, theirs: theirs ?? 0 });
  };
  add('Kills', game?.kills?.ours, game?.kills?.theirs);
  const ours = game?.objectives?.ours;
  const theirs = game?.objectives?.theirs;
  add('Towers', ours?.towers, theirs?.towers);
  add('Dragons', ours?.dragons, theirs?.dragons);
  add('Barons', ours?.barons, theirs?.barons);
  add('Grubs', ours?.grubs, theirs?.grubs);
  add('Heralds', ours?.heralds, theirs?.heralds);

  let call: FilmCall | null = null;
  const widest = tallies.reduce<FilmBoard['tallies'][number] | null>((best, t) => (!best || Math.abs(t.ours - t.theirs) > Math.abs(best.ours - best.theirs) ? t : best), null);
  if (widest && widest.ours !== widest.theirs) {
    const options = shuffle(
      seedOf(matchId),
      tallies.map((t) => t.label),
      'board'
    );
    call = { key: 'board', question: 'Which count was furthest apart?', options, answer: options.indexOf(widest.label), why: `${widest.label} ended ${widest.ours}-${widest.theirs}` };
  }
  return { tallies, call };
}

function buildBoard(review: GameReview, game: AnalysisGame | undefined): FilmBoard {
  return { ...boardCountsOf(game, review.matchId), moments: (review.team.moments ?? []).map((m) => ({ minute: m.minute, text: m.text, swing: m.swing })) };
}

/** The ledger's counts when the facts carry the rows but not the summary (a document written between versions). */
function summarise(ledger: DeathVerdict[]): LedgerSummary {
  return {
    deaths: ledger.length,
    ganks: ledger.filter((d) => d.how === 'gank').length,
    dark: ledger.filter((d) => d.could.includes('ward')).length,
    inReach: ledger.filter((d) => d.could.includes('jungle')).length,
    alone: ledger.filter((d) => d.how === 'solo').length
  };
}

function buildMap(review: GameReview, timeline: MatchTimeline, ledger: DeathVerdict[], seed: number, ourSpots: Map<string, Point>): FilmMap {
  const ourSide = timeline.ourSide;
  const facts = timeline.facts!;
  const players = new Map(review.players.map((p) => [p.seat, p]));
  const perZone = new Map<MapZone, number>();

  const pins: FilmDeathPin[] = ledger
    .slice()
    .sort((a, b) => a.minute - b.minute || seatIndex(a.seat) - seatIndex(b.seat))
    .map((d) => {
      const key = deathKey(d.minute, d.seat);
      const match = (timeline.deaths ?? []).find((t) => t.minute === d.minute && t.seat === d.seat);
      const sec = match?.sec ?? d.minute * 60;
      let spot = ourSpots.get(key);
      if (!spot) {
        // A ledger row the timeline has no death for: placed on its own, stepped out among the unmatched rows in the zone.
        const n = perZone.get(d.zone) ?? 0;
        perZone.set(d.zone, n + 1);
        spot = placeOurDeath(timeline.matchId, ourSide, { sec, seat: d.seat, zone: d.zone }, n);
      }
      const p = players.get(d.seat);
      const pin: FilmDeathPin = { key, sec, minute: d.minute, seat: d.seat, zone: d.zone, x: spot.x, y: spot.y, how: d.how, could: d.could.slice(), line: d.line };
      const name = p?.name ?? d.name;
      if (name) pin.name = name;
      const champion = p?.champion ?? (timeline.lanes ?? []).find((l) => l.seat === d.seat)?.champion;
      if (champion) pin.champion = champion;
      return pin;
    });

  const order = pick(seed, ['chronological', 'worst-first'] as const, 'map-order');
  if (order === 'worst-first') {
    const bad = (p: FilmDeathPin) => (p.could.length >= 2 ? 0 : 1);
    pins.sort((a, b) => bad(a) - bad(b) || a.minute - b.minute || seatIndex(a.seat) - seatIndex(b.seat));
  }

  const theirSpots = placeTheirDeaths(timeline);
  const theirs = (timeline.theirDeaths ?? [])
    .slice()
    .sort((a, b) => a.sec - b.sec)
    .map((d, i) => ({ x: theirSpots[i].x, y: theirSpots[i].y, minute: d.minute }));

  const clusters = (facts.deathClusters ?? []).map((c) => {
    const spot = clusterSpot(c.zone, ourSide, timeline.matchId);
    // A blob says "a fight happened here", not how big; a 53-death game must not become one red map.
    return { x: spot.x, y: spot.y, r: Math.min(7, 3 + 0.8 * (c.ours + c.theirs)), ours: c.ours, theirs: c.theirs, line: c.line };
  });

  const summary = facts.ledgerSummary ?? summarise(ledger);
  return { pins, theirs, clusters, summary, darkCall: { answer: summary.dark, max: summary.deaths }, order };
}

const BASE_CHAPTERS: Record<'title' | 'one-thing' | 'seat' | 'card', FilmChapter> = {
  title: { kind: 'title', title: 'The game' },
  'one-thing': { kind: 'one-thing', title: 'The one thing' },
  seat: { kind: 'seat', title: 'Your seat' },
  card: { kind: 'card', title: 'The card' }
};
const TAPE_CHAPTER: FilmChapter = { kind: 'tape', title: 'The tape' };
const BOARD_CHAPTER: FilmChapter = { kind: 'board', title: 'The board' };
const MAP_CHAPTER: FilmChapter = { kind: 'map', title: 'The map' };

/** How many chapters the fullest film has, for a line written before the model is built (the games row). */
export const FILM_CHAPTER_COUNT = 6;

export function buildFilm(review: GameReview, game: AnalysisGame | undefined, timeline: MatchTimeline | null, previous: FilmPrevious | null, opponent?: string): FilmModel {
  const seed = seedOf(review.matchId);
  const facts = timeline?.facts;
  const title = buildTitle(review, game, facts, previous, opponent, seed);
  const oneThing = buildOneThing(review);
  const model: FilmModel = {
    matchId: review.matchId,
    tier: review.tier,
    seed,
    chapters: [],
    title,
    oneThing,
    seats: buildSeats(review, game, facts),
    card: buildCard(review, game, title.headline)
  };

  // The chapter order is led by the data, never the seed: the tape needs a
  // timeline, the map a ledger, and eight or more deaths put the map first.
  // Without a timeline (a replay, or a Riot game the function has not read
  // yet) the board stands in, built from the game's totals.
  const middle: FilmChapter[] = [];
  if (timeline && review.tier === 'timeline') {
    const ourSpots = placeOurDeaths(timeline);
    model.tape = buildTape(review, timeline, title.win, ourSpots);
    middle.push(TAPE_CHAPTER);
    const ledger = facts?.ledger;
    if (ledger) {
      model.map = buildMap(review, timeline, ledger, seed, ourSpots);
      if (ledger.length >= MAP_FIRST_DEATHS) middle.unshift(MAP_CHAPTER);
      else middle.push(MAP_CHAPTER);
    }
  } else {
    model.board = buildBoard(review, game);
    if (model.board.tallies.length || model.board.moments.length) middle.push(BOARD_CHAPTER);
  }
  model.chapters = [BASE_CHAPTERS.title, ...middle, BASE_CHAPTERS['one-thing'], BASE_CHAPTERS.seat, BASE_CHAPTERS.card].map((c) => ({ ...c }));
  return model;
}

/** Exported for the specs and the page: the ledger rows of one seat, in time order. */
export function deathsFor(ledger: DeathVerdict[] | undefined, seat: Role): DeathVerdict[] {
  return (ledger ?? []).filter((d) => d.seat === seat).sort((a, b) => a.minute - b.minute);
}
