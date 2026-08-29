import { describe, expect, it } from 'vitest';
import { lanesOf, playsRole, primaryLane } from './champion-lanes';

describe('lanesOf', () => {
  it('answers the lane a single-lane champion is played in', () => {
    expect(lanesOf('Leona')).toEqual(['Support']);
    expect(lanesOf('Vi')).toEqual(['Jungle']);
  });

  it('keeps every lane a flex pick is genuinely played in, most played first', () => {
    // Collapsing these to one lane is exactly what makes an auto-assignment
    // feel wrong, so the map deliberately keeps them all.
    expect(lanesOf('Yasuo')).toEqual(['Mid', 'Top', 'ADC']);
    expect(lanesOf('Maokai')).toEqual(['Jungle', 'Support']);
  });

  it('matches regardless of casing or surrounding space', () => {
    expect(lanesOf('  leona  ')).toEqual(['Support']);
  });

  it('returns nothing for a champion with no pro games rather than guessing', () => {
    expect(lanesOf('Evelynn')).toEqual([]);
    expect(lanesOf('Not A Champion')).toEqual([]);
  });
});

describe('playsRole', () => {
  it('is true only for the lanes a champion actually plays', () => {
    expect(playsRole('Leona', 'Support')).toBe(true);
    expect(playsRole('Leona', 'Top')).toBe(false);
  });

  it('is true for every lane when the champion has no data', () => {
    // Hiding an unknown champion from every list would make it unpickable,
    // which is far worse than offering it in a lane it does not belong to.
    for (const role of ['Top', 'Jungle', 'Mid', 'ADC', 'Support'] as const) {
      expect(playsRole('Evelynn', role)).toBe(true);
    }
  });
});

describe('primaryLane', () => {
  it('gives the most-played lane, for a first guess at a seat', () => {
    expect(primaryLane('Yasuo')).toBe('Mid');
    expect(primaryLane('Maokai')).toBe('Jungle');
  });

  it('gives nothing rather than a wrong guess when there is no data', () => {
    expect(primaryLane('Evelynn')).toBeNull();
  });
});
