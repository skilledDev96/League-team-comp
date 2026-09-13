import { Player, Role } from '../models/team.models';
import { rankWords } from './rank-ladder';

/**
 * The line at the top of the home page: who is reading, and how their own solo queue is going (13 Sep 2026).
 *
 * The app knows the reader's seat (`UserPrefs.film.seat`, the one the film room asks for) and not their
 * name, since a signed-in account carries no player id. So the welcome is built from the seat: the
 * starter in it is the reader, and a reader who never picked one is asked once, unless they said no.
 *
 * Their own ranked solo numbers, not the team's (13 Sep 2026, the lead: "this should be all time of solo only,
 * as the flex and team stats are found when scrolling down"): the season's wins and losses on the ladder, the
 * same record the lineup rings read, KDA over the solo games Riot's last read holds, and the rank itself where the
 * team's last five used to be. Riot keeps no all-time record, so the season is the widest honest answer.
 *
 * Pure: the page hands in the seat, the roster and the hour, and reads back one small record. The hour comes in
 * rather than being read here, so the specs pin it.
 */

/** Which part of the day an hour of the clock falls in: 5 to 11 is morning, 12 to 17 afternoon, the rest evening. */
export function dayPart(hour: number): 'Morning' | 'Afternoon' | 'Evening' {
  if (hour >= 5 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 18) return 'Afternoon';
  return 'Evening';
}

/** The reader's own ranked solo queue, as Riot keeps it. */
export interface WelcomeSolo {
  /** "Gold II", or "Master"; null when they have played solo but hold no rank there. */
  rank: string | null;
  lp: number | null;
  /** The season's ladder games when ranked, else the games Riot's last read holds. */
  games: number;
  wins: number;
  winRate: number;
  /** Over the solo games Riot's last read holds; null when it read none. */
  kda: number | null;
  /** Where the games and the win rate came from, for the tip. */
  from: 'season' | 'sample';
}

export interface Welcome {
  /** "Morning, Zac", or the part of the day alone when the seat names nobody. */
  greeting: string;
  /** The starter in the reader's seat; null when there is no seat or nobody sits in it. */
  player: Player | null;
  /** Nobody is named and the reader has not waved the question away: ask which seat is theirs. */
  needsSeat: boolean;
  /** Series titles the MVP race credits them with. */
  titles: number;
  /** Their ranked solo queue; null when Riot has read nothing of it. */
  solo: WelcomeSolo | null;
}

/** One player's ranked solo queue: the season's record when they are ranked, else the games Riot read. */
export function soloOf(p: Player): WelcomeSolo | null {
  const solo = p.queueStats?.solo;
  const rank = solo?.rank?.tier ? solo.rank : undefined;
  const sample = solo?.matches && solo.matches.games > 0 ? solo.matches : undefined;
  const kda = sample && Number.isFinite(sample.avgKda) ? sample.avgKda : null;
  const seasonGames = rank ? rank.wins + rank.losses : 0;
  if (rank && seasonGames > 0) {
    return { rank: rankWords({ tier: rank.tier, division: rank.rank }), lp: rank.leaguePoints, games: seasonGames, wins: rank.wins, winRate: Math.round((rank.wins / seasonGames) * 100), kda, from: 'season' };
  }
  if (sample) {
    return { rank: rank ? rankWords({ tier: rank.tier, division: rank.rank }) : null, lp: rank ? rank.leaguePoints : null, games: sample.games, wins: sample.wins, winRate: sample.winRate, kda, from: 'sample' };
  }
  return null;
}

/** The welcome for one reader. The starter in the seat is the reader, the first by roster order when two starters share it. */
export function welcomeFor(i: {
  seat?: Role;
  starters: readonly Player[];
  titlesByPlayerId: ReadonlyMap<string, number>;
  hour: number;
  /** The reader closed the seat question; do not ask again. */
  dismissed: boolean;
}): Welcome {
  const part = dayPart(i.hour);
  const player = i.seat ? ([...i.starters].sort((a, b) => a.order - b.order).find((p) => p.role === i.seat) ?? null) : null;
  if (!player) return { greeting: part, player: null, needsSeat: !i.dismissed, titles: 0, solo: null };
  return {
    greeting: `${part}, ${player.name}`,
    player,
    needsSeat: false,
    titles: i.titlesByPlayerId.get(player.id) ?? 0,
    solo: soloOf(player)
  };
}
