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
}

/**
 * Credit a played 5-champion game to the defined comp it overlaps most, when
 * that overlap meets the threshold. Always reports the closest comp + overlap.
 */
export function matchComp(
  playedChampions: string[],
  comps: CompChampSet[],
  threshold: number
): CompMatchResult {
  const played = new Set(playedChampions.map(normalizeChampKey));
  let bestId: string | null = null;
  let bestName = '';
  let bestOverlap = 0;

  for (const comp of comps) {
    const compChamps = new Set(comp.champions.map(normalizeChampKey));
    let overlap = 0;
    for (const champ of compChamps) {
      if (played.has(champ)) overlap += 1;
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestId = comp.id;
      bestName = comp.name;
    }
  }

  const matched = bestId !== null && bestOverlap >= threshold;
  return {
    compId: matched ? bestId : null,
    compName: matched ? bestName : null,
    nearName: bestOverlap > 0 ? bestName : null,
    overlap: bestOverlap
  };
}
