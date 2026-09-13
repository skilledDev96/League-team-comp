import { rateBand } from '../../../core/opponent-view';
import { rankWords } from '../../../core/rank-ladder';
import { Player } from '../../../models/team.models';

/** The three queues Riot keeps a sample of for a player. */
export type PlayersQueue = 'solo' | 'flex' | 'clash';

export const PLAYERS_QUEUES: readonly PlayersQueue[] = ['solo', 'flex', 'clash'];

/** Which queue the Players table reads, remembered per browser like the Patterns filters. */
export const PLAYERS_QUEUE_KEY = 'bom-roster-queue';

export function queueLabel(queue: PlayersQueue): string {
  return queue === 'solo' ? 'Solo/Duo' : queue === 'clash' ? 'Clash' : 'Flex';
}

/** Solo when anyone on the roster is ranked there (the queue the cards' rings read), else flex. */
export function defaultQueue(players: readonly Player[]): PlayersQueue {
  return players.some((p) => !!p.queueStats?.solo?.rank?.tier) ? 'solo' : 'flex';
}

/**
 * One player's figures in one queue, as the Players table prints them (13 Sep 2026).
 *
 * Everything here is the player's own games in that queue from Riot's last read, not team games: the ladder rank and
 * its season record, then the sample Riot handed back (up to five hundred games) with its win rate, KDA, farm,
 * participation, damage share and vision. A figure the sample does not carry is null, never a zero, and Clash has no
 * ladder, so no rank.
 */
export interface PlayerRowFigures {
  /** "Gold II", or "Master" for the apex tiers; null when unranked in this queue or for Clash. */
  rank: string | null;
  lp: number | null;
  season: { wins: number; losses: number } | null;
  sample: { games: number; wins: number; losses: number; winRate: number; band: string } | null;
  kda: number | null;
  csPerMin: number | null;
  /** Share of the team's kills, 0-1. */
  kp: number | null;
  /** Share of the team's damage, 0-1. */
  dmgShare: number | null;
  vision: { value: number; samples: number; of: number } | null;
}

export function playerRow(player: Player | undefined, queue: PlayersQueue): PlayerRowFigures {
  const stats = player?.queueStats?.[queue];
  const rank = queue !== 'clash' && stats?.rank?.tier ? stats.rank : undefined;
  const m = stats?.matches && stats.matches.games > 0 ? stats.matches : undefined;
  // Absent means the stats were read before the count existed, so every game counts; zero means none recorded one.
  const visionSamples = m ? (m.visionSamples ?? m.games) : 0;
  return {
    rank: rank ? rankWords({ tier: rank.tier, division: rank.rank }) : null,
    lp: rank ? rank.leaguePoints : null,
    season: rank ? { wins: rank.wins, losses: rank.losses } : null,
    sample: m ? { games: m.games, wins: m.wins, losses: m.losses, winRate: m.winRate, band: rateBand({ champion: '', games: m.games, wins: m.wins }) } : null,
    kda: m && Number.isFinite(m.avgKda) ? m.avgKda : null,
    csPerMin: m && Number.isFinite(m.avgCsPerMin) ? m.avgCsPerMin : null,
    kp: m && Number.isFinite(m.avgKillParticipation) ? m.avgKillParticipation : null,
    dmgShare: m && Number.isFinite(m.avgDamageShare) ? m.avgDamageShare : null,
    vision: m && visionSamples > 0 ? { value: m.avgVisionScore, samples: visionSamples, of: m.games } : null
  };
}

/** What the vision figure is an average over, in words; a dash's reason when there is none. */
export function visionNote(figures: PlayerRowFigures): string {
  const v = figures.vision;
  if (!figures.sample) return '';
  if (!v) return 'No vision score recorded in this sample yet; it fills in as matches refresh.';
  if (v.samples < v.of) return `Vision score over the ${v.samples} of ${v.of} games that recorded one.`;
  return `Average vision score over ${v.samples} games.`;
}
