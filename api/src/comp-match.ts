// Champion-set matching for comp analysis, extracted so it can be unit tested.

import { DDRAGON_TO_DISPLAY } from './champion-names';

/** Lowercase alphanumerics, so "Miss Fortune" == "missfortune" across sources. */
export function normalizeChampKey(name: string): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Riot's ids that are not the display name with its punctuation dropped, keyed both ways: built
 * from `DDRAGON_TO_DISPLAY` rather than typed out, so this cannot drift from the table the rest of
 * the api reads names through. Only three entries survive the strip — MonkeyKing/Wukong,
 * Nunu/Nunu & Willump, Renata/Renata Glasc — which is exactly the three `ID_ALIASES` in
 * `frontend/src/app/core/champion-key.ts` (20 Sep 2026).
 */
const CANONICAL_BY_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(DDRAGON_TO_DISPLAY).map(([id, display]) => [normalizeChampKey(id), normalizeChampKey(display)])
);

/**
 * The key a champion counts under **within one seat**: "MonkeyKing" and "Wukong" are one champion,
 * so one seat cannot list both (20 Sep 2026).
 *
 * It must agree with `canonicalChampion` in `frontend/src/app/core/champion-key.ts`, which is what
 * `core/comp-seats.ts` dedupes a seat with. The two request builders — the browser's `compSeats`
 * and the morning run's `seatsOfComp` — would otherwise disagree about what a seat holds and, since
 * the cap is applied after the dedupe, about where the seat is cut off.
 *
 * It keys the seat dedupe and **nothing else**. Matching a played champion to a seat still compares
 * `normalizeChampKey`, deliberately: a comp with no `seats` is scored champion by champion on that
 * same key, so widening it would change what a stored record says, which this slice may not do.
 */
export function canonicalChampKey(name: string): string {
  const key = normalizeChampKey(name);
  return CANONICAL_BY_KEY[key] ?? key;
}

/**
 * At most four champions a seat — the priority and three fallbacks. Mirrors `MAX_SEAT_OPTIONS` in
 * `frontend/src/app/core/comp-seats.ts`, which is where the board enforces it; repeated here because a
 * request arrives over HTTP and nothing stops a hand-rolled body widening a seat past what the app can
 * write (20 Sep 2026).
 */
export const MAX_SEAT_OPTIONS = 4;

export interface CompChampSet {
  id: string;
  name: string;
  /** The priority five, one a filled seat — unchanged, and what a comp with no `seats` is matched on. */
  champions: string[];
  /**
   * One array a filled seat, the priority first then its fallbacks in order (20 Sep 2026 — the lead:
   * 'the dive comp has naut a priority but Leona can also be added as a secondary pick').
   *
   * Absent on every comp stored before that, and absent is not the same as empty: a comp without it is
   * matched on `champions`, which is `[[a], [b], …]` read as seats and scores identically (see the
   * proof in the spec). Build it with `normalizeSeats`, never by hand.
   */
  seats?: string[][];
}

export interface CompMatchResult {
  /** Matched comp (only when overlap >= threshold), else null. */
  compId: string | null;
  compName: string | null;
  /** Closest comp name regardless of threshold, for off-book hints. */
  nearName: string | null;
  /**
   * Best score found across all comps: how many of a comp's **seats** the played five filled.
   *
   * A seat is filled by any one champion it lists, so this still counts out of five and the threshold
   * still means 'this many of the five seats went to plan'. For a comp whose seats each hold one
   * champion it is exactly the champion overlap it has always been.
   */
  overlap: number;
  /**
   * Names of every comp tied at `overlap`, sorted. Length > 1 means the game
   * genuinely fits multiple comps equally well and the winner is a tie-break,
   * not a clear result — surface it rather than assigning silently.
   *
   * Tied on seats filled, not on how many of them were priorities: two comps the five fits in three
   * seats each are equally well fitted, even when one of them got there on fallbacks. The priority
   * count settles who wins; it does not make the ambiguity go away.
   */
  tiedNames: string[];
  /**
   * How many of the winner's filled seats were filled by a **fallback** rather than the priority — the
   * receipt a comp's record prints as 'n of these games were played on a fallback'. 0 for a comp with
   * no fallbacks, so nothing that reads it changes until the lead adds one.
   */
  onFallback: number;
}

