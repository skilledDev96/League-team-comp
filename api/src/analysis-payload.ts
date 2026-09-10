/**
 * The other side's figures on an analysis game, and the pass that keeps the
 * analysis document under Firestore's cap.
 *
 * Until 10 Sep 2026 an analysis game carried the enemy five as champions and
 * roles only, so the post-game graphs drew a dash for every one of their
 * figures while ours had bars — "why is only our damage dealt shown and not
 * the enemy team, this is the same for CS etc". The cache has always held
 * every participant's figures; this reads them for the enemy seats the way the
 * players block reads them for ours. Pure, so the assembly and the trim can be
 * tested without the function that runs them.
 */
import { killParticipation } from './fights';

/** Only the fields the enemy block reads; the assembly passes cached participants. */
export interface EnemyParticipant {
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damage: number;
  damageTaken?: number;
  visionScore?: number;
}

/**
 * The figures an enemy seat carries: the same ones our own player block does,
 * where the cached participant has them.
 *
 * Gold is not here because our own block does not carry it either — the cache
 * keeps gold only under `extras.goldEarned` from v5 — and a gold graph with
 * bars for them and dashes for us would be the original complaint in reverse.
 */
export interface EnemyStats {
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damage: number;
  /** Absent below cache v3, the same as ours. */
  damageTaken?: number;
  /** Absent below cache v4, the same as ours. */
  visionScore?: number;
  /** Share of their team's kills this seat was in on, 0-1; absent when they took none. */
  killParticipation?: number;
}

/**
 * Read one enemy seat's figures off the cached participant.
 *
 * Conditional spreads throughout, as the players block does: Firestore rejects
 * undefined, and a figure the cache entry lacks stays absent — the page shows a
 * dash for it, never a zero. `theirKills` is the tally of their side, so the
 * share is computed the way ours is (`fights.ts`), on every game rather than
 * from Riot's own challenge field that older matches lack.
 *
 * No CACHE_VERSION bump: the cache already holds every participant's figures,
 * so a Refresh on the Games page rebuilds every row with them at no Riot cost.
 */
export function enemyStats(p: EnemyParticipant, theirKills: number): EnemyStats {
  const share = killParticipation(p.kills, p.assists, theirKills);
  return {
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    cs: p.cs,
    damage: p.damage,
    ...(p.damageTaken !== undefined && { damageTaken: p.damageTaken }),
    ...(p.visionScore !== undefined && { visionScore: p.visionScore }),
    ...(share !== null && { killParticipation: share })
  };
}

/** Well under the 1 MiB document cap, with room for the rest of the document. */
export const PAYLOAD_GUARD_BYTES = 850_000;
/** How many of the newest games keep their detail when the guard trips. */
export const PAYLOAD_KEEP_DETAIL = 120;

/** The parts of a response the trim reads and writes; the assembly passes the real one. */
export interface TrimmableResponse {
  games: TrimmableGame[];
  /** How many games the trim stripped; set only when it had to, so an untouched document carries no field (Firestore rejects undefined). */
  payloadTrimmed?: number;
}

interface TrimmableGame {
  players: { lane?: unknown; facts?: unknown }[];
  enemies?: { stats?: EnemyStats }[];
}

/**
 * Keep one Firestore document under its cap, and say how big it came out.
 *
 * Two things grow per game past the fixed fields: the lane reads and facts on
 * each of our players, and, since 10 Sep 2026, the figures on each enemy seat.
 * The enemy figures cost about 150 bytes a seat as JSON — the five whole
 * numbers plus damage taken, vision and the kill share, keys included — so
 * around 750 bytes a game, five seats a game, and 150 KB over two hundred
 * games. Past the guard the oldest games lose their
 * enemies' figures first, and only if the document is still over do they lose
 * their lane reads as well, in stages that re-measure between them:
 *
 * Their figures go first because an old game's scoreboard is only seen when
 * someone opens that row, while its lane read still counts in every Patterns
 * claim, which aggregates wins against losses over all the games it has. The
 * newest `keep` games keep everything while the old ones can carry the cut, so
 * the recent story is the last to go.
 *
 * The last resort (10 Sep 2026): should the old games' detail not be enough —
 * a roster that plays far more than `keep` games a season, or a document that
 * grew elsewhere — the same two stages run over every game, newest included,
 * because a document over the cap is refused whole and the page would then
 * show no analysis at all. Until then the trim simply returned whatever the
 * two stages left. `payloadTrimmed` says how many games were touched, so
 * Diagnostics can say so beside the size. Mutates the response and returns its
 * size in bytes.
 */
export function trimAnalysisPayload(
  response: TrimmableResponse,
  guard = PAYLOAD_GUARD_BYTES,
  keep = PAYLOAD_KEEP_DETAIL
): number {
  const size = () => JSON.stringify(response).length;
  let bytes = size();
  if (bytes <= guard) return bytes;
  // Games arrive sorted newest first, so past `keep` is the old end.
  const oldest = response.games.slice(keep);
  for (const games of [oldest, response.games]) {
    if (!games.length) continue;
    // The count rides on the document, so it is set before the measure that decides whether the stage was enough.
    response.payloadTrimmed = games.length;
    stripEnemyFigures(games);
    bytes = size();
    if (bytes <= guard) return bytes;
    stripLaneReads(games);
    bytes = size();
    if (bytes <= guard) return bytes;
  }
  return bytes;
}

function stripEnemyFigures(games: TrimmableGame[]): void {
  for (const game of games) {
    for (const enemy of game.enemies ?? []) delete enemy.stats;
  }
}

function stripLaneReads(games: TrimmableGame[]): void {
  for (const game of games) {
    for (const player of game.players) {
      delete player.lane;
      delete player.facts;
    }
  }
}
