import { FilmChoice, FilmCommitment, FilmPrefs, FilmProgress, GameReview, ReviewPoint, Role } from '../models/team.models';
import { askOf } from './review-view';

/**
 * The reminder arithmetic for the film room (9 Sep 2026): when "Before you
 * play" asks about a film again, which film is due, and the words on the
 * Open the film room pill. Pure: times come in and go out as ISO strings, so
 * the page decides what "now" is and the specs pin every date.
 */

/** The reminder ladder in days: the first ask a day after the card, then three, then seven, then never. */
const ASK_AFTER_DAYS = [1, 3, 7];
const DAY_MS = 24 * 60 * 60 * 1000;

/** When to ask again after a film was finished at `doneIso`, given how many times it has already asked. Nothing after the third ask. */
export function nextAskAt(doneIso: string, asked: number): string | undefined {
  const days = ASK_AFTER_DAYS[asked];
  if (days === undefined) return undefined;
  const done = Date.parse(doneIso);
  if (Number.isNaN(done)) return undefined;
  return new Date(done + days * DAY_MS).toISOString();
}

/**
 * One step up the ladder after the card asked (answered or Not now): the
 * count goes up and the next time follows from the later of when the film
 * was finished and now, so a card answered ten days late never lands on a
 * date already past (which would show the next lesson at once, then the
 * third). At the top of the ladder `nextAskAt` is undefined, which
 * `saveFilmProgress` turns into a delete, so the film stops asking. A film
 * never finished (the reminder set by Try it now before the card) counts
 * from `nowIso`.
 */
export function advance(progress: FilmProgress, nowIso: string): Partial<FilmProgress> {
  const asked = (progress.asked ?? 0) + 1;
  return { asked, nextAskAt: nextAskAt(laterOf(progress.done, nowIso), asked) };
}

/** The later of two ISO times; an unreadable or missing `a` yields `b`. */
function laterOf(a: string | undefined, b: string): string {
  const ta = a ? Date.parse(a) : NaN;
  const tb = Date.parse(b);
  if (Number.isNaN(ta)) return b;
  if (Number.isNaN(tb)) return a as string;
  return ta > tb ? (a as string) : b;
}

/** The team's pick on a commitment as an option index: the majority, ties to A; nothing when nobody picked, or the team took the sentence whole. Mirrors `TeamDataService.teamChoice`. */
function committedIndex(c: FilmCommitment): 0 | 1 | undefined {
  const counts: Record<FilmChoice, number> = { a: 0, b: 0, commit: 0 };
  let any = false;
  for (const choice of Object.values(c.by ?? {})) {
    counts[choice] = (counts[choice] ?? 0) + 1;
    any = true;
  }
  if (!any) return undefined;
  if (counts.commit > counts.a && counts.commit > counts.b) return undefined;
  return counts.b > counts.a ? 1 : 0;
}

/** What the team committed to, in words: the option the majority picked (ties to A), or the sentence whole when the team took it whole or it offered no choice; nothing until somebody picked. */
function committedLine(c: FilmCommitment | undefined): string | undefined {
  if (!c || !Object.keys(c.by ?? {}).length) return undefined;
  const i = committedIndex(c);
  if (i !== undefined && c.options?.length === 2) return c.options[i];
  return c.text?.trim() || undefined;
}

/** How many further asks the card carries at most; the rest stay on the film's card. */
const MAX_MORE_LINES = 2;

/**
 * What "Before you play" reminds of, for one film (10 Sep 2026): things to
 * do, not a question. Every line but the one thing is optional; a review
 * with none of them has no reminder and the card stays away.
 */
export interface FilmReminder {
  /** The film's headline, muted over the lines; '' when the review has none. */
  headline: string;
  /** The one thing to watch for: the review's own, else the first work-on cut to its ask; '' when the review carries neither. */
  oneThing: string;
  /** What the team committed to: the option it picked, or the sentence whole; absent until somebody picked. */
  commitment?: string;
  /** The viewer's own seat's ask, when the seat is known and the review has a note for it. */
  ask?: string;
  /** Up to two further asks: the team's other work-ons, then the viewer's own further points, each cut to its ask; absent when there are none beyond the lines above. */
  more?: string[];
}

