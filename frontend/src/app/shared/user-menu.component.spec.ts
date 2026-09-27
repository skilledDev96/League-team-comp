import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { Team } from '../models/team.models';
import { ActivityService } from '../services/activity.service';
import { AuthService } from '../services/auth.service';
import { TeamDataService } from '../services/team-data.service';
import { TeamScopeService } from '../services/team-scope.service';
import { ToastService } from '../services/toast.service';
import { UserPrefsService } from '../services/user-prefs.service';
import { UserMenuComponent } from './user-menu.component';

/**
 * The Team group in the account menu (27 Sep 2026, release 2, Stage 3c): when it draws, what it lists, and the
 * switch. The rule this release lives by is that Bom Squad's screens do not change, so the first cases pin the
 * menu with no group at all: local mode, and the default team alone for anyone who is not an admin. The switch
 * is an order of three steps, Home before the scope before the document, and a job on the Activity board
 * refuses it outright; both are pinned by the order the fakes record.
 */

const team = (id: string, name: string): Team => ({ id, name, region: 'euw', createdBy: 'lead@example.com', createdAt: '2026-09-27T10:00:00Z' });
const ALPHA = team('alpha-a1b2c3', 'Alpha');
const ZETA = team('zeta-z9y8x7', 'Zeta');

/** A page for the router to land on: the spec's Home. */
@Component({ template: '' })
class Blank {}

