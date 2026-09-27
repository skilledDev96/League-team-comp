import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, TitleStrategy, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { TeamDataService } from '../services/team-data.service';
import { composeTitle, TeamTitleStrategy } from './team-title.strategy';

/**
 * The window title follows the team (27 Sep 2026, release 2). The routes name the page alone and the
 * strategy appends the team's name from TeamDataService's accessor; a rename or a switch re-applies it
 * under a page that is not navigating. The signed-out case is the one the e2e boot check reads: the
 * accessor is the public root name then, so the login page's title still matches `/Bom ?Squad/i`.
 */

@Component({ template: '' })
class Blank {}

// Sets document.title through Angular's Title service, which needs the DOM only the Angular runner (ng test, jsdom) provides.
describe.skipIf(typeof document === 'undefined')('TeamTitleStrategy', () => {
  const data = { teamName: signal('Bom Squad') };
  let router: Router;
  let title: Title;

  beforeEach(() => {
    data.teamName.set('Bom Squad');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', title: 'Sign in', component: Blank },
          { path: 'home', title: 'Home', component: Blank },
          { path: 'comps', title: 'Comps', component: Blank },
          { path: 'roster', title: 'Roster', component: Blank },
          { path: 'players', title: 'Roster', component: Blank },
          { path: 'untitled', component: Blank }
        ]),
        { provide: TitleStrategy, useClass: TeamTitleStrategy },
        { provide: TeamDataService, useValue: data }
      ]
    });
    router = TestBed.inject(Router);
    title = TestBed.inject(Title);
  });

  it('composes the page and the team, and again on the next page', async () => {
    await router.navigateByUrl('/home');
    expect(title.getTitle()).toBe('Home · Bom Squad');
    await router.navigateByUrl('/comps');
    expect(title.getTitle()).toBe('Comps · Bom Squad');
  });

  it('follows a rename and a team switch without a navigation', async () => {
    await router.navigateByUrl('/home');
    // Admin › Settings renames the team: the accessor moves, the page does not.
    data.teamName.set('Bom Squad Esports');
    TestBed.tick();
    expect(title.getTitle()).toBe('Home · Bom Squad Esports');
    // The switcher moves to another team.
    data.teamName.set('The B Team');
    TestBed.tick();
    expect(title.getTitle()).toBe('Home · The B Team');
    // And the next page composes with the team now showing.
    await router.navigateByUrl('/comps');
    expect(title.getTitle()).toBe('Comps · The B Team');
  });

  it('keeps the name moving between two routes that name the same page', async () => {
    await router.navigateByUrl('/roster');
    expect(title.getTitle()).toBe('Roster · Bom Squad');
    await router.navigateByUrl('/players');
    data.teamName.set('The B Team');
    TestBed.tick();
    expect(title.getTitle()).toBe('Roster · The B Team');
  });

  it('reads the root name on the login page, which is what the accessor holds signed out', async () => {
    // TeamDataService.teamName is the public root meta/settings name until someone is signed in on another
    // team, so the title the deployed site is checked by (e2e/tests/site.spec.ts) is composed from it.
    await router.navigateByUrl('/');
    expect(title.getTitle()).toBe('Sign in · Bom Squad');
    expect(title.getTitle()).toMatch(/Bom ?Squad/i);
  });

  it('is the team alone on a route that names no page', async () => {
    await router.navigateByUrl('/untitled');
    expect(title.getTitle()).toBe('Bom Squad');
    data.teamName.set('The B Team');
    TestBed.tick();
    expect(title.getTitle()).toBe('The B Team');
  });

  it('composes with nothing to guess', () => {
    expect(composeTitle('Home', 'Bom Squad')).toBe('Home · Bom Squad');
    expect(composeTitle(undefined, 'Bom Squad')).toBe('Bom Squad');
    expect(composeTitle('', 'Bom Squad')).toBe('Bom Squad');
  });
});
