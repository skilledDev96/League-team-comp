import { describe, expect, it } from 'vitest';
import { Comp } from '../models/team.models';
import { effectiveComp, resolveAlias } from './comp-alias';

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
