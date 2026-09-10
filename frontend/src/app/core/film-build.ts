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
  NO_POSITION,
  REVIEW_THEMES,
  ReviewLesson,
  ReviewMoment,
  ReviewPoint,
  Role,
  ROLES,
  TimelineDeath,
  TimelineObjective,
  TimelinePositions,
  TimelineSide,
  TimelineWard
} from '../models/team.models';
import { mentionedSeat } from './champion-mention';
import { DeathRead, DeathReadKind, READ_LABELS, readCounts, readDeath, readsLine } from './death-reads';
import {
  FilmBeat,
  FilmBeatKind,
  FilmBoard,
  FilmCall,
  FilmCard,
  FilmChapter,
  FilmDeathPin,
  FilmDeathScene,
  FilmDraft,
  FilmDraftSeat,
  FilmFrame,
  FilmFramePlace,
  FilmMap,
  FilmModel,
  FilmMoment,
  FilmOneThing,
  FilmSeat,
  FilmTape,
  FilmTapeEvent,
  FilmTitle,
  FilmWard,
  GAIN_GLYPHS,
  OBJECTIVE_GLYPHS
} from './film-model';
import { askOf, playerStatLine, scoreline, ZONE_LABELS } from './review-view';
import { clusterSpot, laneSpot, objectivePit, placeDeath, PlaceDeathArgs, Point, regionFor, RiftSide, riotToPercent, unitsToPercent } from './rift-zones';
import { FilmDeathOrder, styleFor } from './film-style';
import { seedOf, shuffle } from './seed';

