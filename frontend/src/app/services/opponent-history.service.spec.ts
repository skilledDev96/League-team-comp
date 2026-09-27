import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { OpponentPlayer } from '../models/team.models';
import { OpponentHistoryService } from './opponent-history.service';
import { TeamScopeService } from './team-scope.service';

/** The fetch stub the test setup installs: offline, so anything but the history call fails fast. */
const offline = () => Promise.reject(new Error('network disabled in tests'));

const THEIR_FIVE = [
  { name: 'Alpha', riotTag: 'EUW', region: 'euw', role: 'Top' },
  { name: 'Bravo', riotTag: 'EUW', region: 'euw', role: 'Jungle' },
  { name: 'Charlie', riotTag: 'EUW', region: 'euw', role: 'Mid' },
  { name: 'Delta', riotTag: 'EUW', region: 'euw', role: 'ADC' },
  { name: 'Echo', riotTag: 'EUW', region: 'euw', role: 'Support' }
] as unknown as OpponentPlayer[];

/**
 * The body `getOpponentHistory` is sent names the team the scout is for (27 Sep 2026, release 3): the function's
 * door asks `roleOf(email, teamId)`, and a body naming no team is judged on Bom Squad's list, which refused a
 * person on another team alone their own scout. Firebase never runs here: the ID token is a method stubbed on
 * the instance and the function is a stubbed `fetch`, so the POST itself is the real one.
 */
describe('OpponentHistoryService', () => {
  const scope = { activeTeamId: signal(DEFAULT_TEAM_ID), choose: vi.fn<(teamId: string) => void>() };
  let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<unknown>>;
  let service: OpponentHistoryService;

  function sentBody(): Record<string, unknown> {
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/getOpponentHistory'));
    expect(call, 'the history function was called').toBeDefined();
    return JSON.parse(String(call![1]?.body)) as Record<string, unknown>;
  }

  beforeEach(() => {
    scope.activeTeamId.set(DEFAULT_TEAM_ID);
    fetchMock = vi.fn(async (url: string) => {
      if (!String(url).includes('/getOpponentHistory')) return offline();
      return { ok: true, status: 200, json: async () => ({ days: 30, games: [], summary: { games: 0, wins: 0, losses: 0, fullStacks: 0, picks: [] } }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: TeamScopeService, useValue: scope }] });
    service = TestBed.inject(OpponentHistoryService);
    (service as unknown as { idToken: () => Promise<string> }).idToken = async () => 'an-id-token';
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.stubGlobal('fetch', vi.fn(offline));
  });

  it('sends the five and the window, and no teamId for the default', async () => {
    const history = await service.load(THEIR_FIVE, { key: 'series-1', label: 'MAD Synergy' });
    expect(history.days).toBe(30);
    expect(Object.keys(sentBody())).toEqual(['days', 'players']);
    expect(sentBody()['players']).toEqual(
      THEIR_FIVE.map((p) => ({ id: `${p.name}#${p.riotTag}`.toLowerCase(), name: p.name, riotTag: p.riotTag, region: p.region }))
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer an-id-token' } });
    expect(service.busy()).toBe('');
  });

  it('names the active team in the body on any other team', async () => {
    scope.activeTeamId.set('b');
    await service.load(THEIR_FIVE, { days: 14 });
    expect(sentBody()).toMatchObject({ days: 14, teamId: 'b' });
  });

  it('refuses six on the table and fewer than two before anything is sent', async () => {
    await expect(service.load([...THEIR_FIVE, THEIR_FIVE[0]])).rejects.toThrow(/mark their bench first/);
    await expect(service.load([THEIR_FIVE[0]])).rejects.toThrow('Paste their roster first.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the function's refusal as its own sentence", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 403, json: async () => ({ error: "Member access required to read an opponent team's history." }) }));
    await expect(service.load(THEIR_FIVE)).rejects.toThrow("Member access required to read an opponent team's history.");
  });
});
