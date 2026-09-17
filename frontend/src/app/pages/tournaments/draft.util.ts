/**
 * What is still on the table during a fearless draft.
 *
 * In fearless, every champion played in an earlier game of the series is gone
 * for the rest of it, so by game three the pool is genuinely thin. During the
 * draft itself the picture keeps changing — bans land, the enemy takes
 * something — and the question is always the same: which of our comps do we
 * still have, and who is running out of champions.
 *
 * Kept free of Angular so the logic can be tested directly.
 */
import { championKey, sameChampion } from '../../core/champion-key';
import type { SeriesGame } from '../../models/team.models';
import { DRAFT_LENGTH, isComplete, isNoBan, positionOf } from './draft-sequence';

/** Whether a delete would lose anything: a pick, a ban or a result. Prep and the draft room ask, and offer Undo, on this one rule. */
export function gameHasContent(game: Pick<SeriesGame, 'ourChampions' | 'theirChampions' | 'bans' | 'win'>): boolean {
  return (
    (game.ourChampions ?? []).some(Boolean) ||
    (game.theirChampions ?? []).some(Boolean) ||
    (game.bans ?? []).some(Boolean) ||
    game.win !== undefined
  );
}

/**
 * The display-name keys of the champions whose Riot id is another word entirely ("MonkeyKing" is
 * Wukong, "Nunu" is Nunu & Willump, "Renata" is Renata Glasc). The alias table itself lives in
 * `core/champion-key.ts` and is not exported, so a key is resolved through its `sameChampion`:
 * whichever of these the name is the same champion as, that is its key.
 */
const ALIASED_KEYS = ['wukong', 'nunuwillump', 'renataglasc'] as const;

const keyCache = new Map<string, string>();

/**
 * One key for a champion however it is spelled (14 Sep 2026). Every set and every lookup in the draft
 * room and Prep goes through this, because the board holds three spellings at once: replays write
 * Riot's ids ("MissFortune", "MonkeyKing"), the wall and the pickers write display names ("Miss
 * Fortune", "Wukong"), and people type "kaisa". Lower-case letters and digits settle most of them;
 * the Riot ids that are another word resolve to the display name's key. Before this a burned
 * MonkeyKing never greyed the Wukong tile and a banned "missfortune" never greyed Miss Fortune.
 */
export function normalizeChampion(name: string): string {
  const raw = name ?? '';
  const known = keyCache.get(raw);
  if (known !== undefined) return known;
  const key = championKey(raw);
  const resolved = (key && ALIASED_KEYS.find((alias) => sameChampion(key, alias))) || key;
  if (keyCache.size > 2000) keyCache.clear();
  keyCache.set(raw, resolved);
  return resolved;
}

/**
 * One set, normalised, from however many lists of champions. A ban nobody saw (`NO_BAN`, 17 Sep 2026) closes
 * nothing, so it never enters the set.
 */
export function blockedSet(...groups: (readonly string[] | undefined)[]): Set<string> {
  const blocked = new Set<string>();
  for (const group of groups) {
    for (const champion of group ?? []) {
      if (champion && !isNoBan(champion)) blocked.add(normalizeChampion(champion));
    }
  }
  return blocked;
}

/**
 * The champions of however many lists, once each by key, keeping the first spelling met. A burned
 * list counts a champion once whether one game stored "MonkeyKing" and another "Wukong".
 */
export function uniqueChampions(...groups: (readonly (string | undefined)[] | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const champion of group ?? []) {
      const key = champion ? normalizeChampion(champion) : '';
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(champion!);
    }
  }
  return out;
}

/**
 * The games of a series that were played: a result recorded or a replay behind them (14 Sep 2026).
 * An empty board somebody opened the draft room on is not a game of the series, so a head reading
 * "0–2 · 3 games" or "not played yet · 2 games" was counting drafts that never happened.
 */
export function playedGames<T extends { win?: boolean; matchId?: string }>(games: readonly T[]): T[] {
  return games.filter((g) => g.win !== undefined || !!g.matchId);
}

/** Seats a side drafts. */
const SEATS = 5;

/** An earlier game whose board is short of ten picks, and how many champions its burn cannot know about. */
export interface BurnGap {
  id: string;
  gameNumber: number;
  /** Picks on the board, both sides together. */
  picks: number;
  /** Empty seats, both sides together. */
  missing: number;
}

/**
 * The games before this one with fewer than five picks a side (17 Sep 2026). On 10 Sep Paradox
 * Requiem's games 1 and 2 had been played without the room, so game 3 opened with nothing burned and
 * the wall, the advisor and the Comps popup all offered champions that were gone; the two games were
 * back-filled through the live sequence with Skip bans two minutes before the draft. The side
 * question names these so they can be entered first. Whether the series burns at all is the
 * caller's rule (`isFearless`); a seat is filled when it holds a name, and a side counts five at most.
 */
