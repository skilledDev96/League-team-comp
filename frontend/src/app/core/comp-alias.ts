/**
 * Which comp a game counts as, resolved in the browser.
 *
 * This mirrors `api/src/comp-attribution.ts` on purpose. The backend is the
 * authority — its numbers are what the Review page and the stored analysis are
 * built from — but the Analysis page re-derives comp membership live so the
 * strictness slider responds without a Riot call. That re-derivation used to
 * read only `nearCompName`, which silently discarded both corrections: a game
 * placed by hand stayed off the books until someone noticed the win rate had
 * not moved.
 *
 * The two packages do not share code (no workspace linking), so the rules live
 * in both places and must stay in step: **override first, then `countsUnder`.**
 */

import { Comp } from '../models/team.models';

/** Matches `MAX_ALIAS_DEPTH` in the backend. A→B→C is fine; deeper is a mistake. */
const MAX_ALIAS_DEPTH = 5;

/**
 * The comp a chain of `countsUnder` ends at.
 *
 * Terminates on cycles rather than hanging: nothing stops two edits pointing
 * comps at each other, and this runs inside a computed over every game.
 */
export function resolveAlias(compId: string, comps: Comp[]): string {
  const byId = new Map(comps.map((comp) => [comp.id, comp]));
  const seen = new Set<string>([compId]);
  let current = compId;

  for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth += 1) {
    const parent = byId.get(current)?.countsUnder;
    if (!parent || parent === current) return current;
    if (!byId.has(parent) || seen.has(parent)) return current;
    seen.add(parent);
    current = parent;
  }

  return current;
}

/**
 * The comp a game belongs to, given whatever the caller matched it to.
 *
 * `baseCompId` is the caller's own answer — the strictness match on Analysis,
 * the stored `compId` on Review — and is used only when no override claims the
 * game. An override beats it outright, including beating the strictness slider:
 * moving a slider should not quietly undo something a person stated.
 */
export function effectiveComp(
  baseCompId: string | null,
  overrideId: string,
  comps: Comp[]
): { id: string; name: string } | null {
  const byId = new Map(comps.map((comp) => [comp.id, comp]));
  // An override naming a deleted comp is ignored, so the game falls back to
  // where it would have been had nobody touched it.
  const chosen = overrideId && byId.has(overrideId) ? overrideId : baseCompId;
  if (!chosen || !byId.has(chosen)) return null;

  const resolved = resolveAlias(chosen, comps);
  const comp = byId.get(resolved);
  return comp ? { id: comp.id, name: comp.name } : null;
}
