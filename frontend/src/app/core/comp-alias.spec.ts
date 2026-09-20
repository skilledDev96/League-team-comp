import { describe, expect, it } from 'vitest';
import { Comp, CompFallbacks, Role, ROLES } from '../models/team.models';
import { compSeats, effectiveComp, resolveAlias } from './comp-alias';
import { MAX_SEAT_OPTIONS, priorityChampions } from './comp-seats';

function comp(id: string, name: string, countsUnder?: string): Comp {
  return {
    id,
    name,
    picks: { Top: '', Jungle: '', Mid: '', ADC: '', Support: '' },
    order: 0,
    ...(countsUnder ? { countsUnder } : {})
  };
}

const COMPS: Comp[] = [
  comp('wombo', 'Wombo'),
  comp('divewombo', 'Dive/Wombo', 'wombo'),
  comp('fokrond', 'Fok rond'),
  comp('pick', 'Pick')
];

describe('resolveAlias', () => {
  it('leaves a comp that stands alone where it is', () => {
    expect(resolveAlias('pick', COMPS)).toBe('pick');
  });

  it('follows countsUnder', () => {
    expect(resolveAlias('divewombo', COMPS)).toBe('wombo');
  });

  it('terminates on a cycle rather than hanging a computed', () => {
    const cycle = [comp('a', 'A', 'b'), comp('b', 'B', 'a')];
    expect(['a', 'b']).toContain(resolveAlias('a', cycle));
  });

  it('stops at the last real comp when the parent is gone', () => {
    expect(resolveAlias('a', [comp('a', 'A', 'deleted')])).toBe('a');
  });
});

describe('effectiveComp', () => {
  it('uses the callers own match when nothing overrides it', () => {
    expect(effectiveComp('pick', '', COMPS)).toEqual({ id: 'pick', name: 'Pick' });
  });

  it('rescues an off-book game the caller could not place', () => {
    // The bug this exists for: the Analysis page matched on champions alone, so
    // a game placed by hand stayed off the books and the win rate never moved.
    expect(effectiveComp(null, 'fokrond', COMPS)).toEqual({ id: 'fokrond', name: 'Fok rond' });
  });

  it('lets an override beat the callers match', () => {
    expect(effectiveComp('pick', 'fokrond', COMPS)?.id).toBe('fokrond');
  });

  it('applies countsUnder to an overridden comp', () => {
    expect(effectiveComp(null, 'divewombo', COMPS)).toEqual({ id: 'wombo', name: 'Wombo' });
  });

  it('applies countsUnder to a plain match too', () => {
    expect(effectiveComp('divewombo', '', COMPS)).toEqual({ id: 'wombo', name: 'Wombo' });
  });

  it('ignores an override naming a comp that no longer exists', () => {
    expect(effectiveComp('pick', 'deleted', COMPS)?.id).toBe('pick');
  });

  it('leaves a game off the books when nothing claims it', () => {
    expect(effectiveComp(null, '', COMPS)).toBeNull();
  });
});

// ---- The seats the browser sends (20 Sep 2026) ------------------------------

/** A comp with real seats, since the helper above builds five empty picks. */
function seated(picks: Partial<Record<Role, string>>, fallbacks?: CompFallbacks): Comp {
  return {
    id: 'c',
    name: 'C',
    picks: { Top: '', Jungle: '', Mid: '', ADC: '', Support: '', ...picks },
    order: 0,
    ...(fallbacks ? { fallbacks } : {})
  };
}

describe('compSeats', () => {
  it('is undefined for a comp holding no fallback', () => {
    // The whole safety of this change: absent is what the matcher reads as "score this comp the way
    // it was scored yesterday", so on the day it shipped no comp takes the new path and no record
    // can move. A stored-but-empty fallbacks array must not change that either.
    expect(compSeats(seated({ Top: 'Ornn', Jungle: 'Vi' }))).toBeUndefined();
    expect(compSeats(seated({ Top: 'Ornn' }, { Top: [] }))).toBeUndefined();
    expect(compSeats(seated({}))).toBeUndefined();
  });

  it('sends every seat once a single seat holds a fallback', () => {
    // Not only the seats with fallbacks: the score is out of the comp's seats, so a partial list
    // would quietly lower the score of every comp that has one.
    expect(
      compSeats(
        seated(
          { Top: 'Ornn', Jungle: 'Vi', Mid: 'Ahri', ADC: 'Ashe', Support: 'Nautilus - engage' },
          { Support: ['Leona - if Naut is gone'] }
        )
      )
    ).toEqual([['Ornn'], ['Vi'], ['Ahri'], ['Ashe'], ['Nautilus', 'Leona']]);
  });

  it('takes the champion off every line and leaves the notes behind', () => {
    expect(compSeats(seated({ Top: 'Ornn - tank it' }, { Top: ['Sion - if Ornn goes'] }))).toEqual([['Ornn', 'Sion']]);
  });

  it('drops a seat whose fallbacks have no priority to fall back from', () => {
    // `comp-seats.ts` enforces this on read, and the request must not be the one place it is not
    // enforced — a hand-edited document cannot make an empty seat count.
    expect(compSeats(seated({ Jungle: 'Vi' }, { Top: ['Leona'], Jungle: ['Sejuani'] }))).toEqual([['Vi', 'Sejuani']]);
  });

  it('reads a pick line that is only a note as an empty seat, and so must the morning run', () => {
    // Reachable through Admin › Comps, which edits a pick line as free text while `saveComp` leaves
    // `fallbacks` alone: blanking the Support champion leaves ' - need engage' with Leona under it.
    // `championOf` reads no champion there, so the seat is dropped. `championOfLine` in
    // `api/src/daily-refresh.ts` has to answer the same, or the 06:30 run scores the comp one seat
    // higher than this Refresh does and the record flips on whichever ran last (20 Sep 2026).
    expect(compSeats(seated({ Support: ' - need engage' }, { Support: ['Leona'] }))).toBeUndefined();
    expect(compSeats(seated({ Top: 'Ornn', Support: ' - need engage' }, { Support: ['Leona'] }))).toBeUndefined();
  });

  it('caps a seat and keeps one spelling of a champion in it', () => {
    const capped = compSeats(seated({ Top: 'Wukong' }, { Top: ['MonkeyKing', 'Sion', 'Malphite', 'Shen', 'Poppy'] }));
    // MonkeyKing is Wukong (`canonicalChampion`), so it is the same champion and not a fallback.
    expect(capped).toEqual([['Wukong', 'Sion', 'Malphite', 'Shen']]);
    expect(capped?.[0]).toHaveLength(MAX_SEAT_OPTIONS);
  });

  it('agrees with the priority five the request sends beside it', () => {
    // `champions` is unchanged and still the priorities, and the first entry of each seat is the same
    // champion — the two halves of one request cannot describe two different comps.
    const comp = seated(
      { Top: 'Ornn', Jungle: 'Vi', Mid: 'Ahri', ADC: 'Ashe', Support: 'Nautilus' },
      { Support: ['Leona'], Mid: ['Orianna'] }
    );
    const priorities = priorityChampions(comp);
    expect(compSeats(comp)?.map((seat) => seat[0])).toEqual(ROLES.map((role) => priorities[role]).filter(Boolean));
  });
});
