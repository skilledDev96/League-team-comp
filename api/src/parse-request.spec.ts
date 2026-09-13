import { describe, expect, it } from 'vitest';
import {
  normalizeEmail,
  parseBearerToken,
  parseEnrichRequest,
  parseRosterRequest
} from './parse-request';

describe('parseEnrichRequest', () => {
  it('accepts a minimal body', () => {
    expect(parseEnrichRequest({ summonerName: 'Go10x' }).summonerName).toBe('Go10x');
  });

  it('rejects anything that is not an object', () => {
    for (const body of [null, undefined, 'string', 42, []]) {
      // An array is an object, but has no summonerName, so it fails either way.
      expect(() => parseEnrichRequest(body)).toThrow();
    }
  });

  it('requires a summoner name that is not just whitespace', () => {
    expect(() => parseEnrichRequest({})).toThrow(/summonerName is required/);
    expect(() => parseEnrichRequest({ summonerName: '   ' })).toThrow(/summonerName is required/);
  });

  it('trims the name and lowercases the region', () => {
    const parsed = parseEnrichRequest({ summonerName: '  Go10x  ', region: '  EUW1 ' });
    expect(parsed.summonerName).toBe('Go10x');
    expect(parsed.region).toBe('euw1');
  });

  it('accepts every known role', () => {
    for (const role of ['Top', 'Jungle', 'Mid', 'ADC', 'Support']) {
      expect(parseEnrichRequest({ summonerName: 'x', role }).role).toBe(role);
    }
  });

  it('rejects a role that is not one of the five', () => {
    expect(() => parseEnrichRequest({ summonerName: 'x', role: 'Bot' })).toThrow(/must be one of/);
  });

  it('treats an absent role as absent rather than a default', () => {
    expect(parseEnrichRequest({ summonerName: 'x' }).role).toBeUndefined();
    expect(parseEnrichRequest({ summonerName: 'x', role: '' }).role).toBeUndefined();
  });

  it('ignores fields of the wrong type instead of passing them through', () => {
    const parsed = parseEnrichRequest({ summonerName: 'x', riotTag: 12345, region: {} });
    expect(parsed.riotTag).toBeUndefined();
    expect(parsed.region).toBeUndefined();
  });
});

describe('parseRosterRequest', () => {
  const player = (id: string) => ({ id, name: 'Player ' + id });

  it('accepts between two and five players', () => {
    expect(parseRosterRequest({ players: [player('a'), player('b')] }).players).toHaveLength(2);
    expect(parseRosterRequest({ players: ['a', 'b', 'c', 'd', 'e'].map(player) }).players).toHaveLength(5);
  });

  it('rejects fewer than two — one player is not a roster to read together', () => {
    expect(() => parseRosterRequest({ players: [player('a')] })).toThrow(/between 2 and 5/);
    expect(() => parseRosterRequest({ players: [] })).toThrow(/between 2 and 5/);
  });

  it('rejects more than five, which is not a League team', () => {
    expect(() => parseRosterRequest({ players: ['a', 'b', 'c', 'd', 'e', 'f'].map(player) })).toThrow(/between 2 and 5/);
  });

  it('rejects a players field that is not an array', () => {
    expect(() => parseRosterRequest({ players: 'a,b' })).toThrow();
    expect(() => parseRosterRequest({})).toThrow();
  });

  it('requires every player to have an id and a name', () => {
    expect(() => parseRosterRequest({ players: [player('a'), { id: 'b' }] })).toThrow(/id and name/);
    expect(() => parseRosterRequest({ players: [player('a'), { name: 'B' }] })).toThrow(/id and name/);
    expect(() => parseRosterRequest({ players: [player('a'), { id: ' ', name: ' ' }] })).toThrow(/id and name/);
  });

  it('survives a null entry rather than throwing on property access', () => {
    expect(() => parseRosterRequest({ players: [player('a'), null] })).toThrow(/id and name/);
  });
});

describe('parseBearerToken', () => {
  it('pulls the token out', () => {
    expect(parseBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('is case-insensitive about the scheme', () => {
    expect(parseBearerToken('bearer abc')).toBe('abc');
  });

  it('returns null when there is no header or no bearer scheme', () => {
    expect(parseBearerToken(undefined)).toBeNull();
    expect(parseBearerToken('')).toBeNull();
    expect(parseBearerToken('Basic abc')).toBeNull();
    expect(parseBearerToken('Bearer')).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Someone@Example.COM ')).toBe('someone@example.com');
  });

  it('handles absent values', () => {
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
  });
});

