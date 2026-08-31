/**
 * Turning a set of games into the patterns that keep recurring in them.
 *
 * The backend decides *why* each individual game went the way it did and ships
 * that as `lossFactors` / `winFactors`. This counts them, which is a different
 * question: one game is an anecdote, the same factor in most of them is
 * something to work on — or something to keep doing.
 *
 * It counts client-side rather than taking a backend total so the summary stays
 * live under the page's filters — narrowing to one comp re-counts immediately,
 * with no refresh and no extra Riot calls.
 *
 * Wins and losses run through one implementation on purpose. They are the same
 * counting question asked of a different field, and two copies would drift.
 */

import { AnalysisGame, LossCode, OutcomeFactor, WinCode } from '../../models/team.models';

/** Which side of the result a view is about. */
export type Outcome = 'win' | 'loss';

export interface LossPattern {
  code: LossCode | WinCode;
  label: string;
  games: number;
  /** Percentage of the *analysed* games on this side, rounded. */
  share: number;
}

export interface ReviewSummary {
  /** Games carrying objective data, and so the denominator for every share. */
  analysed: number;
  /**
   * Games still on a pre-v2 cache entry. Shown rather than hidden: a summary
   * over 3 of 11 is a different claim from one over all 11.
   */
  pending: number;
  patterns: LossPattern[];
}

/** The factors for whichever side of the result this game landed on. */
export function factorsOf(game: AnalysisGame): OutcomeFactor[] {
  return (game.win ? game.winFactors : game.lossFactors) ?? [];
}

export function summarise(games: AnalysisGame[], outcome: Outcome): ReviewSummary {
  const onSide = games.filter((game) => game.win === (outcome === 'win'));
  const analysed = onSide.filter((game) => game.objectives);
  const counts = new Map<string, { label: string; games: number }>();

  for (const game of analysed) {
    for (const factor of factorsOf(game)) {
      const entry = counts.get(factor.code) ?? { label: factor.label, games: 0 };
      entry.games += 1;
      counts.set(factor.code, entry);
    }
  }

  const patterns = [...counts.entries()]
    .map(([code, entry]) => ({
      code: code as LossCode | WinCode,
      label: entry.label,
      games: entry.games,
      share: Math.round((entry.games / analysed.length) * 100)
    }))
    .sort((a, b) => b.games - a.games || a.label.localeCompare(b.label));

  return { analysed: analysed.length, pending: onSide.length - analysed.length, patterns };
}

/** Kept for readability at the call sites, which read better named than flagged. */
export function summariseLosses(games: AnalysisGame[]): ReviewSummary {
  return summarise(games, 'loss');
}

export function summariseWins(games: AnalysisGame[]): ReviewSummary {
  return summarise(games, 'win');
}

/**
 * What each factor actually means, for a tooltip on its label.
 *
 * Kept to one line each and out of the layout: the bars already take the space,
 * and a permanent paragraph under every row would bury the numbers it explains.
 */
/**
 * What to actually practise, per factor.
 *
 * The factors name what went wrong; these say what to do about it, which is
 * the question a review is for. Written as an action rather than a diagnosis —
 * "lost the map" is already on the screen, and repeating it as advice helps
 * nobody.
 *
 * These are opinions about League, not conclusions from the data, and the UI
 * says so. They live here so that changing one is a deliberate edit in a single
 * place rather than a string buried in a template.
 */
export const FACTOR_ADVICE: Record<string, string> = {
  early_game:
    'Rewatch the first 8 minutes. Where was the jungler when first blood happened, and did anyone have vision on it?',
  lost_fights:
    'Rewatch the first fight you lost. Check who started it, and whether the other four were close enough to follow.',
  dragon_control:
    'Set vision 30 seconds before each dragon spawns. If contesting looks bad, take herald or a tower rather than trading nothing.',
  baron_control:
    'Track their summoners and reset timings past 20 minutes. Do not start baron without knowing where three of them are.',
  map_control:
    'After winning a fight, take towers instead of looking for the next one. Call the objective out loud before the fight ends.',
  threw_lead:
    'Close on objectives, not kills. With a lead, take an inhibitor and reset rather than re-engaging into their base.'
};

