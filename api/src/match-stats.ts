/**
 * Reducing a player's recent matches to the averages shown on their card.
 *
 * Every share here is a ratio against the player's own team in that game, and a
 * game where the denominator is zero — no team kills, no damage recorded —
 * would poison the average, so each metric counts its own usable sample rather
 * than dividing by the match count.
 */

export interface MatchParticipant {
  puuid: string;
  championName: string;
  win: boolean;
  teamId: number;
  teamPosition: string;
  kills: number;
  deaths: number;
  assists: number;
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  totalDamageDealtToChampions: number;
  totalDamageTaken: number;
  /** Absent on cache entries below v4, until the backfill reaches them. */
  damageDealtToBuildings?: number;
  /** Absent on cache entries below v4, likewise. */
  visionScore?: number;
}

export interface Match {
  info: {
    gameDuration: number;
    gameCreation: number;
    queueId: number;
    participants: MatchParticipant[];
  };
}

export interface MatchSummary {
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgKda: number;
  avgCsPerMin: number;
  avgKillParticipation: number;
  avgDamageShare: number;
  avgTankShare: number;
  avgBuildingDamage: number;
  avgVisionScore: number;
  /** Games that actually recorded a vision score — below `games` during a backfill. */
  visionSamples: number;
  /** Games that actually recorded building damage. */
  buildingSamples: number;
  /** Games with a known duration, the only ones CS per minute can come from. */
  csSamples: number;
  /** Most-played champions first, capped so the pool reflects a real spread. */
  topChampions: string[];
  /** Champions that beat this player in lane, most frequent first. */
  banCandidates: string[];
  /** The position played most often, or empty if none was reported. */
  mainPosition: string;
  /**
   * Every position played, most often first, with the games behind each.
   *
   * One position is not enough to scout by. Plenty of players have a main and
   * a comfortable secondary, and the counts are what separate the two — "Mid
   * 34, Top 12" is a different player from "Mid 24, Top 22", and only the
   * second is a genuine flex worth drafting around.
   */
  positions: { position: string; games: number }[];
}

/** How many champions count as the player's pool. */
const POOL_SIZE = 5;

function averageOf(total: number, samples: number): number {
  return samples > 0 ? total / samples : 0;
}

function rankedByCount(counts: Map<string, number>): string[] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
}

/**
 * `renameChampion` maps Riot's internal names onto display ones — the caller
 * owns that table, so it is passed in rather than imported.
 */
export function summarizeMatches(
  matches: Match[],
  puuid: string,
  renameChampion: (name: string) => string = (name) => name
): MatchSummary | null {
  const played = matches.filter((match) => match.info.participants.some((p) => p.puuid === puuid));
  if (played.length === 0) {
    return null;
  }

  const champGames = new Map<string, number>();
  const roleCounts = new Map<string, number>();
  const banCandidateCounts = new Map<string, number>();

  let wins = 0;
  let kills = 0;
  let deaths = 0;
  let assists = 0;
  let csPerMin = 0;
  let csSamples = 0;
  let buildingDamage = 0;
  let buildingSamples = 0;
  let visionScore = 0;
  let visionSamples = 0;

  let killParticipation = 0;
  let killParticipationSamples = 0;
  let damageShare = 0;
  let damageShareSamples = 0;
  let tankShare = 0;
  let tankShareSamples = 0;

  for (const match of played) {
    const me = match.info.participants.find((p) => p.puuid === puuid)!;

    champGames.set(me.championName, (champGames.get(me.championName) ?? 0) + 1);
    if (me.win) wins += 1;
    if (me.teamPosition) {
      roleCounts.set(me.teamPosition, (roleCounts.get(me.teamPosition) ?? 0) + 1);
    }

    kills += me.kills;
    deaths += me.deaths;
    assists += me.assists;
    // A remake would otherwise report an absurd CS per minute, and a cached
    // entry written before durations were stored has no denominator at all —
    // counting that game as a full minute would report ten times the real rate.
    if (match.info.gameDuration > 0) {
      const minutes = Math.max(match.info.gameDuration / 60, 1);
      csPerMin += (me.totalMinionsKilled + me.neutralMinionsKilled) / minutes;
      csSamples += 1;
    }

    // Missing is not zero. These two arrived with cache v4, so during the
    // backfill some games genuinely have no number, and averaging those in as
    // zeroes would read as a player who stopped warding.
    if (typeof me.damageDealtToBuildings === 'number') {
      buildingDamage += me.damageDealtToBuildings;
      buildingSamples += 1;
    }
    if (typeof me.visionScore === 'number') {
      visionScore += me.visionScore;
      visionSamples += 1;
    }

    const teammates = match.info.participants.filter((p) => p.teamId === me.teamId);

    const teamKills = teammates.reduce((sum, p) => sum + p.kills, 0);
    if (teamKills > 0) {
      killParticipation += (me.kills + me.assists) / teamKills;
      killParticipationSamples += 1;
    }

    const teamDamage = teammates.reduce((sum, p) => sum + (p.totalDamageDealtToChampions ?? 0), 0);
    if (teamDamage > 0) {
      damageShare += (me.totalDamageDealtToChampions ?? 0) / teamDamage;
      damageShareSamples += 1;
    }

    const teamTaken = teammates.reduce((sum, p) => sum + (p.totalDamageTaken ?? 0), 0);
    if (teamTaken > 0) {
      tankShare += (me.totalDamageTaken ?? 0) / teamTaken;
      tankShareSamples += 1;
    }

    // Only losses suggest a ban: the champion that beat us in our own lane.
    if (!me.win && me.teamPosition) {
      const opponent = match.info.participants.find(
        (p) => p.teamId !== me.teamId && p.teamPosition === me.teamPosition
      );
      if (opponent) {
        banCandidateCounts.set(
          opponent.championName,
          (banCandidateCounts.get(opponent.championName) ?? 0) + 1
        );
      }
    }
  }

  const games = played.length;
  const avgKills = kills / games;
  const avgDeaths = deaths / games;
  const avgAssists = assists / games;

  return {
    games,
    wins,
    losses: games - wins,
    winRate: Math.round((wins / games) * 100),
    avgKills,
    avgDeaths,
    avgAssists,
    // A perfect game has no denominator; treat it as the raw kill+assist total
    // rather than dividing by zero.
    avgKda: avgDeaths > 0 ? (avgKills + avgAssists) / avgDeaths : avgKills + avgAssists,
    avgCsPerMin: averageOf(csPerMin, csSamples),
    avgKillParticipation: averageOf(killParticipation, killParticipationSamples),
    avgDamageShare: averageOf(damageShare, damageShareSamples),
    avgTankShare: averageOf(tankShare, tankShareSamples),
    avgBuildingDamage: averageOf(buildingDamage, buildingSamples),
    avgVisionScore: averageOf(visionScore, visionSamples),
    visionSamples,
    buildingSamples,
    csSamples,
    topChampions: rankedByCount(champGames).slice(0, POOL_SIZE).map(renameChampion),
    banCandidates: rankedByCount(banCandidateCounts).map(renameChampion),
    mainPosition: rankedByCount(roleCounts)[0] ?? '',
    positions: rankedByCount(roleCounts).map((position) => ({
      position,
      games: roleCounts.get(position) ?? 0
    }))
  };
}