/** What one comp scored against one played five. */
interface SeatScore {
  /** Seats filled: the score, out of five. */
  matched: number;
  /** How many of those were filled by the seat's priority. The first tie-break. */
  priority: number;
}

/**
 * A comp's seats as the matcher will take them, or undefined when the value carries none.
 *
 * Every validator on the analysis path runs its `seats` through here, so the rule lives once: a seat
 * whose **first** entry names no champion holds nothing at all, whatever follows it (the invariant
 * `core/comp-seats.ts` enforces on read — a fallback with nothing to fall back from is not a seat);
 * within a seat a champion appears once, compared on `canonicalChampKey`, the same key
 * `core/comp-seats.ts` dedupes with, so a seat that lists Wukong and MonkeyKing is one champion on
 * both paths and both cut the tail at the same place; a seat stops at `MAX_SEAT_OPTIONS`; and an
 * empty seat is dropped the way `champions` drops an empty pick.
 *
 * Undefined rather than `[]` when nothing survives, because absent is the one value that means 'match
 * this comp exactly the way it was matched yesterday'.
 */
export function normalizeSeats(value: unknown): string[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seats: string[][] = [];
  for (const raw of value) {
    if (!Array.isArray(raw)) continue;
    const entries = raw.map((entry) => (typeof entry === 'string' ? entry.trim() : ''));
    // The invariant: no priority, no seat.
    if (!entries.length || !entries[0]) continue;
    const seat: string[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      const key = canonicalChampKey(entry);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      seat.push(entry);
      if (seat.length >= MAX_SEAT_OPTIONS) break;
    }
    if (seat.length) seats.push(seat);
  }
  return seats.length ? seats : undefined;
}

/**
 * The best a comp's seats can do against one played five.
 *
 * A played champion fills **at most one** seat and a seat takes **at most one** played champion, so
 * this is a maximum matching on a bipartite graph of at most 5 x 5 — and a greedy walk gets it wrong
 * whenever two seats list the same champion (seat A takes Nautilus, seat B listed Nautilus and Leona,
 * Leona was played: greedy scores 1, the truth is 2).
 *
 * It is computed **exhaustively with memoisation**, not by an augmenting-path algorithm: the search
 * enumerates, seat by seat, every legal assignment — each seat either plays nobody or takes one
 * champion nobody upstream took — so the best it can report is the best that exists. Memoisation only
 * merges states that are identical in everything still to be decided (which seat we are on, which
 * champions are still free), so it removes work, not answers. With five seats that is at most 5 x 32
 * states, cheaper than writing Hungarian down, and it takes the second objective for free: exhaustive
 * search can maximise a weighted score where an augmenting-path matcher would need a cost matrix.
 *
 * Two objectives in priority order — seats filled, then how many of those were the seat's priority —
 * are folded into one number: a seat is worth `played.length + 1` and a priority seat one more. Since
 * the priority count can never exceed the number of played champions, no amount of priorities can buy
 * an extra seat, so maximising the sum is exactly maximising the pair in order.
 */
