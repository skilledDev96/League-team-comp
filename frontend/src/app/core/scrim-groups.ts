import { Scrim } from '../models/team.models';

/**
 * Scrims grouped the way they are thought about: by the team we played.
 *
 * The flat list — newest first, every game its own row — was fine for eight
 * scrims and unreadable at thirty. What a coach wants is "how have we done
 * against MOSS", and the notes, target bans and scouted roster belong to that
 * team, not to any one evening. So the top level is the opponent, accumulating
 * across every session; inside it the games fall into dated sessions, because a
 * scrim block is still an evening's work and reads as one.
 *
 * Pure, so it is tested here and the component only renders it.
 */

export interface ScrimGame {
  readonly scrim: Scrim;
  /** From our point of view; null when nobody has said which side we were. */
  readonly won: boolean | null;
}

export interface ScrimSession {
  /** Calendar day, YYYY-MM-DD, in the local zone the scrim was imported in. */
  readonly day: string;
  readonly games: readonly ScrimGame[];
  readonly wins: number;
  readonly losses: number;
}

export interface ScrimOpponentGroup {
  /** Stable key for the metadata record — see `scrimOpponentId`. */
  readonly id: string;
  /** The name as it was typed, from the most recent scrim against them. */
  readonly name: string;
  readonly games: readonly ScrimGame[];
  /** Newest session first. */
  readonly sessions: readonly ScrimSession[];
  readonly wins: number;
  readonly losses: number;
  /** ISO timestamp of the most recent game, for ordering the groups. */
  readonly latest: string;
}

/** Shown for scrims nobody has named an opponent on. Grouped, not scattered. */
export const UNNAMED_OPPONENT = 'Unnamed opponent';

/**
 * One record per team however the name was typed.
 *
 * "MOSS", "moss" and "Moss " are the same opponent, and a notes record keyed on
 * the raw string would split into three the moment someone typed it
 * differently. Letters and digits only, so the id is also safe as a document
 * key.
 */
export function scrimOpponentId(name: string | undefined): string {
  const slug = (name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'unnamed';
}

function dayOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10) || 'unknown';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function tally(games: readonly ScrimGame[]): { wins: number; losses: number } {
  let wins = 0;
  let losses = 0;
  for (const g of games) {
    if (g.won === true) wins += 1;
    else if (g.won === false) losses += 1;
  }
  return { wins, losses };
}

/**
 * Group scrims by opponent, then by day, newest first at every level.
 *
 * `wonOf` is passed in rather than read off the scrim because which side we
 * were on is sometimes inferred from the roster rather than stored, and that
 * inference lives in the component. Keeping it out of here keeps this pure.
 */
export function groupScrims(
  scrims: readonly Scrim[],
  wonOf: (scrim: Scrim) => boolean | null
): ScrimOpponentGroup[] {
  const byOpponent = new Map<string, { name: string; latest: string; games: ScrimGame[] }>();

  for (const scrim of scrims) {
    const id = scrimOpponentId(scrim.opponent);
    const entry = byOpponent.get(id) ?? { name: '', latest: '', games: [] };
    entry.games.push({ scrim, won: wonOf(scrim) });
    // The name shown is the one on the newest scrim, so a corrected spelling
    // wins over an older one without anyone having to edit every game.
    if (scrim.playedOn >= entry.latest) {
      entry.latest = scrim.playedOn;
      entry.name = scrim.opponent?.trim() || UNNAMED_OPPONENT;
    }
    byOpponent.set(id, entry);
  }

  const groups: ScrimOpponentGroup[] = [];
  for (const [id, entry] of byOpponent) {
    const games = [...entry.games].sort((a, b) => b.scrim.playedOn.localeCompare(a.scrim.playedOn));

    const byDay = new Map<string, ScrimGame[]>();
    for (const g of games) {
      const day = dayOf(g.scrim.playedOn);
      byDay.set(day, [...(byDay.get(day) ?? []), g]);
    }
    const sessions: ScrimSession[] = [...byDay.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([day, dayGames]) => ({ day, games: dayGames, ...tally(dayGames) }));

    groups.push({ id, name: entry.name, games, sessions, ...tally(games), latest: entry.latest });
  }

  return groups.sort((a, b) => b.latest.localeCompare(a.latest));
}
