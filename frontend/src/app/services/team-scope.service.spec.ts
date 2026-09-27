import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { AuthService } from './auth.service';
import { resetOnTeamChange, TeamScopeService } from './team-scope.service';

/**
 * Where the active team comes from (27 Sep 2026, release 2). Nothing chooses a team yet, so what
 * is pinned is the memory and its edges: the stored id is read the moment someone signs in and
 * without waiting for anything, a stored value that is not a team id is the default, signing out
 * is the default, and local mode is always the default.
 */
describe('TeamScopeService', () => {
  const auth = { mode: 'firebase' as 'firebase' | 'local', userEmail: signal<string | null>(null) };

  function create(): TeamScopeService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: auth }] });
    return TestBed.inject(TeamScopeService);
  }

  beforeEach(() => {
    auth.mode = 'firebase';
    auth.userEmail.set(null);
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