/**
 * The reminder for one film. Until 10 Sep 2026 this was a question (a lesson
 * with three options, or "which did we commit to?"); the lead wanted a
 * reminder of what to do instead, so it is now the one thing, the
 * commitment, the viewer's own ask and up to two further asks, none of them
 * asked. The further asks were the lessons' whys for a day: a why justifies
 * an answer ("Three, minutes 4 to 9."), so it read as a fragment on the card
 * with nothing to do in it; the other work-ons and the viewer's own further
 * points are imperatives once `askOf` has cut them, which is what the card is
 * for. `progress` and `seed` stay in the signature for the callers: the
 * reminder no longer turns with `asked` or draws on the seed, but the ladder
 * (`nextAskAt`, `advance`, `dueReminders`) still climbs on Got it as it did.
 * Null when the review has none of a one thing, a work-on or a commitment.
 */
export function reminderFor(review: GameReview, _progress: FilmProgress, commitment: FilmCommitment | undefined, _seed: number, seat?: Role): FilmReminder | null {
  const team = review.team;
  const first = team.workOn?.[0]?.text?.trim();
  const oneThing = team.oneThing?.trim() || (first ? askOf(first) : '');
  const committed = committedLine(commitment);
  if (!oneThing && !committed) return null;
  const reminder: FilmReminder = { headline: team.headline?.trim() ?? '', oneThing };
  if (committed) reminder.commitment = committed;
  const own = seat ? review.players?.find((p) => p.seat === seat) : undefined;
  const ownAsk = own?.workOn?.text?.trim();
  if (ownAsk) reminder.ask = askOf(ownAsk);
  const more = furtherAsks([...(team.workOn ?? []).slice(1), ...(own?.more ?? [])], [oneThing, reminder.ask ?? '']);
  if (more.length) reminder.more = more;
  return reminder;
}

/**
 * The further asks, in the order given (the team's other work-ons, then the
 * viewer's own further points), each cut to its ask; a line already on the
 * card or already in the list is not said twice, and at most `MAX_MORE_LINES`
 * are kept.
 */
function furtherAsks(points: ReviewPoint[], taken: string[]): string[] {
  const seen = new Set(taken.map(sameLine));
  const out: string[] = [];
  for (const point of points) {
    const text = point.text?.trim();
    if (!text) continue;
    const ask = askOf(text);
    const key = sameLine(ask);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(ask);
    if (out.length === MAX_MORE_LINES) break;
  }
  return out;
}

/** Two lines are the same ask when they differ only by case or a closing stop. */
function sameLine(s: string): string {
  return s.trim().toLowerCase().replace(/[.!?]+$/, '');
}

/** Every film whose reminder is already due at `nowIso`, earliest first; empty when none is. */
export function dueReminders(prefs: FilmPrefs | undefined, nowIso: string): { matchId: string; progress: FilmProgress }[] {
  const now = Date.parse(nowIso);
  if (!prefs?.films || Number.isNaN(now)) return [];
  const due: { matchId: string; progress: FilmProgress; at: number }[] = [];
  for (const [matchId, progress] of Object.entries(prefs.films)) {
    if (!progress.nextAskAt) continue;
    const at = Date.parse(progress.nextAskAt);
    if (Number.isNaN(at) || at > now) continue;
    due.push({ matchId, progress, at });
  }
  return due.sort((a, b) => a.at - b.at).map(({ matchId, progress }) => ({ matchId, progress }));
}


/**
 * The words beside "Open the film room": "Watched" once the card was reached,
 * "Continue · 3 of 4" part way through (`currentChapter` is the zero-based
 * chapter the person is on), "Continue" when calls were made but the chapter
 * is not known, and nothing when nothing was started.
 */
export function tallyLine(progress: FilmProgress | undefined, chapterCount: number, currentChapter?: number): string {
  if (!progress) return '';
  if (progress.done) return 'Watched';
  if (currentChapter !== undefined && chapterCount > 0) {
    const at = Math.min(Math.max(currentChapter + 1, 1), chapterCount);
    return `Continue · ${at} of ${chapterCount}`;
  }
  return progress.calls && Object.keys(progress.calls).length ? 'Continue' : '';
}
