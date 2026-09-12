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
 */
export function nextSeriesId(
  list: readonly { id: string }[],
  isPlayed: (id: string) => boolean
): string {
  const unplayed = list.find((s) => !isPlayed(s.id));
  return (unplayed ?? list[list.length - 1])?.id ?? '';
}