export const FACTOR_GUIDE: Record<string, string> = {
  early_game: 'Conceded both first blood and first tower — behind before the map opened up.',
  lost_fights: 'Took clearly fewer kills than the enemy. Lost on fighting, not on rotations.',
  dragon_control: 'Two or more dragons behind. Usually vision and timers rather than the fights themselves.',
  baron_control: 'The enemy took more barons. Often a late-game vision or reset problem.',
  map_control: 'Four or more towers behind. Rotations and side-lane pressure, not teamfights.',
  threw_lead: 'Ahead on objectives past 30 minutes and still lost — a closing problem.',
  won_fights: 'Took clearly more kills than the enemy. The fights were the win condition.',
  early_lead: 'Took both first blood and first tower — ahead before the map opened up.',
  closed_fast: 'Won inside 25 minutes. Never gave the game a chance to turn.',
  comeback: 'Behind on objectives past 30 minutes and still won.'
};

/**
 * One line of the read, split so the number can carry the emphasis.
 *
 * Structured rather than a finished sentence because the figure is the point:
 * as one string it sat at the same weight as everything else on the page and
 * read as prose to skim past.
 */
export interface ReadoutLine {
  /** The figure, set apart and emphasised. */
  strong: string;
  /** The rest of the sentence. */
  rest: string;
  tone: 'win' | 'loss' | 'gap';
}

export type ReviewReadout = ReadoutLine[];

/**
 * Below this many analysed games on a side, a share is not worth a sentence.
 * Three of four losses is 75% and means nothing.
 */
const MIN_FOR_A_CLAIM = 8;

/**
 * The bars in prose: what wins, what loses, and the one place they disagree.
 *
 * Deliberately three short lines and no more. The point is to state the
 * conclusion a reader would otherwise have to assemble from two tabs of
 * percentages — not to narrate every factor, which is what the bars are for.
 */
export function reviewReadout(games: AnalysisGame[], lead: Outcome = 'loss'): ReviewReadout {
  const wins = summarise(games, 'win');
  const losses = summarise(games, 'loss');
  const winLines: ReadoutLine[] = [];
  const lossLines: ReadoutLine[] = [];
  const lines: ReadoutLine[] = [];

  // Number first in each line: it is the finding, and leading with it means the
  // eye lands on the figure rather than on "Your wins come from…" three times.
  if (wins.analysed >= MIN_FOR_A_CLAIM && wins.patterns.length) {
    const also = wins.patterns[1]
      ? ` and ${dropSharedVerb(phrase(wins.patterns[0].code, 'win'), phrase(wins.patterns[1].code, 'win'))}`
      : '';
    winLines.push({
      strong: `${wins.patterns[0].share}% of your wins`,
      rest: `come from ${phrase(wins.patterns[0].code, 'win')}${also}.`,
      tone: 'win'
    });
  }

  if (losses.analysed >= MIN_FOR_A_CLAIM && losses.patterns.length) {
    lossLines.push({
      strong: `${losses.patterns[0].share}% of your losses`,
      rest: `come from ${phrase(losses.patterns[0].code, 'loss')}.`,
      tone: 'loss'
    });
  }

  // The reading no single bar gives: games where the fighting went our way and
  // the map still did not. It separates a conversion problem from a fighting
  // one, and those need opposite work.
  const analysedLosses = games.filter((g) => !g.win && g.objectives);
  const wonFightsLost = analysedLosses.filter((g) => {
    const codes = (g.lossFactors ?? []).map((f) => f.code);
    return codes.includes('map_control') && !codes.includes('lost_fights');
  }).length;

  if (analysedLosses.length >= MIN_FOR_A_CLAIM && wonFightsLost > 0) {
    lossLines.push({
      strong: `${wonFightsLost} of those losses`,
      rest: "weren't about the fights — you lost the map anyway. That's a conversion problem, not a fighting one.",
      tone: 'gap'
    });
  }

  // The same reading from the other end: games taken on the map without the
  // fights going our way. It says the map is a route to winning and not only a
  // way of losing, which is the encouraging half of the same fact.
  const analysedWins = games.filter((g) => g.win && g.objectives);
  const wonWithoutFights = analysedWins.filter((g) => {
    const codes = (g.winFactors ?? []).map((f) => f.code);
    return codes.includes('map_control') && !codes.includes('won_fights');
  }).length;

  if (analysedWins.length >= MIN_FOR_A_CLAIM && wonWithoutFights > 0) {
    winLines.push({
      strong: `${wonWithoutFights} of those wins`,
      rest: "came without winning the fights — you took them on the map. That's a route you can play for deliberately.",
      tone: 'gap'
    });
  }

  // Both sides, always — the sentence the toggle cannot give on its own — but
  // led by the one being asked about. Reading "90% of your losses" first under
  // a heading that says "What keeps working" answers a question nobody asked.
  lines.push(...(lead === 'win' ? [...winLines, ...lossLines] : [...lossLines, ...winLines]));

  return lines;
}

