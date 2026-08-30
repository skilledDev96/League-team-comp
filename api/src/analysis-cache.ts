/**
 * Whether a cached match can be trusted, and what a comp-analysis request has
 * to contain.
 *
 * The cache exists because Riot rate-limits hard: re-fetching every match on
 * every refresh would exhaust the budget long before the season's games ran
 * out. Deciding wrongly here is expensive in both directions — trusting a bad
 * entry gives silently wrong numbers, distrusting a good one burns the budget.
 */

/** Only the field the trust check reads; callers pass richer objects. */
export interface CachedParticipant {
  puuid: string;
}

export interface CachedMatch {
  /** Schema stamp. Absent means a legacy entry written before versioning. */
  cacheVersion?: number;
  queueId: number;
  gameCreation: number;
  participants: CachedParticipant[];
}

/**
 * Bump when the cached shape changes; entries below this are re-fetched once.
 *
 * v4 added `visionScore` and `buildingDamage` per participant, so player
 * enrichment can read its sample from here instead of spending a Riot call per
 * match. Both are absent on v3 entries until the backfill works through, and
 * every average over them counts its own sample rather than treating a missing
 * number as a zero.
 */
export const CACHE_VERSION = 4;

/** A Summoner's Rift match has ten participants, and always exactly ten. */
const FULL_LOBBY = 10;

/**
 * Whether an entry has everything the current code wants to read from it.
 *
 * Entries stamped with the current version are trusted outright — we wrote
 * them, so a re-fetch would only produce the same bytes. That guarantee is what
 * stops a match Riot returns oddly, a missing puuid say, from being re-fetched
 * forever: once re-fetched it carries the current stamp and is trusted.
 *
 * Anything else is out of date *by definition*, whether it carries an older
 * stamp or none at all. Versioning only arrived on 23 Aug 2026, so the entries
 * most likely to be missing a new field are precisely the unversioned ones —
 * treating those as fine is how a `CACHE_VERSION` bump silently does nothing.
 */
export function isCacheCurrent(cached: CachedMatch | undefined): boolean {
  return cached?.cacheVersion === CACHE_VERSION;
}

/**
 * Whether an entry is sound enough to use when we *cannot* re-fetch it.
 *
 * Separate from `isCacheCurrent` on purpose. A stale entry still answers who
 * played what and who won, so dropping it would cost a game from every win rate
 * on the site to gain a field the page already knows how to say it is missing.
 * The re-fetch budget is per-run and the backfill takes several runs; nobody
 * should watch their sample size collapse while it works through.
 */
export function isCacheUsable(cached: CachedMatch | undefined): boolean {
  if (!cached) return false;
  if (isCacheCurrent(cached)) return true;

  const parts = cached.participants;
  return (
    Array.isArray(parts) &&
    parts.length === FULL_LOBBY &&
    parts.every((p) => typeof p?.puuid === 'string' && p.puuid.length > 0)
  );
}

export interface AnalysisPlayerInput {
  id: string;
  name: string;
  riotTag?: string;
  region?: string;
}

export interface AnalysisCompInput {
  id: string;
  name: string;
  champions: string[];
  /** Id of the comp this one folds into, for near-duplicates kept as separate drafts. */
  countsUnder?: string | null;
}

export interface CompAnalysisRequestInput {
  players: AnalysisPlayerInput[];
  comps: AnalysisCompInput[];
  /** matchId -> compId, for games a person has placed by hand. */
  overrides: Record<string, string>;
}

/**
 * Analysis needs the whole roster, not a subset — a five-stack is the unit it
 * attributes games to — and allows a few extras for substitutes.
 */
export function parseCompAnalysisRequest(body: unknown): CompAnalysisRequestInput {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid payload. Expected a JSON object.');
  }

  const candidate = body as { players?: unknown; comps?: unknown };
  if (!Array.isArray(candidate.players) || candidate.players.length < 5 || candidate.players.length > 10) {
    throw new Error('players must contain between 5 and 10 roster members.');
  }

  const players = candidate.players.map((value) => {
    const player = (value ?? {}) as Record<string, unknown>;
    const id = typeof player.id === 'string' ? player.id.trim() : '';
    const name = typeof player.name === 'string' ? player.name.trim() : '';
    if (!id || !name) {
      throw new Error('Each roster player requires an id and name.');
    }
    return {
      id,
      name,
      riotTag: typeof player.riotTag === 'string' ? player.riotTag.trim() : undefined,
      region: typeof player.region === 'string' ? player.region.trim().toLowerCase() : undefined
    };
  });

  // Comps are optional: without them the pass still reports the team's games,
  // it just has nothing to attribute them to.
  const comps = Array.isArray(candidate.comps)
    ? candidate.comps.map((value) => {
        const comp = (value ?? {}) as Record<string, unknown>;
        return {
          id: typeof comp.id === 'string' ? comp.id : '',
          name: typeof comp.name === 'string' ? comp.name : 'Comp',
          champions: Array.isArray(comp.champions)
            ? comp.champions.filter((c): c is string => typeof c === 'string')
            : [],
          countsUnder: typeof comp.countsUnder === 'string' ? comp.countsUnder : null
        };
      })
    : [];

  // Overrides are advisory, so a malformed entry is dropped rather than failing
  // the run: losing one hand-placed game beats losing the whole analysis.
  const overrides: Record<string, string> = {};
  const rawOverrides = (candidate as { overrides?: unknown }).overrides;
  if (rawOverrides && typeof rawOverrides === 'object' && !Array.isArray(rawOverrides)) {
    for (const [matchId, compId] of Object.entries(rawOverrides as Record<string, unknown>)) {
      if (matchId && typeof compId === 'string' && compId) overrides[matchId] = compId;
    }
  }

  return { players, comps, overrides };
}
