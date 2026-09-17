import { parseLocalDate } from '../../core/local-date';
import { isSandboxSeries } from '../../core/sandbox-series';

/**
 * Which series the Prep page lands on (12 Sep 2026).
 *
 * Nothing opened before, so a reader arriving the day before a match met a column of
 * closed cards and had to remember which one was theirs. The answer is the next series
 * they have to play — and when the tournament is over, the last one, because that is
 * the one they will want to read back.
 *
 * Deliberately read from the games rather than from `TournamentSeries.status`: that
 * field is only ever written as `'scheduled'`, so a rule that asked it would have been
 * a control that quietly does nothing.
 *
 * The stored order is left alone. It is the order someone typed the schedule in, and
 * re-sorting a Swiss bracket so finished rounds sink would cost more than it pays.
 *
 * Two rules on top (17 Sep 2026), because a series called "test" in the live group
 * became every viewer's next series: a sandbox series is never the answer, not even
 * once everything is played, and among the unplayed a series with a date comes before
 * one without — a date is someone saying the match is really on. Free text such as
 * "Sat 20:00" is not a date here (`parseLocalDate`). The stored order still breaks
 * every tie.
 */
export function nextSeriesId(
  list: readonly { id: string; sandbox?: boolean; scheduledAt?: string }[],
  isPlayed: (id: string) => boolean
): string {
  const real = list.filter((s) => !isSandboxSeries(s));
  const unplayed = real.filter((s) => !isPlayed(s.id));
  const next = unplayed.find((s) => parseLocalDate(s.scheduledAt) !== null) ?? unplayed[0];
  return (next ?? real[real.length - 1])?.id ?? '';
}
