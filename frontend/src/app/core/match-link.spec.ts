import { describe, expect, it } from 'vitest';
import { matchLink } from './match-link';

describe('matchLink', () => {
  it('reads both spellings of a Riot match id and lowercases the region', () => {
    expect(matchLink('EUW1_7975325765')).toBe('https://www.leagueofgraphs.com/match/euw/7975325765');
    expect(matchLink('EUW1-7975325765')).toBe('https://www.leagueofgraphs.com/match/euw/7975325765');
    expect(matchLink('eun1_12')).toBe('https://www.leagueofgraphs.com/match/eune/12');
  });

  it('has no page for an unknown platform, a synthetic replay id, or nothing', () => {
    expect(matchLink('XX9_1')).toBeNull();
    expect(matchLink('scrim:abc:3')).toBeNull();
    expect(matchLink('')).toBeNull();
    expect(matchLink(undefined)).toBeNull();
  });
});
