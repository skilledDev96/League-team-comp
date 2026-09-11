import { describe, expect, it, vi } from 'vitest';
import { isStaleChunkError, reloadForStaleBuild } from './stale-build';

/**
 * The rule that gets a tab out of a deploy it was open across. It is shared by the router's
 * `NavigationError` handler and the review takeover's deferred block, which is the whole point: the
 * two were separate until 11 Sep 2026, only the router had a recovery, and a `@defer` failure —
 * which never reaches the router — left a teammate behind a blank full-screen scrim.
 */
describe('isStaleChunkError', () => {
  it('knows the words every browser uses for a lazy chunk that did not load', () => {
    // The three engines each say it differently, and all three have to be caught: the message is
    // the only evidence there is, since a rejected dynamic import has no type of its own.
    for (const said of [
      'Failed to fetch dynamically imported module: https://example.test/chunk-BhEiC2Zj.js',
      'error loading dynamically imported module: https://example.test/chunk-BhEiC2Zj.js',
      'ChunkLoadError: Loading chunk 42 failed.',
      'Importing a module script failed.'
    ]) {
      expect(isStaleChunkError(new Error(said))).toBe(true);
      expect(isStaleChunkError(said)).toBe(true);
    }
  });

  it('leaves a fault in our own code alone, so a real bug is never papered over with a reload', () => {
    // A reload loop on top of a genuine exception would hide it and make the page unusable, which
    // is strictly worse than the exception.
    expect(isStaleChunkError(new Error("Cannot read properties of undefined (reading 'seat')"))).toBe(false);
    expect(isStaleChunkError(new TypeError('x is not a function'))).toBe(false);
    expect(isStaleChunkError('NG0750')).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
    expect(isStaleChunkError('')).toBe(false);
  });
});

describe('reloadForStaleBuild', () => {
  function storage(seed: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> & { held: Record<string, string> } {
    const held = { ...seed };
    return {
      held,
      getItem: (k: string) => held[k] ?? null,
      setItem: (k: string, v: string) => {
        held[k] = v;
      }
    };
  }

  it('reloads once for a target and never twice', () => {
    // The guard is the point: if the chunk is genuinely gone — a half-finished deploy, an index
    // naming files that were never uploaded — reloading on every failure is an endless refresh on a
    // page nobody can read or leave.
    const store = storage();
    const reload = vi.fn();
    expect(reloadForStaleBuild('/games', store, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadForStaleBuild('/games', store, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('still has a reload left for a different target in the same session', () => {
    // One bad chunk is not every bad chunk: a route that failed does not spend the takeover's try.
    const store = storage();
    const reload = vi.fn();
    expect(reloadForStaleBuild('/games', store, reload)).toBe(true);
    expect(reloadForStaleBuild('review-takeover-stage', store, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('does not reload when it cannot remember having done so', () => {
    // A private window, or a browser refusing site data. A reload we cannot record is a reload we
    // cannot promise to stop, so it is not started at all.
    const reload = vi.fn();
    expect(reloadForStaleBuild('/games', null, reload)).toBe(false);
    const throwsOnRead = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => undefined
    };
    expect(reloadForStaleBuild('/games', throwsOnRead, reload)).toBe(false);
    const throwsOnWrite = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      }
    };
    expect(reloadForStaleBuild('/games', throwsOnWrite, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
