/**
 * Which comp a game counts as, once the humans have had their say.
 *
 * `comp-match.ts` answers this from champions alone, which is right most of the
 * time and wrong in two ways it cannot fix by itself:
 *
 * - Near-duplicate comps. "Dive/Wombo" and "Wombo" are the same plan to the
 *   people playing them, so their win rates should not be two small samples.
 *   That is a standing rule about a comp: `countsUnder`.
 * - A single game the matcher read wrongly, or an off-book game that really was
 *   a known comp with one champion swapped. That is a fact about one match:
 *   an override.
 *
 * Precedence is explicit-beats-rule: an override names the comp, and that comp's
 * own `countsUnder` then applies. Someone who says "count this as Dive/Wombo"
 * while Dive/Wombo counts under Wombo means Wombo, or the two features would
 * contradict each other depending on which screen you looked at.
 */

export interface AttributableComp {
  id: string;
  name: string;
  /** Id of the comp this one folds into. Absent, empty or self means it stands alone. */
  countsUnder?: string | null;
}

/** What the champion matcher concluded, before any human correction. */
export interface AutoMatch {
  compId: string | null;
  compName: string | null;
}

export interface Attribution {
  compId: string | null;
  compName: string | null;
  /**
   * How it got there. `auto` is the matcher unaided; the other two are worth
   * showing, because a number a person can change should say so.
   */
  source: 'auto' | 'manual' | 'alias';
}

/**
 * How far a `countsUnder` chain is followed. A→B→C is reasonable; beyond that
 * it is a mistake, and stopping is better than pretending to resolve it.
 */
const MAX_ALIAS_DEPTH = 5;

/**
 * The comp a chain of `countsUnder` ends at.
 *
 * Cycles are the reason this is not a one-liner. Nothing stops someone pointing
 * A at B and B back at A through the UI, and a naive walk would hang the whole
 * analysis run. A seen-set stops at the first repeat and keeps the last comp it
 * stood on, which is arbitrary but stable — and, importantly, terminates.
 */
export function resolveAlias(compId: string, comps: AttributableComp[]): string {
  const byId = new Map(comps.map((comp) => [comp.id, comp]));
  const seen = new Set<string>([compId]);
  let current = compId;

  for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth += 1) {
    const parent = byId.get(current)?.countsUnder;
    if (!parent || parent === current) return current;
    // Pointing at a comp that no longer exists: keep the last real one rather
    // than attributing the game to an id nothing will render.
    if (!byId.has(parent)) return current;
    if (seen.has(parent)) return current;
    seen.add(parent);
    current = parent;
  }

  return current;
}

/**
 * The comp a game counts as: an override if one names this match, otherwise
 * whatever the matcher found, with `countsUnder` applied either way.
 *
 * An override naming a comp that has since been deleted is ignored rather than
 * honoured — the game falls back to the matcher, which is the same place it
 * would have been had nobody touched it.
 */
export function attributeComp(
  auto: AutoMatch,
  matchId: string,
  overrides: Record<string, string>,
  comps: AttributableComp[]
): Attribution {
  const byId = new Map(comps.map((comp) => [comp.id, comp]));
  const override = overrides[matchId];

  if (override && byId.has(override)) {
    const resolved = resolveAlias(override, comps);
    return {
      compId: resolved,
      compName: byId.get(resolved)?.name ?? null,
      source: resolved === override ? 'manual' : 'alias'
    };
  }

  if (!auto.compId) {
    return { compId: null, compName: null, source: 'auto' };
  }

  const resolved = resolveAlias(auto.compId, comps);
  if (resolved === auto.compId) {
    return { compId: auto.compId, compName: auto.compName, source: 'auto' };
  }
  return { compId: resolved, compName: byId.get(resolved)?.name ?? auto.compName, source: 'alias' };
}
