import { ChampionTraits, Role } from '../../models/team.models';
import { CompAvailability, normalizeChampion } from './draft.util';

/**
 * What to pick next, answered from our own record rather than a win rate.
 *
 * The number every draft tool shows — "this pick takes you to 52%" — comes from
 * millions of matches of champion-pair data. Ours would come from 159 games, so
 * a synthesised percentage here would be noise with a decimal point, which
 * mid-draft is worse than showing nothing.
 *
 * What we can say honestly: which of our own comps a champion keeps reachable,
 * and how those comps have actually gone. Small samples, but they are ours, and
 * the game count travels with every number so nobody over-reads a 100% from two
 * games.
 */

/** A comp a candidate champion would keep alive, with its real record. */
export interface CompFit {
  readonly id: string;
  readonly name: string;
  readonly winRate?: number;
  readonly games?: number;
}

export interface ChampionSuggestion {
  readonly champion: string;
  /** Playable comps this champion belongs to, best record first. */
  readonly comps: readonly CompFit[];
  /** Games behind the whole suggestion — the honesty check on the rest. */
  readonly games: number;
  /** Best win rate among those comps, absent when none has been played. */
  readonly winRate?: number;
  /** Games-weighted mean across those comps — the figure worth reading. */
  readonly projected?: number;
}

/**
 * Rank champions by the comps they keep reachable.
 *
 * Ordering is deliberate and not by win rate alone: a comp with one win is not
 * better than one at 83% over six games. Champions are compared on their best
 * comp's win rate, but only among comps with any record at all; the rest fall
 * behind, ordered by how many comps they serve.
 */
export function suggestForLane(
  lane: Role,
  candidates: readonly string[],
  comps: readonly CompAvailability[],
  championInComp: (comp: CompAvailability, lane: Role) => string
): ChampionSuggestion[] {
  const playable = comps.filter((c) => c.playable);
  const byChampion = new Map<string, CompFit[]>();

  for (const comp of playable) {
    const champion = championInComp(comp, lane);
    if (!champion) continue;
    const key = normalizeChampion(champion);
    const fits = byChampion.get(key) ?? [];
    fits.push({ id: comp.id, name: comp.name, winRate: comp.winRate, games: comp.games });
    byChampion.set(key, fits);
  }

  const out: ChampionSuggestion[] = [];
  for (const champion of candidates) {
    const fits = byChampion.get(normalizeChampion(champion));
    if (!fits?.length) continue;

    const ranked = [...fits].sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1));
    const games = fits.reduce((sum, f) => sum + (f.games ?? 0), 0);
    const played = ranked.filter((f) => (f.games ?? 0) > 0);
    out.push({
      champion,
      comps: ranked,
      games,
      winRate: played.length ? played[0].winRate : undefined,
      projected: weightedWinRate(ranked)
    });
  }

  return out.sort((a, b) => {
    const aPlayed = a.winRate !== undefined;
    const bPlayed = b.winRate !== undefined;
    if (aPlayed !== bPlayed) return aPlayed ? -1 : 1;

    const byConfidence = confidenceScore(b) - confidenceScore(a);
    if (Math.abs(byConfidence) > 0.0001) return byConfidence;
    if (a.comps.length !== b.comps.length) return b.comps.length - a.comps.length;
    return a.champion.localeCompare(b.champion);
  });
}

/** 95% confidence, the usual choice for a lower bound like this. */
const Z = 1.96;

/**
 * The win rate this record can actually support, not the one it happens to show.
 *
 * The list used to sort on the best comp's raw percentage while *displaying*
 * the games-weighted projection, so it read as unsorted: Shen at 100% from one
 * game sat above Mordekaiser at 57% from fourteen, and neither the order nor
 * the numbers explained the other.
 *
 * Sorting on the same figure the row shows fixes the contradiction. Ranking by
 * the *lower bound* of that figure fixes the ordering: the Wilson interval asks
 * "how low could this rate plausibly be", so one win from one game scores 21
 * while eight from fourteen scores 33. A plain average cannot separate them,
 * and simply shrinking toward even is not enough — a single perfect game still
 * shrinks to 60%, which beats a genuine 57%.
 *
 * This is the same mistake the panel exists to stop the team making: a small
 * sample looking like a strong one.
 */
export function confidenceScore(suggestion: ChampionSuggestion): number {
  if (suggestion.projected === undefined) return 0;

  const n = Math.max(suggestion.games, 0);
  if (n <= 0) return 0;

  const p = Math.min(Math.max(suggestion.projected / 100, 0), 1);
  const denominator = 1 + (Z * Z) / n;
  const centre = p + (Z * Z) / (2 * n);
  const margin = Z * Math.sqrt((p * (1 - p) + (Z * Z) / (4 * n)) / n);
  return ((centre - margin) / denominator) * 100;
}


