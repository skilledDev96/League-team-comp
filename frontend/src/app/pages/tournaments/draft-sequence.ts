import { Role, ROLES } from '../../models/team.models';
import { primaryLane } from '../../core/champion-lanes';

/**
 * The competitive draft, step by step.
 *
 * Twenty steps: three bans each, six picks, two more bans each, four picks.
 * Blue is whoever has first pick, which is decided before the draft starts —
 * in this league by a 1v1 for game 1 and by the previous loser afterwards.
 *
 * The order is the only part of drafting that is genuinely fixed, which is why
 * it lives here as data rather than as branching in a component: every question
 * the screen asks ("whose turn", "ban or pick", "are we done") is a lookup.
 */

export type DraftTeam = 'blue' | 'red';
export type DraftAction = 'ban' | 'pick';

export interface DraftStep {
  readonly team: DraftTeam;
  readonly action: DraftAction;
  /** Which ban or pick this is for that team — 1-based, for labelling. */
  readonly ordinal: number;
}

function steps(): DraftStep[] {
  const out: DraftStep[] = [];
  const bans = { blue: 0, red: 0 };
  const picks = { blue: 0, red: 0 };
  const ban = (team: DraftTeam) => out.push({ team, action: 'ban', ordinal: ++bans[team] });
  const pick = (team: DraftTeam) => out.push({ team, action: 'pick', ordinal: ++picks[team] });

  // Ban phase 1 — alternating, blue first.
  ban('blue'); ban('red'); ban('blue'); ban('red'); ban('blue'); ban('red');
  // Pick phase 1 — blue takes one, red takes two, blue takes two, red takes one.
  pick('blue'); pick('red'); pick('red'); pick('blue'); pick('blue'); pick('red');
  // Ban phase 2 — red bans first this time.
  ban('red'); ban('blue'); ban('red'); ban('blue');
  // Pick phase 2 — red takes one, blue takes two, red takes one.
  pick('red'); pick('blue'); pick('blue'); pick('red');
  return out;
}

export const DRAFT_SEQUENCE: readonly DraftStep[] = Object.freeze(steps());

export const DRAFT_LENGTH = DRAFT_SEQUENCE.length;

/** The step at this position, or null once the draft is over. */
export function stepAt(position: number): DraftStep | null {
  if (!Number.isInteger(position) || position < 0) return DRAFT_SEQUENCE[0];
  return DRAFT_SEQUENCE[position] ?? null;
}

export function isComplete(position: number): boolean {
  return position >= DRAFT_LENGTH;
}

/**
 * How far through the draft a position is, as a percentage.
 * Clamped, because a game saved before the sequence existed has no position.
 */
export function draftProgress(position: number): number {
  const clamped = Math.max(0, Math.min(position, DRAFT_LENGTH));
  return Math.round((clamped / DRAFT_LENGTH) * 100);
}

/**
 * Which seat a pick should land in.
 *
 * A real draft picks champions in draft order, not in role order — the fourth
 * pick is whatever the enemy just forced, and which lane it plays is often
 * decided afterwards. So the seat is proposed from where the champion is
 * actually played, and only falls back to the first free one when that lane is
 * taken or the champion has no data.
 *
 * Returns null only when all five seats are full.
 */
export function seatFor(champion: string, seats: readonly string[]): Role | null {
  const free = (i: number) => !seats[i];

  const lane = primaryLane(champion);
  if (lane) {
    const at = ROLES.indexOf(lane);
    if (at >= 0 && free(at)) return lane;
  }

  const firstFree = ROLES.findIndex((_, i) => free(i));
  return firstFree >= 0 ? ROLES[firstFree] : null;
}

/**
 * Which team made each ban, in the order the bans were stored.
 *
 * Bans live as one flat list — under fearless a ban is a ban whoever made it —
 * but the sequence appends them in turn order, so the nth ban's team is fixed
 * by the sequence rather than needing to be stored alongside it. Blue takes
 * positions 0, 2, 4, 7 and 9; red the rest.
 *
 * Only meaningful for a game drafted through the sequence. A game filled in
 * freely has no ban order at all, so callers must not split one.
 */
export const BAN_TEAMS: readonly DraftTeam[] = Object.freeze(
  DRAFT_SEQUENCE.filter((s) => s.action === 'ban').map((s) => s.team)
);

/** The team that made the ban at this position, or null past the tenth. */
export function banTeamAt(position: number): DraftTeam | null {
  return BAN_TEAMS[position] ?? null;
}

/** How many bans each side makes in a game. */
export const BANS_PER_TEAM = 5;

/**
 * One side's bans, padded to five, with `null` where a ban has not happened.
 *
 * The gaps are the point: a draft screen shows five empty slots per side and
 * fills them, so the count reads without being counted.
 *
 * `ourSide` absent means the game was filled in freely rather than drafted
 * through the sequence. There is no ban order to read in that case, so
 * everything is returned as ours rather than split down the middle on a guess.
 */
export function bansForTeam(
  bans: readonly string[],
  side: 'our' | 'their',
  ourSide: DraftTeam | undefined
): (string | null)[] {
  const made = bans.filter(Boolean);

  if (!ourSide) {
    const mine = side === 'our' ? made : [];
    const size = Math.max(BANS_PER_TEAM, mine.length);
    return Array.from({ length: size }, (_, i) => mine[i] ?? null);
  }

  const want: DraftTeam =
    side === 'our' ? ourSide : ourSide === 'blue' ? 'red' : 'blue';
  const mine = made.filter((_, i) => banTeamAt(i) === want);
  return Array.from({ length: BANS_PER_TEAM }, (_, i) => mine[i] ?? null);
}

/** "Blue ban 2", "Red pick 4" — with the teams named, since sides swap. */
export function describeStep(step: DraftStep, blueName: string, redName: string): string {
  const who = step.team === 'blue' ? blueName : redName;
  return `${who} ${step.action} ${step.ordinal}`;
}

/**
 * Which side makes the final pick of the phase this position sits in.
 *
 * The whole reason pick order matters: the side picking last sees the other's
 * champion before choosing, so it answers rather than commits. Standing on it
 * changes what you should do with a flex pick — hold it if you pick last, spend
 * it early if you do not — and the sequence already knows, it just never said.
 *
 * Null outside a pick phase, because during bans there is nothing to counter.
 */
export function lastPickOfPhase(position: number): DraftTeam | null {
  const here = stepAt(position);
  if (!here || here.action !== 'pick') return null;

  let last: DraftTeam | null = null;
  for (let i = position; i < DRAFT_SEQUENCE.length; i += 1) {
    const step = DRAFT_SEQUENCE[i];
    if (step.action !== 'pick') break; // The phase ends where the bans resume.
    last = step.team;
  }
  return last;
}

/** How many picks remain in this phase, including the one on the clock. */
export function picksLeftInPhase(position: number): number {
  let left = 0;
  for (let i = position; i < DRAFT_SEQUENCE.length; i += 1) {
    if (DRAFT_SEQUENCE[i].action !== 'pick') break;
    left += 1;
  }
  return left;
}
