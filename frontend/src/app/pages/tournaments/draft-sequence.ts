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

/**
 * A ban nobody saw (17 Sep 2026). The sequence will not reach the picks until ten bans are in, and operators who
 * missed one got past it with the first tiles on the wall or the random test aid, which later read as real bans.
 * Stored in the flat bans list, because a ban's position is what says whose it was (`bansForTeam`); never a
 * champion: it blocks nothing, is never sent to the advisor, and never counts.
 */
export const NO_BAN = '-';

export function isNoBan(champion: string | null | undefined): boolean {
  return champion === NO_BAN;
}

/** How a ban reads in words: the champion, or "not seen" for `NO_BAN`. */
export function banWord(champion: string): string {
  return isNoBan(champion) ? 'not seen' : champion;
}

/**
 * Where a game is in the sequence. `draftStep` when it was drafted here; a
 * game with no step but five picks a side (filled from a replay, or typed in
 * on the Plan) is over, not waiting at Ban 1 (8 Sep 2026). Anything else
 * opens at the start.
 *
 * Then the board has the last word (21 Sep 2026, the lead: "Why is it asking for a pick if the picks are already
 * in?"): the stored step is where the operator got to, but a game can be filled from somewhere else — a replay
 * import, the Already played dialog, the Plan's pickers — and then the step points at a pick that has nowhere to
 * land. `openFrom` walks forward past every step the board has already answered, so the room asks for what is
 * genuinely missing (MAD Synergy G3: ten picks, six bans, so the second ban phase) and reads as complete when
 * nothing is. It only ever moves forward, so it cannot skip a step back into a draft in progress.
 */
export function positionOf(game: {
  draftStep?: number;
  ourChampions?: readonly string[];
  theirChampions?: readonly string[];
  bans?: readonly string[];
  ourSide?: 'blue' | 'red';
}): number {
  const full = (list?: readonly string[]) => (list ?? []).filter(Boolean).length >= 5;
  const stored = game.draftStep !== undefined ? game.draftStep : full(game.ourChampions) && full(game.theirChampions) ? DRAFT_LENGTH : 0;
  return openFrom(stored, game);
}

/**
 * The first step at or after `from` that the board has not already answered: a ban step needs a ban in its own
 * slot, a pick step needs a free seat on that side. `DRAFT_LENGTH` when every step is answered.
 *
 * A not-seen ban counts as answered — that is what it is for. A side is counted by the champions actually on the
 * board, so a half-filled board still walks to the right place.
 */
export function openFrom(
  from: number,
  board: {
    ourChampions?: readonly string[];
    theirChampions?: readonly string[];
    bans?: readonly string[];
    ourSide?: 'blue' | 'red';
  }
): number {
  const start = Number.isInteger(from) && from > 0 ? Math.min(from, DRAFT_LENGTH) : 0;
  const bans = (board.bans ?? []).filter((b) => !!b).length;
  const ours = (board.ourChampions ?? []).filter(Boolean).length;
  const theirs = (board.theirChampions ?? []).filter(Boolean).length;
  const side = board.ourSide;
  let bansBefore = 0;
  const picksBefore = { blue: 0, red: 0 };
  for (let i = 0; i < DRAFT_LENGTH; i++) {
    const step = DRAFT_SEQUENCE[i];
    const answered =
      step.action === 'ban'
        ? bans > bansBefore
        : // Without a side nothing says which column a step's team is, so a pick step cannot be called answered.
          side !== undefined && (step.team === side ? ours : theirs) > picksBefore[step.team];
    if (i >= start && !answered) return i;
    if (step.action === 'ban') bansBefore += 1;
    else picksBefore[step.team] += 1;
  }
  return DRAFT_LENGTH;
}

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

/**
 * How many bans remain before the next pick, including the one on the clock (17 Sep 2026). What "Rest of phase
 * not seen" writes as `NO_BAN` in one save; zero on a pick step or past the end.
 */
export function bansLeftInPhase(position: number): number {
  if (!Number.isInteger(position) || position < 0) return 0;
  let left = 0;
  for (let i = position; i < DRAFT_SEQUENCE.length; i += 1) {
    if (DRAFT_SEQUENCE[i].action !== 'ban') break;
    left += 1;
  }
  return left;
}

/**
 * Everything the sequence will not take, on a ban step or a pick (17 Sep 2026): burned earlier in the series,
 * drafted by either side, or already banned this game. A confirmed ban is spent, so it stays closed on a ban step
 * too — the test aids chose from a list that left the bans made out, and Skip bans banned Akshan twice in
 * Paradox Requiem game 1. Blanks and `NO_BAN` ride along; `blockedSet` drops both.
 */
export function sequenceClosed(
  game: { bans?: readonly string[]; ourChampions?: readonly string[]; theirChampions?: readonly string[] },
  burned: readonly string[]
): string[] {
  return [
    ...burned,
    ...(game.ourChampions ?? []).filter(Boolean),
    ...(game.theirChampions ?? []).filter(Boolean),
    ...(game.bans ?? [])
  ];
}

/** The held line in the confirm slot, in parts: whose step, which, what is held, and where a pick lands. */
export interface HeldLine {
  /** Our side or theirs, which is what the line leads with. */
  readonly who: 'our' | 'their';
  /** The side's colour this game, for the tint. */
  readonly colour: DraftTeam;
  /** "pick 5", "ban 3". */
  readonly step: string;
  /** The champion, or "Ban not seen". */
  readonly champion: string;
  /** "their Support", or null on a ban or with no seat yet. */
  readonly seat: string | null;
}

