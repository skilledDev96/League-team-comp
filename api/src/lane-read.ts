/**
 * Which lanes we won and lost, and what each player did, per game.
 *
 * The objective factors say a game was lost on dragons or in the fights; they
 * cannot say it was lost in bot lane at eight minutes. This pairs each of our
 * players with the enemy in the same seat and reads the laning phase off the
 * per-participant numbers cache v5 keeps — gold and damage per minute, CS at
 * ten, vision per minute, Riot's own laning-phase flags — and gives a verdict
 * with the numbers behind it. A second read collects what a player did that
 * a plan can act on: wards, solo kills, time dead, whether Teleport joined a
 * fight.
 *
 * Pure. Absent numbers stay absent: a scrim from a replay has totals but no
 * per-minute figures, a remake has nothing, and neither is a zero.
 */
import { ParticipantExtras } from './participant-extras';

export type LaneRole = 'Top' | 'Jungle' | 'Mid' | 'ADC' | 'Support';

export interface LaneParticipant {
  puuid: string;
  teamId: number;
  teamPosition: string;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damage: number;
  visionScore?: number;
  extras?: ParticipantExtras;
}

export type LaneVerdict = 'won' | 'even' | 'lost' | 'unknown';

export interface LaneRead {
  position: LaneRole;
  theirChampion: string;
  verdict: LaneVerdict;
  /** Ours minus theirs, each only when both sides carry the number. */
  csAt10Diff?: number;
  goldPerMinDiff?: number;
  damagePerMinDiff?: number;
  visionPerMinDiff?: number;
  /** Our largest level lead over the lane opponent, from Riot. */
  levelLead?: number;
  earlyLaneAdvantage?: boolean;
  laneAdvantage?: boolean;
}

export interface PlayerFacts {
  goldPerMin?: number;
  visionPerMin?: number;
  controlWards?: number;
  wardTakedowns?: number;
  soloKills?: number;
  hasTeleport?: boolean;
  /** Only present when the player took Teleport, so a non-TP top never dilutes the mean. */
  tpTakedowns?: number;
  timeDeadSec?: number;
  csAt10?: number;
  plates?: number;
  dragonTakedowns?: number;
  baronTakedowns?: number;
  killsNearEnemyTurret?: number;
  /** Share of the team's damage to champions, 0-1, from Riot. */
  damageShare?: number;
}

export const POSITION_ROLE: Record<string, LaneRole> = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MIDDLE: 'Mid',
  BOTTOM: 'ADC',
  UTILITY: 'Support'
};

/** Riot's summoner spell id for Teleport. */
export const TELEPORT_SUMMONER_ID = 12;

/**
 * Gold per minute that separates a won lane from variance: about 900 gold
 * over a thirty-minute game, an item component either way.
 */
export const GOLD_PER_MIN_EDGE = 30;
/** CS at ten minutes; a wave and a bit, which is a real lead, not a last-hit. */
export const CS_AT_10_EDGE = 8;
/** Vision per minute for the two roles whose lane is not a farm. */
export const VISION_PER_MIN_EDGE = 0.3;
/** Two of the three terms have to agree before a lane is called. */
export const VERDICT_EDGE = 2;
/** Below ten minutes there is no laning phase to read. */
export const MIN_DURATION_SEC = 600;

function diff(a: number | undefined, b: number | undefined): number | undefined {
  return a !== undefined && b !== undefined ? Math.round((a - b) * 10) / 10 : undefined;
}

function perMin(total: number | undefined, durationSec: number): number | undefined {
  return total !== undefined && durationSec > 0 ? total / (durationSec / 60) : undefined;
}

function goldPerMin(p: LaneParticipant, durationSec: number): number | undefined {
  return p.extras?.goldPerMinute ?? perMin(p.extras?.goldEarned, durationSec);
}

function visionPerMin(p: LaneParticipant, durationSec: number): number | undefined {
  return p.extras?.visionScorePerMinute ?? perMin(p.visionScore, durationSec);
}

function sign(value: number | undefined, edge: number): number {
  if (value === undefined) return 0;
  if (value >= edge) return 1;
  if (value <= -edge) return -1;
  return 0;
}

