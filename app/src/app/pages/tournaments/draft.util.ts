/**
 * What is still on the table during a fearless draft.
 *
 * In fearless, every champion played in an earlier game of the series is gone
 * for the rest of it, so by game three the pool is genuinely thin. During the
 * draft itself the picture keeps changing — bans land, the enemy takes
 * something — and the question is always the same: which of our comps do we
 * still have, and who is running out of champions.
 *
 * Kept free of Angular so the logic can be tested directly.
 */

/** Punctuation and casing vary between Riot, our notes, and what people type. */
export function normalizeChampion(name: string): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** One set, normalised, from however many lists of champions. */
export function blockedSet(...groups: (readonly string[] | undefined)[]): Set<string> {
  const blocked = new Set<string>();
  for (const group of groups) {
    for (const champion of group ?? []) {
      if (champion) blocked.add(normalizeChampion(champion));
    }
  }
  return blocked;
}

export interface CompChampions {
  id: string;
  name: string;
  category?: string;
  champions: string[];
}

export interface CompAvailability {
  id: string;
  name: string;
  category?: string;
  available: string[];
  blocked: string[];
  playable: boolean;
}

/**
 * Broken comps come back least-damaged first: a comp missing one champion is a
 * substitution, one missing three is not worth the conversation.
 */
export function compAvailability(
  comps: readonly CompChampions[],
  blocked: ReadonlySet<string>
): CompAvailability[] {
  return comps
    .map((comp) => {
      const champions = comp.champions.filter(Boolean);
      return {
        id: comp.id,
        name: comp.name,
        category: comp.category,
        available: champions.filter((c) => !blocked.has(normalizeChampion(c))),
        blocked: champions.filter((c) => blocked.has(normalizeChampion(c))),
        playable: champions.length > 0 && champions.every((c) => !blocked.has(normalizeChampion(c)))
      };
    })
    .sort((a, b) => Number(b.playable) - Number(a.playable) || a.blocked.length - b.blocked.length);
}

export interface PoolPressure {
  name: string;
  left: string[];
  gone: string[];
  /** Thin enough to plan around — fewer champions left than games remaining. */
  critical: boolean;
}

/**
 * How much pool each player has left. `gamesRemaining` decides what counts as
 * critical: a player with two champions left going into two more games has no
 * room for a ban, which is worth seeing before the draft, not during it.
 */
export function poolPressure(
  players: readonly { name: string; pool: readonly string[] }[],
  blocked: ReadonlySet<string>,
  gamesRemaining = 1
): PoolPressure[] {
  return players
    .map((player) => {
      const left = player.pool.filter((c) => c && !blocked.has(normalizeChampion(c)));
      const gone = player.pool.filter((c) => c && blocked.has(normalizeChampion(c)));
      return { name: player.name, left, gone, critical: left.length <= gamesRemaining };
    })
    .sort((a, b) => a.left.length - b.left.length);
}
