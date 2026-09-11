import { MatchTimeline, Role, ROLES, TimelineObjective } from '../models/team.models';
import { MvpGame, seatOfPosition } from './game-mvp';

/**
 * Who swung the game most (11 Sep 2026, queue item 7).
 *
 * Not who played best — the MVP already answers that — but who moved the
 * gold. For every kill of theirs a seat was in on, and every death of that
 * seat, the gold swing over the two minutes after it: the same window and
 * the same curve the map's `cost` reads for a single death
 * (`core/death-reads.ts`, `COST_MINUTES`). A kill adds its swing and a death
 * adds its swing too, because a death's swing is already negative when it
 * cost us; a death that bought a dragon is a plus, and it should be.
 *
 * **A minute is priced once** (11 Sep 2026, second fix pass). The curve moves
 * once, and every event of one seat inside the same minute reads that same
 * two-minute window off it. Summing per event instead multiplied a teamfight
 * by however many of theirs fell in it — a seat in on all five kills of one
 * ace carried the fight's swing five times over, and the chip printed it as
 * gold. So the events are collected by minute and each minute's swing is
 * added a single time; the kills and the deaths are still counted per event,
 * because those are counts and not gold.
 *
 * Most first is by the **size** of the swing either way, not by its sign: on
 * a game we lost every seat's windows come out negative, and ranking by the
 * signed figure crowned whoever lost the least. The sign travels on the
 * figure itself, which every surface prints.
 *
 * What it cannot see, said everywhere it is shown: Riot's timeline carries
 * gold once a minute, so every swing is the minute the event fell in against
 * the minute two later. A fight at 19:50 and a fight at 19:10 are the same
 * minute to this. It is a read, not a ledger.
 *
 * Absent without a timeline. A game with no timeline gets nothing here and
 * the surface says so (`INFLUENCE_NO_TIMELINE`) rather than showing a zero
 * that looks like a finding.
 */

/** How far ahead a swing is read on the gold curve, in minutes. The map's `cost` uses the same window. */
export const INFLUENCE_MINUTES = 2;

/** The sentence every surface closes with, because a minute is all the resolution there is. */
export const INFLUENCE_TIP =
  'The gold swing over the two minutes after every kill they were in on and every death of theirs. Riot keeps the curve a minute at a time, so this is approximate.';

/** What a surface says instead of a swing when the game has no timeline. */
export const INFLUENCE_NO_TIMELINE = 'Who swung it most needs the timeline, and this game has none.';

/**
 * And when the timeline is there but carries no kill or death to price
 * (11 Sep 2026, second fix pass): a document trimmed under `MAX_BYTES` loses
 * their deaths first, and a game nobody died in has none either way. Saying
 * "this game has none" of a timeline the film is reading from is simply
 * false, so the two cases have their own sentence.
 */
export const INFLUENCE_NOTHING = 'Who swung it most needs the fights the timeline keeps, and none came through for this game.';

/** The timeline this module reads: the curve, both sides' deaths, and the objectives that name a swing. */
export type InfluenceTimeline = Pick<MatchTimeline, 'deaths' | 'theirDeaths' | 'goldDiff' | 'objectives'>;

export interface SeatInfluence {
  seat: Role;
  /** Our roster member, when the game named one. */
  name?: string;
  /** The champion in the seat, for the tile. */
  champion?: string;
  /** Gold, ours minus theirs, summed over the minutes this seat had an event in — each such minute counted once. */
  swing: number;
  /** Their deaths this seat was in on, priced. */
  kills: number;
  /** This seat's own deaths, priced. */
  deaths: number;
  /** Events the curve stops before, so the sum can say what it left out. */
  unpriced: number;
  /** The single event that moved the most gold either way. */
  best?: { minute: number; swing: number; what: string };
  /** The terms behind the number, in order: the sum, the biggest, what was left out. */
  terms: string[];
  /** The whole sentence; the first of the list is the one that swung it most. */
  line: string;
}

const seatIndex = (seat: Role) => ROLES.indexOf(seat);

/** How far either way an objective is what an event was about. The reads use the same minute. */
const OBJECTIVE_WINDOW_SEC = 60;

/** What fell, as the sentence wants it; a dragon carries its element when the timeline knows it. */
const OBJECTIVE_WORDS: Record<TimelineObjective['type'], string> = {
  dragon: 'the dragon',
  herald: 'the herald',
  grubs: 'the grubs',
  baron: 'the baron',
  elder: 'the elder dragon',
  atakhan: 'Atakhan'
};

/** "+4.1k", "-800", or "even" when the two minutes came out level. */
export function swingText(gold: number): string {
  const n = Math.round(gold);
  if (!n) return 'even';
  const size = Math.abs(n) >= 1000 ? `${(Math.abs(n) / 1000).toFixed(1)}k` : String(Math.abs(n));
  return `${n > 0 ? '+' : '-'}${size}`;
}

interface Event {
  sec: number;
  minute: number;
  swing?: number;
  kind: 'kill' | 'death';
}

/**
 * Who swung it, most first. Every seat with at least one event is in the
 * list; a seat the timeline never saw in a fight is left out rather than
 * shown at zero, which reads as a finding about them.
 */
