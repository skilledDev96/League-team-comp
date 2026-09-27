import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { DraftAdvisorService, withoutUnseenBans } from './draft-advisor.service';
import { TeamScopeService } from './team-scope.service';

describe('withoutUnseenBans', () => {
  it('takes every ban nobody saw out of the request, and leaves the rest alone (17 Sep 2026)', () => {
    const request = { action: 'ban', bans: ['Akshan', '-', '', 'Yuumi', '-'], candidates: ['Ahri'] };
    expect(withoutUnseenBans(request)).toEqual({ action: 'ban', bans: ['Akshan', 'Yuumi'], candidates: ['Ahri'] });
    // The caller's own object is not changed.
    expect(request.bans).toHaveLength(5);
  });

  it('passes a request with no bans list through as it is', () => {
    const request = { action: 'pick' };
    expect(withoutUnseenBans(request)).toBe(request);
  });
});

/** The fetch stub the test setup installs: offline, so anything but the advisor call fails fast. */
const offline = () => Promise.reject(new Error('network disabled in tests'));

/**
 * The body `ask` sends names the team the draft is for (27 Sep 2026, release 3): the function's door asks
 * `roleOf(email, teamId)`, and a body naming no team is judged on Bom Squad's list, which refused a contributor
 * on another team alone every ask. Firebase never runs here: the ID token is a method stubbed on the instance
 * and the function is a stubbed `fetch`, so the POST itself is the real one.
 */
describe('DraftAdvisorService.ask', () => {
  const scope = { activeTeamId: signal(DEFAULT_TEAM_ID), choose: vi.fn<(teamId: string) => void>() };
  let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<unknown>>;
  let service: DraftAdvisorService;

  function sentBody(): Record<string, unknown> {
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/draftAdvice'));
    expect(call, 'the advisor function was called').toBeDefined();
    return JSON.parse(String(call![1]?.body)) as Record<string, unknown>;
  }

  beforeEach(() => {
    scope.activeTeamId.set(DEFAULT_TEAM_ID);
    fetchMock = vi.fn(async (url: string) => {
      if (!String(url).includes('/draftAdvice')) return offline();
      return { ok: true, status: 200, json: async () => ({ summary: 'Take Ahri.', picks: [], bans: [], watch: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: TeamScopeService, useValue: scope }] });
    service = TestBed.inject(DraftAdvisorService);
    (service as unknown as { idToken: () => Promise<string> }).idToken = async () => 'an-id-token';
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.stubGlobal('fetch', vi.fn(offline));
  });

  it('sends the request with its unseen bans dropped and no teamId for the default', async () => {
    const answer = await service.ask({ action: 'ban', bans: ['Akshan', '-'], candidates: ['Ahri'] });
    expect(answer.summary).toBe('Take Ahri.');
    expect(sentBody()).toEqual({ action: 'ban', bans: ['Akshan'], candidates: ['Ahri'] });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer an-id-token' } });
    expect(service.busy()).toBe(false);
  });

  it('names the active team in the body on any other team', async () => {
    scope.activeTeamId.set('b');
    await service.ask({ action: 'pick', candidates: ['Ahri'] });
    expect(sentBody()).toEqual({ action: 'pick', candidates: ['Ahri'], teamId: 'b' });
  });

  it("surfaces the function's refusal as its own sentence, and is not busy afterwards", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Editor access required to ask the draft advisor.' }) }));
    await expect(service.ask({ action: 'pick' })).rejects.toThrow('Editor access required to ask the draft advisor.');
    expect(service.busy()).toBe(false);
  });
});
