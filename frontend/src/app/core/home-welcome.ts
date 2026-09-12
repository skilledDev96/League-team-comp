import { Player, Role } from '../models/team.models';
import { GameRow, PlayerLine } from '../pages/games/game-rows';

/**
 * The line at the top of the home page: who is reading, and how their last few games went (13 Sep 2026).
 *
 * The app knows the reader's seat (`UserPrefs.film.seat`, the one the film room asks for) and not their
 * name, since a signed-in account carries no player id. So the welcome is built from the seat: the
 * starter in it is the reader, and a reader who never picked one is asked once, unless they said no.
 *
 * Pure: the page hands in the seat, the roster, the rows and the hour, and reads back one small record.
 * The hour comes in rather than being read here, so the specs pin it.
 */

/** Which part of the day an hour of the clock falls in: 5 to 11 is morning, 12 to 17 afternoon, the rest evening. */
export function dayPart(hour: number): 'Morning' | 'Afternoon' | 'Evening' {
  if (hour >= 5 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 18) return 'Afternoon';
  return 'Evening';
}

/** How many of the newest games the form strip shows. */
export const WELCOME_FORM_GAMES = 5;

export interface Welcome {
  /** "Morning, Zac", or the part of the day alone when the seat names nobody. */
  greeting: string;
  /** The starter in the reader's seat; null when there is no seat or nobody sits in it. */
  player: Player | null;
  /** Nobody is named and the reader has not waved the question away: ask which seat is theirs. */
  needsSeat: boolean;
  /** Their line over the rows; absent when they played none of them. */
  line?: PlayerLine;
  /** Series titles the MVP race credits them with. */
  titles: number;
  /** Their newest games first, at most five, as wins and losses. */
  form: ('W' | 'L')[];
}

/**
 * The welcome for one reader. The starter in the seat is the reader, the first by roster order when two
 * starters share it; their line, titles and form are read by the same name the rows carry for our side.
 * Only our side is ever read: the other team has no names here.
 */
export function welcomeFor(i: {
  seat?: Role;
  starters: readonly Player[];
  lines: readonly PlayerLine[];
  titlesByPlayerId: ReadonlyMap<string, number>;
  /** Newest first, as `buildGameRows` returns them. */
  rows: readonly GameRow[];
  hour: number;
  /** The reader closed the seat question; do not ask again. */
  dismissed: boolean;
}): Welcome {
  const part = dayPart(i.hour);
  const player = i.seat ? ([...i.starters].sort((a, b) => a.order - b.order).find((p) => p.role === i.seat) ?? null) : null;
  if (!player) return { greeting: part, player: null, needsSeat: !i.dismissed, titles: 0, form: [] };
  const line = i.lines.find((l) => l.name === player.name);
  const form = i.rows
    .filter((r) => r.ours.some((p) => p.player === player.name))
    .slice(0, WELCOME_FORM_GAMES)
    .map((r): 'W' | 'L' => (r.win ? 'W' : 'L'));
  return {
    greeting: `${part}, ${player.name}`,
    player,
    needsSeat: false,
    ...(line ? { line } : {}),
    titles: i.titlesByPlayerId.get(player.id) ?? 0,
    form
  };
}
