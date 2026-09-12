import { Comp, CompPicks } from '../models/team.models';
import { GameRow } from '../pages/games/game-rows';

/**
 * The comp of the month: which of our saved comps has been winning lately (13 Sep 2026).
 *
 * Built for the home page, which wants one comp to point at and a record to trust it by. The Comps page
 * already gives every comp its record over every game it was ever played in; this asks only the last
 * thirty days, so a comp that carried us in the spring does not stay on the home page all autumn.
 *
 * It reads the comp a game row already counts under. `buildGameRows` puts every Riot game through
 * `effectiveComp`, so a hand-placed game and a `countsUnder` rule have both been applied before a row
 * reaches this file, and nothing here matches champions a second time. A row with no comp (a replay
 * imported on its own, a tournament game typed in from the draft room) is simply not counted.
 */

export interface CompOfTheMonth {
  compId: string;
  /** The comp's name as it is saved now, not as the game row captured it. */
  name: string;
  picks: CompPicks;
  games: number;
  wins: number;
  losses: number;
  /** Rounded percent, 0 to 100, the way `record` counts it. */
  winRate: number;
}

/** How far back the comp of the month looks, in days. */
export const COMP_MONTH_DAYS = 30;

/**
 * Games a comp needs inside the window before it can be the comp of the month (13 Sep 2026). Two wins
 * from two games is a hundred percent and says almost nothing; three is the least that reads as a habit.
 */
export const COMP_MONTH_MIN_GAMES = 3;

const DAY_MS = 86_400_000;

interface Tally {
  comp: Comp;
  games: number;
  wins: number;
  /** The newest game of the comp inside the window, epoch ms. */
  latest: number;
}

const rateOf = (t: Tally) => Math.round((t.wins / t.games) * 100);

/**
 * The comp that has won most over the last `days` days, and, when none has played enough to be named,
 * the one closest to it (13 Sep 2026).
 *
 * A game counts when its row names a comp that still exists and it was played inside the window,
 * `now` included and `days` back included; an undated game cannot be placed and does not count. A comp
 * needs `minGames` games to be named. Between named comps the higher rounded win rate wins, then the
 * comp with more games (the same rate over more games is the stronger claim), then the one played most
 * recently, then the name, so the answer never depends on the order the rows arrived in.
 *
 * `nearest` is only there when `best` is not: the comp with the most games in the window, ties to the
 * one played most recently, so the page can say how far it is from a comp of the month instead of
 * leaving the space empty. Both are null when no game in the window counts at all.
 */
export function compOfTheMonth(
  rows: readonly GameRow[],
  comps: readonly Comp[],
  now: number,
  o: { days?: number; minGames?: number } = {}
): { best: CompOfTheMonth | null; nearest: { name: string; games: number } | null } {
  const days = o.days ?? COMP_MONTH_DAYS;
  const minGames = o.minGames ?? COMP_MONTH_MIN_GAMES;
  const since = now - days * DAY_MS;
  const byId = new Map(comps.map((c) => [c.id, c]));
  const tally = new Map<string, Tally>();
  for (const r of rows) {
    // A date of 0 is a game nobody dated: it cannot be placed inside the window, so it is not in it.
    if (!r.compId || r.date <= 0 || r.date < since || r.date > now) continue;
    // A comp deleted since the game was played has nothing left to show or to open.
    const comp = byId.get(r.compId);
    if (!comp) continue;
    const t = tally.get(comp.id) ?? { comp, games: 0, wins: 0, latest: 0 };
    t.games += 1;
    if (r.win) t.wins += 1;
    t.latest = Math.max(t.latest, r.date);
    tally.set(comp.id, t);
  }
  const all = [...tally.values()];
  if (!all.length) return { best: null, nearest: null };

  const byName = (a: Tally, b: Tally) => a.comp.name.localeCompare(b.comp.name) || a.comp.id.localeCompare(b.comp.id);
  const named = all
    .filter((t) => t.games >= minGames)
    .sort((a, b) => rateOf(b) - rateOf(a) || b.games - a.games || b.latest - a.latest || byName(a, b));
  const top = named[0];
  if (top) {
    return {
      best: {
        compId: top.comp.id,
        name: top.comp.name,
        picks: top.comp.picks,
        games: top.games,
        wins: top.wins,
        losses: top.games - top.wins,
        winRate: rateOf(top)
      },
      nearest: null
    };
  }
  const closest = [...all].sort((a, b) => b.games - a.games || b.latest - a.latest || byName(a, b))[0];
  return { best: null, nearest: { name: closest.comp.name, games: closest.games } };
}
