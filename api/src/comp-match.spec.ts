import { describe, expect, it } from 'vitest';
import {
  canonicalChampKey,
  CompChampSet,
  CompMatchResult,
  matchComp,
  MAX_SEAT_OPTIONS,
  normalizeChampKey,
  normalizeSeats
} from './comp-match';

const COMPS: CompChampSet[] = [
  { id: 'dive', name: 'Dive', champions: ['Vladimir', 'Diana', 'Yasuo', 'Tristana', 'Nautilus'] },
  { id: 'engage', name: 'Engage', champions: ['Maokai', 'Vi', 'Galio', 'Miss Fortune', 'Leona'] }
];

describe('normalizeChampKey', () => {
  it('reduces to lowercase alphanumerics', () => {
    expect(normalizeChampKey('Miss Fortune')).toBe('missfortune');
    expect(normalizeChampKey("Kai'Sa")).toBe('kaisa');
    expect(normalizeChampKey('')).toBe('');
  });

  it('leaves the ids whose display name is another word alone, which is what canonicalChampKey is for', () => {
    // Widening this one would rescore every comp that carries no seats, and no record may move.
    expect(normalizeChampKey('MonkeyKing')).toBe('monkeyking');
    expect(normalizeChampKey('Wukong')).toBe('wukong');
  });
});

describe('canonicalChampKey', () => {
  it('folds the three ids that are another word onto their display name', () => {
    // The same three `ID_ALIASES` as `canonicalChampion` in `frontend/src/app/core/champion-key.ts`,
    // which is what `core/comp-seats.ts` dedupes a seat with — the two must agree or the browser and
    // the morning run send different seats for one comp (20 Sep 2026).
    expect(canonicalChampKey('MonkeyKing')).toBe(canonicalChampKey('Wukong'));
    expect(canonicalChampKey('Nunu')).toBe(canonicalChampKey('Nunu & Willump'));
    expect(canonicalChampKey('Renata')).toBe(canonicalChampKey('Renata Glasc'));
  });

  it('leaves two different champions apart, and strips the way the plain key does', () => {
    expect(canonicalChampKey('Miss Fortune')).toBe('missfortune');
    expect(canonicalChampKey("Kai'Sa")).toBe('kaisa');
    expect(canonicalChampKey('Nautilus')).not.toBe(canonicalChampKey('Leona'));
    expect(canonicalChampKey('')).toBe('');
  });
});

describe('matchComp', () => {
  it('matches a comp when overlap meets the threshold', () => {
    const played = ['Vladimir', 'Diana', 'Yasuo', 'Ashe', 'Thresh']; // 3/5 of Dive
    const result = matchComp(played, COMPS, 3);
    expect(result.compId).toBe('dive');
    expect(result.compName).toBe('Dive');
    expect(result.overlap).toBe(3);
    expect(result.nearName).toBe('Dive');
  });

  it('does not match below the threshold but still reports the near comp', () => {
    const played = ['Vladimir', 'Diana', 'Ashe', 'Thresh', 'Sett']; // 2/5 of Dive
    const result = matchComp(played, COMPS, 3);
    expect(result.compId).toBeNull();
    expect(result.compName).toBeNull();
    expect(result.overlap).toBe(2);
    expect(result.nearName).toBe('Dive');
  });

  it('picks the comp with the most overlap', () => {
    const played = ['Maokai', 'Vi', 'Galio', 'Leona', 'Ashe']; // 4/5 Engage, 0 Dive
    const result = matchComp(played, COMPS, 3);
    expect(result.compId).toBe('engage');
    expect(result.overlap).toBe(4);
  });

  it('reports no near comp when nothing overlaps', () => {
    const played = ['Ashe', 'Thresh', 'Sett', 'Lux', 'Ezreal'];
    const result = matchComp(played, COMPS, 3);
    expect(result.compId).toBeNull();
    expect(result.nearName).toBeNull();
    expect(result.overlap).toBe(0);
  });

  it('normalises names so punctuation/spacing does not matter', () => {
    const comps: CompChampSet[] = [
      { id: 'mf', name: 'MF', champions: ['Miss Fortune', "Kai'Sa", 'Ahri'] }
    ];
    const result = matchComp(['missfortune', 'kaisa', 'AHRI'], comps, 3);
    expect(result.overlap).toBe(3);
    expect(result.compId).toBe('mf');
  });
});

