import { describe, expect, it } from 'vitest';
import { attributeComp, AttributableComp, resolveAlias } from './comp-attribution';

const COMPS: AttributableComp[] = [
  { id: 'wombo', name: 'Wombo' },
  { id: 'divewombo', name: 'Dive/Wombo', countsUnder: 'wombo' },
  { id: 'dive', name: 'Dive' },
  { id: 'engage', name: 'Engage' }
];

const auto = (compId: string | null, compName: string | null = null) => ({ compId, compName });

describe('resolveAlias', () => {
  it('leaves a comp that stands alone where it is', () => {
    expect(resolveAlias('dive', COMPS)).toBe('dive');
  });

  it('follows countsUnder to the comp it folds into', () => {
    expect(resolveAlias('divewombo', COMPS)).toBe('wombo');
  });

  it('follows a chain to the end', () => {
    const chain: AttributableComp[] = [
      { id: 'a', name: 'A', countsUnder: 'b' },
      { id: 'b', name: 'B', countsUnder: 'c' },
      { id: 'c', name: 'C' }
    ];
    expect(resolveAlias('a', chain)).toBe('c');
  });

  it('terminates on a cycle instead of hanging the analysis run', () => {
    // Nothing in the UI stops someone pointing two comps at each other, and a
    // naive walk would spin forever inside a per-match loop.
    const cycle: AttributableComp[] = [
      { id: 'a', name: 'A', countsUnder: 'b' },
      { id: 'b', name: 'B', countsUnder: 'a' }
    ];
    expect(['a', 'b']).toContain(resolveAlias('a', cycle));
  });

  it('ignores a comp pointing at itself', () => {
    expect(resolveAlias('a', [{ id: 'a', name: 'A', countsUnder: 'a' }])).toBe('a');
  });

  it('stops at the last real comp when the parent has been deleted', () => {
    expect(resolveAlias('a', [{ id: 'a', name: 'A', countsUnder: 'gone' }])).toBe('a');
  });
});

describe('attributeComp', () => {
  it('keeps the matchers answer when nobody has intervened', () => {
    const result = attributeComp(auto('dive', 'Dive'), 'M1', {}, COMPS);
    expect(result).toEqual({ compId: 'dive', compName: 'Dive', source: 'auto' });
  });

  it('folds a matched comp into the one it counts under', () => {
    const result = attributeComp(auto('divewombo', 'Dive/Wombo'), 'M1', {}, COMPS);
    expect(result).toEqual({ compId: 'wombo', compName: 'Wombo', source: 'alias' });
  });

  it('lets an override rescue a game the matcher could not place', () => {
    const result = attributeComp(auto(null), 'M1', { M1: 'engage' }, COMPS);
    expect(result).toEqual({ compId: 'engage', compName: 'Engage', source: 'manual' });
  });

  it('lets an override beat the matcher outright', () => {
    const result = attributeComp(auto('dive', 'Dive'), 'M1', { M1: 'engage' }, COMPS);
    expect(result.compId).toBe('engage');
    expect(result.source).toBe('manual');
  });

  it('applies countsUnder to an overridden comp too', () => {
    // Otherwise the two features contradict each other: the game would sit
    // under Dive/Wombo here and under Wombo everywhere else.
    const result = attributeComp(auto(null), 'M1', { M1: 'divewombo' }, COMPS);
    expect(result).toEqual({ compId: 'wombo', compName: 'Wombo', source: 'alias' });
  });

  it('only applies an override to the match it names', () => {
    const result = attributeComp(auto('dive', 'Dive'), 'M2', { M1: 'engage' }, COMPS);
    expect(result.compId).toBe('dive');
  });

  it('falls back to the matcher when an override names a deleted comp', () => {
    const result = attributeComp(auto('dive', 'Dive'), 'M1', { M1: 'gone' }, COMPS);
    expect(result).toEqual({ compId: 'dive', compName: 'Dive', source: 'auto' });
  });

  it('leaves an off-book game off the books when nothing claims it', () => {
    expect(attributeComp(auto(null), 'M1', {}, COMPS)).toEqual({
      compId: null,
      compName: null,
      source: 'auto'
    });
  });
});
