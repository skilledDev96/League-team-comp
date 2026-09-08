/**
 * The numbers Riot hands us per participant that the cache never kept.
 *
 * Every `match/v5/matches/{id}` payload carries a `challenges` block per
 * participant — gold and damage per minute, vision per minute, CS at ten,
 * laning-phase advantage flags, solo kills, teleport takedowns, plates — and
 * a handful of top-level counters beside it. Until cache v5 (8 Sep 2026)
 * none of it was read, which is why the review could say "lost fights" but
 * never "bot lost lane" or "Top's teleport never reached a fight".
 *
 * Only finite numbers are copied. A field Riot did not send stays absent:
 * remakes carry no `challenges` at all, some fields are missing on older
 * patches, and a zero would read as a measurement.
 */

export interface ParticipantExtras {
  // ---- challenges ----
  goldPerMinute?: number;
  damagePerMinute?: number;
  /** Share of the team's damage to champions, 0-1. */
  teamDamagePercentage?: number;
  visionScorePerMinute?: number;
  controlWardsPlaced?: number;
  wardTakedowns?: number;
  laneMinionsFirst10Minutes?: number;
  /** Riot's 0/1 flag: ahead in gold and XP at the end of the early laning phase. */
  earlyLaningPhaseGoldExpAdvantage?: number;
  /** Riot's 0/1 flag: ahead in gold and XP at the end of laning phase. */
  laningPhaseGoldExpAdvantage?: number;
  maxCsAdvantageOnLaneOpponent?: number;
  maxLevelLeadLaneOpponent?: number;
  visionScoreAdvantageLaneOpponent?: number;
  soloKills?: number;
  /** Takedowns after teleporting in. Missing on some patches. */
  teleportTakedowns?: number;
  takedownsFirstXMinutes?: number;
  dragonTakedowns?: number;
  baronTakedowns?: number;
  turretPlatesTaken?: number;
  killsNearEnemyTurret?: number;
  // ---- top-level participant ----
  goldEarned?: number;
  champLevel?: number;
  totalTimeSpentDead?: number;
  wardsPlaced?: number;
  wardsKilled?: number;
  turretTakedowns?: number;
  summoner1Id?: number;
  summoner2Id?: number;
}

const CHALLENGE_FIELDS = [
  'goldPerMinute',
  'damagePerMinute',
  'teamDamagePercentage',
  'visionScorePerMinute',
  'controlWardsPlaced',
  'wardTakedowns',
  'laneMinionsFirst10Minutes',
  'earlyLaningPhaseGoldExpAdvantage',
  'laningPhaseGoldExpAdvantage',
  'maxCsAdvantageOnLaneOpponent',
  'maxLevelLeadLaneOpponent',
  'visionScoreAdvantageLaneOpponent',
  'soloKills',
  'teleportTakedowns',
  'takedownsFirstXMinutes',
  'dragonTakedowns',
  'baronTakedowns',
  'turretPlatesTaken',
  'killsNearEnemyTurret'
] as const;

const TOP_LEVEL_FIELDS = [
  'goldEarned',
  'champLevel',
  'totalTimeSpentDead',
  'wardsPlaced',
  'wardsKilled',
  'turretTakedowns',
  'summoner1Id',
  'summoner2Id'
] as const;

/** The slice of a Riot participant this reads; anything else is ignored. */
export interface RiotParticipantLike {
  challenges?: unknown;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function extractExtras(p: RiotParticipantLike): ParticipantExtras {
  const out: ParticipantExtras = {};
  const top = p as Record<string, unknown>;
  const challenges = (p.challenges && typeof p.challenges === 'object' ? p.challenges : {}) as Record<string, unknown>;
  for (const field of CHALLENGE_FIELDS) {
    const value = finite(challenges[field]);
    if (value !== undefined) out[field] = value;
  }
  for (const field of TOP_LEVEL_FIELDS) {
    const value = finite(top[field]);
    if (value !== undefined) out[field] = value;
  }
  return out;
}