/**
 * The film room's model, built once from the review, the analysed game and
 * the timeline (9 Sep 2026). Everything is decided here so the chapters stay
 * templates: which seat the title card shows, the four themes to call, the
 * A/B the first work-on offers, the card's asks. Every draw is seeded by the
 * match id and salted by what it is for, so a film reads the same on every
 * visit. Nothing reads the clock.
 *
 * Cut 4 (10 Sep 2026) took the questions off the tape and the map: each
 * death of ours now carries a read (`core/death-reads.ts`) and a scene, the
 * tape stops on beats it explains rather than calls it asks, and the draft
 * chapter shows the swaps the coach would make with hindsight.
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

/** Their five as the game knows them: a champion in a seat, never a name, because the api sends none of theirs. Unordered. */
function enemySeats(game: AnalysisGame | undefined): { seat: Role; champion: string }[] {
  return (game?.enemies ?? [])
    .map((e) => ({ seat: POSITION_SEAT[e.position], champion: e.champion }))
    .filter((e): e is { seat: Role; champion: string } => !!e.seat && !!e.champion);
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

/** The two choices of a work-on: the model's own (review version 4) when it wrote exactly two, else read off the sentence. */
export function optionsOf(point: ReviewPoint | undefined): [string, string] | undefined {
  if (!point) return undefined;
  const own = point.options;
  if (own && own.length === 2 && own[0]?.trim() && own[1]?.trim()) return [own[0].trim(), own[1].trim()];
  return splitOptions(point.text);
}

function buildOneThing(review: GameReview): FilmOneThing {
  const { workOn, keepDoing } = review.team;
  const point = workOn[0] ?? BLANK_POINT;
  const out: FilmOneThing = {
    point,
    rest: [...workOn.slice(1).map((p) => ({ kind: 'workOn' as const, point: p })), ...keepDoing.map((p) => ({ kind: 'keepDoing' as const, point: p }))]
  };
  const options = optionsOf(point);
  if (options) out.options = options;
  return out;
}

/**
 * The review's lessons (version 4) as calls: the options in a seeded order,
 * salted by the lesson's index so adding one never reorders another, the
 * answer following its option. A lesson the validator should have dropped
 * (fewer than two options, an answer off the list) is skipped here too, so
 * an old or hand-edited document never shows a call with no right answer.
 */
export function lessonCalls(lessons: ReviewLesson[] | undefined, seed: number): FilmCall[] {
  const out: FilmCall[] = [];
  (lessons ?? []).forEach((l, i) => {
    if (!l || !Array.isArray(l.options) || l.options.length < 2 || !l.question?.trim()) return;
    if (!Number.isInteger(l.answer) || l.answer < 0 || l.answer >= l.options.length) return;
    const order = shuffle(
      seed,
      l.options.map((_, j) => j),
      'lesson:' + i
    );
    const call: FilmCall = { key: 'lesson:' + i, question: l.question.trim(), options: order.map((j) => l.options[j]), answer: order.indexOf(l.answer), why: l.why ?? '' };
    if (l.theme) call.theme = l.theme;
    out.push(call);
  });
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
  // The model's own one thing (version 4) when it wrote one; else the first work-on as an ask.
  const oneThing = review.team.oneThing?.trim();
  const card: FilmCard = {
    headline,
    scoreline: scoreline(game),
    oneThing: oneThing || (first?.text ? askOf(first.text) : ''),
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
const EVEN_SWING_GOLD = 300;
/** Eight or more deaths in the ledger puts the map before the tape. */
const MAP_FIRST_DEATHS = 8;
/** The map names at most this many costly deaths on its strip; the tape stops on every death since 10 Sep 2026, these among them. */
const MAX_COSTLIEST = 3;
/** A beat this close to a coach's moment is the same event: the tape stops once. */
const BEAT_FOLD_SEC = 45;
/**
 * The tape stops at most this many times. Fourteen until 10 Sep 2026, when
 * the lead asked for the timeline broken down on every death; forty since,
 * because a thirty-death game with its objectives and moments needs the
 * room, and the rail groups the stops by minute (`railGroups`) so the chips
 * never read "9 9 9". A fifty-death game still loses its latest deaths and
 * firsts first, never a moment.
 */
const MAX_BEATS = 40;
/** A beat carries at most this many seats or champions on its card. */
const MAX_BEAT_SEATS = 3;

const deathKey = (minute: number, seat: Role) => `d:${minute}:${seat}`;

/**
 * One key per death of ours, in time order (10 Sep 2026, second review):
 * `d:<minute>:<seat>`, and a second death of the same seat inside one
 * minute (a respawn under ten seconds, early) takes `:<sec>` as well. The
 * first keeps the ledger key the notes are stored under; the tape's tokens,
 * the map's pins, the seats' lists and the costliest strip all track by
 * these, so two deaths never share one.
 */
function ourDeathKeys(timeline: MatchTimeline): Map<TimelineDeath, string> {
  const keys = new Map<TimelineDeath, string>();
  const taken = new Set<string>();
  for (const d of (timeline.deaths ?? []).slice().sort((a, b) => a.sec - b.sec)) {
    const base = deathKey(d.minute, d.seat);
    let key = taken.has(base) ? `${base}:${d.sec}` : base;
    for (let n = 2; taken.has(key); n += 1) key = `${base}:${d.sec}:${n}`;
    taken.add(key);
    keys.set(d, key);
  }
  return keys;
}

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
  const keys = ourDeathKeys(timeline);
  for (const d of (timeline.deaths ?? []).slice().sort((a, b) => a.sec - b.sec)) {
    const key = keys.get(d)!;
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

/** A moment as the film shows it: the seats it is about ride along (review version 4). */
function momentOf(m: ReviewMoment): FilmMoment {
  const out: FilmMoment = { minute: m.minute, text: m.text, swing: m.swing };
  if (m.seats?.length) out.seats = m.seats.slice();
  return out;
}

function withConsequence(m: ReviewMoment, goldDiff: number[]): FilmMoment {
  const out = momentOf(m);
  const from = goldDiff[m.minute];
  const to = goldDiff[m.minute + 3];
  if (typeof from === 'number' && typeof to === 'number') {
    const delta = to - from;
    out.consequence = Math.abs(delta) <= EVEN_SWING_GOLD ? 'Over the next three minutes: about even' : `Over the next three minutes: ${delta > 0 ? '+' : '-'}${k(delta)}`;
  }
  return out;
}

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
  // Minute zero is always level, so the question starts at minute one. A lead or deficit under
  // EVEN_SWING_GOLD is level too: "behind for good after minute 1, from 20 up" said nothing (10 Sep 2026).
  const lowest = Math.min(...ours.slice(1));
  if (lowest <= -EVEN_SWING_GOLD) {
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
  // Level for a while (never more than a few hundred either way), or never behind at all.
  const opener = lowest <= 0 ? 'Level early;' : win ? 'Never behind;' : 'Never in front;';
  return { minute: edge, why: `${opener} it broke open around minute ${edge}, ${win ? 'up' : 'down'} ${k(ours[edge])}` };
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
  const keys = ourDeathKeys(timeline);

  for (const d of timeline.deaths ?? []) {
    const key = keys.get(d)!;
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

// ---- The beats ----------------------------------------------------------------------
//
// Cut 4 (10 Sep 2026): the tape used to ask "whose dragon is this?" a minute
// before each objective. Now it stops on what mattered and says so: the
// coach's moments, the turn, the objectives, the fights, the firsts and the
// deaths, each with its glyph and the champions it was about. Nothing here
// is a question. Later the same day the lead asked for the timeline broken
// down on the deaths, so every death of ours is a beat (it used to be the
// three costliest), titled by its read; one inside a fight, at an objective
// or in a coach's moment is that beat, which lists it under `deaths`.

/** What survives the cap first: the coach's moments over the turn, the turn over the objectives, and so on. */
const BEAT_PRIORITY: Record<FilmBeatKind, number> = { moment: 0, turn: 1, objective: 2, fight: 3, death: 4, first: 5 };
/** Whose way a death went, by its read: one that bought an objective went ours, a trade was even, an avoidable or a clean one theirs. */
const DEATH_SWINGS: Record<DeathReadKind, FilmBeat['swing']> = { avoidable: 'them', traded: 'even', bought: 'us', clean: 'them' };
/** A beat's title from the moment's swing; "Minute N" is what the minute pill already says. */
const SWING_TITLES: Record<FilmMoment['swing'], string> = { us: 'Our way', them: 'Their way', even: 'Even' };
/** Kinds the tape folds into a coach's moment when they are the same event. */
const FOLDS_INTO_MOMENT: ReadonlySet<FilmBeatKind> = new Set<FilmBeatKind>(['first', 'objective', 'fight', 'death']);
/**
 * Among the rest, what hosts what within the same fold: a death inside a fight
 * or at an objective is that fight, a first tower taken with an objective is
 * that objective, and a fight over an objective is the objective. The host
 * keeps its title and glyph and says the other's line after its own. Three
 * chips at minute 9 (grubs, the fight over them, the death in it) read as
 * three things live (10 Sep 2026); they are one.
 */
const FOLDS_INTO_KIND: Partial<Record<FilmBeatKind, readonly FilmBeatKind[]>> = {
  death: ['turn', 'objective', 'fight'],
  first: ['objective', 'fight'],
  fight: ['objective']
};

const uniqueSlice = <T>(items: readonly T[], max: number): T[] => [...new Set(items)].slice(0, max);

/**
 * The beats the tape stops on, in time order. `pins` are the map's deaths,
 * every one of them already read, so the tape and the map say the same
 * thing about each; `players` are the review's five, for the champions on
 * a card.
 */
function buildBeats(review: GameReview, timeline: MatchTimeline, facts: GameFacts | undefined, players: readonly TapePlayer[], turn: FilmTape['turn'], win: boolean, pins: readonly FilmDeathPin[]): FilmBeat[] {
  const goldDiff = timeline.goldDiff ?? [];
  const championOf = new Map(players.filter((p) => p.champion).map((p) => [p.seat, p.champion!]));
  const championsOf = (seats: readonly Role[]): string[] => uniqueSlice(seats.map((s) => championOf.get(s)).filter((c): c is string => !!c), MAX_BEAT_SEATS);
  const withSeats = (beat: FilmBeat, seats: readonly Role[]): FilmBeat => {
    const kept = uniqueSlice(seats, MAX_BEAT_SEATS);
    if (kept.length) beat.seats = kept;
    const champions = championsOf(kept);
    if (champions.length) beat.champions = champions;
    return beat;
  };
  const keyOf = (kind: FilmBeatKind, sec: number) => `b:${kind}:${sec}`;
  /**
   * What a host takes from a beat folded into it: its seats and champions
   * (three at most), and the deaths it stands for (10 Sep 2026): a death
   * beat by its pin key, and whatever the folded beat had already gathered,
   * so the tape can draw every one's tile and read under the host's card.
   */
  const foldInto = (host: FilmBeat, beat: FilmBeat): void => {
    const seats = uniqueSlice([...(host.seats ?? []), ...(beat.seats ?? [])], MAX_BEAT_SEATS);
    if (seats.length) host.seats = seats;
    const champions = uniqueSlice([...(host.champions ?? []), ...(beat.champions ?? [])], MAX_BEAT_SEATS);
    if (champions.length) host.champions = champions;
    const deaths = [...new Set([...(host.deaths ?? []), ...(beat.kind === 'death' ? [beat.key] : []), ...(beat.deaths ?? [])])];
    if (deaths.length) host.deaths = deaths;
  };

  const moments: FilmBeat[] = [];
  for (const m of review.team.moments ?? []) {
    const sec = m.minute * 60;
    const beat = withSeats({ key: keyOf('moment', sec), sec, kind: 'moment', title: SWING_TITLES[m.swing] ?? 'Even', text: m.text, swing: m.swing, glyph: 'flag' }, m.seats ?? []);
    const consequence = withConsequence(m, goldDiff).consequence;
    if (consequence) beat.consequence = consequence;
    moments.push(beat);
  }

  const rest: FilmBeat[] = [];
  if (turn) {
    const sec = turn.minute * 60;
    // The turn is the game's, not one side's: on a win it went our way, on a loss theirs.
    rest.push({ key: keyOf('turn', sec), sec, kind: 'turn', title: 'Where it turned', text: turn.why, swing: win ? 'us' : 'them', glyph: 'coin' });
  }

  // The timeline keeps every grub (three a minute) and every dragon as its own row; on the rail one minute of one
  // objective for one side is one beat, or the rail read "Their grubs, Their grubs, Their grubs" (live, 10 Sep 2026).
  const seenObjectives = new Set<string>();
  for (const o of timeline.objectives ?? []) {
    const sec = o.minute * 60;
    const same = `${o.minute}:${o.type}:${o.side}`;
    if (seenObjectives.has(same)) continue;
    seenObjectives.add(same);
    const line = facts?.objectives?.find((f) => f.minute === o.minute && f.type === o.type && f.side === o.side)?.line;
    rest.push(withSeats({ key: keyOf('objective', sec), sec, kind: 'objective', title: objectiveLabel(o), text: line ?? `${objectiveLabel(o)} at minute ${o.minute}.`, swing: o.side, glyph: OBJECTIVE_GLYPHS[o.type] }, o.ourInvolved ?? []));
  }

  for (const c of facts?.deathClusters ?? []) {
    if (c.ours + c.theirs < 2) continue;
    // The stop is the first of ours to fall in it, so the card lands as the fight starts, not at a rounded minute.
    const first = (timeline.deaths ?? []).filter((d) => d.minute >= c.fromMinute && d.minute <= c.toMinute).reduce<number | null>((min, d) => (min === null || d.sec < min ? d.sec : min), null);
    const sec = first ?? c.fromMinute * 60;
    const swing: FilmBeat['swing'] = c.ours < c.theirs ? 'us' : c.ours > c.theirs ? 'them' : 'even';
    rest.push(withSeats({ key: keyOf('fight', sec), sec, kind: 'fight', title: `Fight in ${ZONE_LABELS[c.zone]}`, text: c.line, swing, glyph: 'swords' }, c.seats ?? []));
  }

  const { blood, tower } = timeline.firsts ?? {};
  if (blood) {
    const sec = blood.minute * 60;
    const ours = blood.side === 'us';
    rest.push({ key: keyOf('first', sec), sec, kind: 'first', title: `First blood, ${ours ? 'ours' : 'theirs'}`, text: `The first kill of the game went ${ours ? 'our' : 'their'} way, around minute ${blood.minute}.`, swing: blood.side, glyph: 'blood' });
  }
  if (tower) {
    const sec = tower.minute * 60;
    const ours = tower.side === 'us';
    rest.push({ key: keyOf('first', sec), sec, kind: 'first', title: `First tower, ${tower.lane}, ${ours ? 'ours' : 'theirs'}`, text: `The first tower fell in ${ZONE_LABELS[tower.lane]} around minute ${tower.minute}, ${ours ? 'to us' : 'to them'}.`, swing: tower.side, glyph: 'tower' });
  }

  // Every death of ours is a beat (10 Sep 2026), whatever its read: the map's
  // pins in time order (the map may walk them worst-first), titled by the
  // name and the read's own word ("Nia falls, bought an objective"), the
  // read's line under it, its first glyph on the card.
  for (const pin of pins.slice().sort((a, b) => a.sec - b.sec || seatIndex(a.seat) - seatIndex(b.seat))) {
    const beat: FilmBeat = {
      key: pin.key,
      sec: pin.sec,
      kind: 'death',
      title: `${pin.name ?? pin.seat} falls, ${READ_LABELS[pin.read].label.toLowerCase()}`,
      text: pin.readLine,
      swing: DEATH_SWINGS[pin.read],
      glyph: pin.glyphs[0] ?? 'skull',
      seats: [pin.seat]
    };
    if (pin.champion) beat.champions = [pin.champion];
    rest.push(beat);
  }

  // A first, an objective, a fight or a death within the fold of a coach's
  // moment is the same event: the moment keeps its words and takes the
  // other's glyph (when it still wears the flag), champions and deaths.
  const kept: FilmBeat[] = [];
  for (const beat of rest) {
    const host = FOLDS_INTO_MOMENT.has(beat.kind)
      ? moments.filter((m) => Math.abs(m.sec - beat.sec) <= BEAT_FOLD_SEC).sort((a, b) => Math.abs(a.sec - beat.sec) - Math.abs(b.sec - beat.sec))[0]
      : undefined;
    if (!host) {
      kept.push(beat);
      continue;
    }
    if (host.glyph === 'flag') host.glyph = beat.glyph;
    foldInto(host, beat);
  }

  // Then the rest fold among themselves, the higher kind hosting (see FOLDS_INTO_KIND): its words first, the other's after.
  const merged: FilmBeat[] = [];
  for (const beat of kept.slice().sort((a, b) => BEAT_PRIORITY[a.kind] - BEAT_PRIORITY[b.kind] || a.sec - b.sec)) {
    const hosts = FOLDS_INTO_KIND[beat.kind];
    const host = hosts
      ? merged.filter((h) => hosts.includes(h.kind) && Math.abs(h.sec - beat.sec) <= BEAT_FOLD_SEC).sort((a, b) => Math.abs(a.sec - beat.sec) - Math.abs(b.sec - beat.sec))[0]
      : undefined;
    if (!host) {
      merged.push(beat);
      continue;
    }
    // A folded death's read is not appended (10 Sep 2026): the host lists it in `deaths` and the tape draws the read under the card as a tile, so the text would only say it twice.
    if (beat.kind !== 'death' && beat.text && !host.text.includes(beat.text)) host.text = `${host.text} ${beat.text}`;
    foldInto(host, beat);
  }

  // Two beats of one kind in the same second (grubs and a dragon in one minute) would share a key; the second takes a suffix so a list can track them.
  const seen = new Set<string>();
  const all = [...moments, ...merged].map((b) => {
    let key = b.key;
    for (let n = 2; seen.has(key); n += 1) key = `${b.key}:${n}`;
    seen.add(key);
    return key === b.key ? b : { ...b, key };
  });

  return all
    .sort((a, b) => BEAT_PRIORITY[a.kind] - BEAT_PRIORITY[b.kind] || a.sec - b.sec)
    .slice(0, MAX_BEATS)
    .sort((a, b) => a.sec - b.sec || BEAT_PRIORITY[a.kind] - BEAT_PRIORITY[b.kind]);
}

/**
 * The rail's chips (10 Sep 2026): the beats grouped by game minute, in time
 * order, each group's beats in time order too. A minute with a fight and two
 * deaths in it is one chip with a count of three, where the rail used to
 * read "9 9 9". Pure; the tape draws one chip per group and the badge when
 * a group holds more than one.
 */
export function railGroups(beats: readonly FilmBeat[]): { minute: number; beats: FilmBeat[] }[] {
  const groups = new Map<number, FilmBeat[]>();
  for (const b of beats.slice().sort((a, b) => a.sec - b.sec || BEAT_PRIORITY[a.kind] - BEAT_PRIORITY[b.kind])) {
    const minute = Math.floor(b.sec / 60);
    const list = groups.get(minute);
    if (list) list.push(b);
    else groups.set(minute, [b]);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([minute, list]) => ({ minute, beats: list }));
}

// ---- Part C (10 Sep 2026): where everyone stood, and where our wards were --------
//
// A version 3 timeline keeps every participant's position once a minute and
// each ward of ours with the placer's position at the nearest frame, because
// a ward event carries no position of its own. Both are Riot units; here they
// become the image's percent space through the one calibrated conversion in
// `rift-zones.ts`, so a champion at the pit stands where the map draws the
// pit. Everything below is approximate by a minute, and every chapter that
// draws it says so. An older document has neither, and the tape carries
// neither key.

/** How long a stealth ward stands: 90 s when levelled early, the figure the film uses, since nothing in the log carries a ward's timer. */
const WARD_LIFE_SEC = 90;
/** How far a trinket or control ward sees, in Riot units. */
const WARD_SIGHT_UNITS = 900;

/**
 * Frame i of a seat's track: the flat list's pair at 2i, 2i + 1, or nothing
 * when the frame carries NO_POSITION. A track of [x, y] pairs, the shape the
 * first dev files carried before Firestore refused it (10 Sep 2026, second
 * fix pass), still reads, so a dev timeline pasted that morning is not
 * silently frameless.
 */
const placeIn = (track: unknown, i: number): [number, number] | null => {
  if (!Array.isArray(track)) return null;
  const nested = track[i];
  if (Array.isArray(nested)) return Number.isFinite(nested[0]) && Number.isFinite(nested[1]) ? [nested[0], nested[1]] : null;
  const x = track[2 * i];
  const y = track[2 * i + 1];
  return Number.isFinite(x) && Number.isFinite(y) && x !== NO_POSITION && y !== NO_POSITION ? [x, y] : null;
};

/** Which champion sits in each seat, from whichever list names it first. */
function championsBySeat(...lists: readonly (readonly { seat: Role; champion?: string }[])[]): Map<Role, string> {
  const out = new Map<Role, string>();
  for (const list of lists) for (const p of list) if (p.champion && !out.has(p.seat)) out.set(p.seat, p.champion);
  return out;
}

/**
 * Our five for the frames' tiles: the review's players first, then the
 * analysed game's, then the lanes the timeline matched, so a seat the review
 * left out still shows its champion rather than a blank tile.
 */
function ourSeats(review: GameReview, game: AnalysisGame | undefined, timeline: MatchTimeline): { seat: Role; champion?: string }[] {
  const fromGame = (game?.players ?? []).map((p) => ({ seat: seatOf(p), champion: p.champion })).filter((p): p is { seat: Role; champion: string } => !!p.seat);
  const fromLanes = [...(timeline.lanes ?? []), ...(timeline.facts?.lanes ?? [])].map((l) => ({ seat: l.seat, champion: l.champion }));
  return [...review.players, ...fromGame, ...fromLanes];
}

/**
 * The frames of a version 3 timeline in the image's space: the ten, once a
 * minute, in lane order, ours with our champions and theirs with the game's
 * enemies' champions by seat (a champion in a seat, never a name). A seat
 * with no position at a frame is left out of that frame. Undefined on an
 * older document, so the tape carries no `frames` key at all.
 */
export function framesOf(timeline: MatchTimeline, ours: readonly { seat: Role; champion?: string }[] = [], theirs: readonly { seat: Role; champion?: string }[] = []): FilmFrame[] | undefined {
  const positions = timeline.positions;
  if (!positions || !Array.isArray(positions.minutes)) return undefined;
  const ourChampions = championsBySeat(ours);
  const theirChampions = championsBySeat(theirs);
  const placesAt = (side: TimelinePositions['ours'] | undefined, champions: Map<Role, string>, i: number): FilmFramePlace[] => {
    const out: FilmFramePlace[] = [];
    for (const seat of ROLES) {
      const pair = placeIn(side?.[seat], i);
      if (!pair) continue;
      const { x, y } = riotToPercent(pair[0], pair[1]);
      const champion = champions.get(seat);
      out.push(champion ? { seat, champion, x, y } : { seat, x, y });
    }
    return out;
  };
  const frames: FilmFrame[] = [];
  positions.minutes.forEach((minute, i) => {
    if (!Number.isFinite(minute)) return;
    frames.push({ minute, ours: placesAt(positions.ours, ourChampions, i), theirs: placesAt(positions.theirs, theirChampions, i) });
  });
  return frames.sort((a, b) => a.minute - b.minute);
}

/**
 * Our wards off a version 3 timeline, each from its placing to its end, in
 * time order: killed when the log says so, else a control ward stands until
 * the same seat's next control ward (a player holds one on the map, so the
 * next placing removes the last; 10 Sep 2026, second fix pass) or the end of
 * the game, and anything else for WARD_LIFE_SEC. The spot is the placer's at
 * the nearest frame, and `r` is the sight drawn around it. Undefined on an
 * older document; an empty list on a game with no ward of ours, which is a
 * fact worth drawing.
 */
export function wardsOf(timeline: MatchTimeline): FilmWard[] | undefined {
  if (!Array.isArray(timeline.wards)) return undefined;
  const end = timeline.durationSec;
  const r = Math.round(unitsToPercent(WARD_SIGHT_UNITS) * 100) / 100;
  const valid = timeline.wards.filter((w) => !!w && Number.isFinite(w.sec) && w.sec <= end && Number.isFinite(w.x) && Number.isFinite(w.y) && ROLES.includes(w.seat));
  const nextControlOf = (w: TimelineWard): number =>
    valid.reduce((next, o) => (o !== w && o.seat === w.seat && o.type === 'control' && o.sec > w.sec && o.sec < next ? o.sec : next), end);
  return valid
    .map((w): FilmWard => {
      const lives = w.type === 'control' ? nextControlOf(w) : w.sec + WARD_LIFE_SEC;
      const untilSec = Math.min(end, Number.isFinite(w.killedSec) ? Math.max(w.sec, w.killedSec as number) : lives);
      const { x, y } = riotToPercent(w.x, w.y);
      return { sec: w.sec, untilSec, seat: w.seat, type: w.type, x, y, r };
    })
    .sort((a, b) => a.sec - b.sec);
}

const tenth = (v: number): number => Math.round(v * 10) / 10;

/** A copy of a frame, so the lab can drag a token without moving the tape's own frame. */
const copyFrame = (f: FilmFrame, minute = f.minute): FilmFrame => ({ minute, ours: f.ours.map((p) => ({ ...p })), theirs: f.theirs.map((p) => ({ ...p })) });

/** The places of one side blended between two frames; a seat only one frame has stands where that frame put it. */
function blendPlaces(before: readonly FilmFramePlace[], after: readonly FilmFramePlace[], f: number): FilmFramePlace[] {
  const out: FilmFramePlace[] = [];
  for (const seat of ROLES) {
    const a = before.find((p) => p.seat === seat);
    const b = after.find((p) => p.seat === seat);
    if (a && b) {
      const place: FilmFramePlace = { seat, x: tenth(a.x + (b.x - a.x) * f), y: tenth(a.y + (b.y - a.y) * f) };
      const champion = b.champion ?? a.champion;
      out.push(champion ? { ...place, champion } : place);
    } else if (a || b) {
      out.push({ ...(a ?? b)! });
    }
  }
  return out;
}

/**
 * Where the ten stood at a second: the frames on either side blended
 * linearly, so a token slides between minutes rather than jumping; the
 * first frame before the first, the last after the last, and a fresh copy
 * every time. Null without frames. A blend is a guess: a back between two
 * frames reads as a walk across the map, which is what "approximate by a
 * minute" means here, and the Rift and the lab both say it.
 */
export function placeAt(frames: readonly FilmFrame[] | undefined, sec: number): FilmFrame | null {
  if (!frames?.length) return null;
  const t = sec / 60;
  let before: FilmFrame | undefined;
  let after: FilmFrame | undefined;
  for (const f of frames) {
    if (f.minute <= t && (!before || f.minute > before.minute)) before = f;
    if (f.minute >= t && (!after || f.minute < after.minute)) after = f;
  }
  if (!before) return copyFrame(after!);
  if (!after || after === before || after.minute === before.minute) return copyFrame(before);
  const f = (t - before.minute) / (after.minute - before.minute);
  return { minute: t, ours: blendPlaces(before.ours, after.ours, f), theirs: blendPlaces(before.theirs, after.theirs, f) };
}

/** The wards standing at a second: placed by then and not yet gone (one killed or expired that very second still shows). */
export function wardsAt(wards: readonly FilmWard[] | undefined, sec: number): FilmWard[] {
  return (wards ?? []).filter((w) => w.sec <= sec && sec <= w.untilSec);
}

function buildTape(review: GameReview, game: AnalysisGame | undefined, timeline: MatchTimeline, win: boolean, ourSpots: Map<string, Point>, pins: readonly FilmDeathPin[]): FilmTape {
  const goldDiff = timeline.goldDiff ?? [];
  const turn = turnOf(timeline, win);
  const tape: FilmTape = {
    durationSec: timeline.durationSec,
    ourSide: timeline.ourSide,
    goldDiff: goldDiff.slice(),
    turn,
    moments: (review.team.moments ?? []).map((m) => withConsequence(m, goldDiff)),
    events: buildTapeEvents(review.players, timeline, ourSpots),
    beats: buildBeats(review, timeline, timeline.facts, review.players, turn, win, pins)
  };
  // The layers (Part C, 10 Sep 2026): on a version 3 document only, and never an empty key on an older one, so a chapter can tell "no positions kept" from "nobody moved".
  const frames = framesOf(timeline, ourSeats(review, game, timeline), enemySeats(game));
  if (frames) tape.frames = frames;
  const wards = wardsOf(timeline);
  if (wards) tape.wards = wards;
  return tape;
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
  return { ...boardCountsOf(game, review.matchId), moments: (review.team.moments ?? []).map(momentOf) };
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

/** How many came in when the timeline has no row for a death: read off the ledger's own word for it. */
const KILLERS_BY_HOW: Record<DeathVerdict['how'], number> = { executed: 0, solo: 1, gank: 2, fight: 3 };

/**
 * What was around a death, for the scene that draws it. Everything is
 * approximate by a minute, like the flags it reads; the jungler is a
 * champion in a seat on their side (never a name) and ours by our own
 * review. Absent pieces stay absent rather than read as zero.
 */
function sceneOf(row: DeathVerdict, match: TimelineDeath | undefined, read: DeathRead, ourJungler: string | undefined, theirJungler: string | undefined): FilmDeathScene {
  const could = row.could.slice();
  const scene: FilmDeathScene = {
    could,
    killers: match?.killers ?? KILLERS_BY_HOW[row.how],
    executed: match?.executed ?? row.how === 'executed',
    traded: read.traded,
    warded: match?.warded ?? false
  };
  if (typeof match?.alliesNear === 'number') scene.alliesNear = match.alliesNear;
  // Our jungler's own deaths have no jungler to have come.
  if (row.seat !== 'Jungle') {
    const ours: FilmDeathScene['ourJungler'] = { far: could.includes('jungle') };
    if (ourJungler) ours.champion = ourJungler;
    if (match?.ourJungleZone) ours.zone = match.ourJungleZone;
    scene.ourJungler = ours;
  }
  const close = !!match?.theirJungleIn || could.includes('call');
  if (theirJungler || close) {
    const theirs: FilmDeathScene['theirJungler'] = { close };
    if (theirJungler) theirs.champion = theirJungler;
    scene.theirJungler = theirs;
  }
  if (read.objective) scene.objective = { ...read.objective };
  return scene;
}

/** The order the reads walk in when the film is worst-first: what we could have stopped, then what we got something for. */
const WORST_FIRST_RANK: Record<DeathReadKind, number> = { avoidable: 0, traded: 1, clean: 2, bought: 3 };

/** Ascending by cost, with pins that have no cost after those that do; then time, then seat. */
function byCostThenTime(a: FilmDeathPin, b: FilmDeathPin): number {
  const ca = typeof a.cost === 'number' ? a.cost : Number.POSITIVE_INFINITY;
  const cb = typeof b.cost === 'number' ? b.cost : Number.POSITIVE_INFINITY;
  return ca - cb || a.minute - b.minute || seatIndex(a.seat) - seatIndex(b.seat);
}

/**
 * The avoidable deaths that cost most, most negative first, at most three.
 * Only a death the gold fell after counts as having cost something (10 Sep
 * 2026, second review): on a comfortable win every avoidable death is
 * followed by a gain, and "The ones that cost most" must not show a plus.
 * When the curve reaches none of them (deaths in the last two minutes), the
 * unpriced ones with the most tags stand in, so the tape still has a death
 * to stop on; a game where every avoidable death was followed by a gain
 * names none.
 */
function costliestOf(pins: readonly FilmDeathPin[]): string[] {
  const avoidable = pins.filter((p) => p.read === 'avoidable');
  const priced = avoidable.filter((p) => typeof p.cost === 'number' && p.cost < 0).sort(byCostThenTime);
  if (priced.length) return priced.slice(0, MAX_COSTLIEST).map((p) => p.key);
  return avoidable
    .filter((p) => typeof p.cost !== 'number')
    .sort((a, b) => b.could.length - a.could.length || a.minute - b.minute || seatIndex(a.seat) - seatIndex(b.seat))
    .slice(0, MAX_COSTLIEST)
    .map((p) => p.key);
}

function buildMap(review: GameReview, game: AnalysisGame | undefined, timeline: MatchTimeline, ledger: DeathVerdict[], order: FilmDeathOrder, ourSpots: Map<string, Point>): FilmMap {
  const ourSide = timeline.ourSide;
  const facts = timeline.facts!;
  const players = new Map(review.players.map((p) => [p.seat, p]));
  const perZone = new Map<MapZone, number>();
  const ourJungler = players.get('Jungle')?.champion ?? (timeline.lanes ?? []).find((l) => l.seat === 'Jungle')?.champion;
  // Their jungler is a champion in a seat, never a name (Riot rule): the analysed game's enemy in the Jungle position.
  const theirJungler = (game?.enemies ?? []).find((e) => POSITION_SEAT[e.position] === 'Jungle')?.champion;

  // The ledger is one row per timeline death in the same order, so each row takes the first death of its
  // minute and seat not yet claimed: an early double death (two rows, one minute, one seat) gets both deaths
  // and both keys, not the first twice (10 Sep 2026, second review).
  const keys = ourDeathKeys(timeline);
  const claimed = new Set<TimelineDeath>();
  const taken = new Set<string>();
  const pins: FilmDeathPin[] = ledger
    .slice()
    .sort((a, b) => a.minute - b.minute || seatIndex(a.seat) - seatIndex(b.seat))
    .map((d) => {
      const match = (timeline.deaths ?? [])
        .slice()
        .sort((a, b) => a.sec - b.sec)
        .find((t) => t.minute === d.minute && t.seat === d.seat && !claimed.has(t));
      if (match) claimed.add(match);
      let key = match ? keys.get(match)! : deathKey(d.minute, d.seat);
      // A row the timeline has no death for still needs its own key when another row already took the ledger's.
      for (let n = 2; taken.has(key); n += 1) key = `${deathKey(d.minute, d.seat)}:${n}`;
      taken.add(key);
      const sec = match?.sec ?? d.minute * 60;
      let spot = ourSpots.get(key);
      if (!spot) {
        // A ledger row the timeline has no death for: placed on its own, stepped out among the unmatched rows in the zone.
        const n = perZone.get(d.zone) ?? 0;
        perZone.set(d.zone, n + 1);
        spot = placeOurDeath(timeline.matchId, ourSide, { sec, seat: d.seat, zone: d.zone }, n);
      }
      const p = players.get(d.seat);
      const read = readDeath(d, timeline, match);
      const pin: FilmDeathPin = {
        key,
        sec,
        minute: d.minute,
        seat: d.seat,
        zone: d.zone,
        x: spot.x,
        y: spot.y,
        how: d.how,
        could: d.could.slice(),
        line: d.line,
        read: read.kind,
        readLine: read.line,
        glyphs: read.glyphs,
        scene: sceneOf(d, match, read, ourJungler, theirJungler)
      };
      if (typeof read.cost === 'number') pin.cost = read.cost;
      const name = p?.name ?? d.name;
      if (name) pin.name = name;
      const champion = p?.champion ?? (timeline.lanes ?? []).find((l) => l.seat === d.seat)?.champion;
      if (champion) pin.champion = champion;
      return pin;
    });

  // The walk's order is the film's style (`deathOrder`), drawn once from the seed and the result.
  // Worst-first (10 Sep 2026): the avoidable deaths by what they cost, then the trades, the clean ones, and last what bought something.
  if (order === 'worst-first') {
    pins.sort((a, b) => WORST_FIRST_RANK[a.read] - WORST_FIRST_RANK[b.read] || byCostThenTime(a, b));
  }

  const theirSpots = placeTheirDeaths(timeline);
  const theirs = (timeline.theirDeaths ?? [])
    .slice()
    .sort((a, b) => a.sec - b.sec)
    .map((d, i) => ({ x: theirSpots[i].x, y: theirSpots[i].y, minute: d.minute }));

  const clusters = (facts.deathClusters ?? []).map((c) => {
    const spot = clusterSpot(c.zone, ourSide, timeline.matchId);
    // A blob says "a fight happened here", not how big; a 53-death game must not become one red map.
    return { x: spot.x, y: spot.y, r: Math.min(7, 3 + 0.8 * (c.ours + c.theirs)), ours: c.ours, theirs: c.theirs, line: c.line, seats: (c.seats ?? []).slice() };
  });

  const summary = facts.ledgerSummary ?? summarise(ledger);
  const reads = readCounts(pins.map((p) => p.read));
  return { pins, theirs, clusters, summary, reads, opening: readsLine(reads), costliest: costliestOf(pins), order };
}

// ---- The draft, again ----------------------------------------------------------------

/** Review version 6 (10 Sep 2026): at most three swaps, two alternatives under each, three gaps the comp lacked; the validator caps them too, and the build holds the line on a hand-edited document. */
const MAX_SWAPS = 3;
const MAX_ALTERNATIVES = 2;
const MAX_LACKED = 3;

/**
 * The draft with hindsight (10 Sep 2026): our five and theirs as champions
 * in seats, the coach's verdict and the swaps to try. Built only when the
 * review (version 5) wrote a verdict; an older review has no chapter. Their
 * five come from the analysed game's enemies and stay empty when it has
 * none, so the chapter shows our side alone rather than guess. The variant
 * name is what Save as a variant would call the comp: the comp's own name
 * with the first swap's champion, or the protagonist's comp when the game
 * was off the books. Review version 6 (10 Sep 2026, the lead asked whether
 * it would only ever be one champion swap) adds the second option under a
 * swap (`alternatives`) and what the comp lacked as chips (`lacked`, each
 * gap with its glyph); a version 5 review carries neither, and the chapter
 * shows the swaps alone.
 */
function buildDraft(review: GameReview, game: AnalysisGame | undefined, protagonistChampion: string): FilmDraft | undefined {
  const draft = review.team.draft;
  if (!draft?.verdict?.trim()) return undefined;
  const bySeat = (a: FilmDraftSeat, b: FilmDraftSeat) => seatIndex(a.seat) - seatIndex(b.seat);
  const ours: FilmDraftSeat[] = review.players.map((p) => ({ seat: p.seat, champion: p.champion, name: p.name })).sort(bySeat);
  const theirs: FilmDraftSeat[] = enemySeats(game).sort(bySeat);
  const swaps: FilmDraft['swaps'] = (draft.swaps ?? []).slice(0, MAX_SWAPS).map((s) => {
    const gains = (s.gains ?? []).filter((g) => g in GAIN_GLYPHS).slice(0, 3);
    const glyphs = gains.map((g) => GAIN_GLYPHS[g]);
    const swap: FilmDraft['swaps'][number] = { seat: s.seat, out: s.out, in: s.in, why: s.why, gains, glyphs: glyphs.length ? glyphs : ['swap'] };
    // Another champion for the same job, in the coach's order; the one we played and the swap's own are not alternatives to it.
    const alternatives = uniqueSlice(
      (s.alternatives ?? []).map((a) => (typeof a === 'string' ? a.trim() : '')).filter((a) => a && a !== s.in && a !== s.out),
      MAX_ALTERNATIVES
    );
    if (alternatives.length) swap.alternatives = alternatives;
    return swap;
  });
  const first = swaps[0];
  const variantName = first ? `${review.compName ?? `${protagonistChampion || 'Our'} comp`} · ${first.in}` : null;
  const out: FilmDraft = { verdict: draft.verdict.trim(), ours, theirs, swaps, compId: review.compId, compName: review.compName, variantName };
  // What the comp lacked, one chip per gain (a gain named twice is one chip), each with the glyph a swap's gain wears, so the chips and the swaps read alike.
  const seenGaps = new Set<string>();
  const lacked: NonNullable<FilmDraft['lacked']> = [];
  for (const g of draft.lacked ?? []) {
    if (!g || !(g.gain in GAIN_GLYPHS) || seenGaps.has(g.gain) || lacked.length >= MAX_LACKED) continue;
    seenGaps.add(g.gain);
    lacked.push({ gain: g.gain, glyph: GAIN_GLYPHS[g.gain], why: (g.why ?? '').trim() });
  }
  if (lacked.length) out.lacked = lacked;
  return out;
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
const DRAFT_CHAPTER: FilmChapter = { kind: 'draft', title: 'The draft, again' };

/** How many chapters the fullest film has, for a line written before the model is built (the games row). */
export const FILM_CHAPTER_COUNT = 7;

export function buildFilm(review: GameReview, game: AnalysisGame | undefined, timeline: MatchTimeline | null, previous: FilmPrevious | null, opponent?: string): FilmModel {
  const seed = seedOf(review.matchId);
  const facts = timeline?.facts;
  const title = buildTitle(review, game, facts, previous, opponent, seed);
  const oneThing = buildOneThing(review);
  // The look, the motion and the chrome's voice: one draw per field off the seed, biased by the result.
  const style = styleFor(seed, title.win);
  const model: FilmModel = {
    matchId: review.matchId,
    tier: review.tier,
    seed,
    style,
    chapters: [],
    title,
    oneThing,
    seats: buildSeats(review, game, facts),
    card: buildCard(review, game, title.headline)
  };
  const lessons = lessonCalls(review.team.lessons, seed);
  if (lessons.length) model.lessons = lessons;
  const draft = buildDraft(review, game, title.protagonist.champion);
  if (draft) model.draft = draft;

  // The chapter order is led by the data, never the seed: the tape needs a
  // timeline, the map a ledger, and eight or more deaths put the map first.
  // Without a timeline (a replay, or a Riot game the function has not read
  // yet) the board stands in, built from the game's totals.
  const middle: FilmChapter[] = [];
  if (timeline && review.tier === 'timeline') {
    const ourSpots = placeOurDeaths(timeline);
    const ledger = facts?.ledger;
    // The map is built first: the tape stops on every death the map has read (10 Sep 2026; the three costliest before), and each seat carries its own pins.
    if (ledger) {
      model.map = buildMap(review, game, timeline, ledger, style.deathOrder, ourSpots);
      for (const seat of model.seats) seat.pins = model.map.pins.filter((p) => p.seat === seat.seat).sort((a, b) => a.sec - b.sec);
    }
    model.tape = buildTape(review, game, timeline, title.win, ourSpots, model.map?.pins ?? []);
    middle.push(TAPE_CHAPTER);
    if (model.map) {
      if (ledger!.length >= MAP_FIRST_DEATHS) middle.unshift(MAP_CHAPTER);
      else middle.push(MAP_CHAPTER);
    }
  } else {
    model.board = buildBoard(review, game);
    if (model.board.tallies.length || model.board.moments.length) middle.push(BOARD_CHAPTER);
  }
  // The draft sits right after the one thing (10 Sep 2026): what to try next time, before whose seat it lands on.
  const after: FilmChapter[] = model.draft ? [DRAFT_CHAPTER] : [];
  model.chapters = [BASE_CHAPTERS.title, ...middle, BASE_CHAPTERS['one-thing'], ...after, BASE_CHAPTERS.seat, BASE_CHAPTERS.card].map((c) => ({ ...c }));
  return model;
}

/** Exported for the specs and the page: the ledger rows of one seat, in time order. */
export function deathsFor(ledger: DeathVerdict[] | undefined, seat: Role): DeathVerdict[] {
  return (ledger ?? []).filter((d) => d.seat === seat).sort((a, b) => a.minute - b.minute);
}
