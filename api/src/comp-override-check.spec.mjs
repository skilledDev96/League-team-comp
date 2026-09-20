/**
 * The override check (20 Sep 2026), driven against a fake store and the **real** rules.
 *
 * It lives here for the reason the backfill's spec does: `scripts/` has no runner of its own, and the
 * script is plain ESM on node's own modules.
 *
 * What it guards, and the second one is the point of the whole slice:
 *
 * - the verdict rule — redundant, contradicted, still doing the work, pointing at a deleted comp;
 * - that **nothing moves while no comp holds a fallback**. `comp-match.spec.ts` proves the matcher is
 *   a strict generalisation; this proves the same of the path the report walks — `analysisRequestFrom`
 *   building the comps, `matchComp` scoring them, `attributeComp` applying `countsUnder` — because a
 *   record is not moved by a matcher, it is moved by that whole path. If this ever goes red on today's
 *   data, a stored figure is about to change and nobody asked for it;
 * - that a fallback, once added, is what picks a game up, and is reported as a fallback;
 * - that the script has no write path: the store it is given here has nothing but three readers, and
 *   any other call on it throws.
 *
 * The rules are imported from the TypeScript beside this file, not from `api/lib`, so the spec tests
 * the source rather than whatever was last built.
 */
import { describe, expect, it } from 'vitest';
import { run, verdictFor } from '../../scripts/comp-override-check.mjs';
import { matchComp } from './comp-match';
import { attributeComp } from './comp-attribution';
import { analysisRequestFrom } from './daily-refresh';

/** The same three functions the script pulls out of `api/lib`, and the threshold `index.ts` holds. */
const LIB = { matchComp, attributeComp, analysisRequestFrom, COMP_MATCH_THRESHOLD: 3 };

/** A store with three readers and nothing else — a fourth call is a write path and throws. */
function store({ comps = [], overrides = [], games = [] }) {
  const readers = {
    comps: async () => comps,
    overrides: async () => overrides,
    analysis: async () => games
  };
  return new Proxy(readers, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === 'symbol' || key === 'then') return undefined;
      throw new Error(`comp-override-check reached for store.${String(key)} — it must only read.`);
    }
  });
}

const five = (...champions) => champions.map((champion) => ({ champion }));
const silent = () => {};

const COMPS = [
  {
    id: 'dive',
    name: 'Dive',
    picks: { Top: 'Vladimir', Jungle: 'Diana', Mid: 'Yasuo', ADC: 'Tristana', Support: 'Nautilus - engage' }
  },
  {
    id: 'engage',
    name: 'Engage',
    picks: { Top: 'Maokai', Jungle: 'Vi', Mid: 'Galio', ADC: 'MissFortune', Support: 'Leona' }
  },
  {
    id: 'divev2',
    name: 'Dive v2',
    countsUnder: 'dive',
    picks: { Top: 'Vladimir', Jungle: 'Diana', Mid: 'Ahri', ADC: 'Tristana', Support: 'Thresh' }
  }
];

describe('verdictFor', () => {
  it('calls an override redundant when the matcher reaches the same comp', () => {
    expect(verdictFor('dive', 'dive', true)).toMatch(/^redundant/);
  });

  it('calls it contradicted when the matcher now names another comp', () => {
    expect(verdictFor('dive', 'engage', true)).toMatch(/^contradicted/);
  });

  it('says it is still doing the work when the matcher has no answer', () => {
    expect(verdictFor('dive', '', true)).toMatch(/^still doing the work/);
  });

  it('says so when the comp it names is gone, whatever the matcher thinks', () => {
    expect(verdictFor('gone', 'dive', false)).toMatch(/no longer exists/);
    expect(verdictFor('gone', '', false)).toMatch(/no longer exists/);
  });
});

