import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationStart, Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { ActivityService } from './services/activity.service';
import { AuthService } from './services/auth.service';
import { MotionService } from './services/motion.service';
import { RefreshService } from './services/refresh.service';
import { TeamDataService } from './services/team-data.service';
import { ThemeService } from './services/theme.service';
import { ToastService } from './services/toast.service';
import { TourService } from './services/tour.service';

/**
 * The shell when a session ends somewhere other than its own Log out (27 Sep 2026): another tab signs out, Firebase
 * ends the session, or TeamDataService signs out someone whose access was withdrawn. TeamDataService empties every
 * signal and the nav goes with the session, so a tab left on its guarded page showed an empty page with no way out
 * but a reload. The shell now takes it to the login page with the way back, as the guard does on a cold start.
 *
 * Only the shell's class is under test: its template is emptied and every service it reads is a stand-in.
 */

@Component({ template: '' })
class Blank {}

describe('App, when the session ends', () => {
  const auth = {
    mode: 'firebase' as const,
    ready: signal(false),
    isAuthed: signal(false),
    editing: signal(false),
    logout: vi.fn<() => Promise<void>>()
  };
  let router: Router;
  let starts: string[];

  /** The shell, on a page, with the session as given; one shell a test, as in the app. */
  let shell: { logout(): Promise<void> } | null;
  async function boot(url: string, authed: boolean): Promise<{ logout(): Promise<void> }> {
    auth.ready.set(true);
    auth.isAuthed.set(authed);
    shell ??= TestBed.createComponent(App).componentInstance as unknown as { logout(): Promise<void> };
    await router.navigateByUrl(url);
    await settle();
    starts = [];
    return shell;
  }

  async function settle(): Promise<void> {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  beforeEach(() => {
    auth.ready.set(false);
    auth.isAuthed.set(false);
    auth.logout.mockReset();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: Blank },
          { path: 'login', component: Blank },
          { path: 'home', component: Blank },
          { path: 'tournaments', component: Blank }
        ]),
        { provide: AuthService, useValue: auth },
        { provide: TeamDataService, useValue: { ready: signal(true), settings: signal({ teamName: '' }) } },
        { provide: TourService, useValue: {} },
        { provide: MotionService, useValue: {} },
        { provide: ThemeService, useValue: {} },
        { provide: ToastService, useValue: { once: vi.fn() } },
        { provide: ActivityService, useValue: {} },
        { provide: RefreshService, useValue: {} }
      ]
    });
    TestBed.overrideComponent(App, {
      set: { template: '', templateUrl: undefined, styleUrl: undefined, styleUrls: undefined, styles: [], imports: [] }
    });
    router = TestBed.inject(Router);
    shell = null;
    starts = [];
    router.events.subscribe((event) => {
      if (event instanceof NavigationStart) starts.push(event.url);
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('takes a tab signed out elsewhere from its guarded page to the login, with the way back', async () => {
    await boot('/tournaments?view=draft&series=s1', true);
    expect(router.url).toBe('/tournaments?view=draft&series=s1');

    auth.isAuthed.set(false);
    await settle();
    expect(router.url).toBe('/login?returnUrl=%2Ftournaments%3Fview%3Ddraft%26series%3Ds1');
  });

  it('still gets there when the page answers the emptied data with a navigation of its own', async () => {
    await boot('/tournaments?view=draft&series=s1', true);
    auth.isAuthed.set(false);
    TestBed.tick();
    // What Prep & Draft does once its series is gone from the data: drops it from the query. That cancels the
    // shell's navigation and lands on the same guarded route, where no guard runs again for a query change.
    void router.navigateByUrl('/tournaments');
    await settle();
    expect(starts).toContain('/tournaments');
    expect(router.url).toBe('/login?returnUrl=%2Ftournaments');
  });

  it('leaves the login page where it is, and a cold start to the guard', async () => {
    await boot('/login', false);
    await settle();
    expect(starts).toEqual([]);
    expect(router.url).toBe('/login');

    await boot('/', false);
    await settle();
    expect(starts).toEqual([]);
    expect(router.url).toBe('/');
  });

  it('does nothing before the first auth state has settled', async () => {
    await boot('/home', true);
    auth.ready.set(false);
    auth.isAuthed.set(false);
    await settle();
    expect(starts).toEqual([]);
    expect(router.url).toBe('/home');
  });

  it('lets Log out make the one navigation, to the login page without a way back', async () => {
    const app = await boot('/home', true);
    auth.logout.mockImplementation(async () => {
      auth.isAuthed.set(false);
      // The session's end reaches the shell while Log out is still on its way to the login page.
      TestBed.tick();
    });
    await app.logout();
    await settle();
    expect(starts).toEqual(['/login']);
    expect(router.url).toBe('/login');
  });
});
