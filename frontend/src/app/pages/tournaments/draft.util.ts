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
import { championKey, sameChampion } from '../../core/champion-key';

/**
 * The display-name keys of the champions whose Riot id is another word entirely ("MonkeyKing" is
 * Wukong, "Nunu" is Nunu & Willump, "Renata" is Renata Glasc). The alias table itself lives in
 * `core/champion-key.ts` and is not exported, so a key is resolved through its `sameChampion`:
 * whichever of these the name is the same champion as, that is its key.
 */
const ALIASED_KEYS = ['wukong', 'nunuwillump', 'renataglasc'] as const;

const keyCache = new Map<string, string>();

/**
 * One key for a champion however it is spelled (14 Sep 2026). Every set and every lookup in the draft
 * room and Prep goes through this, because the board holds three spellings at once: replays write
 * Riot's ids ("MissFortune", "MonkeyKing"), the wall and the pickers write display names ("Miss
 * Fortune", "Wukong"), and people type "kaisa". Lower-case letters and digits settle most of them;
 * the Riot ids that are another word resolve to the display name's key. Before this a burned
 * MonkeyKing never greyed the Wukong tile and a banned "missfortune" never greyed Miss Fortune.
 */
export function normalizeChampion(name: string): string {
  const raw = name ?? '';
  const known = keyCache.get(raw);
  if (known !== undefined) return known;
  const key = championKey(raw);
  const resolved = (key && ALIASED_KEYS.find((alias) => sameChampion(key, alias))) || key;
  if (keyCache.size > 2000) keyCache.clear();
  keyCache.set(raw, resolved);
  return resolved;
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

/**
 * The champions of however many lists, once each by key, keeping the first spelling met. A burned
 * list counts a champion once whether one game stored "MonkeyKing" and another "Wukong".
 */
export function uniqueChampions(...groups: (readonly (string | undefined)[] | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const champion of group ?? []) {
      const key = champion ? normalizeChampion(champion) : '';
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(champion!);
    }
  }
  return out;
}

/**
 * The games of a series that were played: a result recorded or a replay behind them (14 Sep 2026).
 * An empty board somebody opened the draft room on is not a game of the series, so a head reading
 * "0–2 · 3 games" or "not played yet · 2 games" was counting drafts that never happened.
 */
export function playedGames<T extends { win?: boolean; matchId?: string }>(games: readonly T[]): T[] {
  return games.filter((g) => g.win !== undefined || !!g.matchId);
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
