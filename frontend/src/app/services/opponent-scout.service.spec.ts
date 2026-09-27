import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../environments/environment';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { Player, Role } from '../models/team.models';
import { ActivityService } from './activity.service';
import { OpponentScoutService } from './opponent-scout.service';
import { EnrichResponse, mergeChampionPool, PlayerEnrichmentService } from './player-enrichment.service';
import { TeamDataService } from './team-data.service';
import { TeamScopeService } from './team-scope.service';
import { ToastService } from './toast.service';

/**
 * The scout pinned to the team it started on (27 Sep 2026, release 2, Stage 3c). A scout writes after every
 * player, on the series or the self-scout document of whichever team is active when the write runs, so it
 * captures the team at its start and checks it before each read and each write: a scout the team moved under
 * stops there, keeps what it saved, and says so instead of "Scouted". Local mode, so TeamDataService opens no
 * listeners and the self-scout write lands on its signal; the scope is a fake a case flips mid-run.
 */

const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

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

describe('OpponentScoutService, pinned to the team it started on', () => {
  const scope = { activeTeamId: signal(DEFAULT_TEAM_ID), choose: vi.fn<(teamId: string) => void>() };
  const enrichPlayer = vi.fn<(request: EnrichRequest) => Promise<EnrichResponse>>();
  let service: OpponentScoutService;
  let data: TeamDataService;
  let toast: ToastService;
  let activity: ActivityService;
  const roster = [player('Alpha', 'Top'), player('Bravo', 'Jungle'), player('Charlie', 'Mid')];

  beforeEach(() => {
    localStorage.clear();
    scope.activeTeamId.set(DEFAULT_TEAM_ID);
    enrichPlayer.mockReset();
    enrichPlayer.mockImplementation(async ({ summonerName }) => provider({ playstyle: `${summonerName} plays fast` }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PlayerEnrichmentService, useValue: { enrichPlayer, mergeChampionPool } },
        { provide: TeamScopeService, useValue: scope }
      ]
    });
    service = TestBed.inject(OpponentScoutService);
    data = TestBed.inject(TeamDataService);
    toast = TestBed.inject(ToastService);
    activity = TestBed.inject(ActivityService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const titles = () => toast.toasts().map((t) => t.title);

  it('stops when the team changes mid-scout: what was saved stays, the rest is not read, and the notice replaces Scouted', async () => {
    const saveSelfScout = vi.spyOn(data, 'saveSelfScout');
    enrichPlayer.mockImplementation(async ({ summonerName }) => {
      if (summonerName === 'Bravo') scope.activeTeamId.set(OTHER_TEAM);
      return provider({ playstyle: `${summonerName} plays fast` });
    });
    await service.scoutOurselves(roster, 'Bom Squad');
    // Alpha was read and saved; Bravo was read and the answer thrown away, since the write would land on the other team.
    expect(enrichPlayer).toHaveBeenCalledTimes(2);
    expect(saveSelfScout).toHaveBeenCalledTimes(1);
    expect(saveSelfScout.mock.calls[0][0].players.map((p) => p.playstyle)).toEqual(['Alpha plays fast', undefined, undefined]);
    expect(titles()).toEqual(['Stopped: the team changed during the scout']);
    expect(service.scouting()).toBeNull();
    expect(service.progress()).toBe('');
    expect(activity.jobs()).toEqual([]);
  });

  it('a scout the team stayed on saves every player and says Scouted', async () => {
    const saveSelfScout = vi.spyOn(data, 'saveSelfScout');
    await service.scoutOurselves(roster, 'Bom Squad');
    expect(saveSelfScout).toHaveBeenCalledTimes(3);
    expect(data.selfScout()?.players.map((p) => p.playstyle)).toEqual(['Alpha plays fast', 'Bravo plays fast', 'Charlie plays fast']);
    expect(titles()).toEqual(['Scouted Bom Squad']);
    expect(activity.jobs()).toEqual([]);
  });
});
