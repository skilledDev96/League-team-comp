/**
 * A comp's seats, now that a seat can hold more than one champion (20 Sep 2026 — the lead: "the dive
 * comp has naut a priority but Leona can also be added as a secondary pick").
 *
 * This is the **only** module that knows a comp has two seat fields. `Comp.picks` is unchanged and
 * always holds the priority, one "Champion - note" line a seat; `Comp.fallbacks` holds each seat's
 * fallbacks in order, each its own line. Everything else reads seats through here, so no caller has to
 * remember which of the two it is looking at and no caller can write one without the other.
 *
 * **The invariant is enforced on read, not on write.** `seatOptions` returns nothing for a seat whose
 * priority is empty, whatever the document holds — a hand-edited document, an Admin paste or a future
 * importer cannot make a seat read as filled because something is sitting in its fallbacks. The same
 * read also drops duplicates within a seat and caps it at `MAX_SEAT_OPTIONS`, so every count, every
 * "is this comp complete" and every wall is answered from one normalisation.
 *
 * The writes all return **both** fields together, so one gesture is one write and the two cannot drift.
 * A write also normalises every other seat, which is the moment a document that broke the invariant
 * gets cleaned up.
 */

import { Comp, CompFallbacks, CompPicks, Role, ROLES } from '../models/team.models';
import { canonicalChampion } from './champion-key';

/**
 * At most four champions a seat — the priority and three fallbacks — mirroring the champion picker's
 * `max`/`atLimit`. Past that a seat is a wish list rather than a plan, and the chips stop fitting under
 * a 9rem board slot.
 */
export const MAX_SEAT_OPTIONS = 4;

/** One champion a seat holds, with the note written against that entry. Rank 0 is the priority. */
export interface SeatOption {
  champion: string;
  note: string;
  rank: number;
}

/**
 * The two fields a comp stores its seats in. A whole `Comp` satisfies it, and so does the comp board,
 * which holds them as two separate inputs and has no comp.
 */
export type CompSeats = Pick<Comp, 'picks' | 'fallbacks'>;

/** What every write here returns: both fields, always together. */
export interface SeatWrite {
  picks: CompPicks;
  fallbacks: CompFallbacks;
}

// ---- The "Champion - note" line -------------------------------------------
// These live here rather than in `shared/comp-board.util.ts` because the line
// format is what a seat entry *is*, and a fallback is one of those lines too.
// `comp-board.util` re-exports them, so every existing import keeps working.

/**
 * Picks are stored as "Champion - note" lines, so setting a champion must not throw away a note
 * someone wrote against that entry.
 */
export function setChampionInLine(line: string | undefined, champion: string): string {
  const note = noteOf(line ?? '');
  return note ? `${champion} - ${note}` : champion;
}

export function championOf(line: string | undefined): string {
  const [champ] = (line ?? '').split(' - ');
  return (champ ?? '').trim();
}

export function noteOf(line: string | undefined): string {
  const parts = (line ?? '').split(' - ');
  return parts.slice(1).join(' - ').trim();
}

// ---- Reading ---------------------------------------------------------------

/** One seat, normalised: the entry lines that name a champion, and what the seat falls back to when empty. */
interface SeatLines {
  /** Lines with a champion in them, the priority first. Empty for an empty seat. */
  options: string[];
  /** The `picks` line for a seat holding no champion: '' or ' - note', so clearing never eats a note. */
  bare: string;
}

/** A seat's line for when it holds nothing: the note alone, the way clearing a pick has always left it. */
function blankLine(line: string | undefined): string {
  const note = noteOf(line);
  return note ? ` - ${note}` : '';
}

/** The invariant, the dedupe and the cap, all in one place: nothing else reads `fallbacks` directly. */
function readSeat(comp: CompSeats, role: Role): SeatLines {
  const priority = comp.picks?.[role] ?? '';
  const bare = blankLine(priority);
  // No priority, no options — whatever is sitting in `fallbacks` for this role.
  if (!championOf(priority)) return { options: [], bare };

  const options: string[] = [];
  const seen = new Set<string>();
  for (const line of [priority, ...(comp.fallbacks?.[role] ?? [])]) {
    const key = canonicalChampion(championOf(line));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    options.push(line);
    if (options.length >= MAX_SEAT_OPTIONS) break;
  }
  return { options, bare };
}

