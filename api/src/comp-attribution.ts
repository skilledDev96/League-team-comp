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
  /**
   * Whether an override put the game here, rather than the matcher (20 Sep 2026).
   *
   * `source` cannot answer this: `alias` is what an override *and* the matcher both become once
   * `countsUnder` applies. The caller needs the answer because the matcher's own receipts describe
   * the comp **it** matched — `onFallback` says how many seats of that comp were played on a
   * fallback, and on an overridden game that is a fact about a comp the game is not counted under.
   * `fallbackReceipt` below is where this is applied, together with the other two ways the game
   * ends up somewhere the matcher did not put it (`countsUnder`, and the threshold).
   */
  overridden: boolean;
}

/**
 * The part of the matcher's answer a receipt is about: which comp it placed the game on, and how
 * many of **that** comp's seats were filled by a fallback. `CompMatchResult` satisfies it.
 */
export interface FallbackMatch {
  compId: string | null;
  onFallback: number;
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
 * How many of a comp's seats this game filled with a fallback rather than the priority — as a fact
 * about the comp the game is **counted under**, which is the only comp anything may print it
 * against (20 Sep 2026).
 *
 * The matcher scores one comp and reports its receipt. Two things then move the game somewhere
 * else, and a receipt that travelled with it would be a sentence about seats the comp it landed on
 * does not have:
 *
 * - an **override**, which names a comp outright — the reason `Attribution.overridden` exists;
 * - **`countsUnder`**, which folds the matched comp into another. 'Dive v2' counting under 'Dive'
 *   is the same lie by a different road: the fallback is on Dive v2's Support seat, and Dive holds
 *   no fallback at all.
 *
 * And a game **below the threshold** is counted under nothing, while the matcher still reports its
 * nearest comp and that comp's receipt — so a receipt written there would describe `nearCompName`
 * rather than the comp the game counts as, which is none.
 *
 * So the receipt stands only when the game is counted under the very comp the matcher scored. 0 for
 * every comp until the lead adds a fallback, either way.
 */
export function fallbackReceipt(attributed: Attribution, match: FallbackMatch): number {
  if (!attributed.compId) return 0;
  if (attributed.overridden) return 0;
  if (attributed.compId !== match.compId) return 0;
  return match.onFallback > 0 ? match.onFallback : 0;
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
      source: resolved === override ? 'manual' : 'alias',
      overridden: true
    };
  }

  if (!auto.compId) {
    return { compId: null, compName: null, source: 'auto', overridden: false };
  }

  const resolved = resolveAlias(auto.compId, comps);
  if (resolved === auto.compId) {
    return { compId: auto.compId, compName: auto.compName, source: 'auto', overridden: false };
  }
  return {
    compId: resolved,
    compName: byId.get(resolved)?.name ?? auto.compName,
    source: 'alias',
    overridden: false
  };
}
