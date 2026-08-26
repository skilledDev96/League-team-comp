import { describe, expect, it } from 'vitest';
import { retryDelayMs, riotEndpointLabel, riotError } from './riot-errors';

describe('riotEndpointLabel', () => {
  it('names the lol endpoint that failed', () => {
    expect(riotEndpointLabel('https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/abc')).toBe('league-v4');
    expect(riotEndpointLabel('https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/abc')).toBe('summoner-v4');
  });

  it('names the riot endpoints too, which sit on a different path', () => {
    expect(riotEndpointLabel('https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/a/b')).toBe('account-v1');
  });

  it('handles hyphenated api names', () => {
    expect(riotEndpointLabel('https://euw1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/x'))
      .toBe('champion-mastery-v4');
  });

  it('falls back rather than throwing on an unrecognised url', () => {
    expect(riotEndpointLabel('https://example.com/whatever')).toBe('the Riot API');
  });
});

describe('riotError', () => {
  const url = 'https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/abc';

  it('says the key is bad on 401', () => {
    const message = riotError(401, url).message;
    expect(message).toContain('401');
    expect(message).toContain('league-v4');
    expect(message).toContain('invalid or expired');
  });

  it('says the key is fine but unauthorised on 403', () => {
    // This is the distinction that hid a retired endpoint behind "key broken".
    const message = riotError(403, url).message;
    expect(message).toContain('403');
    expect(message).toContain('league-v4');
    expect(message).toContain('not authorised');
    expect(message).not.toContain('expired');
  });

  it('does not confuse the two', () => {
    expect(riotError(401, url).message).not.toBe(riotError(403, url).message);
  });

  it('reports any other status with the endpoint', () => {
    const message = riotError(503, url).message;
    expect(message).toContain('503');
    expect(message).toContain('league-v4');
  });
});

describe('retryDelayMs', () => {
  it('waits the window Riot asked for, plus a margin', () => {
    expect(retryDelayMs('10')).toBe(10500);
  });

  it('falls back when the header is missing or unusable', () => {
    expect(retryDelayMs(null)).toBe(2500);
    expect(retryDelayMs('not a number')).toBe(2500);
  });

  it('never returns zero, which would retry straight into the same limit', () => {
    expect(retryDelayMs('0')).toBeGreaterThan(0);
  });
});
