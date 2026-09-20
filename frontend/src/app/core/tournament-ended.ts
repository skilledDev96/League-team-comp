import { Tournament } from '../models/team.models';
import { parseLocalDate } from './local-date';

/**
 * A tournament that is over (21 Sep 2026).
 *
 * The lead: *"Also we should be able to end a tournament…"*. Nothing said a split was finished, so a
 * league whose final had been played went on behaving like the live one: it stayed the landing group on
 * Prep & Draft, its next unplayed series was still Home's Next series, and the season every figure was
 * scoped to was still "the running tournament". The only way on was to untick `active` on one and tick it
 * on another, which nothing in the page explained.
 *
 * `endedAt` is what ending means and the whole of it: the day somebody pressed End tournament. It is not
 * `endDate` — that is the schedule, the last day the organiser planned, typed in before a game was played;
 * this is us saying it is done. `finish` is the one line the lead can add afterwards ("3rd of 12 — lost
 * the semi"), free text because the app never sees a bracket and no one shape fits Swiss, groups and cups.
 *
 * **Ended beats active, on read.** `active` is still the flag that makes a group the current one, and the
 * End action clears it, but a document hand-edited in Firestore could carry both. So every reader asks
 * `isActiveTournament` rather than `t.active`, and a finished split can never be the live one whatever is
 * stored.
 *
 * **Ending is not deleting.** Its series, its games and every figure they feed stay exactly as they were:
 * the record, the crowns, the trophies, Patterns and the Games list all count them as they did the day
 * before. What stops is leading a page.
 */
export function isEndedTournament(t: Pick<Tournament, 'endedAt'> | null | undefined): boolean {
  return typeof t?.endedAt === 'string' && t.endedAt.trim() !== '';
}

/** The one reading of `active` in the app: the flag is set, and the tournament has not ended. */
export function isActiveTournament(t: Pick<Tournament, 'active' | 'endedAt'> | null | undefined): boolean {
  return t?.active === true && !isEndedTournament(t);
}

/** The ids of the splits that are over, for a reader holding series rather than tournaments. */
export function endedTournamentIds(list: readonly Pick<Tournament, 'id' | 'endedAt'>[]): Set<string> {
  return new Set(list.filter(isEndedTournament).map((t) => t.id));
}

/**
 * Whether a real tournament is still going (21 Sep 2026): one that is not the scrims group — which is never a
 * competition and never ends — and that nobody has ended.
 *
 * What "and not replaced" means, for the one surface that says a season is over. Nothing next is not the same
 * thing as nothing left: a split ended last week with a new one on the page, its pairings not out yet or its
 * games all played, has nothing next and is emphatically not finished.
 */
export function hasLiveTournament(list: readonly Pick<Tournament, 'kind' | 'endedAt'>[]): boolean {
  return list.some((t) => t.kind !== 'scrims' && !isEndedTournament(t));
}

/**
 * The live groups first, the ended ones after, each side keeping the order it arrived in (a stable sort of
 * a copy). What Prep & Draft's group row is sorted by: a finished split is still one press away, just not
 * in front of the one being played.
 */
export function endedLast<T extends Pick<Tournament, 'endedAt'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => Number(isEndedTournament(a)) - Number(isEndedTournament(b)));
}

/**
 * The split that ended most recently, for a page that has to say why nothing is next. Real tournaments
 * only — the scrims group is not a competition and never ends. The newest `endedAt` wins; a day nobody can
 * parse sorts oldest, and two on the same day go to the one listed last, which is the one entered later.
 */
export function lastEndedTournament(list: readonly Tournament[]): Tournament | null {
  let best: Tournament | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  let bestOrder = Number.NEGATIVE_INFINITY;
  for (const t of list) {
    if (t.kind === 'scrims' || !isEndedTournament(t)) continue;
    const at = parseLocalDate(t.endedAt) ?? Number.NEGATIVE_INFINITY;
    const order = t.order ?? 0;
    if (!best || at > bestAt || (at === bestAt && order >= bestOrder)) {
      best = t;
      bestAt = at;
      bestOrder = order;
    }
  }
  return best;
}

/**
 * Today as a stored `YYYY-MM-DD`, in the reader's own day. `toISOString().slice(0, 10)` would end a split
 * "yesterday" for anyone pressing the button after midnight in a positive-offset timezone, which is
 * exactly when a final is over.
 */
export function todayStored(now: number = Date.now()): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
