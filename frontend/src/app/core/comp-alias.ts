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

import { Comp, ROLES } from '../models/team.models';
import { seatOptions } from './comp-seats';

/** Matches `MAX_ALIAS_DEPTH` in the backend. A→B→C is fine; deeper is a mistake. */
const MAX_ALIAS_DEPTH = 5;

/**
 * A comp's seats as the backend's matcher takes them: one array a filled seat, the priority first
 * then its fallbacks in order (20 Sep 2026 — the lead: "the dive comp has naut a priority but Leona
 * can also be added as a secondary pick").
 *
 * This is the third rule in this file that has to be the same in two packages, and it is the one the
 * others depend on: **the browser does not match champions to comps at all.** Every surface that asks
 * "which comp is this game" reads `AnalysisGame.compId` through `effectiveComp` below, and that id is
 * the backend's answer to the request this builds. So the way the two agree is not that both run a
 * matcher — it is that the browser sends the same seats the morning run sends, and there is exactly
 * one matcher. Send a comp without its seats and a fallback silently counts for nothing, on every
 * page at once.
 *
 * The seats themselves come from `comp-seats.ts`, the one module that knows a comp has two seat
 * fields, so the invariant (no priority, no seat), the dedupe and the cap are applied once and this
 * cannot drift from what the board writes. `api/src/daily-refresh.ts` `seatsOfComp` is the mirror —
 * keep the two identical, including the last line.
 *
 * **Undefined for a comp holding no fallback**, which is every comp the day this shipped. That is not
 * an optimisation: an absent `seats` is the value the matcher reads as "score this comp exactly the
 * way it was scored yesterday", so until the lead adds a fallback not one comp even takes the new
 * path, and no record can move. (A one-champion-a-seat `seats` scores the same — that is proved in
 * `api/src/comp-match.spec.ts` — but sending it would make the request differ from the morning run's
 * for no reason, and a difference nobody needs is a difference nobody checks.)
 */
export function compSeats(comp: Comp): string[][] | undefined {
  const seats = ROLES.map((role) => seatOptions(comp, role).map((option) => option.champion)).filter(
    (seat) => seat.length > 0
  );
  return seats.some((seat) => seat.length > 1) ? seats : undefined;
}

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
