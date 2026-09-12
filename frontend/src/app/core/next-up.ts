import { FilmGlyph } from './film-model';

/**
 * What to do next, as one card (12 Sep 2026).
 *
 * The complaint this is part of answering: *"too much information to read."* The Games page
 * opens on nine peer cards, so the eye has no entry point and the best thing the app makes — the
 * review — sits five clicks from login. This is the entry point: **one card, at most three lines,
 * two pills**, saying the single next thing.
 *
 * A ladder, not a list. The rungs are in the order the week actually runs:
 *
 * 1. **A film that asked to be remembered.** It earned its place — somebody set the reminder, and
 *    it is due now rather than merely available.
 * 2. **A game with no review** (editors only, since only they can ask for one).
 * 3. **The next opponent** — an editor opens the draft, a viewer goes and scouts them.
 * 4. **Nothing.** The card does not render. A team that is up to date should see an empty top of
 *    page, not a card congratulating them, and certainly not a second card stacked under the
 *    first — two cards at the top of Games is the complaint restated.
 *
 * **An unwatched review is deliberately NOT a rung** (12 Sep 2026, the lead: *"remove the watch
 * this first… it is redundant unless looking for it"*). Every review is unwatched until somebody
 * watches it, so that rung fired for most people most of the time and the card stopped carrying
 * news. The prompt lives on the game's own row instead, where a reader meets it while looking at
 * that game: the Reviewed chip opens the film room. A card at the top of the page is for what is
 * due; a mark on a row is for what is there.
 *
 * Pure: the page assembles what it knows and this decides. "Now" comes in, so the specs pin
 * every date.
 */

/** Which rung fired. The page maps it to the two pills, since one of them is not a route. */
export type NextUpKind = 'remind' | 'ask' | 'draft';

/** One line of the card, with the film-room glyph that names what kind of line it is. */
export interface NextUpLine {
  glyph: FilmGlyph;
  label: string;
  text: string;
}

export interface NextUpCard {
  kind: NextUpKind;
  /** The rung's name, over the headline. */
  kicker: string;
  headline: string;
  /** At most three. The rest stay where they came from. */
  lines: NextUpLine[];
  matchId?: string;
  seriesId?: string;
}

export interface NextUpGame {
  matchId: string;
  /** Milliseconds, so the caller does the date parsing once. */
  when: number;
  opponent?: string;
}

export interface NextUpInput {
  /** The film whose reminder is due for this person, with what it would remind of. */
  reminder: { matchId: string; headline: string; lines: NextUpLine[] } | null;
  /** Games played that carry no review yet, any order. Ignored for a viewer. */
  unreviewed: readonly NextUpGame[];
  /** The series to prepare for next, when there is one. */
  nextSeries: { id: string; opponent: string; when?: string } | null;
  canEdit: boolean;
  /** Now, in milliseconds. */
  now: number;
}

/** Three lines is the cap the card was designed around; anything longer is a page, not a prompt. */
export const NEXT_UP_LINES = 3;

/**
 * How far back a game can be and still be the next thing to do.
 *
 * Without it a new account meets a card about a game from February and keeps meeting it: 181
 * games over nine months are all "unwatched" the day somebody signs in. Fourteen days is the
 * window the team already reads the Games list on.
 */
export const NEXT_UP_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The newest game inside the window, or nothing. */
function newest(games: readonly NextUpGame[], now: number): NextUpGame | null {
  const since = now - NEXT_UP_DAYS * DAY_MS;
  const recent = games.filter((g) => g.when >= since && g.when <= now);
  if (!recent.length) return null;
  return recent.reduce((best, g) => (g.when > best.when ? g : best));
}

/** "the Sunset Wolves game" — or just "the game", for a row with no opponent on it. */
function nameOf(game: NextUpGame): string {
  return game.opponent ? `the ${game.opponent} game` : 'the game';
}

export function nextUp(input: NextUpInput): NextUpCard | null {
  if (input.reminder) {
    return {
      kind: 'remind',
      kicker: 'Before you play',
      headline: input.reminder.headline,
      lines: input.reminder.lines.slice(0, NEXT_UP_LINES),
      matchId: input.reminder.matchId
    };
  }

  if (input.canEdit) {
    const ask = newest(input.unreviewed, input.now);
    if (ask) {
      return {
        kind: 'ask',
        kicker: 'Nobody has reviewed this',
        headline: `${nameOf(ask)[0].toUpperCase()}${nameOf(ask).slice(1)} has no review yet.`,
        lines: [],
        matchId: ask.matchId
      };
    }
  }

  if (input.nextSeries) {
    return {
      kind: 'draft',
      kicker: 'Next up',
      headline: `You play ${input.nextSeries.opponent}${input.nextSeries.when ? ` ${input.nextSeries.when}` : ''}.`,
      lines: [],
      matchId: undefined,
      seriesId: input.nextSeries.id
    };
  }

  return null;
}
