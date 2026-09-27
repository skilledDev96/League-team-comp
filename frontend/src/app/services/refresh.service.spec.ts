import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../environments/environment';
import { BACKEND_BEHIND, BackendBehindError } from '../core/team-echo';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { CompAnalysis, Player, Role } from '../models/team.models';
import { ActivityService } from './activity.service';
import { CompAnalysisService } from './comp-analysis.service';
import { EnrichResponse, mergeChampionPool, PlayerEnrichmentService } from './player-enrichment.service';
import { RefreshService } from './refresh.service';
import { TeamDataService } from './team-data.service';
import { TeamScopeService } from './team-scope.service';
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

/**
 * Pinned to the team it started on (27 Sep 2026, release 2, Stage 3c). Each refresh captures the active team
 * when it starts and checks it before every write; a run the team moved under stops there, says so once, and
 * leaves what already landed. Local mode never chooses a team, so the scope is a fake a case flips mid-run.
 */
describe('RefreshService, pinned to the team it started on', () => {
  type EnrichRequest = { summonerName: string; role?: Role };
  const provider = (over: Partial<EnrichResponse> = {}): EnrichResponse => ({
    playstyle: 'Tempo jungler',
    strengths: ['Pathing'],
    weaknesses: ['Vision'],
    top3: ['Lee Sin'],
    bans: ['Nidalee'],
    source: 'provider',
    provider: 'riot',
    generatedAt: '2026-09-27T10:00:00Z',
    ...over
  });
  const player = (name: string, role: Role): Player => ({ id: name.toLowerCase(), name, role, strengths: [], weaknesses: [], top3: [], bans: [], order: 0 });
  const OTHER_TEAM = 'other-team-a1b2c3';

  const scope = { activeTeamId: signal(DEFAULT_TEAM_ID), choose: vi.fn<(teamId: string) => void>() };
  const compAnalysis = { running: signal(false), refresh: vi.fn<() => Promise<CompAnalysis>>() };
  const enrichPlayer = vi.fn<(request: EnrichRequest) => Promise<EnrichResponse>>();
  let service: RefreshService;
  let data: TeamDataService;
  let toast: ToastService;
  let activity: ActivityService;

  beforeEach(() => {
    localStorage.clear();
    scope.activeTeamId.set(DEFAULT_TEAM_ID);
    compAnalysis.running.set(false);
    compAnalysis.refresh.mockReset();
    enrichPlayer.mockReset();
    enrichPlayer.mockImplementation(async ({ summonerName }) => provider({ playstyle: `${summonerName} plays fast` }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: CompAnalysisService, useValue: compAnalysis },
        { provide: PlayerEnrichmentService, useValue: { enrichPlayer, mergeChampionPool } },
        { provide: TeamScopeService, useValue: scope }
      ]
    });
    service = TestBed.inject(RefreshService);
    data = TestBed.inject(TeamDataService);
    toast = TestBed.inject(ToastService);
    activity = TestBed.inject(ActivityService);
    data.players.set([player('Alpha', 'Top'), player('Bravo', 'Jungle'), player('Charlie', 'Mid')]);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  const titles = () => toast.toasts().map((t) => t.title);

  it('refreshPlayers stops when the team changes mid-run: the player being read is not written, the rest are not read, and the notice says how many landed', async () => {
    enrichPlayer.mockImplementation(async ({ summonerName }) => {
      if (summonerName === 'Bravo') scope.activeTeamId.set(OTHER_TEAM);
      return provider({ playstyle: `${summonerName} plays fast` });
    });
    expect(await service.refreshPlayers()).toEqual({ done: 1, failed: 0, stopped: true });
    expect(enrichPlayer).toHaveBeenCalledTimes(2);
    expect(data.players().map((p) => p.playstyle)).toEqual(['Alpha plays fast', undefined, undefined]);
    expect(titles()).toEqual(['Stopped: the team changed during the player refresh']);
    expect(toast.toasts()[0].text).toMatch(/^1 of 3 were updated before it stopped\./);
    expect(service.playersRunning()).toBe(false);
    expect(activity.jobs()).toEqual([]);
  });

  it('refreshPlayer alone answers stopped and writes nothing', async () => {
    const updatePlayer = vi.spyOn(data, 'updatePlayer');
    enrichPlayer.mockImplementation(async () => {
      scope.activeTeamId.set(OTHER_TEAM);
      return provider();
    });
    expect(await service.refreshPlayer(data.players()[0])).toBe('stopped');
    expect(updatePlayer).not.toHaveBeenCalled();
    expect(data.players()[0].playstyle).toBeUndefined();
  });

  it('refreshAnalysis applies nothing when the team changed while the backend was computing', async () => {
    compAnalysis.refresh.mockImplementation(async () => {
      scope.activeTeamId.set(OTHER_TEAM);
      return analysis;
    });
    await service.refreshAnalysis();
    expect(data.compAnalysis()).toBeNull();
    expect(titles()).toEqual(['Stopped: the team changed during the analysis refresh']);
  });

  it('refreshAll does not go on to the analysis after a stopped player refresh, and says so once', async () => {
    enrichPlayer.mockImplementation(async ({ summonerName }) => {
      if (summonerName === 'Charlie') scope.activeTeamId.set(OTHER_TEAM);
      return provider();
    });
    compAnalysis.refresh.mockResolvedValue(analysis);
    await service.refreshAll();
    expect(compAnalysis.refresh).not.toHaveBeenCalled();
    expect(titles()).toEqual(['Stopped: the team changed during the player refresh']);
    expect(service.allRunning()).toBe(false);
  });

  it('a run the team stayed on finishes with the count, as before', async () => {
    expect(await service.refreshPlayers()).toEqual({ done: 3, failed: 0, stopped: false });
    expect(titles()).toEqual(['Updated all 3 players from Riot']);
  });
});