function text(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

// Renders under TestBed, which needs the DOM only the Angular runner (ng test, jsdom) provides.
describe.skipIf(typeof localStorage === 'undefined')('UserMenuComponent, the Team group', () => {
  const teams = signal<Team[]>([]);
  /** The teams the person may see are the teams the fake holds: the real service filters its list through AuthService.maySee. */
  const data = { mode: 'firebase' as 'firebase' | 'local', teams, visibleTeams: teams, rootTeamName: signal('Bom Squad') };
  /** A member of the root list, not an admin, unless a case says otherwise (release 3: the root row is a root member's, New team… a root admin's). */
  const auth = { canManageUsers: signal(false), isRootAdmin: signal(false), isRootMember: signal(true) };
  /** The order the switch ran its steps in, as the fakes saw them. */
  let steps: string[];
  const scope = {
    activeTeamId: signal(DEFAULT_TEAM_ID),
    choose: vi.fn<(teamId: string) => void>((teamId) => {
      steps.push(`choose ${teamId}`);
      scope.activeTeamId.set(teamId);
    })
  };
  const prefs = { setTeam: vi.fn<(teamId: string) => Promise<void>>(async (teamId) => void steps.push(`setTeam ${teamId}`)) };
  let navigateByUrl: ReturnType<typeof vi.fn<(url: string) => Promise<boolean>>>;
  /** The spy over the router's own navigateByUrl; the case that needs the real router restores it. */
  let navigateSpy: { mockRestore(): void };
  let activity: ActivityService;
  let toast: ToastService;

  function mount() {
    const fixture = TestBed.createComponent(UserMenuComponent);
    fixture.componentRef.setInput('email', 'lead@example.com');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const open = () => {
      root.querySelector<HTMLButtonElement>('.user-chip-trigger')!.click();
      fixture.detectChanges();
    };
    const rows = () => [...root.querySelectorAll<HTMLButtonElement>('.user-menu-team')];
    const click = async (name: string) => {
      rows().find((r) => text(r.querySelector('.user-menu-team-name')) === name)!.click();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, root, open, rows, click, panel: () => root.querySelector('.user-menu-panel'), group: () => root.querySelector('.user-menu-group') };
  }

  beforeEach(() => {
    localStorage.clear();
    steps = [];
    data.mode = 'firebase';
    data.teams.set([]);
    auth.canManageUsers.set(false);
    auth.isRootAdmin.set(false);
    auth.isRootMember.set(true);
    scope.activeTeamId.set(DEFAULT_TEAM_ID);
    scope.choose.mockClear();
    prefs.setTeam.mockClear();
    navigateByUrl = vi.fn(async (url: string) => {
      steps.push(`navigate ${url}`);
      return true;
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'home', component: Blank }]),
        { provide: TeamDataService, useValue: data },
        { provide: AuthService, useValue: auth },
        { provide: TeamScopeService, useValue: scope },
        { provide: UserPrefsService, useValue: prefs }
      ]
    });
    navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockImplementation(navigateByUrl as unknown as Router['navigateByUrl']);
    activity = TestBed.inject(ActivityService);
    toast = TestBed.inject(ToastService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('draws no group in local mode, whatever the list holds', () => {
    data.mode = 'local';
    data.teams.set([ALPHA]);
    auth.canManageUsers.set(true);
    auth.isRootAdmin.set(true);
    const { open, group, panel } = mount();
    open();
    expect(panel()).not.toBeNull();
    expect(group()).toBeNull();
    expect(panel()!.querySelector('.user-menu-sep')).toBeNull();
  });

  it('draws no group on the default team alone for anyone who is not an admin: the menu is what it was', () => {
    const { open, group, panel } = mount();
    open();
    expect(group()).toBeNull();
    expect(panel()!.children).toHaveLength(0);
  });

  it('draws the group for a root admin with no teams: the root row, checked, and New team… into Admin › Teams', () => {
    auth.canManageUsers.set(true);
    auth.isRootAdmin.set(true);
    const { open, rows, group } = mount();
    open();
    expect(text(group()!.querySelector('.user-menu-group-label'))).toBe('Team');
    expect(rows().map((r) => text(r.querySelector('.user-menu-team-name')))).toEqual(['Bom Squad']);
    expect(rows()[0].getAttribute('aria-current')).toBe('true');
    expect(rows()[0].querySelector('.user-menu-check')).not.toBeNull();
    const link = group()!.querySelector<HTMLAnchorElement>('#user-menu-new-team')!;
    expect(text(link)).toBe('New team…');
    expect(link.getAttribute('href')).toBe('/admin?tab=teams');
  });

  it('lists the root first and the teams by name, the active one checked, and no New team… for a non-admin', () => {
    data.teams.set([ZETA, ALPHA]);
    scope.activeTeamId.set(ZETA.id);
    const { open, rows, group } = mount();
    open();
    expect(rows().map((r) => text(r.querySelector('.user-menu-team-name')))).toEqual(['Bom Squad', 'Alpha', 'Zeta']);
    expect(rows().map((r) => r.getAttribute('aria-current'))).toEqual([null, null, 'true']);
    expect(rows().map((r) => !!r.querySelector('.user-menu-check'))).toEqual([false, false, true]);
    expect(rows().map((r) => r.id)).toEqual(['user-menu-team-default', 'user-menu-team-alpha-a1b2c3', 'user-menu-team-zeta-z9y8x7']);
    expect(group()!.querySelector('#user-menu-new-team')).toBeNull();
  });

  it('draws no New team… for an admin of a team who is not a root admin', () => {
    data.teams.set([ALPHA]);
    scope.activeTeamId.set(ALPHA.id);
    auth.canManageUsers.set(true);
    const { open, rows, group } = mount();
    open();
    expect(rows().map((r) => text(r.querySelector('.user-menu-team-name')))).toEqual(['Bom Squad', 'Alpha']);
    expect(group()!.querySelector('#user-menu-new-team')).toBeNull();
  });

  it('lists no root row for a person on other teams alone, and no group at all while they have one team (release 3)', () => {
    auth.isRootMember.set(false);
    data.teams.set([ALPHA]);
    scope.activeTeamId.set(ALPHA.id);
    const one = mount();
    one.open();
    expect(one.group()).toBeNull();

    data.teams.set([ZETA, ALPHA]);
    const two = mount();
    two.open();
    expect(two.rows().map((r) => text(r.querySelector('.user-menu-team-name')))).toEqual(['Alpha', 'Zeta']);
    expect(two.rows().map((r) => r.getAttribute('aria-current'))).toEqual(['true', null]);
    expect(two.group()!.querySelector('#user-menu-new-team')).toBeNull();
  });

  it('refuses a switch while a job runs: names the job, moves nothing', async () => {
    data.teams.set([ALPHA]);
    const job = activity.begin('Importing roster');
    const { open, click } = mount();
    open();
    await click('Alpha');
    expect(toast.toasts().map((t) => t.title)).toEqual(['Wait for Importing roster to finish before switching teams']);
    expect(steps).toEqual([]);
    expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
    job.end();
  });

  it('switches in order: Home first, then the scope, then the document; the check mark follows', async () => {
    data.teams.set([ALPHA]);
    const { open, click, rows } = mount();
    open();
    await click('Alpha');
    expect(steps).toEqual(['navigate /home', `choose ${ALPHA.id}`, `setTeam ${ALPHA.id}`]);
    expect(toast.toasts().map((t) => t.title)).toEqual(['Switched to Alpha']);
    open();
    expect(rows().map((r) => r.getAttribute('aria-current'))).toEqual([null, 'true']);
  });

  it('the active row is a no-op, and back to the default is a switch like any other', async () => {
    data.teams.set([ALPHA]);
    scope.activeTeamId.set(ALPHA.id);
    const { open, click } = mount();
    open();
    await click('Alpha');
    expect(steps).toEqual([]);
    open();
    await click('Bom Squad');
    expect(steps).toEqual(['navigate /home', `choose ${DEFAULT_TEAM_ID}`, `setTeam ${DEFAULT_TEAM_ID}`]);
  });

  it('a page that would not close leaves the team where it is, and says so', async () => {
    data.teams.set([ALPHA]);
    navigateByUrl.mockResolvedValue(false);
    const { open, click } = mount();
    open();
    await click('Alpha');
    expect(steps).toEqual([]);
    expect(scope.choose).not.toHaveBeenCalled();
    expect(toast.toasts().map((t) => t.title)).toEqual(['The page would not close, so the team was not switched']);
  });

  it('switches from Home itself: the router answers false to the page it is on, and that is not a refusal', async () => {
    // The real router this time, already on /home, where a sign-in lands. navigateByUrl('/home') resolves false there
    // (NavigationSkipped, onSameUrlNavigation 'ignore'), which the switch once read as the page refusing to close, so
    // nobody could switch from the landing page, and the fake above, always true, could not see it.
    navigateSpy.mockRestore();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/home');
    expect(router.url).toBe('/home');
    expect(await router.navigateByUrl('/home')).toBe(false);
    data.teams.set([ALPHA]);
    const { open, click } = mount();
    open();
    await click('Alpha');
    expect(steps).toEqual([`choose ${ALPHA.id}`, `setTeam ${ALPHA.id}`]);
    expect(toast.toasts().map((t) => t.title)).toEqual(['Switched to Alpha']);
    expect(router.url).toBe('/home');
  });

  it('a refused document write keeps the switch on this device', async () => {
    data.teams.set([ALPHA]);
    prefs.setTeam.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
    const { open, click } = mount();
    open();
    await click('Alpha');
    expect(scope.activeTeamId()).toBe(ALPHA.id);
    expect(toast.toasts().map((t) => t.title)).toEqual(['Switched to Alpha']);
  });
});
