import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { BACKEND_BEHIND } from '../core/team-echo';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { GameReview } from '../models/team.models';
import { GameReviewService } from './game-review.service';
import { TeamScopeService } from './team-scope.service';
import { ToastService } from './toast.service';

/**
 * The review call and its echo check, wired (27 Sep 2026, release 2, Stage 2). `core/team-echo.spec.ts`
 * pins the check; this pins its place in `call()`: the team is read before the job, the body names it
 * the way Bom Squad's body never did, and the echo is checked before the verdict, so a stale
 * deployment's root decline is refused as "behind this build" and not shown as the reviewer declining.
 * The refusal rides the path every review failure takes: `review()` answers null and keeps the sentence
 * per match, and the activity board announces it. Firebase never runs here: the ID token is a method
 * stubbed on the instance and the function is a stubbed `fetch`, so the POST itself is the real one.
 */

const MATCH_ID = 'EUW1_7000000001';
const DECLINED = 'The reviewer declined to write about this game.';

const written = { matchId: MATCH_ID, reviewedAt: '2026-09-27T07:00:00.000Z', trigger: 'manual', headline: 'Fine.' } as unknown as GameReview;

/** The fetch stub the test setup installs: offline, so anything but the review call fails fast. */
const offline = () => Promise.reject(new Error('network disabled in tests'));

describe('GameReviewService', () => {
  /** The scope as the test drives it; the real one follows the account and localStorage (its own spec). */
  const scope = { activeTeamId: signal(DEFAULT_TEAM_ID), choose: vi.fn<(teamId: string) => void>() };
  let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<unknown>>;
  let answer: { ok: boolean; body: Record<string, unknown> };
  /** Runs when the stubbed function is called, before it answers: the place to switch teams mid-run. */
  let midRun: () => void = () => undefined;
  let service: GameReviewService;
  let toast: ToastService;

  function create(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: TeamScopeService, useValue: scope }] });
    service = TestBed.inject(GameReviewService);
    (service as unknown as { idToken: () => Promise<string> }).idToken = async () => 'an-id-token';
    toast = TestBed.inject(ToastService);
  }

  /** The body the service sent, as the string it went as. */
  function sentBody(): string {
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/gameReview'));
    expect(call, 'the review function was called').toBeDefined();
    return String(call![1]?.body);
  }

  beforeEach(() => {
    scope.activeTeamId.set(DEFAULT_TEAM_ID);
    answer = { ok: true, body: { ...written } };
    midRun = () => undefined;
    fetchMock = vi.fn(async (url: string) => {
      if (!String(url).includes('/gameReview')) return offline();
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

  it("sends Bom Squad's body byte for byte, and accepts an answer with no echo", async () => {
    const review = await service.review(MATCH_ID, null);
    expect(review).toEqual(written);
    expect(sentBody()).toBe(`{"matchId":"${MATCH_ID}","expect":null}`);
    expect(service.errorFor(MATCH_ID)).toBeUndefined();
    expect(service.isBusy(MATCH_ID)).toBe(false);
  });

  it("names team b in the body and accepts b's echo, written or declined", async () => {
    scope.activeTeamId.set('b');
    answer.body = { ...written, teamId: 'b' };
    expect(await service.review(MATCH_ID, null)).toMatchObject({ matchId: MATCH_ID, teamId: 'b' });
    expect(sentBody()).toBe(`{"matchId":"${MATCH_ID}","expect":null,"teamId":"b"}`);
    expect(service.errorFor(MATCH_ID)).toBeUndefined();

    // A declined verdict that is b's is the reviewer declining, as before.
    answer.body = { declined: true, teamId: 'b' };
    expect(await service.review(MATCH_ID, null)).toBeNull();
    expect(service.errorFor(MATCH_ID)).toBe(DECLINED);
  });

  it("refuses a declined verdict with no echo for team b as behind this build, not as the reviewer declining", async () => {
    // A deployment older than release 2 declined the root's game: its verdict is about another team.
    scope.activeTeamId.set('b');
    answer.body = { declined: true };
    expect(await service.review(MATCH_ID, null)).toBeNull();
    expect(service.errorFor(MATCH_ID)).toBe(BACKEND_BEHIND);
    expect(service.errorFor(MATCH_ID)).not.toBe(DECLINED);
    // The board announced it the way it announces every review failure, with the sentence.
    expect(toast.toasts().map((t) => [t.title, t.text])).toEqual([['Reviewing the game failed', BACKEND_BEHIND]]);
    expect(service.isBusy(MATCH_ID)).toBe(false);
  });

  it('refuses a written review with no echo, or with another team echoed, for team b', async () => {
    scope.activeTeamId.set('b');
    const bodies: Record<string, unknown>[] = [{ ...written }, { ...written, teamId: 'default' }, { ...written, teamId: 'c' }];
    for (const body of bodies) {
      answer.body = body;
      const echoed = JSON.stringify(body['teamId']);
      expect(await service.review(MATCH_ID, null), echoed).toBeNull();
      expect(service.errorFor(MATCH_ID), echoed).toBe(BACKEND_BEHIND);
    }
  });

  it('checks the echo against the team the request was sent for, not the team active when the answer lands', async () => {
    scope.activeTeamId.set('b');
    answer.body = { ...written, teamId: 'b' };
    midRun = () => scope.activeTeamId.set('c');
    expect(await service.review(MATCH_ID, null)).toMatchObject({ teamId: 'b' });
    expect(sentBody()).toContain('"teamId":"b"');
    expect(service.errorFor(MATCH_ID)).toBeUndefined();
  });

  it('keeps a failed request as the error it was', async () => {
    scope.activeTeamId.set('b');
    answer = { ok: false, body: { error: 'Editor access required to review a game.' } };
    expect(await service.review(MATCH_ID, null)).toBeNull();
    expect(service.errorFor(MATCH_ID)).toBe('Editor access required to review a game.');
  });
});
