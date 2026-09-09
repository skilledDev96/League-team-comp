import { FilmPrefs, FilmProgress } from '../models/team.models';

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

/** The film whose reminder is earliest and already due at `nowIso`, or nothing when none is. */
export function dueReminder(prefs: FilmPrefs | undefined, nowIso: string): { matchId: string; progress: FilmProgress } | undefined {
  const now = Date.parse(nowIso);
  if (!prefs?.films || Number.isNaN(now)) return undefined;
  let best: { matchId: string; progress: FilmProgress; at: number } | undefined;
  for (const [matchId, progress] of Object.entries(prefs.films)) {
    if (!progress.nextAskAt) continue;
    const at = Date.parse(progress.nextAskAt);
    if (Number.isNaN(at) || at > now) continue;
    if (!best || at < best.at) best = { matchId, progress, at };
  }
  return best && { matchId: best.matchId, progress: best.progress };
}

/**
 * The words beside "Open the film room": "Watched · called 4 of 5" once the
 * card was reached, "Continue · 3 of 7" part way through (`currentChapter` is
 * the zero-based chapter the person is on), "Continue" when calls were made
 * but the chapter is not known, and nothing when nothing was started.
 */
export function tallyLine(progress: FilmProgress | undefined, chapterCount: number, currentChapter?: number): string {
  if (!progress) return '';
  if (progress.done) {
    const t = progress.tally;
    return t && t.of > 0 ? `Watched · called ${t.called} of ${t.of}` : 'Watched';
  }
  if (currentChapter !== undefined && chapterCount > 0) {
    const at = Math.min(Math.max(currentChapter + 1, 1), chapterCount);
    return `Continue · ${at} of ${chapterCount}`;
  }
  return progress.calls && Object.keys(progress.calls).length ? 'Continue' : '';
}
