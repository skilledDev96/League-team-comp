/**
 * Validation for the request bodies the callable endpoints accept.
 *
 * These run on untrusted input from the browser, so everything is checked
 * rather than cast — and the errors are the ones the caller sees, so they say
 * what was wrong rather than that something was.
 */

export type KnownRole = 'Top' | 'Jungle' | 'Mid' | 'ADC' | 'Support';

export const KNOWN_ROLES: KnownRole[] = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];

export interface EnrichRequestInput {
  summonerName: string;
  riotTag?: string;
  region?: string;
  role?: KnownRole;
  mobalyticsSlug?: string;
}

export interface SynergyPlayerInput {
  id: string;
  name: string;
  riotTag?: string;
  region?: string;
}

export interface SynergyRequestInput {
  players: SynergyPlayerInput[];
}

export function normalizeEmail(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase();
}

export function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/** Optional strings are trimmed, and absent rather than empty when blank. */
function optional(value: unknown, lower = false): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = lower ? value.trim().toLowerCase() : value.trim();
  return trimmed;
}

export function parseEnrichRequest(body: unknown): EnrichRequestInput {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid payload. Expected a JSON object.');
  }

  const candidate = body as Record<string, unknown>;
  const summonerName = typeof candidate.summonerName === 'string' ? candidate.summonerName.trim() : '';
  if (!summonerName) {
    throw new Error('summonerName is required.');
  }

  const role = typeof candidate.role === 'string' ? candidate.role.trim() : '';
  if (role && !KNOWN_ROLES.includes(role as KnownRole)) {
    throw new Error('role must be one of Top, Jungle, Mid, ADC, Support.');
  }

  return {
    summonerName,
    riotTag: optional(candidate.riotTag),
    region: optional(candidate.region, true),
    role: role ? (role as KnownRole) : undefined,
    mobalyticsSlug: optional(candidate.mobalyticsSlug)
  };
}

/**
 * Synergy needs at least a duo and at most a full team — a single player has no
 * synergy to measure, and more than five is not a League team.
 */
export function parseSynergyRequest(body: unknown): SynergyRequestInput {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid payload. Expected a JSON object.');
  }

  const candidate = body as { players?: unknown };
  if (!Array.isArray(candidate.players) || candidate.players.length < 2 || candidate.players.length > 5) {
    throw new Error('players must contain between 2 and 5 roster players.');
  }

  const players = candidate.players.map((value) => {
    const player = (value ?? {}) as Record<string, unknown>;
    const id = typeof player.id === 'string' ? player.id.trim() : '';
    const name = typeof player.name === 'string' ? player.name.trim() : '';
    if (!id || !name) {
      throw new Error('Each synergy player requires an id and name.');
    }
    return {
      id,
      name,
      riotTag: optional(player.riotTag),
      region: optional(player.region, true)
    };
  });

  return { players };
}

/**
 * Every way to choose `size` items, order ignored. Used to score each subset of
 * the roster that might have queued together.
 */
export function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const result: T[][] = [];
  for (let index = 0; index <= items.length - size; index += 1) {
    for (const rest of combinations(items.slice(index + 1), size - 1)) {
      result.push([items[index], ...rest]);
    }
  }
  return result;
}
