import { describe, expect, it } from 'vitest';
import { nextSeriesId } from './series-order';

describe('the series the page lands on', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('is the first with no result yet', () => {
    expect(nextSeriesId(list, (id) => id === 'a')).toBe('b');
  });

  it('is the first of all when nothing has been played', () => {
    expect(nextSeriesId(list, () => false)).toBe('a');
  });

  it('is the last one once the tournament is over', () => {
    // Not the first: a finished bracket is read back from the end.
    expect(nextSeriesId(list, () => true)).toBe('c');
  });

  it('skips a played series in the middle rather than stopping at it', () => {
    expect(nextSeriesId(list, (id) => id === 'a' || id === 'b')).toBe('c');
  });

  it('is nothing at all when there are no series', () => {
    expect(nextSeriesId([], () => false)).toBe('');
  });
});
