import { DeathCould, DeathVerdict, MapZone, MatchTimeline, Role, TimelineDeath, TimelineObjective } from '../models/team.models';
import { COULD_GLYPHS, FilmGlyph, OBJECTIVE_GLYPHS } from './film-model';

/**
 * How the film reads a death of ours (cut 4, 10 Sep 2026): not a question
 * for the reader but a verdict in plain words, so the map and the tape can
 * say what went wrong and what did not. Built from the ledger row (what
 * would have stopped it) and the timeline around it (what it bought, what
 * it traded, what it cost).
 *
 * The reads, in the order they are checked:
 * - `bought`: an objective of ours fell within `OBJECTIVE_WINDOW_SEC` of the
 *   death (before or after), and the death was where the fight over it was:
 *   river-side or in a jungle, or the victim was on the take. A death that
 *   buys a dragon is a good death, whatever the tags say; a laner dying alone
 *   in lane while the other four take it has bought nothing, whatever the
 *   clock says (10 Sep 2026, second review).
 * - `traded`: at least as many of theirs fell as ours within
 *   `TRADE_WINDOW_SEC` of it, and the ledger has no tag on it. Theirs count
 *   only when they fell in the same zone or the victim was on the kill,
 *   because a solo death top and a kill bot in the same half-minute are two
 *   things; ours count by time alone, this one included, so a second death
 *   of ours elsewhere makes a trade harder to claim, never easier. A
 *   one-for-one is even; a one-for-three where we lost three is not a trade.
 * - `avoidable`: the ledger carries at least one tag; the read's line is
 *   the ledger's own line, led by the word.
 * - `clean`: nothing on the map would have stopped it, and it bought and
 *   traded nothing.
 *
 * Pure. The specs pin every rule with fixtures; nothing here reads a
 * service or the clock.
 */

export type DeathReadKind = 'avoidable' | 'traded' | 'bought' | 'clean';
export const DEATH_READS: readonly DeathReadKind[] = ['avoidable', 'traded', 'bought', 'clean'];

/** An objective this close to a death, either way, is what the death was about. */
export const OBJECTIVE_WINDOW_SEC = 60;
/** Their deaths this close to ours, either way, are the same fight. */
export const TRADE_WINDOW_SEC = 30;
/** How far ahead the cost of a death is read on the gold curve, in minutes. */
export const COST_MINUTES = 2;
/** Where a fight over an objective is: every pit is river-side, and it spills into the jungles either side. A death in a lane or a base is somewhere else. */
export const OBJECTIVE_ZONES: ReadonlySet<MapZone> = new Set<MapZone>(['river', 'ourJungle', 'theirJungle']);
/** A card carries at most this many glyphs; the line names at most this many tags too, so the two agree. */
const MAX_GLYPHS = 3;

/** The word on screen for each read, and the tip that says what it means. */
export const READ_LABELS: Record<DeathReadKind, { label: string; tip: string; icon: FilmGlyph }> = {
  avoidable: { label: 'Avoidable', tip: 'The ledger found something on the map that would have stopped it: a ward, the jungler, a call, or standing elsewhere', icon: 'skull' },
  traded: { label: 'Traded', tip: 'At least as many of theirs fell in the same fight', icon: 'swords' },
  bought: { label: 'Bought an objective', tip: 'An objective of ours fell within a minute of it', icon: 'coin' },
  clean: { label: 'Clean', tip: 'Nothing on the map would have stopped it, and it bought and traded nothing; sometimes they just play it well', icon: 'check' }
};

/** The read in the counts line: "6 avoidable, 1 bought an objective". */
const READ_WORDS: Record<DeathReadKind, string> = { avoidable: 'avoidable', traded: 'traded', bought: 'bought an objective', clean: 'clean' };

/** Each tag as the clause of a sentence; the card shows the name and the minute, so neither is repeated here. */
const COULD_WORDS: Record<DeathCould, string> = {
  ward: 'no ward had gone down nearby',
  jungle: 'our jungler was about a screen away',
  call: 'their jungler had been on this side a minute earlier',
  position: 'alone on their side of the map'
};

/** What fell, for "Bought the …": the dragon carries its element when the timeline knows it. */
const OBJECTIVE_WORDS: Record<TimelineObjective['type'], string> = {
  dragon: 'dragon',
  herald: 'herald',
  grubs: 'grubs',
  baron: 'baron',
  elder: 'elder dragon',
  atakhan: 'Atakhan'
};

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five'];
/** Small counts in words, as the sentence wants them; anything past a team of five stays a digit. */
const countWord = (n: number): string => COUNT_WORDS[n] ?? String(n);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "X", "X, and Y", "X, Y, and Z". */
function joinWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

export interface DeathRead {
  kind: DeathReadKind;
  /** One line in the read's own words. */
  line: string;
  /** The imagery, most telling first; at most three. */
  glyphs: FilmGlyph[];
  /** Ours minus theirs over the next `COST_MINUTES`, in gold; negative when it cost us. Absent when the curve does not reach. */
  cost?: number;
  /** How many of theirs fell within the trade window. */
  traded: number;
  /** The objective within the window, when there is one. */
  objective?: { type: TimelineObjective['type']; ours: boolean };
}

/**
 * The read of one ledger row against the timeline. `death` is the
 * timeline's own row for it when the caller has already matched it
 * (`minute` and `seat`); found here otherwise.
 */
