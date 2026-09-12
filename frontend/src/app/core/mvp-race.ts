import { Player, Role, ROLES } from '../models/team.models';
import { SeriesCrown } from './series-results';

/**
 * The MVP race on the home page: how many finished series have crowned each of ours (13 Sep 2026).
 *
 * A title is a crown that counts, and nothing else. A mark on a roster player that is too thin to count
 * is kept beside the titles as provisional, because a series with one replay imported still said
 * something, and hiding it would make importing the rest look pointless. A mark that names nobody on the
 * roster names nobody here either.
 *
 * Only our own players are ever read. A crown carries the series it came from, and the other team is
 * that series' name and nothing more.
 */

export interface RaceEntry {
  playerId: string;
  name: string;
  role: Role;
  icon?: string;
  /** Crowns that count. */
  titles: number;
  /** Marks on this player that do not count yet: too few of the series' games carried figures. */
  provisional: number;
  /** The newest counting crown in schedule order. Absent until the first title. */
  lastTitle?: { seriesId: string; opponent: string; champion: string; at: number | null };
}

const seatIndex = (seat: Role) => ROLES.indexOf(seat);

/**
 * Every starter, and any sub a crown has named, ranked by titles (13 Sep 2026).
 *
 * A starter with nothing is still listed at zero, because the race is the five and an empty place on the
 * board says more than a missing one; a sub appears once a crown names them, counted or provisional.
 * Ties go to whoever took their last title later in the schedule, then to lane order, then to the name.
 * Later in the schedule rather than later by date, because the crowns always arrive in schedule order
 * and a series' date can be missing.
 */
export function mvpRace(crowns: readonly SeriesCrown[], roster: readonly Player[]): RaceEntry[] {
  const tally = new Map<string, { titles: number; provisional: number; lastIndex: number; lastTitle?: RaceEntry['lastTitle'] }>();
  crowns.forEach((crown, index) => {
    if (!crown.playerId) return;
    const mark = tally.get(crown.playerId) ?? { titles: 0, provisional: 0, lastIndex: -1 };
    if (crown.counts) {
      mark.titles += 1;
      mark.lastIndex = index;
      mark.lastTitle = {
        seriesId: crown.finished.series.id,
        opponent: crown.finished.series.opponent,
        champion: crown.mvp.champion,
        at: crown.finished.endedAt
      };
    } else {
      mark.provisional += 1;
    }
    tally.set(crown.playerId, mark);
  });
  return roster
    .filter((player) => !player.sub || tally.has(player.id))
    .map((player) => {
      const mark = tally.get(player.id);
      const entry: RaceEntry = { playerId: player.id, name: player.name, role: player.role, titles: mark?.titles ?? 0, provisional: mark?.provisional ?? 0 };
      if (player.icon) entry.icon = player.icon;
      if (mark?.lastTitle) entry.lastTitle = mark.lastTitle;
      return { entry, lastIndex: mark?.lastIndex ?? -1 };
    })
    .sort(
      (a, b) =>
        b.entry.titles - a.entry.titles ||
        b.lastIndex - a.lastIndex ||
        seatIndex(a.entry.role) - seatIndex(b.entry.role) ||
        a.entry.name.localeCompare(b.entry.name)
    )
    .map(({ entry }) => entry);
}

export interface PodiumPlace {
  place: 1 | 2 | 3;
  entry: RaceEntry;
}

/**
 * The first three places by titles, shared on a tie (13 Sep 2026).
 *
 * Places are dense: two players on three titles are both first and the next count down is second, so the
 * podium never skips a step because two people shared one. Nobody without a title stands on it, and
 * everyone who does comes back in the race's own order.
 */
export function podium(race: readonly RaceEntry[]): PodiumPlace[] {
  const titled = race.filter((entry) => entry.titles > 0);
  const counts = [...new Set(titled.map((entry) => entry.titles))].sort((a, b) => b - a);
  const out: PodiumPlace[] = [];
  for (const entry of titled) {
    const place = counts.indexOf(entry.titles) + 1;
    if (place <= 3) out.push({ place: place as PodiumPlace['place'], entry });
  }
  return out;
}

export interface LastCrown {
  seriesId: string;
  /** The other team's name, which is all the page ever says about them. */
  opponent: string;
  result: 'won' | 'lost' | 'drawn';
  /** When the series ended, as `FinishedSeries.endedAt` has it; null when no date is known. */
  at: number | null;
  /** The roster member the crown names. */
  playerId?: string;
  /** The name the series' games carried, when one person held the seat throughout. */
  name?: string;
  /** The champion of their best game of the series. */
  champion: string;
  seat: Role;
}

/**
 * The newest series that crowned somebody for real, or nothing yet (13 Sep 2026).
 *
 * A newer mark that does not count is passed over, so the home page never announces a crown the race
 * beside it does not show as a title.
 */
export function lastCrown(crowns: readonly SeriesCrown[]): LastCrown | null {
  for (let index = crowns.length - 1; index >= 0; index -= 1) {
    const crown = crowns[index];
    if (!crown?.counts) continue;
    const { series, result, endedAt } = crown.finished;
    return {
      seriesId: series.id,
      opponent: series.opponent,
      result,
      at: endedAt,
      ...(crown.playerId ? { playerId: crown.playerId } : {}),
      ...(crown.mvp.name ? { name: crown.mvp.name } : {}),
      champion: crown.mvp.champion,
      seat: crown.mvp.seat
    };
  }
  return null;
}
