import { describe, expect, it } from 'vitest';
import { attributeComp, AttributableComp, fallbackReceipt, resolveAlias } from './comp-attribution';

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
    expect(result).toEqual({ compId: 'dive', compName: 'Dive', source: 'auto', overridden: false });
  });

  it('folds a matched comp into the one it counts under', () => {
    const result = attributeComp(auto('divewombo', 'Dive/Wombo'), 'M1', {}, COMPS);
    expect(result).toEqual({ compId: 'wombo', compName: 'Wombo', source: 'alias', overridden: false });
  });

  it('lets an override rescue a game the matcher could not place', () => {
    const result = attributeComp(auto(null), 'M1', { M1: 'engage' }, COMPS);
    expect(result).toEqual({ compId: 'engage', compName: 'Engage', source: 'manual', overridden: true });
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
    expect(result).toEqual({ compId: 'wombo', compName: 'Wombo', source: 'alias', overridden: true });
  });

  it('only applies an override to the match it names', () => {
    const result = attributeComp(auto('dive', 'Dive'), 'M2', { M1: 'engage' }, COMPS);
    expect(result.compId).toBe('dive');
  });

  it('falls back to the matcher when an override names a deleted comp', () => {
    const result = attributeComp(auto('dive', 'Dive'), 'M1', { M1: 'gone' }, COMPS);
    expect(result).toEqual({ compId: 'dive', compName: 'Dive', source: 'auto', overridden: false });
  });

  it('leaves an off-book game off the books when nothing claims it', () => {
    expect(attributeComp(auto(null), 'M1', {}, COMPS)).toEqual({
      compId: null,
      compName: null,
      source: 'auto',
      overridden: false
    });
  });

  // 20 Sep 2026: the caller needs this apart from `source`, because `alias` is what an override and
  // the matcher both become once `countsUnder` applies — and the matcher's fallback receipt
  // describes the comp *it* matched, which on an overridden game is not the comp the game counts as.
  it('says whether an override put the game here, which source cannot', () => {
    expect(attributeComp(auto('dive', 'Dive'), 'M1', {}, COMPS).overridden).toBe(false);
    expect(attributeComp(auto('divewombo', 'Dive/Wombo'), 'M1', {}, COMPS).overridden).toBe(false);
    expect(attributeComp(auto(null), 'M1', { M1: 'engage' }, COMPS).overridden).toBe(true);
    // Both of these read source 'alias'; only one of them is a person's doing.
    expect(attributeComp(auto(null), 'M1', { M1: 'divewombo' }, COMPS).overridden).toBe(true);
    // An override naming a deleted comp is ignored, so the game is not overridden after all.
    expect(attributeComp(auto('dive', 'Dive'), 'M1', { M1: 'gone' }, COMPS).overridden).toBe(false);
  });
});

describe('fallbackReceipt', () => {
  const scored = (compId: string | null, onFallback: number) => ({ compId, onFallback });

  it('keeps the receipt when the game counts under the very comp the matcher scored', () => {
    const attributed = attributeComp(auto('dive', 'Dive'), 'M1', {}, COMPS);
    expect(fallbackReceipt(attributed, scored('dive', 2))).toBe(2);
  });

  it('drops it when countsUnder moved the game onto a comp that holds no fallback', () => {
    // The case this was written for: 'Dive/Wombo' counts under 'Wombo'. The fallback is on
    // Dive/Wombo's Support seat; Wombo holds none at all, and a surface printing "n of its games
    // were played on a fallback" for Wombo would state a fact about seats that comp does not have.
    const attributed = attributeComp(auto('divewombo', 'Dive/Wombo'), 'M1', {}, COMPS);
    expect(attributed.compId).toBe('wombo');
    expect(fallbackReceipt(attributed, scored('divewombo', 1))).toBe(0);
  });

  it('drops it on a game a person placed by hand', () => {
    const attributed = attributeComp(auto('dive', 'Dive'), 'M1', { M1: 'engage' }, COMPS);
    expect(fallbackReceipt(attributed, scored('dive', 1))).toBe(0);
  });

  it('drops it on an off-book game, where the matcher is only naming its nearest comp', () => {
    // `matchComp` reports `onFallback` for the comp it scored best whether or not the score cleared
    // the threshold, so without this the field would ride on a game counted under nothing and
    // describe `nearCompName` instead.
    expect(fallbackReceipt(attributeComp(auto(null), 'M1', {}, COMPS), scored(null, 2))).toBe(0);
    expect(fallbackReceipt(attributeComp(auto(null), 'M1', {}, COMPS), scored('dive', 2))).toBe(0);
  });

  it('never reports a negative receipt', () => {
    const attributed = attributeComp(auto('dive', 'Dive'), 'M1', {}, COMPS);
    expect(fallbackReceipt(attributed, scored('dive', -1))).toBe(0);
  });
});