export function readDeath(row: DeathVerdict, timeline: Pick<MatchTimeline, 'deaths' | 'theirDeaths' | 'objectives' | 'goldDiff'>, death?: TimelineDeath): DeathRead {
  const deaths = timeline.deaths ?? [];
  const match = death ?? deaths.find((d) => d.minute === row.minute && d.seat === row.seat);
  // A ledger row the timeline has no death for sits on its minute; the windows still read around it.
  const sec = match?.sec ?? row.minute * 60;
  const zone = match?.zone ?? row.zone;
  const executed = match?.executed ?? row.how === 'executed';

  // The objective the death was about: ours if any fell in the window, else the nearest of theirs, so the scene can still say what was up.
  const near = (timeline.objectives ?? [])
    .filter((o) => Math.abs(o.minute * 60 - sec) <= OBJECTIVE_WINDOW_SEC)
    .sort((a, b) => Math.abs(a.minute * 60 - sec) - Math.abs(b.minute * 60 - sec));
  const bought = near.find((o) => o.side === 'us') ?? near[0];
  // Where matters as much as when (10 Sep 2026): the death bought the objective only when it fell where the fight over it was, or the victim was on the take.
  const boughtHere = !!bought && bought.side === 'us' && (OBJECTIVE_ZONES.has(zone) || onIt(bought, row.seat));

  // Their deaths in the window are the fight when they fell where this one did, or the victim was on the kill; ours in the same window include this one, whether or not the timeline lists it.
  const inWindow = (s: number) => Math.abs(s - sec) <= TRADE_WINDOW_SEC;
  const traded = (timeline.theirDeaths ?? []).filter((d) => inWindow(d.sec) && (d.zone === zone || (d.ourInvolved ?? []).includes(row.seat))).length;
  const ours = deaths.filter((d) => inWindow(d.sec)).length + (deaths.some((d) => d.minute === row.minute && d.seat === row.seat) ? 0 : 1);

  const read: DeathRead = { kind: 'clean', line: '', glyphs: [], traded };
  if (bought) read.objective = { type: bought.type, ours: bought.side === 'us' };

  const goldDiff = timeline.goldDiff ?? [];
  const from = goldDiff[row.minute];
  const to = goldDiff[row.minute + COST_MINUTES];
  if (typeof from === 'number' && typeof to === 'number') read.cost = to - from;

  if (bought && boughtHere) {
    read.kind = 'bought';
    const word = bought.type === 'dragon' && bought.subType ? `${bought.subType} dragon` : OBJECTIVE_WORDS[bought.type];
    read.line = `Bought the ${word}: it fell to us within a minute.`;
    read.glyphs = [OBJECTIVE_GLYPHS[bought.type]];
  } else if (row.could.length) {
    read.kind = 'avoidable';
    read.line = avoidableLine(row.could, match?.killers ?? 0, traded);
    read.glyphs = couldGlyphs(row.could);
  } else if (traded > 0 && traded >= ours) {
    read.kind = 'traded';
    read.line = `Traded: ${countWord(traded)} of theirs fell in the same fight.`;
    read.glyphs = ['swords'];
  } else {
    read.line = 'Clean: nothing on the map would have stopped this one.';
    read.glyphs = ['check'];
  }
  if (executed && read.glyphs.length < MAX_GLYPHS) read.glyphs.push('tower');
  return read;
}

/** Whether one of our seats was on an objective: on the take, or near the pit as the timeline saw it. */
function onIt(o: Pick<TimelineObjective, 'ourInvolved' | 'ourNear'>, seat: Role): boolean {
  return (o.ourInvolved ?? []).includes(seat) || (o.ourNear ?? []).includes(seat);
}

/**
 * "Avoidable: " and the tags as clauses, at most three so the line stays
 * near 140 characters. When two or more came in and a ward is among the
 * tags, the ward clause leads with the count ("two came in and no ward had
 * gone down nearby") — but only up to two tags, where the sentence has room.
 * A trade that the tags rule out is still said, at the end.
 */
function avoidableLine(could: readonly DeathCould[], killers: number, traded: number): string {
  const tags = could.slice(0, MAX_GLYPHS);
  let words = tags.map((t) => COULD_WORDS[t]);
  if (killers >= 2 && tags.includes('ward') && tags.length <= 2) {
    const lead = `${countWord(killers)} came in and ${COULD_WORDS.ward}`;
    words = [lead, ...tags.filter((t) => t !== 'ward').map((t) => COULD_WORDS[t])];
  }
  const trade = traded > 0 ? `, though ${countWord(traded)} of theirs fell too` : '';
  return `Avoidable: ${joinWords(words)}${trade}.`;
}

/** How many deaths fall under each read, every read present. */
export function readCounts(reads: readonly DeathReadKind[]): Record<DeathReadKind, number> {
  const out: Record<DeathReadKind, number> = { avoidable: 0, traded: 0, bought: 0, clean: 0 };
  for (const r of reads) out[r]++;
  return out;
}

/**
 * One line over the map and in the panel: "11 deaths: 6 avoidable, 2 traded,
 * 1 bought an objective, 2 clean." Reads with a count of zero are left out;
 * no deaths reads "No deaths."
 */
export function readsLine(counts: Record<DeathReadKind, number>): string {
  const total = DEATH_READS.reduce((n, k) => n + (counts[k] ?? 0), 0);
  if (!total) return 'No deaths.';
  const parts = DEATH_READS.filter((k) => counts[k] > 0).map((k) => `${counts[k]} ${READ_WORDS[k]}`);
  return `${plural(total, 'death', 'deaths')}: ${parts.join(', ')}.`;
}

/** The tags' glyphs, in the ledger's order, for a pin's badges; at most three, like the card. */
export function couldGlyphs(could: readonly DeathCould[]): FilmGlyph[] {
  return could.slice(0, MAX_GLYPHS).map((c) => COULD_GLYPHS[c]);
}
