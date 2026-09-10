import { describe, expect, it } from 'vitest';
import { compToOpen, revealBehavior } from './open-comp.util';

const comps = [{ id: 'c1' }, { id: 'c2' }];

describe('compToOpen', () => {
  it('opens the comp the link names when the list carries it', () => {
    expect(compToOpen('c2', comps)).toBe('c2');
    expect(compToOpen('c1', comps)).toBe('c1');
  });

  it('opens nothing when no comp was asked for', () => {
    expect(compToOpen(null, comps)).toBeNull();
    expect(compToOpen(undefined, comps)).toBeNull();
    expect(compToOpen('', comps)).toBeNull();
  });

  it('waits while the list is empty and stays quiet for an id no comp carries', () => {
    // The page arrives before its comps: the effect asks again when they land.
    expect(compToOpen('c2', [])).toBeNull();
    // A comp deleted since the link was made: nothing opens, the param stays.
    expect(compToOpen('gone', comps)).toBeNull();
  });
});

describe('revealBehavior', () => {
  it('glides unless the reader asked for stillness', () => {
    expect(revealBehavior(false)).toBe('smooth');
    expect(revealBehavior(true)).toBe('auto');
  });
});