describe('matchComp tie-breaking', () => {
  // Two comps that overlap the played set equally. 'aaa' sorts before 'zzz'.
  const TIED: CompChampSet[] = [
    { id: 'zzz', name: 'Zed Comp', champions: ['Vladimir', 'Diana', 'Ashe', 'Thresh', 'Zed'] },
    { id: 'aaa', name: 'Ahri Comp', champions: ['Vladimir', 'Diana', 'Ashe', 'Braum', 'Ahri'] }
  ];
  const played = ['Vladimir', 'Diana', 'Ashe', 'Lulu', 'Sett']; // 3 of each

  it('breaks ties by comp id, not array order', () => {
    const result = matchComp(played, TIED, 3);
    expect(result.compId).toBe('aaa');
  });

  it('gives the same winner when the comps are reordered', () => {
    const reordered = matchComp(played, [...TIED].reverse(), 3);
    expect(reordered.compId).toBe('aaa');
  });

  it('reports every tied comp so the ambiguity can be surfaced', () => {
    const result = matchComp(played, TIED, 3);
    expect(result.tiedNames).toEqual(['Ahri Comp', 'Zed Comp']);
  });

  it('reports no tie when one comp overlaps more', () => {
    const clear = matchComp(['Maokai', 'Vi', 'Galio', 'Miss Fortune', 'Leona'], COMPS, 3);
    expect(clear.compId).toBe('engage');
    expect(clear.tiedNames).toEqual([]);
  });

  it('still reports the closest comp below threshold, with no match', () => {
    const result = matchComp(['Vladimir', 'Diana', 'Ashe', 'Lulu', 'Sett'], TIED, 5);
    expect(result.compId).toBeNull();
    expect(result.nearName).toBe('Ahri Comp');
    expect(result.overlap).toBe(3);
  });
});

// ---- Seats: a seat can hold a priority and its fallbacks (20 Sep 2026) -----

/** Dive with two seats that will take a second champion: Support Nautilus/Leona, Mid Diana/Ahri. */
const DIVE_WITH_FALLBACKS: CompChampSet = {
  id: 'dive',
  name: 'Dive',
  champions: ['Vladimir', 'Diana', 'Yasuo', 'Tristana', 'Nautilus'],
  seats: [['Vladimir'], ['Diana', 'Ahri'], ['Yasuo'], ['Tristana'], ['Nautilus', 'Leona']]
};

describe('normalizeSeats', () => {
  it('keeps a seat in order and drops the blanks around it', () => {
    expect(normalizeSeats([['Nautilus', '', ' Leona ']])).toEqual([['Nautilus', 'Leona']]);
  });

  it('drops a seat with no priority, whatever is sitting behind it', () => {
    // The invariant `core/comp-seats.ts` enforces on read: a fallback with nothing to fall back from.
    expect(normalizeSeats([['', 'Leona'], ['Vi']])).toEqual([['Vi']]);
  });

  it('keeps one spelling of a champion within a seat', () => {
    expect(normalizeSeats([['Miss Fortune', 'missfortune', 'Ashe']])).toEqual([['Miss Fortune', 'Ashe']]);
  });

  it('knows the Riot id and the display name are one champion, and so cuts the same tail', () => {
    // `core/comp-seats.ts` dedupes on `canonicalChampion` and caps **after** the dedupe, so keying
    // on the plain strip kept MonkeyKing, spent a slot on it and lost the last real fallback off
    // the end. One seat of difference between the two request builders is enough to cross the
    // threshold (20 Sep 2026).
    expect(normalizeSeats([['Wukong', 'MonkeyKing', 'Sion', 'Malphite', 'Shen', 'Poppy']])).toEqual([
      ['Wukong', 'Sion', 'Malphite', 'Shen']
    ]);
    expect(normalizeSeats([['MonkeyKing', 'Wukong']])).toEqual([['MonkeyKing']]);
    expect(normalizeSeats([['Nunu', 'Nunu & Willump', 'Sejuani']])).toEqual([['Nunu', 'Sejuani']]);
  });

  it('stops a seat at MAX_SEAT_OPTIONS', () => {
    const seat = normalizeSeats([['A', 'B', 'C', 'D', 'E']]);
    expect(seat?.[0]).toHaveLength(MAX_SEAT_OPTIONS);
    expect(seat?.[0]).toEqual(['A', 'B', 'C', 'D']);
  });

  it('is undefined for anything that carries no seat at all', () => {
    // Undefined is the value that means "match this comp exactly as it was matched yesterday".
    expect(normalizeSeats(undefined)).toBeUndefined();
    expect(normalizeSeats([])).toBeUndefined();
    expect(normalizeSeats([[], ['']])).toBeUndefined();
    expect(normalizeSeats('Nautilus')).toBeUndefined();
    expect(normalizeSeats([['Vi'], 'Ahri', 7])).toEqual([['Vi']]);
  });
});