/** One lane: ours against theirs in the same seat. */
export function readLane(ours: LaneParticipant, theirs: LaneParticipant | undefined, durationSec: number): LaneRead | null {
  const position = POSITION_ROLE[ours.teamPosition];
  if (!position) return null;
  const base: LaneRead = { position, theirChampion: theirs?.championName ?? '', verdict: 'unknown' };
  if (!theirs) return base;

  const goldDiff = diff(goldPerMin(ours, durationSec), goldPerMin(theirs, durationSec));
  const damageDiff = diff(ours.extras?.damagePerMinute, theirs.extras?.damagePerMinute);
  const visionDiff = diff(visionPerMin(ours, durationSec), visionPerMin(theirs, durationSec));
  const longEnough = durationSec >= MIN_DURATION_SEC;
  const csDiff = longEnough ? diff(ours.extras?.laneMinionsFirst10Minutes, theirs.extras?.laneMinionsFirst10Minutes) : undefined;
  const levelLead = ours.extras?.maxLevelLeadLaneOpponent;
  const early = ours.extras?.earlyLaningPhaseGoldExpAdvantage;
  const laning = ours.extras?.laningPhaseGoldExpAdvantage;
  const theirLaning = theirs.extras?.laningPhaseGoldExpAdvantage;

  const read: LaneRead = {
    ...base,
    ...(csDiff !== undefined ? { csAt10Diff: csDiff } : {}),
    ...(goldDiff !== undefined ? { goldPerMinDiff: goldDiff } : {}),
    ...(damageDiff !== undefined ? { damagePerMinDiff: damageDiff } : {}),
    ...(visionDiff !== undefined ? { visionPerMinDiff: visionDiff } : {}),
    ...(levelLead !== undefined ? { levelLead } : {}),
    ...(early !== undefined ? { earlyLaneAdvantage: early === 1 } : {}),
    ...(laning !== undefined ? { laneAdvantage: laning === 1 } : {})
  };

  // A verdict needs Riot's per-minute figures on both sides. A replay has
  // end-of-game totals only, which gave every replay lane an 'even' that
  // diluted the shares (8 Sep 2026); its diffs are still reported.
  const perMinute = ours.extras?.goldPerMinute !== undefined && theirs.extras?.goldPerMinute !== undefined;
  if (goldDiff === undefined || !longEnough || !perMinute) return read;

  const laneTerm = position === 'Jungle' || position === 'Support' ? sign(visionDiff, VISION_PER_MIN_EDGE) : sign(csDiff, CS_AT_10_EDGE);
  const flagTerm = laning === 1 ? 1 : theirLaning === 1 ? -1 : 0;
  const score = sign(goldDiff, GOLD_PER_MIN_EDGE) + laneTerm + flagTerm;
  read.verdict = score >= VERDICT_EDGE ? 'won' : score <= -VERDICT_EDGE ? 'lost' : 'even';
  return read;
}

/** Every one of ours with a seat, keyed by puuid. */
export function readLanes(
  participants: readonly LaneParticipant[],
  ourTeamId: number,
  durationSec: number
): Map<string, LaneRead> {
  const out = new Map<string, LaneRead>();
  for (const p of participants) {
    if (p.teamId !== ourTeamId) continue;
    const theirs = p.teamPosition
      ? participants.find((q) => q.teamId !== ourTeamId && q.teamPosition === p.teamPosition)
      : undefined;
    const read = readLane(p, theirs, durationSec);
    if (read) out.set(p.puuid, read);
  }
  return out;
}

export function playerFacts(p: LaneParticipant, durationSec: number): PlayerFacts {
  const x = p.extras ?? {};
  const hasTeleport = x.summoner1Id === TELEPORT_SUMMONER_ID || x.summoner2Id === TELEPORT_SUMMONER_ID;
  const gold = goldPerMin(p, durationSec);
  const vision = visionPerMin(p, durationSec);
  const facts: PlayerFacts = {
    ...(gold !== undefined ? { goldPerMin: Math.round(gold) } : {}),
    ...(vision !== undefined ? { visionPerMin: Math.round(vision * 100) / 100 } : {}),
    ...(x.controlWardsPlaced !== undefined ? { controlWards: x.controlWardsPlaced } : {}),
    ...(x.wardTakedowns !== undefined ? { wardTakedowns: x.wardTakedowns } : {}),
    ...(x.soloKills !== undefined ? { soloKills: x.soloKills } : {}),
    ...(x.summoner1Id !== undefined || x.summoner2Id !== undefined ? { hasTeleport } : {}),
    ...(hasTeleport && x.teleportTakedowns !== undefined ? { tpTakedowns: x.teleportTakedowns } : {}),
    ...(x.totalTimeSpentDead !== undefined ? { timeDeadSec: x.totalTimeSpentDead } : {}),
    ...(x.laneMinionsFirst10Minutes !== undefined ? { csAt10: x.laneMinionsFirst10Minutes } : {}),
    ...(x.turretPlatesTaken !== undefined ? { plates: x.turretPlatesTaken } : {}),
    ...(x.dragonTakedowns !== undefined ? { dragonTakedowns: x.dragonTakedowns } : {}),
    ...(x.baronTakedowns !== undefined ? { baronTakedowns: x.baronTakedowns } : {}),
    ...(x.killsNearEnemyTurret !== undefined ? { killsNearEnemyTurret: x.killsNearEnemyTurret } : {}),
    ...(x.teamDamagePercentage !== undefined ? { damageShare: Math.round(x.teamDamagePercentage * 1000) / 1000 } : {})
  };
  return facts;
}