/**
 * A games-weighted mean of some comps' win rates.
 *
 * This is *not* the number a draft tool shows. Theirs models champion-versus-
 * champion outcomes over millions of games; this is simply how the comps in
 * question have gone for us. A comp with six games counts six times as much as
 * one with a single game, and comps never played are left out entirely rather
 * than dragged in at zero.
 *
 * Undefined when nothing on the list has been played — which is the honest
 * answer, and better than a confident-looking 0%.
 */
export function weightedWinRate(comps: readonly CompFit[]): number | undefined {
  const played = comps.filter((c) => (c.games ?? 0) > 0 && c.winRate !== undefined);
  if (!played.length) return undefined;
  const games = played.reduce((sum, c) => sum + (c.games ?? 0), 0);
  const total = played.reduce((sum, c) => sum + c.winRate! * (c.games ?? 0), 0);
  return Math.round(total / games);
}

/**
 * Games a projection needs behind it before its *movement* is worth showing.
 *
 * The projection itself is always honest — it is the record, and it carries its
 * game count. The swing is a different claim: "+25" reads as this pick being
 * worth twenty-five points, and off two games it is worth nothing of the sort.
 * Five is where a comp stops being an anecdote; below it the number is shown
 * without the arrow rather than hidden, because the record is still the record.
 */
export const MIN_SWING_GAMES = 5;

/**
 * How far a pick would move us, or nothing when the sample cannot carry it.
 *
 * Deliberately stricter than the projection it derives from: a difference of
 * two uncertain numbers is more uncertain than either, and this one is rendered
 * as a signed chip that invites being read as a fact.
 */
export function swingOf(
  projected: number | undefined,
  standing: number | undefined,
  games: number
): number | undefined {
  if (projected === undefined || standing === undefined) return undefined;
  if (games < MIN_SWING_GAMES) return undefined;
  const delta = projected - standing;
  return delta === 0 ? undefined : delta;
}

/** Where we stand now: every comp still reachable, weighted by games played. */
export function currentStanding(comps: readonly CompAvailability[]): { rate?: number; games: number } {
  const fits = comps
    .filter((c) => c.playable)
    .map((c) => ({ id: c.id, name: c.name, winRate: c.winRate, games: c.games }));
  return {
    rate: weightedWinRate(fits),
    games: fits.reduce((sum, c) => sum + (c.games ?? 0), 0)
  };
}

/**
 * What the picks so far are short of.
 *
 * Deterministic — read straight off champion traits, with no statistics behind
 * it, so it says the same thing on the first game as on the hundredth and has
 * no sample size to caveat.
 */
export interface CompGaps {
  readonly physical: number;
  readonly magic: number;
  readonly frontline: number;
  readonly cc: number;
  readonly picked: number;
  /** Plain sentences, most worth acting on first. Empty when nothing is amiss. */
  readonly missing: readonly string[];
}

/** Durability at 2 or more is a body the enemy has to go through. */
const FRONTLINE_AT = 2;
/** Below this the comp cannot reliably catch anyone. */
const THIN_CC = 3;
/** Four of five on one damage type is trivially itemised against. */
const LOPSIDED_AT = 4;

export function compGaps(traits: readonly ChampionTraits[]): CompGaps {
  const physical = traits.filter((t) => t.damage === 'physical').length;
  const magic = traits.filter((t) => t.damage === 'magic').length;
  const frontline = traits.filter((t) => t.durability >= FRONTLINE_AT).length;
  const cc = traits.reduce((sum, t) => sum + t.cc, 0);
  const picked = traits.length;

  const missing: string[] = [];

  // Only worth saying once there is enough of a comp to be short of anything.
  if (picked >= 3) {
    if (!frontline) missing.push('No frontline — nobody to walk in first');
    if (cc < THIN_CC) missing.push('Little crowd control — hard to catch anyone');
  }
  if (picked >= 4) {
    if (physical >= LOPSIDED_AT) missing.push(`${physical} of ${picked} AD — one item line answers it`);
    if (magic >= LOPSIDED_AT) missing.push(`${magic} of ${picked} AP — one item line answers it`);
  }

  return { physical, magic, frontline, cc, picked, missing };
}

/**
 * What the enemy draft is telling us, read off champion traits.
 *
 * Deterministic, like the gaps: no statistics, so it needs no sample size and
 * says the same thing on the first game as on the hundredth. It is also the
 * only enemy-aware thing here — the win rates above are blind to their draft,
 * because "how do we do into Malphite" would come from about three games.
 *
 * Shaped as { strong, rest, tone } so it renders in the same callout the Review
 * page already uses: a coloured lead phrase, then the consequence.
 */
export interface DraftRead {
  readonly strong: string;
  readonly rest: string;
  readonly tone: 'win' | 'loss' | 'gap';
}

/** Enough of a draft to read anything from. */
const READABLE_AT = 3;
/** Four of five on one damage type is a single item line to answer. */
const ONE_SIDED_AT = 4;
/** Below this a comp cannot reliably catch anybody. */
const LOW_CC = 3;
/** At or above this, walking at them is the losing move. */
const HEAVY_CC = 8;