function readSeats(comp: CompSeats): Record<Role, SeatLines> {
  const out = {} as Record<Role, SeatLines>;
  for (const role of ROLES) out[role] = readSeat(comp, role);
  return out;
}

/** Back to the two stored fields. A role with no fallbacks is left off entirely rather than stored empty. */
function writeSeats(seats: Record<Role, SeatLines>): SeatWrite {
  const picks = {} as CompPicks;
  const fallbacks: CompFallbacks = {};
  for (const role of ROLES) {
    const seat = seats[role];
    picks[role] = seat.options[0] ?? seat.bare;
    if (seat.options.length > 1) fallbacks[role] = seat.options.slice(1);
  }
  return { picks, fallbacks };
}

/** Where a champion sits within one seat, comparing canonically so MonkeyKing finds Wukong. */
function indexIn(seat: SeatLines, champion: string): number {
  const key = canonicalChampion(champion);
  if (!key) return -1;
  return seat.options.findIndex((line) => canonicalChampion(championOf(line)) === key);
}

/**
 * Everything one seat can play, the priority first then the fallbacks in order.
 *
 * Empty when the priority is empty, so `filled` and `complete` can never lie about a seat whose
 * document holds fallbacks and no pick.
 */
export function seatOptions(comp: CompSeats, role: Role): SeatOption[] {
  return readSeat(comp, role).options.map((line, rank) => ({
    champion: championOf(line),
    note: noteOf(line),
    rank
  }));
}

/** All five seats' options at once, for a view that draws the whole board. */
export function compSeatOptions(comp: CompSeats): Record<Role, SeatOption[]> {
  const out = {} as Record<Role, SeatOption[]>;
  for (const role of ROLES) out[role] = seatOptions(comp, role);
  return out;
}

/**
 * The five priority champions, one a seat and no notes — what a comp's identity, damage profile, face
 * and expectation still read, and what every caller that wants exactly five champions should use.
 */
export function priorityChampions(comp: CompSeats): CompPicks {
  const out = {} as CompPicks;
  for (const role of ROLES) out[role] = championOf(comp.picks?.[role]);
  return out;
}

/**
 * Every champion the comp can put on the map, in seat then rank order, once each.
 *
 * This is what "does this comp use Leona" asks: a fallback counts. The spelling kept is the first one
 * met, so an icon lookup resolves the name as it was written.
 */
export function allChampions(comp: CompSeats): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const role of ROLES) {
    for (const option of seatOptions(comp, role)) {
      const key = canonicalChampion(option.champion);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(option.champion);
    }
  }
  return out;
}

/** Which seat holds a champion, priority or fallback, or null. */
export function seatOf(comp: CompSeats, champion: string): Role | null {
  const key = canonicalChampion(champion);
  if (!key) return null;
  for (const role of ROLES) {
    if (readSeat(comp, role).options.some((line) => canonicalChampion(championOf(line)) === key)) return role;
  }
  return null;
}

// ---- Writing ---------------------------------------------------------------

/**
 * The seat's priority, keeping whatever note was written against it.
 *
 * A champion already in *this* seat is promoted rather than duplicated; a champion sitting in another
 * seat is refused, because one champion cannot hold two seats of one comp. Both refusals return the
 * comp's seats normalised, so a caller that writes anyway writes the same thing back.
 */
export function setPriority(comp: CompSeats, role: Role, champion: string): SeatWrite {
  const seats = readSeats(comp);
  const name = champion.trim();
  if (!name) return writeSeats(seats);
  if (indexIn(seats[role], name) >= 0) return promoteOption(comp, role, name);
  if (seatOf(comp, name)) return writeSeats(seats);

  const seat = seats[role];
  const line = setChampionInLine(seat.options[0] ?? seat.bare, name);
  seats[role] = { ...seat, options: [line, ...seat.options.slice(1)] };
  return writeSeats(seats);
}

