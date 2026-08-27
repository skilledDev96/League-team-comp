/**
 * Turning a set of games into the patterns that keep recurring in them.
 *
 * The backend decides *why* each individual game went the way it did and ships
 * that as `lossFactors` / `winFactors`. This counts them, which is a different
 * question: one game is an anecdote, the same factor in most of them is
 * something to work on — or something to keep doing.
 *
 * It counts client-side rather than taking a backend total so the summary stays
 * live under the page's filters — narrowing to one comp re-counts immediately,
 * with no refresh and no extra Riot calls.
 *
 * Wins and losses run through one implementation on purpose. They are the same
 * counting question asked of a different field, and two copies would drift.
 */

import { AnalysisGame, LossCode, OutcomeFactor, WinCode } from '../../models/team.models';

/** Which side of the result a view is about. */
export type Outcome = 'win' | 'loss';

export interface LossPattern {
  code: LossCode | WinCode;
  label: string;
  games: number;
  /** Percentage of the *analysed* games on this side, rounded. */
  share: number;
}

export interface ReviewSummary {
  /** Games carrying objective data, and so the denominator for every share. */
  analysed: number;
  /**
   * Games still on a pre-v2 cache entry. Shown rather than hidden: a summary
   * over 3 of 11 is a different claim from one over all 11.
   */
  pending: number;
  patterns: LossPattern[];
}

/** The factors for whichever side of the result this game landed on. */
export function factorsOf(game: AnalysisGame): OutcomeFactor[] {
  return (game.win ? game.winFactors : game.lossFactors) ?? [];
}

export function summarise(games: AnalysisGame[], outcome: Outcome): ReviewSummary {
  const onSide = games.filter((game) => game.win === (outcome === 'win'));
  const analysed = onSide.filter((game) => game.objectives);
  const counts = new Map<string, { label: string; games: number }>();

  for (const game of analysed) {
    for (const factor of factorsOf(game)) {
      const entry = counts.get(factor.code) ?? { label: factor.label, games: 0 };
      entry.games += 1;
      counts.set(factor.code, entry);
    }
  }

  const patterns = [...counts.entries()]
    .map(([code, entry]) => ({
      code: code as LossCode | WinCode,
      label: entry.label,
      games: entry.games,
      share: Math.round((entry.games / analysed.length) * 100)
    }))
    .sort((a, b) => b.games - a.games || a.label.localeCompare(b.label));

  return { analysed: analysed.length, pending: onSide.length - analysed.length, patterns };
}

/** Kept for readability at the call sites, which read better named than flagged. */
export function summariseLosses(games: AnalysisGame[]): ReviewSummary {
  return summarise(games, 'loss');
}

export function summariseWins(games: AnalysisGame[]): ReviewSummary {
  return summarise(games, 'win');
}

/** Bucket id for games that matched no comp. Not a comp id, so it cannot collide. */
export const OFF_BOOK = '__offbook';

/** One comp's games on a given side of the result, and what they have in common. */
export interface LossGroup {
  compId: string;
  name: string;
  /** Only games carrying objective data — the ones that can be read. */
  losses: AnalysisGame[];
  /** Games under this comp still waiting on a backfill. */
  pending: number;
  topFactor: string | null;
}

/**
 * The one thing that shows up most across a comp's games, for the collapsed
 * header. Returns null below two occurrences: a factor appearing once is not a
 * pattern, and billing it as this comp's habit would be reading tea leaves.
 */
export function commonestFactor(games: AnalysisGame[]): string | null {
  const counts = new Map<string, number>();
  for (const game of games) {
    for (const factor of factorsOf(game)) {
      counts.set(factor.label, (counts.get(factor.label) ?? 0) + 1);
    }
  }

  let best: string | null = null;
  let bestCount = 1;
  for (const [label, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && label < best)) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

/** `1847` -> `30:47`, because a loss at 22 minutes reads differently to one at 41. */
export function formatDuration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return '--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