describe('matchComp with seats', () => {
  it('counts a seat played on its fallback, and says how many were', () => {
    const played = ['Vladimir', 'Diana', 'Yasuo', 'Ashe', 'Leona']; // Support on the fallback
    const result = matchComp(played, [DIVE_WITH_FALLBACKS], 3);
    expect(result.compId).toBe('dive');
    expect(result.overlap).toBe(4);
    expect(result.onFallback).toBe(1);
  });

  it('reports no fallback when every filled seat was the priority', () => {
    const played = ['Vladimir', 'Diana', 'Yasuo', 'Tristana', 'Nautilus'];
    const result = matchComp(played, [DIVE_WITH_FALLBACKS], 3);
    expect(result.overlap).toBe(5);
    expect(result.onFallback).toBe(0);
  });

  it('gives one seat at most one champion', () => {
    // Both of the Support seat's champions were played; the seat is still one seat.
    const played = ['Nautilus', 'Leona', 'Ashe', 'Sett', 'Lux'];
    const result = matchComp(played, [DIVE_WITH_FALLBACKS], 1);
    expect(result.overlap).toBe(1);
  });

  it('gives one played champion to at most one seat', () => {
    const shared: CompChampSet = {
      id: 'shared',
      name: 'Shared',
      champions: ['Nautilus', 'Nautilus'],
      seats: [['Nautilus'], ['Nautilus']]
    };
    expect(matchComp(['Nautilus', 'Ashe', 'Sett', 'Lux', 'Vi'], [shared], 1).overlap).toBe(1);
  });

  it('finds the assignment a greedy walk misses', () => {
    // Seat A lists Nautilus only; seat B lists Nautilus first and Leona behind it. A greedy walk
    // hands Nautilus to seat B and scores 1; the truth is 2 — Nautilus to A, Leona to B.
    const greedyTrap: CompChampSet = {
      id: 'trap',
      name: 'Trap',
      champions: ['Nautilus', 'Nautilus'],
      seats: [['Nautilus', 'Leona'], ['Nautilus']]
    };
    const result = matchComp(['Nautilus', 'Leona', 'Ashe', 'Sett', 'Lux'], [greedyTrap], 2);
    expect(result.overlap).toBe(2);
    expect(result.compId).toBe('trap');
    expect(result.onFallback).toBe(1);
  });

  it('finds the assignment two greedy walks miss, in either direction', () => {
    // Three seats, three champions, and only one assignment fills all three.
    const chain: CompChampSet = {
      id: 'chain',
      name: 'Chain',
      champions: ['Ahri', 'Ahri', 'Ahri'],
      seats: [['Ahri', 'Zed', 'Sett'], ['Ahri', 'Zed'], ['Ahri']]
    };
    expect(matchComp(['Ahri', 'Zed', 'Sett', 'Lux', 'Vi'], [chain], 3).overlap).toBe(3);
  });

  it('prefers the comp that got there on its priorities, over the one on fallbacks', () => {
    const onPriorities: CompChampSet = {
      id: 'zzz-priorities',
      name: 'On priorities',
      champions: ['Vladimir', 'Diana', 'Yasuo'],
      seats: [['Vladimir'], ['Diana'], ['Yasuo']]
    };
    const onFallbacks: CompChampSet = {
      id: 'aaa-fallbacks',
      name: 'On fallbacks',
      champions: ['Maokai', 'Vi', 'Galio'],
      seats: [['Maokai', 'Vladimir'], ['Vi', 'Diana'], ['Galio', 'Yasuo']]
    };
    // 'aaa-fallbacks' would win the id tie-break; three priorities beat three fallbacks first.
    const result = matchComp(['Vladimir', 'Diana', 'Yasuo', 'Ashe', 'Sett'], [onPriorities, onFallbacks], 3);
    expect(result.compId).toBe('zzz-priorities');
    expect(result.onFallback).toBe(0);
    // Still ambiguous: the five fit both plans in three seats, and the reader should be told.
    expect(result.tiedNames).toEqual(['On fallbacks', 'On priorities']);
  });

  it('falls back to the lowest comp id when the priorities tie too', () => {
    const a: CompChampSet = { id: 'aaa', name: 'A', champions: ['Vladimir', 'Diana', 'Ashe'], seats: [['Vladimir'], ['Diana'], ['Ashe']] };
    const z: CompChampSet = { id: 'zzz', name: 'Z', champions: ['Vladimir', 'Diana', 'Ashe'], seats: [['Vladimir'], ['Diana'], ['Ashe']] };
    expect(matchComp(['Vladimir', 'Diana', 'Ashe', 'Lux', 'Sett'], [z, a], 3).compId).toBe('aaa');
  });

  it('reads an empty seats array as no seats at all', () => {
    const empty: CompChampSet = { ...COMPS[0], seats: [] };
    const played = ['Vladimir', 'Diana', 'Yasuo', 'Ashe', 'Thresh'];
    expect(matchComp(played, [empty], 3)).toEqual(matchComp(played, [COMPS[0]], 3));
  });

  it('reports the fallback count of the winner, not of the runner-up', () => {
    const runnerUp: CompChampSet = {
      id: 'aaa-runner',
      name: 'Runner up',
      champions: ['Maokai', 'Vi'],
      seats: [['Maokai', 'Vladimir'], ['Vi', 'Diana']]
    };
    const result = matchComp(['Vladimir', 'Diana', 'Yasuo', 'Tristana', 'Nautilus'], [DIVE_WITH_FALLBACKS, runnerUp], 3);
    expect(result.compId).toBe('dive');
    expect(result.onFallback).toBe(0);
  });
});

