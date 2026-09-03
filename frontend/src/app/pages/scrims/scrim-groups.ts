import { Scrim } from '../../models/team.models';

/**
 * Scrims folded by the team they were against.
 *
 * A scrim arrives as one replay with an opponent name typed on it, so the flat
 * list answered "what did we play" and nothing else. Grouping by opponent is
 * what makes a scrims page a history: how many times we have met a team, how
 * that has gone, and — once notes and bans hang off the group — what we know
 * about them going in.
 */

export interface ScrimGroup {
  /** Slug of the name; the same key the stored ScrimOpponent record uses. */
  id: string;
  /** The first spelling seen, so "MOSS" and "moss" show as one team, once. */
  name: string;
  /** Newest first. */
  scrims: Scrim[];
  wins: number;
  losses: number;
  /** Scrims whose side could not be told, so they count in neither column. */
  unknown: number;
  /** ISO timestamp of the most recent scrim, for ordering the groups. */
  lastPlayed: string;
}

/** What an unnamed scrim files under, so it is never lost off the page. */
export const UNNAMED_OPPONENT = 'Unnamed opponent';

/**
 * Turn an opponent name into a stable key.
 *
 * Case, spacing and punctuation are all things people type inconsistently
 * about the same team — "MOSS", "Moss", "moss " — and none of them mean a
 * different opponent. Letters and digits only, so the key is also a safe
 * Firestore document id.
 */
export function slugOpponent(name: string | undefined): string {
  const slug = (name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'unnamed';
}

/**
 * Group scrims by opponent, newest group first.
 *
 * `won` is passed in rather than computed here because knowing which side was
 * ours needs the roster, which this module does not have. A null answer means
 * the side is genuinely unknown and the scrim counts in neither column rather
 * than being guessed into one.
 */
export function groupScrims(
  scrims: readonly Scrim[],
  won: (scrim: Scrim) => boolean | null
): ScrimGroup[] {
  const groups = new Map<string, ScrimGroup>();

  for (const scrim of scrims) {
    const id = slugOpponent(scrim.opponent);
    const name = scrim.opponent?.trim() || UNNAMED_OPPONENT;
    const group = groups.get(id) ?? {
      id,
      name,
      scrims: [],
      wins: 0,
      losses: 0,
      unknown: 0,
      lastPlayed: ''
    };

    group.scrims.push(scrim);
    const result = won(scrim);
    if (result === true) group.wins += 1;
    else if (result === false) group.losses += 1;
    else group.unknown += 1;

    const at = scrim.playedOn ?? '';
    if (at > group.lastPlayed) group.lastPlayed = at;

    groups.set(id, group);
  }

  const out = [...groups.values()];
  for (const group of out) {
    group.scrims.sort((a, b) => (b.playedOn ?? '').localeCompare(a.playedOn ?? ''));
  }
  // Most recently played opponent first: the team you scrimmed last night is
  // the one you came to the page to look at.
  return out.sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed));
}