describe('comp-override-check', () => {
  it('reads and never writes', async () => {
    // The proxy store throws on anything that is not one of the three readers.
    await expect(
      run({
        lib: LIB,
        store: store({ comps: COMPS, overrides: [{ matchId: 'M1', compId: 'dive' }], games: [] }),
        log: silent
      })
    ).resolves.toBeTruthy();
  });

  it('moves nothing while no comp holds a fallback', async () => {
    // The guarantee the slice rests on, over the whole path rather than the matcher alone: 200
    // generated fives against comps that have no fallbacks, each one overridden onto a comp.
    const pool = [
      'Vladimir', 'Diana', 'Yasuo', 'Tristana', 'Nautilus',
      'Maokai', 'Vi', 'Galio', 'MissFortune', 'Leona',
      'Ashe', 'Thresh', 'Sett', 'Lux', 'Ahri'
    ];
    let state = 7;
    const games = [];
    const overrides = [];
    for (let i = 0; i < 200; i += 1) {
      const left = [...pool];
      const picks = [];
      for (let n = 0; n < 5; n += 1) {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        picks.push(left.splice(state % left.length, 1)[0]);
      }
      games.push({ matchId: `M${i}`, compId: null, players: five(...picks) });
      overrides.push({ matchId: `M${i}`, compId: COMPS[i % COMPS.length].id });
    }

    const result = await run({ lib: LIB, store: store({ comps: COMPS, overrides, games }), log: silent });
    expect(result.seated).toBe(0);
    expect(result.changed).toBe(0);
    expect(result.rescored).toBe(0);
    // And not one game claims a fallback, because there is none to claim.
    expect(result.rows.every((row) => row.onFallback === 0)).toBe(true);
    // The before and after scores agree game by game, which is the same statement said per row.
    expect(result.rows.every((row) => row.beforeScore === row.afterScore)).toBe(true);
    expect(result.rows.every((row) => row.beforeId === row.afterId)).toBe(true);
  });

  it('picks a game up once the seat it needed has a fallback, and says it was one', async () => {
    const withLeona = [{ ...COMPS[0], fallbacks: { Support: ['Leona - if Naut is gone'] } }, COMPS[1]];
    // Two of Dive's priorities and its Support fallback: three seats only with the fallback counted.
    const games = [{ matchId: 'M1', compId: null, players: five('Vladimir', 'Diana', 'Sett', 'Ashe', 'Leona') }];
    const overrides = [{ matchId: 'M1', compId: 'dive' }];

    const before = await run({ lib: LIB, store: store({ comps: [COMPS[0], COMPS[1]], overrides, games }), log: silent });
    expect(before.rows[0].afterId).toBe('');
    expect(before.rows[0].verdict).toMatch(/^still doing the work/);

    const after = await run({ lib: LIB, store: store({ comps: withLeona, overrides, games }), log: silent });
    expect(after.seated).toBe(1);
    expect(after.rows[0].afterId).toBe('dive');
    expect(after.rows[0].afterScore).toBe(3);
    expect(after.rows[0].onFallback).toBe(1);
    expect(after.rows[0].changed).toBe(true);
    expect(after.rows[0].verdict).toMatch(/^redundant/);
  });

  it('reports an override the analysis cannot answer for rather than dropping it', async () => {
    const result = await run({
      lib: LIB,
      store: store({ comps: COMPS, overrides: [{ matchId: 'OLD', compId: 'dive' }], games: [] }),
      log: silent
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].verdict).toMatch(/not checkable/);
    expect(result.changed).toBe(0);
  });

  it('names a deleted comp as the problem, not the matcher', async () => {
    const result = await run({
      lib: LIB,
      store: store({
        comps: COMPS,
        overrides: [{ matchId: 'M1', compId: 'deleted' }],
        games: [{ matchId: 'M1', compId: null, players: five('Vladimir', 'Diana', 'Yasuo', 'Ashe', 'Sett') }]
      }),
      log: silent
    });
    expect(result.rows[0].verdict).toMatch(/no longer exists/);
  });

  it('compares end points, so an override onto a comp that folds into the match is redundant', async () => {
    // The five are Dive's; the override names Dive v2, which counts under Dive. Both resolve to Dive,
    // so this is a correction that no longer changes anything — not a contradiction.
    const result = await run({
      lib: LIB,
      store: store({
        comps: COMPS,
        overrides: [{ matchId: 'M1', compId: 'divev2' }],
        games: [{ matchId: 'M1', compId: 'dive', players: five('Vladimir', 'Diana', 'Yasuo', 'Tristana', 'Nautilus') }]
      }),
      log: silent
    });
    expect(result.rows[0].forcedId).toBe('dive');
    expect(result.rows[0].verdict).toMatch(/^redundant/);
  });

  it('says when the stored analysis disagrees with re-running the rules', async () => {
    const result = await run({
      lib: LIB,
      store: store({
        comps: COMPS,
        overrides: [{ matchId: 'M1', compId: 'engage' }],
        games: [{ matchId: 'M1', compId: 'dive', players: five('Vladimir', 'Diana', 'Yasuo', 'Tristana', 'Nautilus') }]
      }),
      log: silent
    });
    expect(result.mismatched).toBe(1);
    expect(result.rows[0].notes.join(' ')).toMatch(/changed after the last refresh/);
  });
});