// ---- The proof: seats are a strict generalisation of the flat overlap -------

/**
 * Today's rule, copied here on purpose (20 Sep 2026).
 *
 * This is the matcher's scoring as it stood before seats existed — count how many of the comp's
 * distinct champions appear in the played five. It lives in the spec so the table below can assert
 * the new matcher against it rather than against a number somebody typed, and so nobody can change
 * the matcher and quietly move a stored record: the day seats shipped, no comp held a fallback, and
 * every one of those comps has to score exactly what it scored yesterday.
 */
function flatOverlap(comp: CompChampSet, played: readonly string[]): number {
  const playedKeys = new Set(played.map(normalizeChampKey));
  const compKeys = new Set(comp.champions.map(normalizeChampKey));
  let overlap = 0;
  for (const key of compKeys) if (playedKeys.has(key)) overlap += 1;
  return overlap;
}

/**
 * Yesterday's whole matcher, copied here on purpose (20 Sep 2026).
 *
 * `flatOverlap` above proves the **score**; this proves the **answer** — which comp a game is
 * credited to, and which comps it says were tied, i.e. the thing that actually moves a stored
 * record. Nothing else in this file can: `matchComp` reads an absent `seats` as
 * `champions.map(c => [c])`, which is exactly what `asSingletonSeats` builds, so a table comparing
 * `matchComp(played, SHAPES)` against `matchComp(played, SHAPES.map(asSingletonSeats))` is the same
 * computation on the same data and passes whatever the matcher does. Measured: inverting the id
 * tie-break — a change that hands every tied game to a different comp — left that version green.
 *
 * The body is `git show <the commit before seats>:api/src/comp-match.ts`'s `matchComp`, unchanged,
 * less the `onFallback` field it did not have. Do not tidy it; its value is that it is the old one.
 */
function legacyMatchComp(
  playedChampions: string[],
  comps: CompChampSet[],
  threshold: number
): Omit<CompMatchResult, 'onFallback'> {
  const played = new Set(playedChampions.map(normalizeChampKey));

  let bestOverlap = 0;
  let tied: CompChampSet[] = [];

  for (const comp of comps) {
    const compChamps = new Set(comp.champions.map(normalizeChampKey));
    let overlap = 0;
    for (const champ of compChamps) {
      if (played.has(champ)) overlap += 1;
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      tied = [comp];
    } else if (overlap === bestOverlap && overlap > 0) {
      tied.push(comp);
    }
  }

  // Deterministic, order-independent winner: lowest comp id wins a tie.
  const winner = [...tied].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] ?? null;
  const matched = winner !== null && bestOverlap >= threshold;

  return {
    compId: matched ? winner.id : null,
    compName: matched ? winner.name : null,
    nearName: winner ? winner.name : null,
    overlap: bestOverlap,
    tiedNames: tied.length > 1 ? [...tied].map((c) => c.name).sort() : []
  };
}

/** The same comp with its champions spelled out as one-champion seats. */
function asSingletonSeats(comp: CompChampSet): CompChampSet {
  return { ...comp, seats: comp.champions.map((champion) => [champion]) };
}

const POOL = [
  'Vladimir', 'Diana', 'Yasuo', 'Tristana', 'Nautilus',
  'Maokai', 'Vi', 'Galio', 'Miss Fortune', 'Leona',
  'Ashe', 'Thresh', 'Sett', 'Lux', 'Ezreal',
  "Kai'Sa", 'Ahri', 'Zed', 'Braum', 'Lulu'
];

