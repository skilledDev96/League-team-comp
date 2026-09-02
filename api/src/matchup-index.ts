/**
 * A small, readable index over the raw matchup tallies.
 *
 * The raw documents are written for accumulation, not for reading: one per
 * patch per lane, holding every pairing ever seen. `matchupStats/16.17_TOP`
 * measured 1.17 MB two days into a patch, and the ceiling is C(173,2) = 14,878
 * pairings in a single lane. That is fine for `FieldValue.increment`, which
 * never reads the document, and hopeless for a browser: the draft room would
 * pull a megabyte per lane to show six numbers, mid-draft, on someone's laptop.
 *
 * So the raw tallies stay exactly as they are and this publishes a second,
 * derived document containing only the pairings with enough games to be worth
 * reading. At the current floor that is a few hundred entries — kilobytes, not
 * megabytes — and it grows in step with what is actually usable rather than
 * with what has merely been seen once.
 *
 * The prune floor here is deliberately *lower* than the floor the UI applies.
 * This one exists to keep the document small; the honesty threshold lives in
 * the frontend, so it can be tuned without redeploying functions.
 */

/**
 * Games before a pairing is published at all.
 *
 * Low on purpose — this is the size guard, not the statistics. Fifty games is
 * enough to be confident a pairing is a real one that keeps occurring rather
 * than a one-off, which is all this floor is asked to decide.
 */
export const INDEX_MIN_GAMES = 50;

/** The raw tally document, as the crawler writes it. */
export interface RawMatchupDoc {
  patch?: string;
  lane?: string;
  pairs?: Record<string, { games?: number; winsA?: number } | undefined>;
}

export interface IndexedPair {
  readonly games: number;
  readonly winsA: number;
}

export interface MatchupIndex {
  readonly patch: string;
  readonly lane: string;
  /** Keyed exactly as the raw document keys them: `matchupKey(a, b)`. */
  readonly pairs: Record<string, IndexedPair>;
  /** Pairings the raw document held, so a reader can see how far off coverage is. */
  readonly pairsSeen: number;
  /** Pairings published, i.e. those at or above the floor. */
  readonly pairsPublished: number;
  readonly builtAt: string;
}

/**
 * Filter one raw lane document down to the pairings worth publishing.
 *
 * Counts are validated rather than trusted: a pairing with more wins than games
 * is arithmetically impossible and means a write went wrong somewhere, and
 * publishing it would put a rate above 100% on screen in a draft. Dropping it
 * loses one cell; keeping it discredits every cell beside it.
 */
export function buildIndex(
  raw: RawMatchupDoc | null,
  patch: string,
  lane: string,
  builtAt: string,
  floor: number = INDEX_MIN_GAMES
): MatchupIndex {
  const pairs: Record<string, IndexedPair> = {};
  const source = raw?.pairs ?? {};
  let seen = 0;

  for (const [key, tally] of Object.entries(source)) {
    if (!tally) continue;
    seen += 1;

    const games = Number(tally.games);
    const winsA = Number(tally.winsA);
    if (!Number.isFinite(games) || !Number.isFinite(winsA)) continue;
    if (games < floor) continue;
    if (winsA < 0 || winsA > games) continue;

    pairs[key] = { games, winsA };
  }

  return {
    patch,
    lane,
    pairs,
    pairsSeen: seen,
    pairsPublished: Object.keys(pairs).length,
    builtAt
  };
}

/** Firestore path for a published index. Deliberately not the raw path. */
export function indexDocPath(patch: string, lane: string): string {
  return `matchupIndex/${patch}_${lane}`;
}

/** The five lanes the crawler records, in the order a scoreboard reads. */
export const CRAWL_LANES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const;

/**
 * Split a raw document id back into its patch and lane.
 *
 * Ids are `{patch}_{LANE}` and a patch carries a dot, not an underscore, so the
 * last underscore is the separator. Split on the first and a future id with any
 * further part in it would silently hand back the wrong lane — the sort of
 * failure that files top-lane numbers under jungle and looks like bad data
 * rather than a bad parse.
 */
export function splitIndexId(id: string): { patch: string; lane: string } | null {
  const cut = id.lastIndexOf('_');
  if (cut <= 0 || cut === id.length - 1) return null;
  const patch = id.slice(0, cut);
  const lane = id.slice(cut + 1);
  if (!CRAWL_LANES.includes(lane as (typeof CRAWL_LANES)[number])) return null;
  return { patch, lane };
}
