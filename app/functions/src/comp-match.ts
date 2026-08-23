// Champion-set matching for comp analysis, extracted so it can be unit tested.

/** Lowercase alphanumerics, so "Miss Fortune" == "missfortune" across sources. */
export function normalizeChampKey(name: string): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface CompChampSet {
  id: string;
  name: string;
  champions: string[];
}

export interface CompMatchResult {
  /** Matched comp (only when overlap >= threshold), else null. */
  compId: string | null;
  compName: string | null;
  /** Closest comp name regardless of threshold, for off-book hints. */
  nearName: string | null;
  /** Best champion overlap found across all comps. */
  overlap: number;
  /**
   * Names of every comp tied at `overlap`, sorted. Length > 1 means the game
   * genuinely fits multiple comps equally well and the winner is a tie-break,
   * not a clear result — surface it rather than assigning silently.
   */
  tiedNames: string[];
}

/**
 * Credit a played 5-champion game to the defined comp it overlaps most, when
 * that overlap meets the threshold. Always reports the closest comp + overlap.
 *
 * Ties are broken by comp id, not by array position, so reordering comps in the
 * admin editor can never silently change historical attribution.
 */
export function matchComp(
  playedChampions: string[],
  comps: CompChampSet[],
  threshold: number
): CompMatchResult {
  const played = new Set(playedChampions.map(normalizeChampKey));

  let bestOverlap = 0;
  let tied: CompChampSet[] = [];

  for (const comp of comps) {
    const compChamps = new Set(comp.champions.map(normalizeChampKey));
    let overlap = 0;
    for (const champ of compChamps) {
      if (played.has(champ)) overlap += 1;
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      tied = [comp];
    } else if (overlap === bestOverlap && overlap > 0) {
      tied.push(comp);
    }
  }

  // Deterministic, order-independent winner: lowest comp id wins a tie.
  const winner = [...tied].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] ?? null;
  const matched = winner !== null && bestOverlap >= threshold;

  return {
    compId: matched ? winner.id : null,
    compName: matched ? winner.name : null,
    nearName: winner ? winner.name : null,
    overlap: bestOverlap,
    tiedNames: tied.length > 1 ? [...tied].map((c) => c.name).sort() : []
  };
}