export function gapsBefore(
  games: readonly Pick<SeriesGame, 'id' | 'gameNumber' | 'ourChampions' | 'theirChampions'>[],
  gameNumber: number
): BurnGap[] {
  const filled = (list: readonly string[] | undefined) => Math.min(SEATS, (list ?? []).filter((c) => !!c && !!c.trim()).length);
  return games
    .filter((g) => g.gameNumber < gameNumber)
    .map((g) => {
      const ours = filled(g.ourChampions);
      const theirs = filled(g.theirChampions);
      return { id: g.id, gameNumber: g.gameNumber, picks: ours + theirs, missing: SEATS * 2 - ours - theirs };
    })
    .filter((g) => g.missing > 0)
    .sort((a, b) => a.gameNumber - b.gameNumber);
}

/** "1", "1 and 2", "1, 2 and 3". */
function inWords(items: readonly (string | number)[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/**
 * The one warning line the side question shows over the gaps: which games, and how many champions the
 * burn is missing because of them. The count is the empty seats, never a guess at the champions, and
 * "up to" because an empty board is not proof the game was played.
 */
export function gapsLine(gaps: readonly BurnGap[]): string {
  if (!gaps.length) return '';
  const empty = gaps.filter((g) => g.picks === 0).map((g) => g.gameNumber);
  const clauses = [
    ...(empty.length ? [`${empty.length === 1 ? 'game' : 'games'} ${inWords(empty)} ${empty.length === 1 ? 'has' : 'have'} no picks`] : []),
    ...gaps.filter((g) => g.picks > 0).map((g) => `game ${g.gameNumber} has ${g.picks} of ${SEATS * 2} picks`)
  ];
  const missing = gaps.reduce((sum, g) => sum + g.missing, 0);
  const line = `${inWords(clauses)}, so the burn is missing up to ${missing} champion${missing === 1 ? '' : 's'}`;
  return line[0].toUpperCase() + line.slice(1);
}

/**
 * A side's five as the room saves every board: role order, Top to Support, "" for a seat nobody filled.
 * A champion keeps the seat it was entered in, so an empty Jungle never shifts the Mid into it, and
 * anything past the fifth seat is not a seat and is cut.
 */
export function playedSeats(list: readonly (string | undefined)[] | undefined): string[] {
  return Array.from({ length: SEATS }, (_, i) => list?.[i]?.trim() ?? '');
}

/** What the "Enter game N as played" dialog was given: our side, both fives in seat order, and the result if there is one. */
export interface PlayedEntry {
  ourSide: 'blue' | 'red';
  ours: readonly string[];
  theirs: readonly string[];
  win?: boolean;
}

/**
 * The one save that enters a game played without the room (17 Sep 2026): the side, both fives as seats,
 * the result, and the step at the end, so the room reads the game as drafted rather than waiting at Ban 1.
 * The hold and the pick log belong to a sequence that never ran and go. Everything else the game holds is
 * kept as it is — the bans, the advice, a linked replay and the board it replaced — because the dialog
 * does not ask about them, and a save that dropped them would lose what nobody chose to change.
 */
export function playedGameWrite(live: SeriesGame, entry: PlayedEntry): SeriesGame {
  return {
    ...live,
    ourSide: entry.ourSide,
    ourChampions: playedSeats(entry.ours),
    theirChampions: playedSeats(entry.theirs),
    win: entry.win,
    draftStep: DRAFT_LENGTH,
    holding: undefined,
    pickLog: undefined
  };
}

/**
 * Where the room goes once a played game is saved. Entered from the side question's warning, an earlier
 * game hands the room back to the game it was on (`back`, so nothing about that game's clock changes).
 * Otherwise the room moves to the next game of the series still to draft, else stays on the saved one,
 * whose done bar offers the next game. `games` is the series' games.
 */
export function gameAfterPlayed(
  games: readonly Pick<SeriesGame, 'id' | 'gameNumber' | 'win' | 'draftStep' | 'ourChampions' | 'theirChampions'>[],
  saved: Pick<SeriesGame, 'id' | 'gameNumber'>,
  fromId: string
): { id: string; back: boolean } {
  if (fromId && fromId !== saved.id && games.some((g) => g.id === fromId)) return { id: fromId, back: true };
  const next = games
    .filter((g) => g.gameNumber > saved.gameNumber && g.win === undefined && !isComplete(positionOf(g)))
    .sort((a, b) => a.gameNumber - b.gameNumber)[0];
  return { id: next?.id ?? saved.id, back: false };
}

/** 95% confidence, the usual choice for a lower bound like this. */
const Z = 1.96;

/**
 * The win rate a record can actually support: the lower bound of its Wilson interval, as a percentage
 * (17 Sep 2026, moved here from the advisor's `confidenceScore`, which calls it with the same
 * arithmetic in the same order, so its ranking did not move). One win from one game supports 21, five
 * from six 43. `rate` is a percentage and is clamped to 0–100; no games is nothing, not even.
 */
export function wilsonLowerBound(rate: number, games: number): number {
  const n = Math.max(games, 0);
  if (n <= 0) return 0;

  const p = Math.min(Math.max(rate / 100, 0), 1);
  const denominator = 1 + (Z * Z) / n;
  const centre = p + (Z * Z) / (2 * n);
  const margin = Z * Math.sqrt((p * (1 - p) + (Z * Z) / (4 * n)) / n);
  return ((centre - margin) / denominator) * 100;
}

/** Games a comp needs before the Comps popup prints its rate; under this it says "few games" instead. */
export const COMP_RATE_MIN_GAMES = 3;

export interface CompChampions {
  id: string;
  name: string;
  category?: string;
  champions: string[];
  /** From match history, when the comp has been played enough to have one. */
  winRate?: number;
  games?: number;
}

export interface CompAvailability {
  id: string;
  name: string;
  category?: string;
  available: string[];
  blocked: string[];
  playable: boolean;
  winRate?: number;
  games?: number;
}

/** How far a comp's record can be trusted: the Wilson lower bound of its rate, or null with no games behind it. */
function recordConfidence(comp: { winRate?: number; games?: number }): number | null {
  const games = comp.games ?? 0;
  return comp.winRate !== undefined && games > 0 ? wilsonLowerBound(comp.winRate, games) : null;
}

/** Best-supported record first, no record last; bounds within a hair of each other are a tie, as in `suggestForLane`. */
function byRecord(a: { winRate?: number; games?: number }, b: { winRate?: number; games?: number }): number {
  const ours = recordConfidence(a);
  const theirs = recordConfidence(b);
  if (ours === null || theirs === null) return ours === theirs ? 0 : ours === null ? 1 : -1;
  const gap = theirs - ours;
  return Math.abs(gap) > 0.0001 ? gap : 0;
}

/**
 * Playable comps come back by how much their record can bear, not by the rate it shows (17 Sep 2026):
 * sorted on the raw rate a 1–0 comp stood above a 5–1 one, so the order is the Wilson lower bound
 * and a comp never played goes last. Broken comps come back least-damaged first: a comp missing one
 * champion is a substitution, one missing three is not worth the conversation; the record breaks a tie.
 */
export function compAvailability(
  comps: readonly CompChampions[],
  blocked: ReadonlySet<string>
): CompAvailability[] {
  return comps
    .map((comp) => {
      const champions = comp.champions.filter(Boolean);
      return {
        id: comp.id,
        name: comp.name,
        category: comp.category,
        winRate: comp.winRate,
        games: comp.games,
        available: champions.filter((c) => !blocked.has(normalizeChampion(c))),
        blocked: champions.filter((c) => blocked.has(normalizeChampion(c))),
        playable: champions.length > 0 && champions.every((c) => !blocked.has(normalizeChampion(c)))
      };
    })
    .sort(
      (a, b) =>
        Number(b.playable) - Number(a.playable) ||
        (a.playable ? byRecord(a, b) : a.blocked.length - b.blocked.length || byRecord(a, b)) ||
        a.name.localeCompare(b.name)
    );
}

export interface PoolPressure {
  name: string;
  role: string;
  left: string[];
  gone: string[];
  /** Two or fewer left: one ban away from having no choice at all. */
  critical: boolean;
}

/** Draft order, so the list reads top to bottom the way a draft is discussed. */
const ROLE_ORDER: Record<string, number> = { Top: 0, Jungle: 1, Mid: 2, ADC: 3, Support: 4 };

/** Champions left at or below which a pool is worth flagging. */
export const CRITICAL_POOL = 2;

/**
 * How much pool each player has left, thinnest first — that is who the draft
 * has to be planned around.
 */
/**
 * Ordered by role, not by how thin each pool is.
 *
 * Sorting by pressure put whoever was closest to running out on top, which
 * moved rows around between picks: the list reordered itself in the middle of a
 * draft, exactly when someone is trying to find one player. Role order is
 * stable and matches how a draft is talked through, and the `critical` flag
 * still marks urgency in place rather than by position.
 */
export function poolPressure(
  players: readonly { name: string; role?: string; pool: readonly string[] }[],
  blocked: ReadonlySet<string>
): PoolPressure[] {
  return players
    .map((player) => {
      const left = player.pool.filter((c) => c && !blocked.has(normalizeChampion(c)));
      const gone = player.pool.filter((c) => c && blocked.has(normalizeChampion(c)));
      return {
        name: player.name,
        role: player.role ?? '',
        left,
        gone,
        critical: left.length <= CRITICAL_POOL
      };
    })
    .sort(
      (a, b) =>
        (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.name.localeCompare(b.name)
    );
}
