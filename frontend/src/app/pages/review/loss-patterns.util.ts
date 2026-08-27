/**
 * Turning a set of games into the problems that keep recurring in the losses.
 *
 * The backend decides *why* each individual game was lost and ships that as
 * `lossFactors`. This counts them, which is a different question: one loss is
 * an anecdote, the same factor in most of them is something to work on.
 *
 * It counts client-side rather than taking a backend total so the summary stays
 * live under the page's filters — narrowing to one comp re-counts immediately,
 * with no refresh and no extra Riot calls.
 */

import { AnalysisGame, LossCode } from '../../models/team.models';

export interface LossPattern {
  code: LossCode;
  label: string;
  games: number;
  /** Percentage of the *analysed* losses, rounded. */
  share: number;
}

export interface ReviewSummary {
  /** Losses carrying objective data, and so the denominator for every share. */
  analysed: number;
  /**
   * Losses still on a pre-v2 cache entry. Shown rather than hidden: a summary
   * over 3 of 11 losses is a different claim from one over all 11.
   */
  pending: number;
  patterns: LossPattern[];
}

export function summariseLosses(games: AnalysisGame[]): ReviewSummary {
  const losses = games.filter((game) => !game.win);
  const analysed = losses.filter((game) => game.objectives);
  const counts = new Map<LossCode, { label: string; games: number }>();

  for (const loss of analysed) {
    for (const factor of loss.lossFactors ?? []) {
      const entry = counts.get(factor.code) ?? { label: factor.label, games: 0 };
      entry.games += 1;
      counts.set(factor.code, entry);
    }
  }

  const patterns = [...counts.entries()]
    .map(([code, entry]) => ({
      code,
      label: entry.label,
      games: entry.games,
      share: Math.round((entry.games / analysed.length) * 100)
    }))
    .sort((a, b) => b.games - a.games || a.label.localeCompare(b.label));

  return { analysed: analysed.length, pending: losses.length - analysed.length, patterns };
}

/** `1847` -> `30:47`, because a loss at 22 minutes reads differently to one at 41. */
export function formatDuration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return '--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
