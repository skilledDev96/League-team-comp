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
  /** From match history, when the comp has been played enough to have one. */
  winRate?: number;
  games?: number;
}

export interface CompAvailability {
  id: string;
  name: string;
  category?: string;
  available: string[];
  blocked: string[];
  playable: boolean;
  winRate?: number;
  games?: number;
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
        winRate: comp.winRate,
        games: comp.games,
        available: champions.filter((c) => !blocked.has(normalizeChampion(c))),
        blocked: champions.filter((c) => blocked.has(normalizeChampion(c))),
        playable: champions.length > 0 && champions.every((c) => !blocked.has(normalizeChampion(c)))
      };
    })
    .sort(
      (a, b) =>
        Number(b.playable) - Number(a.playable) ||
        (a.playable
          ? (b.winRate ?? -1) - (a.winRate ?? -1)
          : a.blocked.length - b.blocked.length || (b.winRate ?? -1) - (a.winRate ?? -1)) ||
        a.name.localeCompare(b.name)
    );
}

export interface PoolPressure {
  name: string;
  role: string;
  left: string[];
  gone: string[];
  /** Two or fewer left: one ban away from having no choice at all. */
  critical: boolean;
}

/** Draft order, so the list reads top to bottom the way a draft is discussed. */
const ROLE_ORDER: Record<string, number> = { Top: 0, Jungle: 1, Mid: 2, ADC: 3, Support: 4 };

/** Champions left at or below which a pool is worth flagging. */
export const CRITICAL_POOL = 2;

/**
 * How much pool each player has left, thinnest first — that is who the draft
 * has to be planned around.
 */
/**
 * Ordered by role, not by how thin each pool is.
 *
 * Sorting by pressure put whoever was closest to running out on top, which
 * moved rows around between picks: the list reordered itself in the middle of a
 * draft, exactly when someone is trying to find one player. Role order is
 * stable and matches how a draft is talked through, and the `critical` flag
 * still marks urgency in place rather than by position.
 */
export function poolPressure(
  players: readonly { name: string; role?: string; pool: readonly string[] }[],
  blocked: ReadonlySet<string>
): PoolPressure[] {
  return players
    .map((player) => {
      const left = player.pool.filter((c) => c && !blocked.has(normalizeChampion(c)));
      const gone = player.pool.filter((c) => c && blocked.has(normalizeChampion(c)));
      return {
        name: player.name,
        role: player.role ?? '',
        left,
        gone,
        critical: left.length <= CRITICAL_POOL
      };
    })
    .sort(
      (a, b) =>
        (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.name.localeCompare(b.name)
    );
}
