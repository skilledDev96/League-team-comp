/**
 * A rank a morning, per player (13 Sep 2026, for the home page's rank climb).
 *
 * Riot keeps only the rank a player holds now; nothing it answers says where they were last week. So
 * the morning refresh, which already reads every player's league entries, writes down what it saw:
 * one point per queue per day in `rankHistory/{playerId}`, the newest `RANK_HISTORY_CAP` kept. A second
 * run on the same day (a manual one) replaces that day's point rather than adding a second.
 *
 * Only our own players are ever read here, and a point carries the rank and nothing else about a game.
 */

/** Days kept per queue, a little over a year of mornings for one queue, or half that for both. */
export const RANK_HISTORY_CAP = 400;

export type RankQueue = 'solo' | 'flex';

export interface RankPoint {
  /** The run's day in Amsterdam, YYYY-MM-DD, where the schedule runs. */
  day: string;
  queue: RankQueue;
  /** Riot's tier, "GOLD". */
  tier: string;
  /** Riot's division, "II"; empty for the three apex tiers. */
  division: string;
  lp: number;
  wins: number;
  losses: number;
}

export interface RankHistoryDoc {
  playerId: string;
  points: RankPoint[];
  updatedAt: string;
}

interface StoredRank {
  tier?: unknown;
  rank?: unknown;
  leaguePoints?: unknown;
  wins?: unknown;
  losses?: unknown;
}

const APEX = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

/** The day a moment falls on in Amsterdam, as YYYY-MM-DD. */
export function amsterdamDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

function pointOf(rank: StoredRank | undefined, queue: RankQueue, day: string): RankPoint | null {
  if (!rank || typeof rank.tier !== 'string' || !rank.tier.trim()) return null;
  const tier = rank.tier.trim().toUpperCase();
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    day,
    queue,
    tier,
    division: APEX.has(tier) ? '' : typeof rank.rank === 'string' ? rank.rank.trim() : '',
    lp: num(rank.leaguePoints),
    wins: num(rank.wins),
    losses: num(rank.losses)
  };
}

/**
 * The points a player's stored queue stats give for one day: solo and flex, each only when Riot ranked
 * them in it. An unranked player gives nothing, which is not the same as a drop to the bottom.
 */
export function rankPointsFrom(queueStats: unknown, day: string): RankPoint[] {
  const stats = (queueStats ?? {}) as { solo?: { rank?: StoredRank }; flex?: { rank?: StoredRank } };
  return [pointOf(stats.solo?.rank, 'solo', day), pointOf(stats.flex?.rank, 'flex', day)].filter((p): p is RankPoint => !!p);
}

/**
 * The history with today's points in: a point for a day and queue already there is replaced, the list
 * is kept oldest first, and past the cap the oldest go. `added` counts the points that were new days.
 */
export function appendRankPoints(
  existing: readonly RankPoint[] | undefined,
  incoming: readonly RankPoint[],
  cap = RANK_HISTORY_CAP
): { points: RankPoint[]; added: number } {
  const key = (p: RankPoint) => `${p.day}|${p.queue}`;
  const byKey = new Map((existing ?? []).map((p) => [key(p), p]));
  let added = 0;
  for (const p of incoming) {
    if (!byKey.has(key(p))) added += 1;
    byKey.set(key(p), p);
  }
  const points = [...byKey.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.queue < b.queue ? -1 : a.queue > b.queue ? 1 : 0));
  return { points: points.slice(Math.max(0, points.length - cap)), added };
}