/**
 * One more champion behind the seat's priority.
 *
 * On an empty seat it becomes the priority instead — a fallback with nothing to fall back from is the
 * one state the invariant forbids. Refused for a champion already anywhere in the comp, and refused
 * past `MAX_SEAT_OPTIONS`.
 */
export function addOption(comp: CompSeats, role: Role, champion: string): SeatWrite {
  const seats = readSeats(comp);
  const name = champion.trim();
  if (!name) return writeSeats(seats);

  const seat = seats[role];
  if (!seat.options.length) return setPriority(comp, role, name);
  if (seatOf(comp, name)) return writeSeats(seats);
  if (seat.options.length >= MAX_SEAT_OPTIONS) return writeSeats(seats);

  seats[role] = { ...seat, options: [...seat.options, name] };
  return writeSeats(seats);
}

/**
 * One entry out of a seat.
 *
 * Removing the priority **promotes** the first fallback, so a seat never reads Empty with chips under
 * it. The promoted entry brings its own note, and the removed one takes its note with it — except when
 * the seat is left with nothing, where the note stays on the empty seat the way clearing a pick always
 * has.
 */
export function removeOption(comp: CompSeats, role: Role, champion: string): SeatWrite {
  const seats = readSeats(comp);
  const seat = seats[role];
  const at = indexIn(seat, champion);
  if (at < 0) return writeSeats(seats);

  const options = [...seat.options];
  const [gone] = options.splice(at, 1);
  seats[role] = { options, bare: options.length ? seat.bare : blankLine(gone) };
  return writeSeats(seats);
}

/** A fallback becomes the priority, the old priority dropping to the front of the fallbacks. */
export function promoteOption(comp: CompSeats, role: Role, champion: string): SeatWrite {
  const seats = readSeats(comp);
  const seat = seats[role];
  const at = indexIn(seat, champion);
  // Not in this seat, or already the priority: nothing to do either way.
  if (at <= 0) return writeSeats(seats);

  const options = [...seat.options];
  const [risen] = options.splice(at, 1);
  seats[role] = { ...seat, options: [risen, ...options] };
  return writeSeats(seats);
}

/**
 * The note against one entry, which is where the reason for that pick lives.
 *
 * A seat holding no champion still takes a note — the board's note field has always worked on an empty
 * slot, and the note is often written before the pick is chosen.
 */
export function setNote(comp: CompSeats, role: Role, champion: string, note: string): SeatWrite {
  const seats = readSeats(comp);
  const seat = seats[role];
  const text = note.trim();

  if (!seat.options.length) {
    seats[role] = { ...seat, bare: text ? ` - ${text}` : '' };
    return writeSeats(seats);
  }

  const at = indexIn(seat, champion);
  if (at < 0) return writeSeats(seats);
  const options = [...seat.options];
  options[at] = text ? `${championOf(options[at])} - ${text}` : championOf(options[at]);
  seats[role] = { ...seat, options };
  return writeSeats(seats);
}

/**
 * Two whole seats exchanged — priority, fallbacks and notes — which is what the board's drag does.
 *
 * The roles are checked rather than trusted (20 Sep 2026): a drop carries whatever the drag put on
 * the clipboard, and a drag that began on a champion's picture in the wall carries an icon URL. Taking
 * it at its type wrote a junk key into the seat map and left a real seat `undefined`, which threw on
 * the way back out — so anything that is not one of the five is no swap at all.
 */
export function swapSeats(comp: CompSeats, a: Role, b: Role): SeatWrite {
  const seats = readSeats(comp);
  if (a === b || !ROLES.includes(a) || !ROLES.includes(b)) return writeSeats(seats);
  const moved = seats[a];
  seats[a] = seats[b];
  seats[b] = moved;
  return writeSeats(seats);
}