export function enemyRead(traits: readonly ChampionTraits[]): DraftRead[] {
  const seen = traits.length;
  if (seen < READABLE_AT) return [];

  const physical = traits.filter((t) => t.damage === 'physical').length;
  const magic = traits.filter((t) => t.damage === 'magic').length;
  const melee = traits.filter((t) => t.attack === 'melee').length;
  const frontline = traits.filter((t) => t.durability >= FRONTLINE_AT).length;
  const cc = traits.reduce((sum, t) => sum + t.cc, 0);

  const out: DraftRead[] = [];

  // Their weaknesses first — those are what a pick can still exploit.
  if (physical >= ONE_SIDED_AT) {
    out.push({ strong: `They're ${physical} AD`, rest: 'armour stacks well here.', tone: 'win' });
  }
  if (magic >= ONE_SIDED_AT) {
    out.push({ strong: `They're ${magic} AP`, rest: 'magic resist answers most of it.', tone: 'win' });
  }
  if (!frontline) {
    out.push({
      strong: 'They have no frontline',
      rest: 'a dive comp gets straight to their carries.',
      tone: 'win'
    });
  }
  if (melee === seen) {
    out.push({ strong: 'Their comp is all melee', rest: 'poke has a free lane.', tone: 'win' });
  }
  if (cc < LOW_CC) {
    out.push({
      strong: 'They have little crowd control',
      rest: 'a diving carry survives going in.',
      tone: 'win'
    });
  }

  // Then what they threaten, which changes what we should avoid picking.
  if (cc >= HEAVY_CC) {
    out.push({
      strong: 'They have heavy crowd control',
      rest: 'anything walking at them needs a way back out.',
      tone: 'loss'
    });
  }
  if (frontline >= 3) {
    out.push({
      strong: `${frontline} of their ${seen} are frontline`,
      rest: 'percent-health damage gets through where flat damage will not.',
      tone: 'loss'
    });
  }

  return out;
}

/**
 * Which of our still-playable comps a champion belongs to.
 *
 * Written for ban time, where the useful question is the reverse of pick time:
 * not "does this help us" but "does banning it cost us". A ban is permanent for
 * the series under fearless, so banning a champion three of our comps depend on
 * spends one of their bans for them.
 *
 * Deliberately not a ban *recommendation*. Recommending what to ban needs to
 * know what the opponent plays, and nothing in this app knows that yet — a
 * suggestion built from our own comps alone would be a confident-looking guess
 * about somebody else's draft.
 */
export function compsUsing(
  champion: string,
  comps: readonly CompAvailability[],
  championInComp: (comp: CompAvailability, lane: Role) => string,
  lanes: readonly Role[]
): string[] {
  const wanted = normalizeChampion(champion);
  if (!wanted) return [];

  return comps
    .filter((comp) => comp.playable)
    .filter((comp) => lanes.some((lane) => normalizeChampion(championInComp(comp, lane)) === wanted))
    .map((comp) => comp.name);
}

/** A champion worth banning, and why. */
export interface BanSuggestion {
  readonly champion: string;
  /** Which of their seats this champion beat in lane, e.g. ["Mid", "Top"]. */
  readonly beats: readonly string[];
  /** Comps of ours it would take away with it. */
  readonly costsUs: readonly string[];
}

/**
 * What to ban, from what actually beats the people we are playing.
 *
 * This is the version that needed the opponent roster. Enrichment reports, for
 * each of their players, the champions that beat them *in their own lane in
 * games they lost* — so it is a record of that player losing to that champion,
 * not a guess from the meta. A champion that shows up against two of their
 * seats is worth more than one that shows up against a single seat, which is
 * the ordering here.
 *
 * The cost of the ban travels with it. A ban lasts the whole series under
 * fearless, so one that also takes three of our comps away may be the wrong
 * trade even when it is a good counter, and that judgement belongs to whoever
 * is drafting rather than to a sort order.
 */
export function banSuggestions(
  roster: readonly { role: string; bans?: readonly string[] }[],
  isAvailable: (champion: string) => boolean,
  costOf: (champion: string) => string[]
): BanSuggestion[] {
  const beatsBy = new Map<string, { champion: string; roles: string[] }>();

  for (const player of roster) {
    for (const champion of player.bans ?? []) {
      if (!champion || !isAvailable(champion)) continue;
      const key = normalizeChampion(champion);
      const entry = beatsBy.get(key) ?? { champion, roles: [] };
      // One player can lose to the same champion repeatedly; the seat is the
      // unit here, not the game.
      if (!entry.roles.includes(player.role)) entry.roles.push(player.role);
      beatsBy.set(key, entry);
    }
  }

  return [...beatsBy.values()]
    .map((entry) => ({
      champion: entry.champion,
      beats: entry.roles,
      costsUs: costOf(entry.champion)
    }))
    .sort(
      (a, b) =>
        b.beats.length - a.beats.length ||
        a.costsUs.length - b.costsUs.length ||
        a.champion.localeCompare(b.champion)
    );
}
