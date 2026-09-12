import { describe, expect, it } from 'vitest';
import { UserPrefs } from '../models/team.models';

/**
 * The depth preference, as pure reads and writes over a `UserPrefs` document (12 Sep 2026).
 *
 * The service itself needs a signed-in account and a Firestore door, so what is worth pinning here
 * is the shape discipline the rest of the app depends on: **an absent key means Starter**, so no
 * stored document changes shape and nothing has to be migrated, and going back to Starter deletes
 * the key rather than storing the default a second way.
 */
const depthOf = (prefs: UserPrefs, surface: 'games' | 'reviews' | 'patterns' | 'prep') =>
  prefs.depth?.[surface] === 'full' ? 'full' : 'starter';

const nextDepth = (prefs: UserPrefs, surface: 'games' | 'reviews' | 'patterns' | 'prep', full: boolean) => {
  const depth = { ...(prefs.depth ?? {}) };
  if (full) depth[surface] = 'full';
  else delete depth[surface];
  return depth;
};

describe('the reading depth', () => {
  it('is Starter for a document that has never heard of it', () => {
    // Every stored userPrefs document predates this field.
    const old: UserPrefs = { toursSeen: { welcome: 1 }, film: { seat: 'Jungle' } };
    for (const s of ['games', 'reviews', 'patterns', 'prep'] as const) expect(depthOf(old, s)).toBe('starter');
  });

  it('remembers each surface on its own', () => {
    const prefs: UserPrefs = { depth: nextDepth({}, 'games', true) };
    expect(depthOf(prefs, 'games')).toBe('full');
    expect(depthOf(prefs, 'patterns')).toBe('starter');
  });

  it('deletes the key on the way back rather than storing the default twice', () => {
    const onPrep: UserPrefs = { depth: nextDepth({}, 'prep', true) };
    expect(nextDepth(onPrep, 'prep', false)).toEqual({});

    // And turning one surface back off leaves the others where they were.
    const onBoth: UserPrefs = { depth: nextDepth(onPrep, 'games', true) };
    const prepOff: UserPrefs = { depth: nextDepth(onBoth, 'prep', false) };
    expect(depthOf(prepOff, 'games')).toBe('full');
    expect(depthOf(prepOff, 'prep')).toBe('starter');
  });

  it('leaves everything else in the document untouched', () => {
    const prefs: UserPrefs = { tourSeen: true, toursSeen: { games: 2 }, film: { seat: 'ADC' } };
    const next: UserPrefs = { ...prefs, depth: nextDepth(prefs, 'reviews', true) };
    expect(next.toursSeen).toEqual({ games: 2 });
    expect(next.film).toEqual({ seat: 'ADC' });
    expect(next.tourSeen).toBe(true);
  });
});