function scoreSeats(seats: readonly string[][], playedKeys: readonly string[]): SeatScore {
  const n = playedKeys.length;
  if (!n || !seats.length) return { matched: 0, priority: 0 };

  // One bit a played champion. A Summoner's Rift five never reaches 31; anything past it is a caller
  // passing something that is not a game, and is ignored rather than overflowing the mask.
  const width = Math.min(n, 31);
  const index = new Map<string, number>();
  for (let i = 0; i < width; i += 1) if (!index.has(playedKeys[i])) index.set(playedKeys[i], i);

  /** Which played champions each seat can take, and which of those are its priority. */
  const can: number[] = [];
  const isPriority: number[] = [];
  for (const seat of seats) {
    let mask = 0;
    let top = 0;
    seat.forEach((champion, rank) => {
      const at = index.get(normalizeChampKey(champion));
      if (at === undefined) return;
      mask |= 1 << at;
      if (rank === 0) top |= 1 << at;
    });
    if (mask) {
      can.push(mask);
      isPriority.push(top);
    }
  }
  if (!can.length) return { matched: 0, priority: 0 };

  // A filled seat outweighs every priority that could ever be counted, so the sum orders the two
  // objectives: seats first, priorities only among the ties.
  const SEAT = width + 1;
  const total = 1 << width;
  const memo = new Map<number, number>();

  const best = (seat: number, used: number): number => {
    if (seat === can.length) return 0;
    const key = seat * total + used;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    let out = best(seat + 1, used); // this seat plays nobody
    let free = can[seat] & ~used;
    while (free) {
      const bit = free & -free;
      free ^= bit;
      const worth = SEAT + (isPriority[seat] & bit ? 1 : 0);
      const score = worth + best(seat + 1, used | bit);
      if (score > out) out = score;
    }
    memo.set(key, out);
    return out;
  };

  const score = best(0, 0);
  return { matched: Math.floor(score / SEAT), priority: score % SEAT };
}

/**
 * Credit a played 5-champion game to the defined comp it fits best, when that fit meets the threshold.
 * Always reports the closest comp + its score.
 *
 * Since 20 Sep 2026 a comp is a set of **seats** rather than a flat champion list, and a seat is filled
 * by any champion it lists — the priority or one of its fallbacks. A comp that carries no `seats` is
 * read as one champion a seat, which scores exactly what the flat overlap scored, so the day this
 * shipped no record moved (the spec proves it over the old cases and generated ones).
 *
 * Ties are broken by how many filled seats were priorities and then by comp id, not by array position,
 * so reordering comps in the admin editor can never silently change historical attribution.
 */
export function matchComp(
  playedChampions: string[],
  comps: CompChampSet[],
  threshold: number
): CompMatchResult {
  // Deduped, as the played set has always been: one champion cannot fill two seats.
  const playedKeys: string[] = [];
  const seenPlayed = new Set<string>();
  for (const champion of playedChampions) {
    const key = normalizeChampKey(champion);
    if (!key || seenPlayed.has(key)) continue;
    seenPlayed.add(key);
    playedKeys.push(key);
  }

  let bestMatched = 0;
  let tied: CompChampSet[] = [];
  let winner: CompChampSet | null = null;
  let winnerScore: SeatScore = { matched: 0, priority: 0 };

  for (const comp of comps) {
    // No seats means a comp stored before fallbacks existed: its five champions, one a seat.
    const seats = comp.seats?.length ? comp.seats : comp.champions.map((champion) => [champion]);
    const score = scoreSeats(seats, playedKeys);
    if (score.matched > bestMatched) {
      bestMatched = score.matched;
      tied = [comp];
    } else if (score.matched === bestMatched && score.matched > 0) {
      tied.push(comp);
    }
    if (!score.matched) continue;
    // The winner is settled as each comp is scored, so its score travels with it: more seats, then
    // more of them on the priority, then the lowest id.
    const better =
      !winner ||
      score.matched > winnerScore.matched ||
      (score.matched === winnerScore.matched &&
        (score.priority > winnerScore.priority ||
          (score.priority === winnerScore.priority && comp.id < winner.id)));
    if (better) {
      winner = comp;
      winnerScore = score;
    }
  }

  const matched = winner !== null && bestMatched >= threshold;

  return {
    compId: matched && winner ? winner.id : null,
    compName: matched && winner ? winner.name : null,
    nearName: winner ? winner.name : null,
    overlap: bestMatched,
    tiedNames: tied.length > 1 ? [...tied].map((c) => c.name).sort() : [],
    onFallback: winner ? winnerScore.matched - winnerScore.priority : 0
  };
}
