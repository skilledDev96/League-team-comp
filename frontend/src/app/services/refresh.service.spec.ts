import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../environments/environment';
import { BACKEND_BEHIND, BackendBehindError } from '../core/team-echo';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { CompAnalysis } from '../models/team.models';
import { CompAnalysisService } from './comp-analysis.service';
import { RefreshService } from './refresh.service';
import { TeamDataService } from './team-data.service';
import { ToastService } from './toast.service';

/**
 * The applier of the analysis answer on the Refresh side (27 Sep 2026, release 2, Stage 2). The
 * service refuses an answer computed for another team with `BackendBehindError`; `refreshAnalysis`
 * then shows one toast and applies nothing, and lets any other failure through to the caller as it
 * always did. The Games page is the other applier, pinned in its own spec.
 */

// Local mode, so TeamDataService opens no listeners; what the test sets on its signals is what it holds.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

const analysis = { comps: [], games: [], totalTeamGames: 3, scannedMatches: 3, generatedAt: '2026-09-27T07:00:00.000Z' } as unknown as CompAnalysis;

describe('RefreshService.refreshAnalysis', () => {
  /** The analysis service as the test drives it: the call is a stub, the running flag is real enough. */
  const compAnalysis = { running: signal(false), refresh: vi.fn<() => Promise<CompAnalysis>>() };
  let service: RefreshService;
  let data: TeamDataService;
  let toast: ToastService;

  beforeEach(() => {
    localStorage.clear();
    compAnalysis.running.set(false);
    compAnalysis.refresh.mockReset();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: CompAnalysisService, useValue: compAnalysis }] });
    service = TestBed.inject(RefreshService);
    data = TestBed.inject(TeamDataService);
    toast = TestBed.inject(ToastService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('shows one toast and applies nothing when the service refuses an answer computed for another team', async () => {
    const before = { ...analysis, totalTeamGames: 1 } as CompAnalysis;
    data.compAnalysis.set(before);
    compAnalysis.refresh.mockRejectedValue(new BackendBehindError('b', DEFAULT_TEAM_ID));
    await expect(service.refreshAnalysis()).resolves.toBeUndefined();
    expect(data.compAnalysis()).toBe(before);
    expect(toast.toasts().map((t) => ({ title: t.title, kind: t.kind }))).toEqual([{ title: BACKEND_BEHIND, kind: 'warn' }]);
  });

  it('lets any other failure through to the caller, with no toast of its own', async () => {
    compAnalysis.refresh.mockRejectedValue(new Error('Riot answered 503.'));
    await expect(service.refreshAnalysis()).rejects.toThrow('Riot answered 503.');
    expect(toast.toasts()).toEqual([]);
    expect(data.compAnalysis()).toBeNull();
  });

  it('applies an answer the service accepted', async () => {
    compAnalysis.refresh.mockResolvedValue(analysis);
    await service.refreshAnalysis();
    expect(data.compAnalysis()).toBe(analysis);
    expect(toast.toasts()).toEqual([]);
  });

  it('does nothing while a run is already in flight', async () => {
    compAnalysis.running.set(true);
    await service.refreshAnalysis();
    expect(compAnalysis.refresh).not.toHaveBeenCalled();
  });
});
