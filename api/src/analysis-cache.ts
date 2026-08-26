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

/** Bump when the cached shape changes; entries below this are re-fetched once. */
export const CACHE_VERSION = 1;

/** A Summoner's Rift match has ten participants, and always exactly ten. */
const FULL_LOBBY = 10;

/**
 * Entries stamped with the current version are trusted outright — we wrote
 * them, so a re-fetch would only produce the same bytes. That guarantee is what
 * stops a match Riot returns oddly, a missing puuid say, from being re-fetched
 * forever. Unversioned legacy entries get a structural check instead.
 */
export function isCacheUsable(cached: CachedMatch | undefined): boolean {
  if (!cached) return false;
  if (cached.cacheVersion === CACHE_VERSION) return true;

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
}

export interface CompAnalysisRequestInput {
  players: AnalysisPlayerInput[];
  comps: AnalysisCompInput[];
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
            : []
        };
      })
    : [];

  return { players, comps };
}