/**
 * Whose step a held champion is going into, said before the champion (17 Sep 2026). The slot read "Jinx into ADC",
 * and on 13 Sep an editor put our Jinx into their step and abandoned the draft; it now reads "Their pick 1 · Jinx →
 * their ADC" in red when red picks. Null without a step or a side, when there is no sequence to name.
 */
export function heldLine(step: DraftStep | null, ourSide: DraftTeam | undefined, champion: string, seat: Role | null): HeldLine | null {
  if (!step || !ourSide || !champion) return null;
  const who = step.team === ourSide ? 'our' : 'their';
  return {
    who,
    colour: step.team,
    step: `${step.action} ${step.ordinal}`,
    champion: isNoBan(champion) ? 'Ban not seen' : champion,
    seat: step.action === 'pick' && seat && !isNoBan(champion) ? `${who} ${seat}` : null
  };
}

/**
 * Whose ban a place in the flat list is, in words: "their ban 2" (17 Sep 2026). Read off the sequence the way
 * `bansForTeam` reads it; null past the tenth or without a side, when there is no order to read.
 */
export function banPlaceWords(index: number, ourSide: DraftTeam | undefined): string | null {
  const team = banTeamAt(index);
  if (!team || !ourSide) return null;
  const ordinal = BAN_TEAMS.slice(0, index + 1).filter((t) => t === team).length;
  return `${team === ourSide ? 'our' : 'their'} ban ${ordinal}`;
}

/**
 * A wall click on the bans of a board the sequence is not running (17 Sep 2026): a game filled in freely, or a
 * finished draft with "Adjust picks or bans" open. `at` is where the clicked champion is already banned, or -1.
 *
 * A banned champion comes off. On a drafted board (`ourSide` set) it leaves a ban nobody saw in its place instead
 * of closing the gap, since a ban's position is what says whose it was and every later ban would change sides. A
 * new champion fills the first ban nobody saw before it is added at the end: a finished draft holds all ten, so a
 * not-seen ban read off the client afterwards was a click that did nothing. `filled` is the place it took, if any.
 */
export function banWallClick(
  bans: readonly string[],
  at: number,
  name: string,
  ourSide: DraftTeam | undefined,
  max: number
): { bans: string[]; filled: number | null } {
  const next = [...bans];
  if (at >= 0) {
    if (ourSide) next[at] = NO_BAN;
    else next.splice(at, 1);
    return { bans: next, filled: null };
  }
  const unseen = next.findIndex(isNoBan);
  if (unseen >= 0) {
    next[unseen] = name;
    return { bans: next, filled: unseen };
  }
  if (next.length < max) next.push(name);
  return { bans: next, filled: null };
}

/** What Enter in the sequence wall's empty search box does: hold a ban nobody saw, confirm it, or nothing. */
export type EmptyEnterAction = 'hold' | 'confirm' | 'none';

/**
 * Enter on the sequence wall's empty box (17 Sep 2026). On a ban step with nothing held it holds `NO_BAN`, and with
 * that held it confirms it, so a missed ban is two Enters. It does nothing with a champion held — whether Enter
 * should confirm one waits on the lead — nothing on a pick step, where not seen is no answer, and nothing while a
 * made ban or seat is aimed at, since the replace has the wall. `action` is the step on the clock, absent when no
 * sequence runs.
 */
export function emptyEnterAction(
  action: DraftAction | null | undefined,
  held: string | null,
  replacing: boolean,
  heldForMs = Number.POSITIVE_INFINITY
): EmptyEnterAction {
  if (!action || replacing) return 'none';
  // Nothing held: on a ban step, Enter on an empty box holds a ban nobody saw. A pick nobody saw is not a thing
  // — an unseen pick would hide a real champion from the burn and the advisor — so a pick step does nothing.
  if (!held) return action === 'ban' ? 'hold' : 'none';
  // Something held: Enter locks it. A not-seen ban locks at once (its first Enter was the empty box, so a second
  // Enter is deliberate); a champion has to have been held for LOCK_AFTER_MS, because the Enter that took it off
  // the wall clears the box, and a double tap of one key must not confirm something nobody has read back yet.
  if (isNoBan(held)) return action === 'ban' ? 'confirm' : 'none';
  return heldForMs >= LOCK_AFTER_MS ? 'confirm' : 'none';
}

/**
 * How long a champion must have been held before Enter locks it (21 Sep 2026, the lead: "second enter should lock
 * the pick"). Typing a name and pressing Enter holds it and clears the box, so the very next Enter would otherwise
 * confirm a champion the operator has not looked at — and on a live draft that is the one keystroke you cannot take
 * back cleanly. A third of a second is longer than a double tap and shorter than reading the confirm line.
 */
export const LOCK_AFTER_MS = 350;

/** What Undo would take back from a game at its current step, so the room can ask before removing a pick. */
export function undoTarget(game: { draftStep?: number; bans?: string[]; pickLog?: string[] }): { action: DraftAction; champion: string | null } | null {
  const position = game.draftStep ?? 0;
  if (position <= 0) return null;
  const previous = stepAt(position - 1);
  if (!previous) return null;
  if (previous.action === 'ban') {
    const bans = game.bans ?? [];
    return { action: 'ban', champion: bans[bans.length - 1] ?? null };
  }
  const log = game.pickLog ?? [];
  return { action: 'pick', champion: log[log.length - 1] ?? null };
}
