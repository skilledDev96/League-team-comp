import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { BACKEND_BEHIND, BackendBehindError } from '../core/team-echo';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { CompAnalysis, Player } from '../models/team.models';
import { CompAnalysisService } from './comp-analysis.service';
import { TeamScopeService } from './team-scope.service';
import { ToastService } from './toast.service';

/**
 * The analysis call and its echo check, wired (27 Sep 2026, release 2, Stage 2). `core/team-echo.spec.ts`
 * pins the check itself; this pins how `refresh()` uses it, which the helper cannot see: the team is read
 * before the job and the echo is checked against that same id, the "refreshed" toast waits for the
 * check, a refused answer is thrown as `BackendBehindError` and never returned, and the activity board
 * does not call it a failed job, because the job ran. Firebase never runs here: the ID token is a method
 * stubbed on the instance and the function is a stubbed `fetch`, so the POST itself is the real one.
 */

const players = [{ id: 'p1', name: 'Ruan', role: 'Top', order: 0, profile: { riotTag: 'EUW', region: 'euw' } }] as unknown as Player[];

/** What `getCompAnalysis` answers, as the check reads it; `teamId` is set per case. */
const analysis = { comps: [], games: [], totalTeamGames: 0, scannedMatches: 0, generatedAt: '2026-09-27T07:00:00.000Z' } as unknown as CompAnalysis;

/** The fetch stub the test setup installs: offline, so anything but the analysis call fails fast. */
const offline = () => Promise.reject(new Error('network disabled in tests'));

describe('CompAnalysisService', () => {
  /** The scope as the test drives it; the real one follows the account and localStorage (its own spec). */
  const scope = { activeTeamId: signal(DEFAULT_TEAM_ID), choose: vi.fn<(teamId: string) => void>() };
  let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<unknown>>;
  /** What the next call answers: the body, and whether it is `ok`. */
  let answer: { ok: boolean; body: Record<string, unknown> };
  /** Runs when the stubbed function is called, before it answers: the place to switch teams mid-run. */
  let midRun: () => void = () => undefined;
  let service: CompAnalysisService;
  let toast: ToastService;

  function create(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: TeamScopeService, useValue: scope }] });
    service = TestBed.inject(CompAnalysisService);
    (service as unknown as { idToken: () => Promise<string> }).idToken = async () => 'an-id-token';
    toast = TestBed.inject(ToastService);
  }

  /** The body the service sent, parsed. */
  function sentBody(): Record<string, unknown> {
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/getCompAnalysis'));
    expect(call, 'the analysis function was called').toBeDefined();
    return JSON.parse(String(call![1]?.body)) as Record<string, unknown>;
  }

  const titles = () => toast.toasts().map((t) => t.title);

  beforeEach(() => {
    scope.activeTeamId.set(DEFAULT_TEAM_ID);
    answer = { ok: true, body: { ...analysis } };
    midRun = () => undefined;
    fetchMock = vi.fn(async (url: string) => {
      if (!String(url).includes('/getCompAnalysis')) return offline();
      midRun();
      return { ok: answer.ok, status: answer.ok ? 200 : 400, json: async () => answer.body };
    });
    vi.stubGlobal('fetch', fetchMock);
    create();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.stubGlobal('fetch', vi.fn(offline));
  });

  it('sends no teamId for the default, accepts an answer with no echo, and says refreshed once', async () => {
    const result = await service.refresh(players, [], {});
    expect(result).toEqual(analysis);
    // The body Bom Squad always sent: the three keys, in that order, and no fourth.
    expect(Object.keys(sentBody())).toEqual(['players', 'comps', 'overrides']);
    expect(fetchMock.mock.calls.find(([url]) => String(url).includes('/getCompAnalysis'))![1]).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer an-id-token' }
    });
    expect(titles()).toEqual(['Match analysis refreshed']);
    expect(service.running()).toBe(false);
  });

  it("names team b in the body and accepts b's echo", async () => {
    scope.activeTeamId.set('b');
    answer.body = { ...analysis, teamId: 'b' };
    const result = await service.refresh(players, [], {});
    expect(result).toMatchObject({ teamId: 'b' });
    expect(sentBody()['teamId']).toBe('b');
    expect(titles()).toEqual(['Match analysis refreshed']);
  });

  it('refuses an answer with no echo for team b, before the refreshed toast and without the board calling the job failed', async () => {
    scope.activeTeamId.set('b');
    // A deployment older than release 2: it ignored the field and answered for the root, saying nothing.
    answer.body = { ...analysis };
    let caught: unknown;
    try {
      await service.refresh(players, [], {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BackendBehindError);
    expect((caught as BackendBehindError).message).toBe(BACKEND_BEHIND);
    expect((caught as BackendBehindError).sentFor).toBe('b');
    expect((caught as BackendBehindError).answeredFor).toBe(DEFAULT_TEAM_ID);
    // Neither "refreshed" nor the board's "failed": the one toast that says so is the applier's.
    expect(titles()).toEqual([]);
    expect(service.running()).toBe(false);
  });

  it("refuses the root's own echo and another team's echo for team b", async () => {
    scope.activeTeamId.set('b');
    for (const echoed of ['default', 'c']) {
      answer.body = { ...analysis, teamId: echoed };
      await expect(service.refresh(players, [], {}), echoed).rejects.toBeInstanceOf(BackendBehindError);
    }
    expect(titles()).toEqual([]);
  });

  it('checks the echo against the team the request was sent for, not the team active when the answer lands', async () => {
    // The team is read once, before the job. A switch while the function runs must not move the
    // goalposts: b asked, b answered, and the answer is b's whatever the scope says now.
    scope.activeTeamId.set('b');
    answer.body = { ...analysis, teamId: 'b' };
    midRun = () => scope.activeTeamId.set('c');
    await expect(service.refresh(players, [], {})).resolves.toMatchObject({ teamId: 'b' });
    expect(sentBody()['teamId']).toBe('b');

    // And the other way: b asked, the scope moved to c, the function echoed c. Not b's answer.
    scope.activeTeamId.set('b');
    answer.body = { ...analysis, teamId: 'c' };
    midRun = () => scope.activeTeamId.set('c');
    await expect(service.refresh(players, [], {})).rejects.toBeInstanceOf(BackendBehindError);
  });

  it("leaves a failed request on the board's own path: an ordinary error, announced as the job failing", async () => {
    scope.activeTeamId.set('b');
    answer = { ok: false, body: { error: 'Riot answered 503.' } };
    let caught: unknown;
    try {
      await service.refresh(players, [], {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(BackendBehindError);
    expect((caught as Error).message).toBe('Riot answered 503.');
    expect(titles()).toEqual(['Refreshing match analysis failed']);
    expect(service.running()).toBe(false);
  });
});
