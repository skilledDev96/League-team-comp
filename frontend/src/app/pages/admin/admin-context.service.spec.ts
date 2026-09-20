import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { Comp, Settings } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { ConfirmService } from '../../services/confirm.service';
import { PlayerEnrichmentService } from '../../services/player-enrichment.service';
import { TeamDataService } from '../../services/team-data.service';
import { AdminContextService } from './admin-context.service';
import { AdminPlayersService } from './state/admin-players.service';
import { AdminShellService } from './state/admin-shell.service';

/**
 * The settings save (17 Sep 2026). `meta/settings` is written whole, with no merge, so a field the save forgets
 * is a field it wipes: a teammate fixing the team name would take the banner, the motto or Next patch on with it,
 * and Customs to record would fall back to its estimate without a word. The stored document is typed `Required`,
 * so a field added to `Settings` has to be added here, and the save is then held to keeping it.
 */

const STORED: Required<Settings> = {
  teamName: 'Bom Squad',
  autoAdvisor: true,
  autoReview: true,
  motto: 'Ban the Yorick',
  banner: { champion: 'Yorick', skin: 3 },
  nextPatchOn: '2026-09-23'
};

describe('AdminContextService settings save', () => {
  let ctx: AdminContextService;
  let updateSettings: Mock<(settings: Settings) => Promise<void>>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    updateSettings = vi.fn(async (_settings: Settings) => undefined);
    const data = {
      ready: signal(true),
      settings: signal<Settings>(structuredClone(STORED)),
      players: signal([]),
      fillIns: signal([]),
      comps: signal([]),
      accessEntries: signal([]),
      tournaments: signal([]),
      compAnalysis: signal(null),
      updateSettings
    };
    const empty = convertToParamMap({});
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AdminContextService,
        AdminShellService,
        { provide: AdminPlayersService, useValue: { load: vi.fn(), follow: vi.fn(), playerDrafts: signal([]) } },
        { provide: TeamDataService, useValue: data },
        { provide: AuthService, useValue: { canManageUsers: signal(true) } },
        { provide: ConfirmService, useValue: {} },
        { provide: PlayerEnrichmentService, useValue: {} },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: empty }, queryParamMap: of(empty) } }
      ]
    });
    ctx = TestBed.inject(AdminContextService);
    // The form loads from the stored document once the data is ready.
    TestBed.tick();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads every field of the stored document into the form, Next patch on included', () => {
    expect(ctx.teamName()).toBe('Bom Squad');
    expect(ctx.motto()).toBe('Ban the Yorick');
    expect(ctx.bannerChampion()).toBe('Yorick');
    expect(ctx.bannerSkin()).toBe(3);
    expect(ctx.nextPatchOn()).toBe('2026-09-23');
  });

  it('keeps every other field when the team name is changed, and writes once after the typing stops', () => {
    ctx.setTeamName('Bom Squa');
    ctx.setTeamName('Bom Squad Esports');
    vi.advanceTimersByTime(599);
    expect(updateSettings).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings.mock.calls[0][0]).toEqual({ ...STORED, teamName: 'Bom Squad Esports' });
  });

  it('writes a new Next patch on with the rest of the document', () => {
    ctx.setNextPatchOn('2026-10-07');
    vi.advanceTimersByTime(600);
    expect(updateSettings.mock.calls[0][0]).toEqual({ ...STORED, nextPatchOn: '2026-10-07' });
  });

  it('leaves Next patch on out when the date is cleared, and nothing else', () => {
    ctx.setNextPatchOn('');
    vi.advanceTimersByTime(600);
    const written = updateSettings.mock.calls[0][0];
    expect(written).not.toHaveProperty('nextPatchOn');
    const rest: Settings = { ...STORED };
    delete rest.nextPatchOn;
    expect(written).toEqual(rest);
  });

  it('takes anything but a YYYY-MM-DD as no date', () => {
    ctx.setNextPatchOn('23/09/2026');
    vi.advanceTimersByTime(600);
    expect(ctx.nextPatchOn()).toBe('');
    expect(updateSettings.mock.calls[0][0]).not.toHaveProperty('nextPatchOn');
  });

  it('keeps Next patch on when a checkbox saves at once', () => {
    ctx.setAutoReview(false);
    expect(updateSettings.mock.calls[0][0]).toEqual({ ...STORED, autoReview: false });
  });
});

/**
 * Admin › Comps is the text fallback for the comp board, and it edits the five picks only. Since a seat may
 * also hold fallbacks (20 Sep 2026), a save writing `picks` alone would delete them — `updateComp` is a
 * `setDoc` with no merge, so the document is replaced whole. `saveComp` spreads the existing comp first,
 * which is what keeps them; this holds it to that.
 */
describe('AdminContextService comp save', () => {
  let ctx: AdminContextService;
  let updateComp: Mock<(comp: Comp) => Promise<void>>;

  const stored: Comp = {
    id: 'comp-dive',
    name: 'Dive',
    picks: { Top: 'Maokai', Jungle: 'Vi', Mid: 'Ahri', ADC: 'Jinx', Support: 'Nautilus - hook engage' },
    fallbacks: { Support: ['Leona - same engage, longer lockdown'] },
    notes: 'Force the 5v5',
    order: 3
  };

  beforeEach(() => {
    updateComp = vi.fn(async (_comp: Comp) => undefined);
    const empty = convertToParamMap({});
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AdminContextService,
        AdminShellService,
        { provide: AdminPlayersService, useValue: { load: vi.fn(), follow: vi.fn(), playerDrafts: signal([]) } },
        {
          provide: TeamDataService,
          useValue: {
            ready: signal(true),
            settings: signal<Settings>({ teamName: 'Bom Squad' }),
            players: signal([]),
            fillIns: signal([]),
            comps: signal<Comp[]>([structuredClone(stored)]),
            accessEntries: signal([]),
            tournaments: signal([]),
            compAnalysis: signal(null),
            updateComp
          }
        },
        { provide: AuthService, useValue: { canManageUsers: signal(true) } },
        { provide: ConfirmService, useValue: {} },
        { provide: PlayerEnrichmentService, useValue: {} },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: empty }, queryParamMap: of(empty) } }
      ]
    });
    ctx = TestBed.inject(AdminContextService);
    TestBed.tick();
  });

  it('keeps a seat’s fallbacks when the five are saved as text', async () => {
    await ctx.saveComp({ id: stored.id, name: 'Dive', picks: { ...stored.picks, Top: 'Ornn' } }, true);
    const written = updateComp.mock.calls[0][0];
    expect(written.picks.Top).toBe('Ornn');
    expect(written.fallbacks).toEqual({ Support: ['Leona - same engage, longer lockdown'] });
    expect(written.notes).toBe('Force the 5v5');
  });
});
