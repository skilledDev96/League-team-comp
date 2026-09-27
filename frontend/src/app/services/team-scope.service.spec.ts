import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { maySee } from '../core/access';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { AccessRole } from '../models/team.models';
import { AuthService } from './auth.service';
import { resetOnTeamChange, TeamScopeService } from './team-scope.service';

/**
 * Where the active team comes from (27 Sep 2026, release 2). What is pinned is the memory and its edges: the
 * stored id is read the moment someone signs in and without waiting for anything, a stored value that is not a
 * team id is the default, signing out is the default, and local mode is always the default. Since release 3 the
 * rule is over what the person may see: the fake AuthService answers `maySee` from its root role and team map,
 * a root admin by default so every team is theirs, as every case before release 3 assumed.
 */
describe('TeamScopeService', () => {
  const auth = {
    mode: 'firebase' as 'firebase' | 'local',
    userEmail: signal<string | null>(null),
    rootRole: signal<AccessRole | null>('admin'),
    teamRoles: signal<Record<string, AccessRole>>({}),
    maySee: (teamId: string) => maySee(auth.rootRole(), auth.teamRoles(), teamId)
  };

  function create(): TeamScopeService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: auth }] });
    return TestBed.inject(TeamScopeService);
  }

  beforeEach(() => {
    auth.mode = 'firebase';
    auth.userEmail.set(null);
    auth.rootRole.set('admin');
    auth.teamRoles.set({});
    localStorage.clear();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('is the default while nobody is signed in, and a choice made then is not remembered', () => {
    const scope = create();
    expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
    scope.choose('b');
    expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
    expect(localStorage.length).toBe(0);
  });

  it('reads the account\'s stored team the moment they sign in, with no tick in between', () => {
    localStorage.setItem('bom-team:a@example.com', 'b');
    const scope = create();
    auth.userEmail.set('a@example.com');
    // Synchronous on purpose: the listeners a sign-in opens read this in the same effect run, and must land on the
    // stored team rather than on the default first and the stored team a tick later.
    expect(scope.activeTeamId()).toBe('b');
  });

  it('is the default for an account with nothing stored, or with a stored value that is not a team id', () => {
    const scope = create();
    auth.userEmail.set('a@example.com');
    expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
    for (const stale of ['B', 'default', 'teams', '', 'a/b', 'bom squad']) {
      localStorage.setItem('bom-team:b@example.com', stale);
      auth.userEmail.set(null);
      auth.userEmail.set('b@example.com');
      expect(scope.activeTeamId(), JSON.stringify(stale)).toBe(DEFAULT_TEAM_ID);
    }
  });

  it('choose makes a team active and stores it for the account; the default clears the key', () => {
    const scope = create();
    auth.userEmail.set('a@example.com');
    scope.choose('bom-squad-2');
    expect(scope.activeTeamId()).toBe('bom-squad-2');
    expect(localStorage.getItem('bom-team:a@example.com')).toBe('bom-squad-2');
    scope.choose(DEFAULT_TEAM_ID);
    expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
    expect(localStorage.getItem('bom-team:a@example.com')).toBeNull();
  });

  it('refuses a value that is neither the default nor a team id, and keeps the team it had', () => {
    const scope = create();
    auth.userEmail.set('a@example.com');
    scope.choose('b');
    for (const bad of ['B', 'teams', '', 'a/b', 'bom squad']) {
      expect(() => scope.choose(bad), JSON.stringify(bad)).toThrow();
    }
    expect(scope.activeTeamId()).toBe('b');
    expect(localStorage.getItem('bom-team:a@example.com')).toBe('b');
  });

  it('goes back to the default on sign-out, and each account has its own memory', () => {
    const scope = create();
    auth.userEmail.set('a@example.com');
    scope.choose('b');
    auth.userEmail.set(null);
    expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
    // Another account on the same device: nothing of the first one's carries over.
    auth.userEmail.set('c@example.com');
    expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
    // And the first one's choice is still there when they come back.
    auth.userEmail.set('a@example.com');
    expect(scope.activeTeamId()).toBe('b');
  });

  it('holds the choice for the session when localStorage cannot be written, and is the default when it cannot be read', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const scope = create();
    auth.userEmail.set('a@example.com');
    scope.choose('b');
    expect(scope.activeTeamId()).toBe('b');

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    auth.userEmail.set('c@example.com');
    expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
  });

  it('is always the default in local mode, which has one team', () => {
    auth.mode = 'local';
    localStorage.setItem('bom-team:local@preview', 'b');
    const scope = create();
    auth.userEmail.set('local@preview');
    expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
    scope.choose('b');
    expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
    expect(localStorage.getItem('bom-team:local@preview')).toBe('b');
  });

  /**
   * What a person may see decides the team (release 3): a stored key naming a team that has since taken them off
   * its list is passed over, the root is only a root member's to land on, and `choose` refuses a team that is not
   * theirs while the default, "no choice", is always accepted.
   */
  describe('over what the person may see (release 3)', () => {
    it('passes over a stored team they may not see: the root for a root member, their first team for anyone else', () => {
      localStorage.setItem('bom-team:a@example.com', 'gone');
      auth.rootRole.set('viewer');
      auth.teamRoles.set({ c: 'viewer', b: 'contributor' });
      const scope = create();
      auth.userEmail.set('a@example.com');
      expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
      // The key is left as it is: the rule decides, and the person may be put back on the team later.
      expect(localStorage.getItem('bom-team:a@example.com')).toBe('gone');

      auth.rootRole.set(null);
      expect(scope.activeTeamId()).toBe('b');
      // And a stored team they may see is read as before.
      localStorage.setItem('bom-team:a@example.com', 'c');
      auth.userEmail.set(null);
      auth.userEmail.set('a@example.com');
      expect(scope.activeTeamId()).toBe('c');
    });

    it('never lands a person on other teams alone on the root, and moves them the moment their index changes', () => {
      auth.rootRole.set(null);
      auth.teamRoles.set({ b: 'contributor', c: 'viewer' });
      const scope = create();
      auth.userEmail.set('only@example.com');
      expect(scope.activeTeamId()).toBe('b');
      scope.choose('c');
      expect(scope.activeTeamId()).toBe('c');
      // Taken off c: the rule lands on the team that is left, with no tick and no choose.
      auth.teamRoles.set({ b: 'contributor' });
      expect(scope.activeTeamId()).toBe('b');
      // Off every team: nothing to open, and AuthService signs them out from here.
      auth.teamRoles.set({});
      expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
    });

    it('refuses a team the person may not see, and accepts the default as no choice', () => {
      auth.rootRole.set('contributor');
      auth.teamRoles.set({ b: 'viewer' });
      const scope = create();
      auth.userEmail.set('a@example.com');
      scope.choose('b');
      expect(scope.activeTeamId()).toBe('b');
      expect(() => scope.choose('c')).toThrow(/not a member of the team c/);
      expect(scope.activeTeamId()).toBe('b');
      expect(localStorage.getItem('bom-team:a@example.com')).toBe('b');
      scope.choose(DEFAULT_TEAM_ID);
      expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
      expect(localStorage.getItem('bom-team:a@example.com')).toBeNull();

      // For a person on other teams alone the default is their first team, and the key is cleared the same.
      auth.rootRole.set(null);
      scope.choose('b');
      scope.choose(DEFAULT_TEAM_ID);
      expect(scope.activeTeamId()).toBe('b');
      expect(localStorage.getItem('bom-team:a@example.com')).toBeNull();
    });

    it('lets a root admin choose any team, listed in their index or not', () => {
      const scope = create();
      auth.userEmail.set('admin@example.com');
      scope.choose('never-listed');
      expect(scope.activeTeamId()).toBe('never-listed');
    });
  });

  /**
   * The reset the read-on-demand caches and the tournament context hang on: it runs when the account or the team
   * changes and at no other time, so nothing a service read between being made and its first run is thrown away,
   * and nothing survives a switch.
   */
  describe('resetOnTeamChange', () => {
    it('runs the reset on a team change and on an account change, never at first and never for a run with nothing changed', () => {
      const scope = create();
      auth.userEmail.set('a@example.com');
      const reset = vi.fn();
      TestBed.runInInjectionContext(() => resetOnTeamChange(reset));
      TestBed.tick();
      expect(reset).not.toHaveBeenCalled();

      scope.choose('b');
      TestBed.tick();
      expect(reset).toHaveBeenCalledTimes(1);
      TestBed.tick();
      expect(reset).toHaveBeenCalledTimes(1);

      auth.userEmail.set(null);
      TestBed.tick();
      expect(reset).toHaveBeenCalledTimes(2);
      auth.userEmail.set('c@example.com');
      TestBed.tick();
      expect(reset).toHaveBeenCalledTimes(3);
    });

    it('measures from the key at construction, so a change made before its first run still resets', () => {
      const scope = create();
      auth.userEmail.set('a@example.com');
      const reset = vi.fn();
      TestBed.runInInjectionContext(() => resetOnTeamChange(reset));
      scope.choose('b');
      TestBed.tick();
      expect(reset).toHaveBeenCalledTimes(1);
    });
  });
});
