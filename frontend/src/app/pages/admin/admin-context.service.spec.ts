import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { Comp, Settings, Tournament } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { ConfirmRequest, ConfirmService } from '../../services/confirm.service';
import { PlayerEnrichmentService } from '../../services/player-enrichment.service';
import { TeamDataService } from '../../services/team-data.service';
import { ToastService } from '../../services/toast.service';
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

/**
 * Ending a tournament, the write path (21 Sep 2026, the lead: *"Also we should be able to end a tournament…"*).
 *
 * Ending writes the day and clears the current flag, behind the app's own confirmation — never
 * `window.confirm`, which a browser can answer by itself. Reopening lifts the day and asks nothing, because a
 * wrong click has to be recoverable without a second question. Neither touches a series or a game: ending is
 * not deleting.
 */
describe('AdminContextService ending a tournament', () => {
  let ctx: AdminContextService;
  let updateTournament: Mock<(t: Tournament) => Promise<void>>;
  let ask: Mock<(request: ConfirmRequest) => Promise<boolean>>;

  const oryx: Tournament = { id: 't-oryx', name: 'Oryx Fearless League', order: 0, active: true, startDate: '2026-08-01', endDate: '2026-10-31', fearless: true };
  /** Today the way the app stores it: local, never `toISOString`. */
  const today = (() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  })();

  const setUp = (stored: Tournament) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    updateTournament = vi.fn(async (_t: Tournament) => undefined);
    ask = vi.fn(async (_request: ConfirmRequest) => true);
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
            comps: signal<Comp[]>([]),
            accessEntries: signal([]),
            tournaments: signal<Tournament[]>([structuredClone(stored)]),
            compAnalysis: signal(null),
            updateTournament
          }
        },
        { provide: AuthService, useValue: { canManageUsers: signal(true) } },
        { provide: ConfirmService, useValue: { ask } },
        { provide: PlayerEnrichmentService, useValue: {} },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: empty }, queryParamMap: of(empty) } }
      ]
    });
    ctx = TestBed.inject(AdminContextService);
    TestBed.tick();
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks first, then stores today and clears the current flag', async () => {
    setUp(oryx);
    await ctx.endTournament(ctx.tournamentDrafts()[0]);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toMatchObject({ confirmLabel: 'End tournament' });
    // The question names what happens, because the fear it answers is that ending deletes the split.
    expect(ask.mock.calls[0][0].body).toContain('games keep counting');
    const written = updateTournament.mock.calls[0][0];
    expect(written).toMatchObject({ id: 't-oryx', endedAt: today, active: false });
    // Everything else on the document survives: ending is not editing.
    expect(written).toMatchObject({ name: 'Oryx Fearless League', startDate: '2026-08-01', endDate: '2026-10-31', fearless: true, order: 0 });
    // And the card follows without a reload.
    expect(ctx.tournamentDrafts()[0]).toMatchObject({ endedAt: today, active: false });
  });

  it('writes nothing when the question is answered no', async () => {
    setUp(oryx);
    ask.mockResolvedValueOnce(false);
    await ctx.endTournament(ctx.tournamentDrafts()[0]);
    expect(updateTournament).not.toHaveBeenCalled();
    expect(ctx.tournamentDrafts()[0].endedAt).toBe('');
  });

  it('reopens without a question, lifting the day and leaving Current for a separate press', async () => {
    setUp({ ...oryx, active: false, endedAt: '2026-09-20', finish: '3rd of 12' });
    expect(ctx.tournamentDrafts()[0]).toMatchObject({ endedAt: '2026-09-20', finish: '3rd of 12', active: false });
    await ctx.reopenTournament(ctx.tournamentDrafts()[0]);
    expect(ask).not.toHaveBeenCalled();
    const written = updateTournament.mock.calls[0][0];
    expect(written.endedAt).toBeUndefined();
    expect(written.active).toBe(false);
    expect(written.finish).toBe('3rd of 12');
    expect(ctx.tournamentDrafts()[0].endedAt).toBe('');
  });

  it('keeps a save from marking an ended split current, and carries the finish line', async () => {
    setUp({ ...oryx, active: false, endedAt: '2026-09-20' });
    const draft = { ...ctx.tournamentDrafts()[0], active: true, finish: ' 3rd of 12 ' };
    await ctx.saveTournament(draft);
    const written = updateTournament.mock.calls[0][0];
    expect(written).toMatchObject({ active: false, endedAt: '2026-09-20', finish: '3rd of 12' });
  });

  /**
   * The day is stored data, and Reopen sits a tab stop from the finish line's input (21 Sep 2026). A mis-click
   * used to throw the real day away, and End again wrote today over it with no route back short of Firestore.
   */
  it('offers Undo on a reopen, and the Undo writes the day it lifted back', async () => {
    setUp({ ...oryx, active: false, endedAt: '2026-09-12', finish: '3rd of 12' });
    const toast = TestBed.inject(ToastService);
    await ctx.reopenTournament(ctx.tournamentDrafts()[0]);
    expect(updateTournament.mock.calls[0][0].endedAt).toBeUndefined();
    expect(ctx.tournamentDrafts()[0].endedAt).toBe('');

    const undo = toast.toasts().at(-1)?.action;
    expect(undo?.label).toBe('Undo');
    undo!.run();
    // The pill's run is fire-and-forget, so let its write and the draft patch after it settle.
    await Promise.resolve();
    await Promise.resolve();
    const back = updateTournament.mock.calls[1][0];
    // The real day, not today, and it is still not the current tournament.
    expect(back).toMatchObject({ id: 't-oryx', endedAt: '2026-09-12', active: false, finish: '3rd of 12' });
    expect(ctx.tournamentDrafts()[0]).toMatchObject({ endedAt: '2026-09-12', active: false });
  });
});
