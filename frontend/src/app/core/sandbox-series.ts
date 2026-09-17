import { SeriesGame, TournamentSeries } from '../models/team.models';

/**
 * A sandbox series is practice only (17 Sep 2026).
 *
 * A series called "test" sat in the live Oryx group, so every viewer saw NEXT SERIES vs test on Home and the draft
 * room opened on it. The lead kept it to rehearse the room on, marked by an explicit flag and never guessed from the
 * name: a team really called Test Pilots is a real opponent. What the flag means is decided here, once, so no reader
 * can half-apply it — a sandbox series is never the next series, never finishes and never crowns anyone, and its
 * games are not team games, so none of them reaches a record, the form, a trophy, Patterns or an MVP.
 */
export function isSandboxSeries(series: Pick<TournamentSeries, 'sandbox'> | null | undefined): boolean {
  return series?.sandbox === true;
}

/** The ids of the sandbox series, for a reader that holds games rather than series. */
export function sandboxSeriesIds(series: readonly Pick<TournamentSeries, 'id' | 'sandbox'>[]): Set<string> {
  return new Set(series.filter(isSandboxSeries).map((s) => s.id));
}

/**
 * The replays imported against a sandbox series' games. The analysis folds every stored replay in as a game of its
 * own, so a reader of the analysis leaves these out the way it leaves out a practice-tagged game — except that no
 * "All" brings them back.
 */
export function sandboxMatchIds(
  series: readonly Pick<TournamentSeries, 'id' | 'sandbox'>[],
  seriesGames: readonly Pick<SeriesGame, 'seriesId' | 'matchId'>[]
): Set<string> {
  const sandbox = sandboxSeriesIds(series);
  if (!sandbox.size) return new Set();
  return new Set(seriesGames.flatMap((g) => (g.matchId && sandbox.has(g.seriesId) ? [g.matchId] : [])));
}

/** A name that reads like a rehearsal ("test", "Test 2"): only ever a prompt to mark it, never the flag itself. */
export function looksLikeTestSeries(series: Pick<TournamentSeries, 'opponent' | 'sandbox'>): boolean {
  return !isSandboxSeries(series) && /^test/i.test((series.opponent ?? '').trim());
}
