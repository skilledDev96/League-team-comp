/**
 * Building a player's recent-form sample from the match cache before Riot.
 *
 * Enrichment used to read twelve matches, every one of them a Riot call, and
 * six players times three queues already crowds the 100-per-2-minutes ceiling.
 * Meanwhile `matchCache` holds every match the comp analysis has ever pulled —
 * whole lobbies, ten participants each — so a large part of that sample is
 * already sitting in Firestore, paid for, and free to read.
 *
 * The cache only covers `TEAM_QUEUES` (flex and clash), so solo queue starts
 * cold. That is not a reason to skip the lookup: matches fetched here are
 * written back, so the second run over a player is cheaper than the first, and
 * flex — the queue the profile treats as primary — is warm from the start.
 */

/** What this module reads off a cached participant; callers pass richer objects. */
export interface SampleParticipant {
  puuid: string;
  championName: string;
  win: boolean;
  teamId: number;
  teamPosition: string;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damage: number;
  damageTaken?: number;
  /** Absent below cache v4, and averaged over its own sample rather than as 0. */
  visionScore?: number;
  /** Absent below cache v4, likewise. */
  buildingDamage?: number;
}

export interface SampleMatch {
  cacheVersion?: number;
  queueId: number;
  gameCreation: number;
  /** Absent on v1 entries; without it CS per minute has no denominator. */
  durationSec?: number;
  participants: SampleParticipant[];
}

/** The shape `summarizeMatches` consumes, rebuilt from a cached entry. */
export interface AdaptedMatch {
  info: {
    gameDuration: number;
    gameCreation: number;
    queueId: number;
    participants: {
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
      damageDealtToBuildings?: number;
      totalDamageTaken: number;
      visionScore?: number;
    }[];
  };
}

/**
 * Re-shape a cached match into what the summariser expects.
 *
 * The cache stores CS as one number because nothing downstream separates lane
 * minions from jungle camps; it is put back on `totalMinionsKilled` with zero
 * neutrals, which the summariser adds together anyway.
 *
 * Vision and building damage stay `undefined` when the entry predates v4 —
 * deliberately not defaulted to zero, because a zero is indistinguishable from
 * a real one and would drag the average down for weeks while the backfill runs.
 */
export function cachedToMatch(cached: SampleMatch): AdaptedMatch {
  return {
    info: {
      // Zero means "unknown", which the summariser skips rather than dividing by.
      gameDuration: cached.durationSec ?? 0,
      gameCreation: cached.gameCreation,
      queueId: cached.queueId,
      participants: cached.participants.map((p) => ({
        puuid: p.puuid,
        championName: p.championName,
        win: p.win,
        teamId: p.teamId,
        teamPosition: p.teamPosition,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        totalMinionsKilled: p.cs,
        neutralMinionsKilled: 0,
        totalDamageDealtToChampions: p.damage,
        damageDealtToBuildings: p.buildingDamage,
        totalDamageTaken: p.damageTaken ?? 0,
        visionScore: p.visionScore
      }))
    }
  };
}

/**
 * How many matches enrichment may pull from Riot per queue when the cache is
 * cold. Held at the old fixed sample size on purpose: a player nobody has
 * analysed is no worse off than before, and everything fetched is cached, so
 * the next run over them costs less.
 */
export const MAX_ENRICH_FETCHES = 12;

export interface SamplePlan {
  /** Cache entries good enough to summarise, in the order the ids arrived. */
  readonly usable: SampleMatch[];
  /** Ids worth a Riot call, newest first and already capped to the budget. */
  readonly toFetch: string[];
  /** Ids left unfetched because the budget ran out — the sample is short, not wrong. */
  readonly skipped: number;
}

/**
 * Split a player's recent match ids into what the cache can already answer and
 * what is worth spending calls on.
 *
 * `usable` is deliberately not `isCacheCurrent`: a v3 entry is missing vision
 * and building damage but still carries the kills, the result and the champion,
 * which is most of the card. Re-fetching it to complete two averages would burn
 * the budget that buys the extra games in the first place, and the comp
 * analysis backfills it anyway on its own schedule.
 */
export function planSample(
  ids: readonly string[],
  cached: ReadonlyMap<string, SampleMatch | undefined>,
  budget: number = MAX_ENRICH_FETCHES
): SamplePlan {
  const usable: SampleMatch[] = [];
  const missing: string[] = [];

  for (const id of ids) {
    const entry = cached.get(id);
    if (entry && Array.isArray(entry.participants) && entry.participants.length > 0) {
      usable.push(entry);
    } else {
      missing.push(id);
    }
  }

  return {
    usable,
    toFetch: missing.slice(0, Math.max(budget, 0)),
    skipped: Math.max(missing.length - Math.max(budget, 0), 0)
  };
}
