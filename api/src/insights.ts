/**
 * Turning a player's averages into the strengths, weaknesses and archetype on
 * their card.
 *
 * These are thresholds, and thresholds drift: someone nudges a number and the
 * cards quietly reclassify half the roster. Keeping them here with tests means
 * a change to what counts as "efficient farming" has to be deliberate.
 */

export type KnownRole = 'Top' | 'Jungle' | 'Mid' | 'ADC' | 'Support';

export interface PlayerAverages {
  games: number;
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
}

/** At most this many of each are shown, so the card stays readable. */
export const INSIGHT_LIMIT = 3;

const WINNING_RECORD = 50;
const STRONG_KDA = 3;
const EFFICIENT_CS_PER_MIN = 6.5;
const HIGH_DEATHS = 5;

/**
 * Each of the first three is a two-sided judgement — the same measure is either
 * a strength or a weakness, never neither — so a card always has something to
 * say even about a player with no standout numbers.
 */
export function describePlayer(
  stats: PlayerAverages,
  topChampions: string[]
): { strengths: string[]; weaknesses: string[] } {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (stats.winRate >= WINNING_RECORD) {
    strengths.push(`Positive win rate over last ${stats.games} games (${stats.winRate}%)`);
  } else {
    weaknesses.push(`Below 50% win rate over last ${stats.games} games (${stats.winRate}%)`);
  }

  if (stats.avgKda >= STRONG_KDA) {
    strengths.push(`Strong average KDA (${stats.avgKda.toFixed(1)})`);
  } else {
    weaknesses.push(`Average KDA needs work (${stats.avgKda.toFixed(1)})`);
  }

  if (stats.avgCsPerMin >= EFFICIENT_CS_PER_MIN) {
    strengths.push(`Efficient farming (${stats.avgCsPerMin.toFixed(1)} CS/min)`);
  } else {
    weaknesses.push(`Farming pace below target (${stats.avgCsPerMin.toFixed(1)} CS/min)`);
  }

  if (topChampions.length > 0) {
    strengths.push(`Consistent champion pool led by ${topChampions[0]}`);
  }
  if (stats.avgDeaths >= HIGH_DEATHS) {
    weaknesses.push(`High average deaths (${stats.avgDeaths.toFixed(1)}) — focus on positioning`);
  }

  return {
    strengths: strengths.slice(0, INSIGHT_LIMIT),
    weaknesses: weaknesses.slice(0, INSIGHT_LIMIT)
  };
}

/**
 * A GPI-style archetype from real aggregates, ordered by specificity: the first
 * rule that fits wins, so the narrow classifications are checked before the
 * broad ones and nobody who is clearly a Split Pusher comes back as a Carry.
 */
export function classifyArchetype(stats: PlayerAverages, role: KnownRole): string {
  if (role === 'Support' || (stats.avgVisionScore >= 40 && stats.avgDamageShare < 0.18)) {
    return 'Utility';
  }
  if (stats.avgTankShare >= 0.28 && stats.avgDamageShare < 0.22) {
    return 'Tank / Frontline';
  }
  if (stats.avgBuildingDamage >= 2200 && stats.avgKillParticipation < 0.5) {
    return 'Split Pusher';
  }
  if (stats.avgDamageShare >= 0.28 && stats.avgKillParticipation >= 0.5) {
    return 'Carry';
  }
  if (stats.avgCsPerMin >= 7.5) {
    return 'Farm-focused';
  }
  if (stats.avgAssists >= stats.avgKills * 1.3 && stats.avgAssists >= 5) {
    return 'Playmaker';
  }
  if (stats.avgKda >= 4) {
    return 'Duelist';
  }
  // Nothing stood out, which is itself worth saying rather than guessing.
  return `${role} Generalist`;
}