/** A deterministic shuffle, so a failure can be reproduced from its seed alone. */
function fiveFrom(seed: number): string[] {
  const pool = [...POOL];
  const five: string[] = [];
  let state = seed;
  for (let i = 0; i < 5; i += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    five.push(pool.splice(state % pool.length, 1)[0]);
  }
  return five;
}

describe('seats are a strict generalisation of the flat overlap', () => {
  /** Every played five the old cases used, plus 300 generated ones. */
  const CASES: { name: string; played: string[] }[] = [
    { name: '3 of Dive', played: ['Vladimir', 'Diana', 'Yasuo', 'Ashe', 'Thresh'] },
    { name: '2 of Dive', played: ['Vladimir', 'Diana', 'Ashe', 'Thresh', 'Sett'] },
    { name: '4 of Engage', played: ['Maokai', 'Vi', 'Galio', 'Leona', 'Ashe'] },
    { name: 'all of Engage', played: ['Maokai', 'Vi', 'Galio', 'Miss Fortune', 'Leona'] },
    { name: 'nothing', played: ['Ashe', 'Thresh', 'Sett', 'Lux', 'Ezreal'] },
    { name: 'other spellings', played: ['missfortune', 'kaisa', 'AHRI', 'Lulu', 'Sett'] },
    { name: 'tied threes', played: ['Vladimir', 'Diana', 'Ashe', 'Lulu', 'Sett'] },
    { name: 'empty', played: [] },
    { name: 'one champion twice', played: ['Nautilus', 'Nautilus', 'Ashe', 'Sett', 'Lux'] },
    ...Array.from({ length: 300 }, (_, i) => ({ name: `generated ${i}`, played: fiveFrom(i + 1) }))
  ];

  const SHAPES: CompChampSet[] = [
    ...COMPS,
    { id: 'zzz', name: 'Zed Comp', champions: ['Vladimir', 'Diana', 'Ashe', 'Thresh', 'Zed'] },
    { id: 'aaa', name: 'Ahri Comp', champions: ['Vladimir', 'Diana', 'Ashe', 'Braum', 'Ahri'] },
    { id: 'short', name: 'Half built', champions: ['Vladimir', 'Diana'] },
    { id: 'empty', name: 'Nothing yet', champions: [] },
    { id: 'dup', name: 'Same champion twice', champions: ['Nautilus', 'Nautilus', 'Ashe'] },
    { id: 'spelling', name: 'Riot ids', champions: ['MonkeyKing', 'MissFortune', 'Kaisa'] }
  ];

  it.each(CASES)('$name: one-champion seats score the flat overlap, comp by comp', ({ played }) => {
    for (const comp of SHAPES) {
      // A comp scored through its seats, against the same comp scored the way it was yesterday.
      const seated = matchComp(played, [asSingletonSeats(comp)], 1);
      expect(seated.overlap).toBe(flatOverlap(comp, played));
      expect(seated.onFallback).toBe(0);
    }
  });

  it.each(CASES)('$name: comps carrying no seats get the whole answer the old matcher gave', ({ played }) => {
    for (const threshold of [1, 2, 3, 4, 5]) {
      const { onFallback, ...answer } = matchComp(played, SHAPES, threshold);
      // The winner, its name, the near comp, the score and the tied names — against the matcher as
      // it stood, not against the new one wearing a different hat. This is what would have caught
      // an inverted tie-break, and what will catch the next one.
      expect(answer).toEqual(legacyMatchComp(played, SHAPES, threshold));
      expect(onFallback).toBe(0);
    }
  });

  it.each(CASES)('$name: spelling every seat out one champion at a time gets it too', ({ played }) => {
    const seated = SHAPES.map(asSingletonSeats);
    for (const threshold of [1, 2, 3, 4, 5]) {
      const { onFallback, ...answer } = matchComp(played, seated, threshold);
      // Still compared against the OLD matcher over the same comps, so this is a second claim and
      // not the first one restated: the seat path reaches yesterday's answer by itself.
      expect(answer).toEqual(legacyMatchComp(played, SHAPES, threshold));
      expect(onFallback).toBe(0);
    }
  });

  it.each(CASES)('$name: a comp carrying no seats scores what it always did', ({ played }) => {
    for (const comp of SHAPES) {
      expect(matchComp(played, [comp], 1).overlap).toBe(flatOverlap(comp, played));
    }
  });
});
