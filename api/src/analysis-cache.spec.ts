import { describe, expect, it } from 'vitest';
import {
  CACHE_VERSION,
  CachedMatch,
  isCacheCurrent,
  isCacheUsable,
  parseCompAnalysisRequest
} from './analysis-cache';

function cached(over: Partial<CachedMatch> = {}): CachedMatch {
  return {
    queueId: 420,
    gameCreation: 1,
    participants: Array.from({ length: 10 }, (_, i) => ({ puuid: 'p' + i })),
    ...over
  };
}

describe('isCacheUsable', () => {
  it('rejects a missing entry', () => {
    expect(isCacheUsable(undefined)).toBe(false);
  });

  it('trusts anything stamped with the current version', () => {
    // We wrote it, so a re-fetch would only produce the same bytes — even if
    // the shape looks odd, which is what stops an endless re-fetch loop.
    expect(isCacheUsable({ cacheVersion: CACHE_VERSION, queueId: 420, gameCreation: 1, participants: [] })).toBe(true);
  });

  it('accepts a legacy entry that looks structurally complete', () => {
    expect(isCacheUsable(cached())).toBe(true);
  });

  it('rejects a legacy entry that is not a full lobby', () => {
    expect(isCacheUsable(cached({ participants: [{ puuid: 'a' }] }))).toBe(false);
    expect(isCacheUsable(cached({ participants: Array.from({ length: 11 }, () => ({ puuid: 'a' })) }))).toBe(false);
  });

  it('rejects a legacy entry with a participant missing a puuid', () => {
    const parts = Array.from({ length: 10 }, (_, i) => ({ puuid: 'p' + i }));
    parts[4] = { puuid: '' };
    expect(isCacheUsable(cached({ participants: parts }))).toBe(false);
  });

  it('rejects a legacy entry whose participants are not an array', () => {
    expect(isCacheUsable(cached({ participants: undefined as never }))).toBe(false);
  });

  it('still accepts a structurally sound entry with an older stamp', () => {
    // Usable is the "can we serve this if we cannot re-fetch it" question, and
    // a stale entry still carries the roster and the result. Whether it is
    // up to date is isCacheCurrent's business, not this one.
    expect(isCacheUsable({ ...cached(), cacheVersion: CACHE_VERSION - 1 })).toBe(true);
  });
});

describe('isCacheCurrent', () => {
  it('rejects a missing entry', () => {
    expect(isCacheCurrent(undefined)).toBe(false);
  });

  it('accepts an entry stamped with the current version', () => {
    expect(isCacheCurrent({ ...cached(), cacheVersion: CACHE_VERSION })).toBe(true);
  });

  it('rejects an entry stamped with an older version', () => {
    expect(isCacheCurrent({ ...cached(), cacheVersion: CACHE_VERSION - 1 })).toBe(false);
  });

  it('rejects an unversioned entry even when it looks structurally perfect', () => {
    // The regression this exists for. Versioning only arrived on 23 Aug 2026,
    // so unversioned entries are the *oldest* ones and the most likely to be
    // missing a field added since. Judging them by shape alone let a
    // CACHE_VERSION bump pass silently over 82 of them.
    expect(isCacheUsable(cached())).toBe(true);
    expect(isCacheCurrent(cached())).toBe(false);
  });
});

describe('parseCompAnalysisRequest', () => {
  const roster = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'Player ' + i }));

  it('accepts a full roster', () => {
    expect(parseCompAnalysisRequest({ players: roster(5) }).players).toHaveLength(5);
  });

  it('allows a few substitutes beyond the five', () => {
    expect(parseCompAnalysisRequest({ players: roster(10) }).players).toHaveLength(10);
  });

  it('rejects fewer than five — a five-stack is the unit it attributes to', () => {
    expect(() => parseCompAnalysisRequest({ players: roster(4) })).toThrow(/between 5 and 10/);
  });

  it('rejects more than ten', () => {
    expect(() => parseCompAnalysisRequest({ players: roster(11) })).toThrow(/between 5 and 10/);
  });

  it('rejects a body that is not an object', () => {
    expect(() => parseCompAnalysisRequest(null)).toThrow();
    expect(() => parseCompAnalysisRequest('players')).toThrow();
  });

  it('requires an id and name on every player', () => {
    const players = [...roster(4), { id: 'x' }];
    expect(() => parseCompAnalysisRequest({ players })).toThrow(/id and name/);
  });

  it('survives a null player rather than throwing on property access', () => {
    expect(() => parseCompAnalysisRequest({ players: [...roster(4), null] })).toThrow(/id and name/);
  });

  it('lowercases regions and trims tags', () => {
    const parsed = parseCompAnalysisRequest({
      players: [{ id: 'a', name: 'A', region: ' EUW1 ', riotTag: ' EUW ' }, ...roster(4)]
    });
    expect(parsed.players[0].region).toBe('euw1');
    expect(parsed.players[0].riotTag).toBe('EUW');
  });

  it('treats comps as optional', () => {
    // Without comps the pass still reports the team's games.
    expect(parseCompAnalysisRequest({ players: roster(5) }).comps).toEqual([]);
    expect(parseCompAnalysisRequest({ players: roster(5), comps: 'nope' }).comps).toEqual([]);
  });

  it('keeps only the champion entries that are strings', () => {
    const parsed = parseCompAnalysisRequest({
      players: roster(5),
      comps: [{ id: 'c1', name: 'Engage', champions: ['Vi', 42, null, 'Ahri'] }]
    });
    expect(parsed.comps[0].champions).toEqual(['Vi', 'Ahri']);
  });

  it('names an unnamed comp rather than leaving it blank', () => {
    const parsed = parseCompAnalysisRequest({ players: roster(5), comps: [{ id: 'c1' }] });
    expect(parsed.comps[0].name).toBe('Comp');
    expect(parsed.comps[0].champions).toEqual([]);
  });
});
