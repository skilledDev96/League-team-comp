import { Role } from '../models/team.models';

/** A seat and the champion on it, the shape both the review's players and the film's seats share. */
export interface SeatChampion {
  seat: Role;
  champion: string;
}

/** Letters only, lowercased, so "Kai'Sa", "Kaisa" and "KaiSa" agree. */
function letters(text: string): string {
  return text.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * The first seat (in the order given) whose champion a sentence names, on
 * whole words only (9 Sep 2026). The text is split into runs of letters and
 * each run, and each pair of adjacent runs, is compared to the champion's
 * letters: "Vi" no longer matches "vision", while "Miss Fortune", "Leona's"
 * and "KaiSa" all match theirs. Undefined when it names none of them.
 */
export function mentionedSeat(text: string, players: readonly SeatChampion[]): Role | undefined {
  const runs = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const words = new Set<string>();
  runs.forEach((run, i) => {
    words.add(run);
    if (i + 1 < runs.length) words.add(run + runs[i + 1]);
  });
  return players.find((p) => p.champion && words.has(letters(p.champion)))?.seat;
}