export function influenceOf(game: MvpGame | undefined | null, timeline: InfluenceTimeline | undefined | null): SeatInfluence[] {
  if (!timeline) return [];
  const gold = timeline.goldDiff ?? [];
  // A minute the curve does not reach cannot be priced: the timeline stops where the game did, and the last minutes have no "two minutes after".
  const swingAt = (minute: number): number | undefined => {
    const from = gold[minute];
    const to = gold[minute + INFLUENCE_MINUTES];
    return typeof from === 'number' && typeof to === 'number' ? to - from : undefined;
  };

  const events = new Map<Role, Event[]>();
  const add = (seat: Role, event: Event) => {
    const list = events.get(seat) ?? [];
    list.push(event);
    events.set(seat, list);
  };
  for (const d of timeline.theirDeaths ?? []) {
    for (const seat of d.ourInvolved ?? []) add(seat, { sec: d.sec, minute: d.minute, swing: swingAt(d.minute), kind: 'kill' });
  }
  for (const d of timeline.deaths ?? []) add(d.seat, { sec: d.sec, minute: d.minute, swing: swingAt(d.minute), kind: 'death' });

  const objectives = timeline.objectives ?? [];
  const seats = new Map<Role, { name?: string; champion?: string }>();
  for (const p of game?.players ?? []) {
    const seat = seatOfPosition(p.position);
    if (seat && !seats.has(seat)) seats.set(seat, { name: p.name ?? undefined, champion: p.champion || undefined });
  }

  const rows = [...events.entries()].map(([seat, list]) => {
    const priced = list.filter((e) => typeof e.swing === 'number');
    // One window a minute (11 Sep 2026, second fix pass): every event of this seat inside a minute reads the same
    // `goldDiff[m+2] - goldDiff[m]`, so the gold is added once for the minute however many events fell in it.
    const byMinute = new Map<number, number>();
    for (const e of priced) byMinute.set(e.minute, e.swing ?? 0);
    const swing = [...byMinute.values()].reduce((sum, v) => sum + v, 0);
    // The biggest either way, because the one fight that lost the game is as much a swing as the one that won it; ties go to the earlier minute, then a kill over a death.
    const best = priced
      .slice()
      .sort((a, b) => Math.abs(b.swing ?? 0) - Math.abs(a.swing ?? 0) || a.sec - b.sec || (a.kind === b.kind ? 0 : a.kind === 'kill' ? -1 : 1))[0];
    const who = seats.get(seat);
    const row: SeatInfluence = {
      seat,
      swing,
      kills: priced.filter((e) => e.kind === 'kill').length,
      deaths: priced.filter((e) => e.kind === 'death').length,
      unpriced: list.length - priced.length,
      terms: [],
      line: ''
    };
    if (who?.name) row.name = who.name;
    if (who?.champion) row.champion = who.champion;
    if (best) row.best = { minute: best.minute, swing: best.swing ?? 0, what: whatOf(best, objectives) };
    return row;
  });

  // By size, either way: a game we lost has every seat negative, and the biggest figure there is the seat the game
  // moved most around, not the one who lost the least. The sign says which way it went (11 Sep 2026, second fix pass).
  rows.sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing) || seatIndex(a.seat) - seatIndex(b.seat));
  for (const [i, row] of rows.entries()) {
    row.terms = termsOf(row);
    row.line = lineOf(row, i === 0);
  }
  return rows;
}

/** What the event was about: the objective within a minute of it either way, else the kill or the death itself. */
function whatOf(event: Event, objectives: readonly TimelineObjective[]): string {
  const near = objectives
    .filter((o) => Math.abs(o.minute * 60 - event.sec) <= OBJECTIVE_WINDOW_SEC)
    .sort((a, b) => Math.abs(a.minute * 60 - event.sec) - Math.abs(b.minute * 60 - event.sec))[0];
  if (near) return near.type === 'dragon' && near.subType ? `the ${near.subType} dragon` : OBJECTIVE_WORDS[near.type];
  return event.kind === 'kill' ? 'a kill' : 'a death';
}

function termsOf(row: SeatInfluence): string[] {
  const terms = [`${swingText(row.swing)} across the fights they were in`];
  // The biggest carries its own figure and its sign (11 Sep 2026, second fix pass): "the biggest was the baron at 24"
  // read the same whether that baron won the game or lost it. The minute takes its unit, like every other on the film.
  if (row.best) terms.push(`the biggest was ${swingText(row.best.swing)} on ${row.best.what} at ${row.best.minute} min`);
  if (row.unpriced) terms.push(`the curve stops before ${row.unpriced} more`);
  return terms;
}

/**
 * "Vi swung the game most: +4.1k across the fights they were in, and the
 * biggest was +4.1k on the herald at 20 min." The champion says who, because a seat word
 * is not a person; "they" because a champion's pronoun is not ours to guess.
 * Everyone under the first is named and then read off, with no verb, so a
 * seat the curve came out level on does not have to "swing even".
 */
function lineOf(row: SeatInfluence, most: boolean): string {
  const who = row.champion || row.name || row.seat;
  const [first, ...rest] = row.terms;
  const lead = most ? `${who} swung the game most: ${first}` : `${who}: ${first}`;
  return `${lead}${rest.length ? `, and ${rest.join(', and ')}` : ''}.`;
}
