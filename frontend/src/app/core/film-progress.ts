import { FilmChoice, FilmCommitment, FilmPrefs, FilmProgress, GameReview } from '../models/team.models';
import { lessonCalls } from './film-build';
import { FilmCall } from './film-model';

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

/**
 * What "Before you play" asks about one film: the review's lessons in turn
 * (the one at `asked` modulo their count, built the way the film builds them
 * so the options sit in the same order), else the team's commitment as a
 * two-way call, else nothing, and the card stays away.
 */
export function reminderFor(review: GameReview, progress: FilmProgress, commitment: FilmCommitment | undefined, seed: number): FilmCall | null {
  const lessons = lessonCalls(review.team.lessons, seed);
  if (lessons.length) return lessons[(progress.asked ?? 0) % lessons.length];
  if (commitment?.options && commitment.options.length === 2) {
    const answer = committedIndex(commitment);
    if (answer === undefined) return null;
    return { key: 'commit', question: 'Last game we committed to one of these. Which was it?', options: [commitment.options[0], commitment.options[1]], answer, why: commitment.text };
  }
  return null;
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

/** The film whose reminder is earliest and already due at `nowIso`, or nothing when none is. */
export function dueReminder(prefs: FilmPrefs | undefined, nowIso: string): { matchId: string; progress: FilmProgress } | undefined {
  return dueReminders(prefs, nowIso)[0];
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
