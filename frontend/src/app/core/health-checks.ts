/**
 * Whether one analysed game is sound, and what it is missing.
 *
 * A wrong number on Patterns is worse than no number, so every game is put
 * through the same checks and anything odd is flagged in words (8 Sep 2026).
 * The checks are structural — five of ours, kills that add up, a real game
 * length, objectives present, the cache version the code expects — because
 * those are the ways a game has silently gone wrong before.
 */
import { AnalysisGame } from '../models/team.models';

/**
 * Mirrors `CACHE_VERSION` in `api/src/analysis-cache.ts`. Duplicated on
 * purpose: the frontend cannot import the api package, and a game below this
 * version is the one thing the health table must be able to say.
 */
export const EXPECTED_CACHE_VERSION = 6;

/** Under ten minutes a game was a remake or a surrender at fifteen never happened. */
const MIN_DURATION_SEC = 600;

export interface HealthRow {
  matchId: string;
  date: number;
  queue: string;
  cacheVersion?: number;
  players: number;
  hasExtras: boolean;
  hasLanes: boolean;
  killsSum: number;
  killsTally?: number;
  durationSec?: number;
  hasObjectives: boolean;
  /** A derived timeline document exists for the game. */
  hasTimeline: boolean;
  flags: string[];
}

export function healthChecks(game: AnalysisGame): HealthRow {
  const players = game.players.length;
  const killsSum = game.players.reduce((n, p) => n + p.kills, 0);
  const killsTally = game.kills?.ours;
  const hasExtras = game.players.some((p) => !!p.facts);
  const hasLanes = game.players.some((p) => p.lane && p.lane.verdict !== 'unknown');
  const hasObjectives = !!game.objectives;
  const replay = game.queue === 'Scrim';
  const flags: string[] = [];
  if (players !== 5) flags.push(`${players} of ours in the game, not five`);
  // The tally counts everyone on our side; the players are the roster only,
  // so with a sub in the two are allowed to differ.
  if (players === 5 && killsTally !== undefined && killsSum !== killsTally) flags.push(`player kills add to ${killsSum}, tally says ${killsTally}`);
  if (game.durationSec !== undefined && game.durationSec < MIN_DURATION_SEC) flags.push(`only ${Math.round(game.durationSec / 60)} minutes long`);
  if (!hasObjectives) flags.push('no objectives stored');
  if (game.cacheVersion !== undefined && game.cacheVersion < EXPECTED_CACHE_VERSION) flags.push(`cache v${game.cacheVersion}, waiting on the backfill`);
  if (game.cacheVersion === undefined) flags.push('no cache version stamped');
  const longEnough = game.durationSec === undefined || game.durationSec >= MIN_DURATION_SEC;
  // Lanes are read from v5 on, so a v5 entry still waiting on the v6 backfill should have one too.
  if (!replay && longEnough && game.cacheVersion !== undefined && game.cacheVersion >= 5 && !hasLanes) flags.push(`v${game.cacheVersion} Riot game with no lane read`);
  return {
    matchId: game.matchId,
    date: game.date,
    queue: game.queue,
    ...(game.cacheVersion !== undefined ? { cacheVersion: game.cacheVersion } : {}),
    players,
    hasExtras,
    hasLanes,
    killsSum,
    ...(killsTally !== undefined ? { killsTally } : {}),
    ...(game.durationSec !== undefined ? { durationSec: game.durationSec } : {}),
    hasObjectives,
    hasTimeline: game.timelineData === 'riot',
    flags
  };
}

export interface HealthTotals {
  games: number;
  current: number;
  behind: number;
  unstamped: number;
  flagged: number;
  /** Games with a derived timeline, and Riot games still waiting for one. */
  withTimeline: number;
  waitingTimeline: number;
}

export function healthTotals(rows: readonly HealthRow[]): HealthTotals {
  return {
    games: rows.length,
    current: rows.filter((r) => r.cacheVersion === EXPECTED_CACHE_VERSION).length,
    behind: rows.filter((r) => r.cacheVersion !== undefined && r.cacheVersion < EXPECTED_CACHE_VERSION).length,
    unstamped: rows.filter((r) => r.cacheVersion === undefined).length,
    flagged: rows.filter((r) => r.flags.length > 0).length,
    withTimeline: rows.filter((r) => r.hasTimeline).length,
    waitingTimeline: rows.filter((r) => !r.hasTimeline && r.queue !== 'Scrim').length
  };
}