/**
 * Factor labels are past-tense headings — "Lost the map" — which do not fit a
 * sentence frame: lowercasing one gives "you lose to lost the map". These are
 * the same facts as verb phrases. Keyed by side as well as code, because three
 * codes are shared and mean opposite things on each.
 */
const PHRASES: Record<Outcome, Record<string, string>> = {
  win: {
    early_lead: 'winning the early game',
    won_fights: 'winning the fights',
    dragon_control: 'controlling dragons',
    baron_control: 'controlling baron',
    map_control: 'controlling the map',
    closed_fast: 'closing games out early',
    comeback: 'coming back from behind'
  },
  loss: {
    early_game: 'losing the early game',
    lost_fights: 'losing the fights',
    dragon_control: 'conceding dragons',
    baron_control: 'conceding baron',
    map_control: 'losing the map',
    threw_lead: 'losing from ahead'
  }
};

function phrase(code: string, side: Outcome): string {
  return PHRASES[side][code] ?? code.replace(/_/g, ' ');
}

/**
 * "controlling the map and controlling baron" -> "controlling the map and baron".
 *
 * Both phrases are verb-first by construction, so when the verb repeats the
 * second one can shed it and the sentence stops sounding like a form.
 */
function dropSharedVerb(first: string, second: string): string {
  const verb = first.split(' ')[0];
  return second.startsWith(`${verb} `) ? second.slice(verb.length + 1) : second;
}

/** Bucket id for games that matched no comp. Not a comp id, so it cannot collide. */
export const OFF_BOOK = '__offbook';

/** One comp's games on a given side of the result, and what they have in common. */
export interface LossGroup {
  compId: string;
  name: string;
  /** Only games carrying objective data — the ones that can be read. */
  losses: AnalysisGame[];
  /** Games under this comp still waiting on a backfill. */
  pending: number;
  topFactor: string | null;
}

/**
 * The one thing that shows up most across a comp's games, for the collapsed
 * header. Returns null below two occurrences: a factor appearing once is not a
 * pattern, and billing it as this comp's habit would be reading tea leaves.
 */
export function commonestFactor(games: AnalysisGame[]): string | null {
  const counts = new Map<string, number>();
  for (const game of games) {
    for (const factor of factorsOf(game)) {
      counts.set(factor.label, (counts.get(factor.label) ?? 0) + 1);
    }
  }

  let best: string | null = null;
  let bestCount = 1;
  for (const [label, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && label < best)) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

/** `1847` -> `30:47`, because a loss at 22 minutes reads differently to one at 41. */
export function formatDuration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return '--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
