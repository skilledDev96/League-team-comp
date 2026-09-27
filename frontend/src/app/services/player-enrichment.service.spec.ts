import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { PlayerEnrichmentService, mergeChampionPool } from './player-enrichment.service';
import { TeamScopeService } from './team-scope.service';

/** The fetch stub the test setup installs: offline, so anything but the enrich call fails fast. */
const offline = () => Promise.reject(new Error('network disabled in tests'));

describe('mergeChampionPool', () => {
  it('appends champions Riot reports that we do not already have', () => {
    const merged = mergeChampionPool(['Yorick', 'Lucian'], ['Trundle', 'Ornn']);
    expect(merged).toEqual(['Yorick', 'Lucian', 'Trundle', 'Ornn']);
  });

  it('keeps the curated order, so the Main Champion stays first', () => {
    const merged = mergeChampionPool(['Trundle', 'Yorick'], ['Yorick', 'Mordekaiser']);
    expect(merged[0]).toBe('Trundle');
    expect(merged).toEqual(['Trundle', 'Yorick', 'Mordekaiser']);
  });

  it('does not duplicate a champion that is already in the pool', () => {
    const merged = mergeChampionPool(['Yorick'], ['Yorick']);
    expect(merged).toEqual(['Yorick']);
  });

  it('treats punctuation and casing as the same champion', () => {
    const merged = mergeChampionPool(["Kai'Sa", 'Miss Fortune'], ['kaisa', 'missfortune']);
    expect(merged).toEqual(["Kai'Sa", 'Miss Fortune']);
  });

  it('never shrinks a hand-curated pool', () => {
    const curated = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const merged = mergeChampionPool(curated, ['A', 'B']);
    expect(merged).toEqual(curated);
  });

  it('handles missing values on either side', () => {
    expect(mergeChampionPool(undefined, ['Yorick'])).toEqual(['Yorick']);
    expect(mergeChampionPool(['Yorick'], undefined)).toEqual(['Yorick']);
    expect(mergeChampionPool(undefined, undefined)).toEqual([]);
  });
});

/**
 * The body `enrichPlayer` sends names the team the read is for (27 Sep 2026, release 3). The function's door
 * asks `roleOf(email, teamId)`, and a body naming no team is judged on Bom Squad's list, so the three
 * services that gained a door in release 3 without gaining the field refused everyone listed on another team
 * alone. Firebase never runs here: the ID token is a method stubbed on the instance and the function is a
 * stubbed `fetch`, so the POST itself is the real one.
 */
describe('PlayerEnrichmentService.enrichPlayer', () => {
  const scope = { activeTeamId: signal(DEFAULT_TEAM_ID), choose: vi.fn<(teamId: string) => void>() };
  let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<unknown>>;
  let service: PlayerEnrichmentService;

  /** The body the service sent, parsed. */
  function sentBody(): Record<string, unknown> {
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/enrichPlayer'));
    expect(call, 'the enrich function was called').toBeDefined();
    return JSON.parse(String(call![1]?.body)) as Record<string, unknown>;
  }

  beforeEach(() => {
    scope.activeTeamId.set(DEFAULT_TEAM_ID);
    fetchMock = vi.fn(async (url: string) => {
      if (!String(url).includes('/enrichPlayer')) return offline();
      return { ok: true, status: 200, json: async () => ({ playstyle: 'Tempo', source: 'provider', provider: 'riot' }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: TeamScopeService, useValue: scope }] });
    service = TestBed.inject(PlayerEnrichmentService);
    (service as unknown as { idToken: () => Promise<string> }).idToken = async () => 'an-id-token';
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.stubGlobal('fetch', vi.fn(offline));
  });

  it('sends no teamId for the default, so Bom Squad\'s body is the body it always was', async () => {
    const answer = await service.enrichPlayer({ summonerName: 'Ruan', riotTag: 'EUW', region: 'EUW', role: 'Top' });
    expect(answer.playstyle).toBe('Tempo');
    expect(sentBody()).toEqual({ summonerName: 'Ruan', riotTag: 'EUW', region: 'euw', role: 'Top' });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer an-id-token' } });
  });

  it('names the active team in the body on any other team', async () => {
    scope.activeTeamId.set('b');
    await service.enrichPlayer({ summonerName: 'Ruan', role: 'Mid' });
    expect(sentBody()).toEqual({ summonerName: 'Ruan', role: 'Mid', teamId: 'b' });
  });

  it("surfaces the function's refusal as its own sentence", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Editor access required to enrich a player.' }) }));
    await expect(service.enrichPlayer({ summonerName: 'Ruan' })).rejects.toThrow('Editor access required to enrich a player.');
  });
});
