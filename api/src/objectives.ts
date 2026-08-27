/**
 * Why a game was lost, read from the objectives both teams took.
 *
 * The comp analysis already answers "which comps win". It cannot answer "what
 * went wrong", because a scoreline says nothing about *where* the game was
 * lost: a 20-minute stomp and a 40-minute throw both land in the loss column.
 * The objective deltas separate them.
 *
 * Like `insights.ts`, these are thresholds, and thresholds drift. They live
 * here with tests so that changing what counts as "conceded dragon control"
 * has to be deliberate.
 */

export interface TeamObjectives {
  firstBlood: boolean;
  firstTower: boolean;
  dragons: number;
  barons: number;
  heralds: number;
  /** Voidgrubs. Absent on matches played before they existed, hence 0. */
  grubs: number;
  towers: number;
  inhibitors: number;
}

export interface GameObjectives {
  ours: TeamObjectives;
  theirs: TeamObjectives;
}

/** A single reason a game was lost, with the numbers that justify it. */
export interface LossFactor {
  /** Stable id, so the summary can count occurrences without matching prose. */
  code: LossCode;
  label: string;
  detail: string;
}

export type LossCode =
  | 'early_game'
  | 'dragon_control'
  | 'baron_control'
  | 'map_control'
  | 'threw_lead';

/** Dragons behind before it is worth mentioning — one is variance, two is a pattern. */
const DRAGON_DEFICIT = 2;
/** Towers behind that indicates the map was genuinely lost, not just conceded late. */
const TOWER_DEFICIT = 4;
/** Past this, a loss is a long game that got away rather than an early collapse. */
const LONG_GAME_SECONDS = 30 * 60;

/**
 * Ranked reasons a loss happened, most explanatory first.
 *
 * Order is deliberate and not by severity: it walks the game forward in time,
 * so the earliest thing that went wrong is read first. A team that lost the
 * early game *and* the barons is better served by "you lost the early game"
 * than by the last objective to fall.
 *
 * Returns an empty list for a win, and for a loss with no objective story to
 * tell — which is itself informative, and the caller says so rather than
 * inventing a reason.
 */
export function describeLoss(
  objectives: GameObjectives,
  durationSec: number
): LossFactor[] {
  const { ours, theirs } = objectives;
  const factors: LossFactor[] = [];

  if (!ours.firstBlood && !ours.firstTower) {
    factors.push({
      code: 'early_game',
      label: 'Lost the early game',
      detail: 'Conceded both first blood and first tower'
    });
  }

  const dragonGap = theirs.dragons - ours.dragons;
  if (dragonGap >= DRAGON_DEFICIT) {
    factors.push({
      code: 'dragon_control',
      label: 'Conceded dragon control',
      detail: `Dragons ${ours.dragons}-${theirs.dragons}`
    });
  }

  if (theirs.barons > ours.barons) {
    factors.push({
      code: 'baron_control',
      label: 'Lost baron control',
      detail: `Barons ${ours.barons}-${theirs.barons}`
    });
  }

  const towerGap = theirs.towers - ours.towers;
  if (towerGap >= TOWER_DEFICIT) {
    factors.push({
      code: 'map_control',
      label: 'Lost the map',
      detail: `Towers ${ours.towers}-${theirs.towers}`
    });
  }

  // The most useful case, and the one the win rate hides completely: ahead on
  // the map and still lost. Only claimed for long games, because being "ahead"
  // on objectives in a short loss usually means nobody had taken any yet.
  const aheadOnObjectives =
    ours.dragons + ours.barons > theirs.dragons + theirs.barons && ours.towers >= theirs.towers;
  if (aheadOnObjectives && durationSec >= LONG_GAME_SECONDS) {
    factors.push({
      code: 'threw_lead',
      label: 'Lost from ahead',
      detail: `Led on objectives at ${Math.round(durationSec / 60)} minutes and still lost`
    });
  }

  return factors;
}

/** How often one reason appeared across a set of losses. */
export interface LossPattern {
  code: LossCode;
  label: string;
  games: number;
  /** Percentage of the losses examined, rounded. */
  share: number;
}

/**
 * The headline the per-game view cannot give: one loss is an anecdote, the same
 * factor in most of them is a problem to work on. Sorted by frequency so the
 * recurring failure is read first.
 */
export function summariseLosses(
  losses: { objectives: GameObjectives; durationSec: number }[]
): LossPattern[] {
  if (losses.length === 0) return [];

  const counts = new Map<LossCode, { label: string; games: number }>();
  for (const loss of losses) {
    for (const factor of describeLoss(loss.objectives, loss.durationSec)) {
      const entry = counts.get(factor.code) ?? { label: factor.label, games: 0 };
      entry.games += 1;
      counts.set(factor.code, entry);
    }
  }

  return [...counts.entries()]
    .map(([code, entry]) => ({
      code,
      label: entry.label,
      games: entry.games,
      share: Math.round((entry.games / losses.length) * 100)
    }))
    .sort((a, b) => b.games - a.games || a.label.localeCompare(b.label));
}
