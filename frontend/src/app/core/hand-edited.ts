import { Player } from '../models/team.models';

/**
 * When a save makes a player hand-edited.
 *
 * The hand-edited flag (`Player.curated`) exists for one reason: the morning
 * refresh keeps a hand-edited player's text, pool and bans and only updates the
 * stats. Until 27 Sep 2026 every save through the editor set it, a seat change
 * included, so reseating a freshly imported roster froze five players' Riot
 * text on the spot (the lead: "oh I just adjusted their roles, so we need to
 * fix that?"). A seat needs no protecting since Release 1, when a refresh
 * stopped moving a set seat, and the bench flag and the second seats were
 * never Riot's to overwrite. So the flag is set when one of the fields the
 * refresh would otherwise rewrite changes by hand, and stays once set.
 */
const HAND_FIELDS = ['playstyle', 'strengths', 'weaknesses', 'top3', 'bans', 'icon'] as const;

function same(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): string => (Array.isArray(v) ? v.map((x) => String(x).trim()).join('\u0000') : String(v ?? '').trim());
  return norm(a) === norm(b);
}

/** True when `after` should carry the hand-edited flag, given the stored `before` (undefined for a new player). */
export function handEdited(before: Player | undefined, after: Partial<Player>): boolean {
  if (!before) return true;
  if (before.curated) return true;
  return HAND_FIELDS.some((field) => field in after && !same(before[field], after[field]));
}
