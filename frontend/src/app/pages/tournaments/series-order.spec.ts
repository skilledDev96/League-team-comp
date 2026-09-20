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

  // 17 Sep 2026: a series called "test" in the live group was every viewer's next series.
  it('never lands on a sandbox series, however early it sits or however much is played', () => {
    const withTest = [{ id: 'test', sandbox: true }, ...list];
    expect(nextSeriesId(withTest, () => false)).toBe('a');
    expect(nextSeriesId(withTest, (id) => id !== 'test')).toBe('c');
    expect(nextSeriesId([{ id: 'test', sandbox: true }], () => false)).toBe('');
  });

  // 21 Sep 2026: the split being over is now said out loud rather than guessed from every series having a result.
  it('lands on the last series of an ended split, whatever is left unplayed on its schedule', () => {
    expect(nextSeriesId(list, () => false, { ended: true })).toBe('c');
    const schedule = [{ id: 'r1' }, { id: 'r2', scheduledAt: '2026-09-27T19:30' }];
    expect(nextSeriesId(schedule, (id) => id === 'r1', { ended: true })).toBe('r2');
    // Still never a sandbox series, and an empty group is still nothing.
    expect(nextSeriesId([...list, { id: 'test', sandbox: true }], () => false, { ended: true })).toBe('c');
    expect(nextSeriesId([], () => false, { ended: true })).toBe('');
    // Not ended, and the same data answers as it always did.
    expect(nextSeriesId(schedule, (id) => id === 'r1', { ended: false })).toBe('r2');
    expect(nextSeriesId(list, () => false, {})).toBe('a');
  });

  it('prefers an unplayed series with a date, then keeps the stored order', () => {
    const schedule = [{ id: 'tbd' }, { id: 'free', scheduledAt: 'Sat 20:00' }, { id: 'r2', scheduledAt: '2026-09-20T19:30' }, { id: 'r3', scheduledAt: '2026-09-27' }];
    expect(nextSeriesId(schedule, () => false)).toBe('r2');
    expect(nextSeriesId(schedule, (id) => id === 'r2')).toBe('r3');
    // With no date left among the unplayed, the stored order decides as it always did.
    expect(nextSeriesId(schedule, (id) => id === 'r2' || id === 'r3')).toBe('tbd');
  });
});
