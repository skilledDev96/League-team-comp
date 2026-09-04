/**
 * What five people did as a team lately.
 *
 * A scouted roster says what each of them plays; it does not say what they
 * play *together*, and a team that queues flex as a five drafts differently
 * from five solo players. This reads the games where enough of them were on
 * one side and lays out the picks per game, so the draft can be read against
 * the comps they actually run.
 *
 * Pure: the handler in index.ts resolves accounts, pages match ids and reads
 * the cache; everything here is decided from data it is handed.
 */
import { SynergyPlayerInput, parseSynergyRequest } from './parse-request';

/**
 * Queues a five plays as a five. Flex and Clash are the team queues; draft is
 * in because an amateur team's five-stack plays normals to practise, and those
 * games carry the same comps.
 */
export const TEAM_HISTORY_QUEUES = [440, 700, 400];

export const DEFAULT_DAYS = 30;
export const MIN_DAYS = 7;
export const MAX_DAYS = 90;

/**
 * How many of them have to be on one side for a game to count. Three: a duo
 * says nothing about the team, and demanding all five hides the games with a
 * sub in, which are still their comps.
 */
export const MIN_TOGETHER = 3;

/** Most recent first; deeper than this is a season, not "lately". */
export const MAX_HISTORY_CANDIDATES = 60;

/**
 * New Riot fetches per run. Their games are rarely in our cache — it holds
 * ours — so most candidates cost a call, and this keeps one run inside the
 * rate limit. Whatever is left is reported as pending; a refresh reads on.
 */
export const MAX_HISTORY_FETCHES = 40;

export interface TeamHistoryRequest {
  players: SynergyPlayerInput[];
  days: number;
}

export function parseTeamHistoryRequest(body: unknown): TeamHistoryRequest {
  const { players } = parseSynergyRequest(body);
  const raw = (body as { days?: unknown }).days;
  const days =
    typeof raw === 'number' && Number.isFinite(raw)
      ? Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(raw)))
      : DEFAULT_DAYS;
  return { players, days };
}

/** Riot's `startTime` is epoch seconds. */
export function sinceSeconds(days: number, now = Date.now()): number {
  return Math.floor(now / 1000) - days * 86_400;
}

/** The fields read off a cached match; the cache carries more. */
export interface HistoryParticipant {
  puuid: string;
  championName: string;
  win: boolean;
  teamId: number;
  teamPosition: string;
}

export interface HistoryMatch {
  queueId: number;
  gameCreation: number;
  durationSec?: number;
  participants: HistoryParticipant[];
}

export type HistoryRole = 'Top' | 'Jungle' | 'Mid' | 'ADC' | 'Support' | '';

const ROLE_ORDER: HistoryRole[] = ['Top', 'Jungle', 'Mid', 'ADC', 'Support', ''];

const POSITION_ROLE: Record<string, HistoryRole> = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MIDDLE: 'Mid',
  BOTTOM: 'ADC',
  UTILITY: 'Support'
};

export const QUEUE_LABEL: Record<number, string> = {
  420: 'Solo',
  440: 'Flex',
  700: 'Clash',
  400: 'Draft',
  430: 'Blind',
  490: 'Quickplay'
};

export interface TogetherPick {
  role: HistoryRole;
  champion: string;
  /** Roster member's name, or null for a teammate who is not one of the five. */
  player: string | null;
}

export interface TogetherGame {
  matchId: string;
  /** ISO. */
  date: string;
  queue: string;
  durationSec?: number;
  win: boolean;
  side: 'blue' | 'red';
  /** How many of the five were on this side. */
  together: number;
  /** Their side, seat order. */
  picks: TogetherPick[];
  /** The other side, seat order. */
  enemies: TogetherPick[];
}

function toPick(p: HistoryParticipant, nameByPuuid: Map<string, string>): TogetherPick {
  return {
    role: POSITION_ROLE[p.teamPosition] ?? '',
    champion: p.championName,
    player: nameByPuuid.get(p.puuid) ?? null
  };
}

const bySeat = (a: TogetherPick, b: TogetherPick) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);

/**
 * One match as a game of theirs, or null when too few of them were on a side.
 * Two of them on opposite sides is not a team game either: only the side with
 * the most of them counts, and it still has to reach the floor.
 */
export function gameTogether(
  matchId: string,
  match: HistoryMatch,
  nameByPuuid: Map<string, string>,
  minTogether = MIN_TOGETHER
): TogetherGame | null {
  const bySide = new Map<number, HistoryParticipant[]>();
  for (const p of match.participants) {
    if (!nameByPuuid.has(p.puuid)) continue;
    bySide.set(p.teamId, [...(bySide.get(p.teamId) ?? []), p]);
  }
  let teamId = -1;
  let theirs: HistoryParticipant[] = [];
  for (const [id, members] of bySide) {
    if (members.length > theirs.length) {
      teamId = id;
      theirs = members;
    }
  }
  if (theirs.length < minTogether) return null;

  return {
    matchId,
    date: new Date(match.gameCreation).toISOString(),
    queue: QUEUE_LABEL[match.queueId] ?? String(match.queueId),
    durationSec: match.durationSec,
    win: theirs[0].win,
    side: teamId === 100 ? 'blue' : 'red',
    together: theirs.length,
    picks: match.participants.filter((p) => p.teamId === teamId).map((p) => toPick(p, nameByPuuid)).sort(bySeat),
    enemies: match.participants.filter((p) => p.teamId !== teamId).map((p) => toPick(p, nameByPuuid)).sort(bySeat)
  };
}

/** Newest first. */
export function gamesTogether(
  matches: readonly { id: string; match: HistoryMatch }[],
  nameByPuuid: Map<string, string>,
  minTogether = MIN_TOGETHER
): TogetherGame[] {
  return matches
    .map(({ id, match }) => gameTogether(id, match, nameByPuuid, minTogether))
    .filter((g): g is TogetherGame => g !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export interface TogetherPickStat {
  champion: string;
  role: HistoryRole;
  games: number;
  wins: number;
  /** Rounded percentage. */
  winRate: number;
}

export interface TogetherSummary {
  games: number;
  wins: number;
  losses: number;
  /** Games with every one of the five on the side. */
  fullStacks: number;
  /** The five's own picks across these games, most played first. */
  picks: TogetherPickStat[];
}

export function summariseTogether(games: readonly TogetherGame[], rosterSize = 5): TogetherSummary {
  const picks = new Map<string, TogetherPickStat>();
  let wins = 0;
  let fullStacks = 0;
  for (const g of games) {
    if (g.win) wins += 1;
    if (g.together >= rosterSize) fullStacks += 1;
    for (const pick of g.picks) {
      if (!pick.player) continue;
      const key = pick.champion + '|' + pick.role;
      const stat = picks.get(key) ?? { champion: pick.champion, role: pick.role, games: 0, wins: 0, winRate: 0 };
      stat.games += 1;
      if (g.win) stat.wins += 1;
      picks.set(key, stat);
    }
  }
  const ranked = [...picks.values()]
    .map((s) => ({ ...s, winRate: Math.round((s.wins / s.games) * 100) }))
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate);
  return { games: games.length, wins, losses: games.length - wins, fullStacks, picks: ranked };
}
