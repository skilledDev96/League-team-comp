import { TestBed } from '@angular/core/testing';
import type { Auth, User } from 'firebase/auth';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { environment } from '../../environments/environment';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { AccessRole } from '../models/team.models';
import { AuthService } from './auth.service';
import { TeamScopeService } from './team-scope.service';

/**
 * AuthService's gate in Firebase mode (27 Sep 2026): the first auth state always lets the guards go, and a signed-in
 * person can be asked about again when the rules start refusing them.
 *
 * Under the members-only rules the own-access read can fail: a session from a door the rules do not count is refused
 * it, and it fails offline. That failure used to escape the auth-state callback before `markReady`, so viewerGuard and
 * authGuard waited for good and a shared link opened onto an empty outlet, with an uncaught rejection on the console.
 *
 * Since release 3 (the same day) a second read, the person's `members/{email}` index, says which other teams they
 * are on, and the roles follow the active team; the cases under "a role per team" pin that with the real
 * TeamScopeService, so the two services are proved to agree through the choice store.
 *
 * Firebase never runs here. Auth, the auth-state subscription, the two reads and the sign-out are methods on the
 * service (the ReplayRecordingService pattern), stubbed on the prototype before the constructor runs.
 */

type AccessDoc = { role?: AccessRole; active?: boolean };
type MembersDoc = { teams?: unknown };
type Proto = {
  authInstance: () => Auth | null;
  watchAuthState: (auth: Auth, next: (user: User | null) => void) => void;
  readAccess: (email: string) => Promise<AccessDoc | null>;
  readMembers: (email: string) => Promise<MembersDoc | null>;
  signOutOf: (auth: Auth) => Promise<void>;
};

const FAKE_AUTH = { name: 'spec-auth' } as unknown as Auth;
const user = (email: string) => ({ email }) as User;
const refused = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
const offline = () => Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });

/** Resolves 'ready' if the service settles its first auth state within a few ticks, 'pending' if it never does. */
function readyOrPending(auth: AuthService): Promise<'ready' | 'pending'> {
  return Promise.race([
    auth.waitUntilReady().then(() => 'ready' as const),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 50))
  ]);
}

let savedApiKey = '';
beforeAll(() => {
  savedApiKey = environment.firebase.apiKey;
});
afterAll(() => {
  environment.firebase.apiKey = savedApiKey;
});

describe('AuthService in Firebase mode', () => {
  let next: (user: User | null) => void;
  let readAccess: Mock<(email: string) => Promise<AccessDoc | null>>;
  let readMembers: Mock<(email: string) => Promise<MembersDoc | null>>;
  let signOutOf: Mock<(auth: Auth) => Promise<void>>;
  let warn: Mock<(...args: unknown[]) => void>;
  let consoleError: Mock<(...args: unknown[]) => void>;

  function create(): AuthService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    return TestBed.inject(AuthService);
  }

  /** Sign in the way Firebase reports it, and let the gate finish. */
  async function arrive(auth: AuthService, email: string): Promise<void> {
    next(user(email));
    await auth.waitUntilReady();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  beforeEach(() => {
    environment.firebase.apiKey = savedApiKey || 'spec-api-key';
    localStorage.clear();
    const proto = AuthService.prototype as unknown as Proto;
    vi.spyOn(proto, 'authInstance').mockReturnValue(FAKE_AUTH);
    vi.spyOn(proto, 'watchAuthState').mockImplementation((_auth, callback) => {
      next = callback;
    });
    readAccess = vi.fn();
    vi.spyOn(proto, 'readAccess').mockImplementation(readAccess);
    // No index unless a case writes one: what every root member had before release 3.
    readMembers = vi.fn(async () => null);
    vi.spyOn(proto, 'readMembers').mockImplementation(readMembers);
    // Firebase reports a sign-out as the next auth state, as the real one does.
    signOutOf = vi.fn(async () => next(null));
    vi.spyOn(proto, 'signOutOf').mockImplementation(signOutOf);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined) as unknown as Mock<(...args: unknown[]) => void>;
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined) as unknown as Mock<(...args: unknown[]) => void>;
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('the first auth state', () => {
    it('lets a member with an active entry in', async () => {
      readAccess.mockResolvedValue({ active: true, role: 'viewer' });
      const auth = create();
      next(user('Viewer@Example.com'));
      expect(await readyOrPending(auth)).toBe('ready');
      expect(readAccess).toHaveBeenCalledWith('viewer@example.com');
      expect(auth.userEmail()).toBe('viewer@example.com');
      expect(auth.role()).toBe('viewer');
    });

    it('lets the guards go when the access read is refused, and signs that session out', async () => {
      readAccess.mockRejectedValue(refused());
      const auth = create();
      next(user('old-password-session@example.com'));
      expect(await readyOrPending(auth)).toBe('ready');
      expect(auth.isAuthed()).toBe(false);
      expect(auth.role()).toBeNull();
      expect(signOutOf).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('lets the guards go when the access read fails offline, and keeps the session for a reload', async () => {
      readAccess.mockRejectedValue(offline());
      const auth = create();
      next(user('viewer@example.com'));
      expect(await readyOrPending(auth)).toBe('ready');
      expect(auth.isAuthed()).toBe(false);
      expect(signOutOf).not.toHaveBeenCalled();
      expect(String(warn.mock.calls[0]?.[0])).toContain('unavailable');
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('still signs out an entry that is not active, without a warning', async () => {
      readAccess.mockResolvedValue({ active: false, role: 'viewer' });
      const auth = create();
      next(user('inactive@example.com'));
      expect(await readyOrPending(auth)).toBe('ready');
      expect(auth.isAuthed()).toBe(false);
      expect(signOutOf).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('confirmAccess, when the rules start refusing someone signed in', () => {
    it('answers true and keeps them in while the entry is still active', async () => {
      readAccess.mockResolvedValue({ active: true, role: 'viewer' });
      const auth = create();
      await arrive(auth, 'viewer@example.com');
      expect(await auth.confirmAccess()).toBe(true);
      expect(readAccess).toHaveBeenCalledTimes(2);
      expect(signOutOf).not.toHaveBeenCalled();
      expect(auth.userEmail()).toBe('viewer@example.com');
    });

    it('signs them out and answers false once the entry is unticked or gone', async () => {
      readAccess.mockResolvedValue({ active: true, role: 'contributor' });
      const auth = create();
      await arrive(auth, 'contributor@example.com');

      readAccess.mockResolvedValue({ active: false, role: 'contributor' });
      expect(await auth.confirmAccess()).toBe(false);
      expect(signOutOf).toHaveBeenCalledTimes(1);
      expect(auth.isAuthed()).toBe(false);

      await arrive(auth, 'contributor@example.com');
      readAccess.mockResolvedValue(null);
      expect(await auth.confirmAccess()).toBe(false);
      expect(signOutOf).toHaveBeenCalledTimes(2);
    });

    it('takes the role back when the entry is still active in another one', async () => {
      readAccess.mockResolvedValue({ active: true, role: 'admin' });
      const auth = create();
      await arrive(auth, 'admin@example.com');
      expect(auth.canManageUsers()).toBe(true);

      readAccess.mockResolvedValue({ active: true, role: 'contributor' });
      expect(await auth.confirmAccess()).toBe(true);
      expect(auth.role()).toBe('contributor');
      expect(auth.canManageUsers()).toBe(false);
    });

    it('answers true for the bootstrap admin without a read, and false with nobody signed in', async () => {
      const auth = create();
      expect(await auth.confirmAccess()).toBe(false);
      await arrive(auth, 'ruanhart7@gmail.com');
      expect(await auth.confirmAccess()).toBe(true);
      expect(readAccess).not.toHaveBeenCalled();
      expect(readMembers).not.toHaveBeenCalled();
    });

    it('throws when the entry cannot be read, so the caller can tell "still in" from "could not ask"', async () => {
      readAccess.mockResolvedValue({ active: true, role: 'viewer' });
      const auth = create();
      await arrive(auth, 'viewer@example.com');
      readAccess.mockRejectedValue(offline());
      await expect(auth.confirmAccess()).rejects.toMatchObject({ code: 'unavailable' });
      expect(signOutOf).not.toHaveBeenCalled();
      expect(auth.isAuthed()).toBe(true);
    });
  });

  describe('a role per team (release 3)', () => {
    it('lands a root viewer with no index on the root, as the e2e viewer does, with no team preference', async () => {
      readAccess.mockResolvedValue({ active: true, role: 'viewer' });
      const auth = create();
      const scope = TestBed.inject(TeamScopeService);
      await arrive(auth, 'viewer@example.com');
      expect(readMembers).toHaveBeenCalledWith('viewer@example.com');
      expect(auth.isAuthed()).toBe(true);
      expect(auth.isRootMember()).toBe(true);
      expect(auth.isRootAdmin()).toBe(false);
      expect(auth.teamsOf()).toEqual([]);
      expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
      expect(auth.role()).toBe('viewer');
      expect(auth.canEdit()).toBe(false);
      expect(auth.canManageUsers()).toBe(false);
      expect(auth.maySee('b')).toBe(false);
      expect(localStorage.length).toBe(0);
    });

    it('lets a person on other teams alone in, on their first team, and refuses them the root', async () => {
      readAccess.mockResolvedValue(null);
      readMembers.mockResolvedValue({ teams: { c: 'viewer', b: 'contributor' } });
      const auth = create();
      const scope = TestBed.inject(TeamScopeService);
      await arrive(auth, 'only@example.com');
      expect(auth.isAuthed()).toBe(true);
      expect(signOutOf).not.toHaveBeenCalled();
      expect(auth.isRootMember()).toBe(false);
      expect(auth.rootRole()).toBeNull();
      expect(auth.teamsOf()).toEqual(['b', 'c']);
      // Their first team, by id, since the root is not theirs to land on.
      expect(scope.activeTeamId()).toBe('b');
      expect(auth.role()).toBe('contributor');
      expect(auth.canEdit()).toBe(true);
      expect(auth.canManageUsers()).toBe(false);
      expect(auth.roleFor(DEFAULT_TEAM_ID)).toBeNull();
      expect(auth.maySee(DEFAULT_TEAM_ID)).toBe(false);
      expect(auth.roleFor('d')).toBeNull();
      // The switcher: a team of theirs, yes; another, no; the default is "no choice" and the rule answers b again.
      scope.choose('c');
      expect(scope.activeTeamId()).toBe('c');
      expect(auth.role()).toBe('viewer');
      expect(auth.canEdit()).toBe(false);
      expect(() => scope.choose('d')).toThrow(/not a member/);
      expect(scope.activeTeamId()).toBe('c');
      scope.choose(DEFAULT_TEAM_ID);
      expect(scope.activeTeamId()).toBe('b');
    });

    it('makes a root admin an admin of every team, with no index read needed', async () => {
      readAccess.mockResolvedValue({ active: true, role: 'admin' });
      readMembers.mockRejectedValue(refused());
      const auth = create();
      const scope = TestBed.inject(TeamScopeService);
      await arrive(auth, 'admin@example.com');
      expect(auth.isAuthed()).toBe(true);
      expect(auth.isRootAdmin()).toBe(true);
      expect(auth.teamsOf()).toEqual([]);
      expect(auth.roleFor('never-listed')).toBe('admin');
      expect(auth.maySee('never-listed')).toBe(true);
      scope.choose('never-listed');
      expect(scope.activeTeamId()).toBe('never-listed');
      expect(auth.role()).toBe('admin');
      expect(auth.canManageUsers()).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    });

    it('reads a refused index as no teams, never as a refusal to sign in', async () => {
      readAccess.mockResolvedValue({ active: true, role: 'contributor' });
      readMembers.mockRejectedValue(refused());
      const auth = create();
      await arrive(auth, 'contributor@example.com');
      expect(auth.isAuthed()).toBe(true);
      expect(auth.role()).toBe('contributor');
      expect(auth.teamsOf()).toEqual([]);
      expect(signOutOf).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      // Any other failure of the index read is the sign-in failing, as the root read's is.
      readMembers.mockRejectedValue(offline());
      await expect(auth.confirmAccess()).rejects.toMatchObject({ code: 'unavailable' });
    });

    it('signs out a person with an inactive root entry and no teams, and keeps one with an inactive entry but a team', async () => {
      readAccess.mockResolvedValue({ active: false, role: 'admin' });
      const auth = create();
      const scope = TestBed.inject(TeamScopeService);
      await arrive(auth, 'off@example.com');
      expect(auth.isAuthed()).toBe(false);
      expect(signOutOf).toHaveBeenCalledTimes(1);

      readMembers.mockResolvedValue({ teams: { b: 'viewer' } });
      await arrive(auth, 'off@example.com');
      expect(auth.isAuthed()).toBe(true);
      // A root admin switched off at the root is nobody on the root and only what b says on b.
      expect(auth.isRootAdmin()).toBe(false);
      expect(scope.activeTeamId()).toBe('b');
      expect(auth.role()).toBe('viewer');
    });

    it('follows the index on confirmAccess: moved off the active team to their next, and signed out off their last', async () => {
      readAccess.mockResolvedValue(null);
      readMembers.mockResolvedValue({ teams: { b: 'contributor', c: 'viewer' } });
      const auth = create();
      const scope = TestBed.inject(TeamScopeService);
      await arrive(auth, 'only@example.com');
      expect(scope.activeTeamId()).toBe('b');

      readMembers.mockResolvedValue({ teams: { c: 'viewer' } });
      expect(await auth.confirmAccess()).toBe(true);
      expect(auth.teamsOf()).toEqual(['c']);
      expect(scope.activeTeamId()).toBe('c');
      expect(auth.role()).toBe('viewer');

      readMembers.mockResolvedValue(null);
      expect(await auth.confirmAccess()).toBe(false);
      expect(signOutOf).toHaveBeenCalledTimes(1);
      expect(auth.isAuthed()).toBe(false);
      expect(auth.teamsOf()).toEqual([]);
    });

    it('opens the stored team when the person may still see it, and passes it over when they may not', async () => {
      localStorage.setItem('bom-team:viewer@example.com', 'b');
      readAccess.mockResolvedValue({ active: true, role: 'viewer' });
      readMembers.mockResolvedValue({ teams: { b: 'viewer' } });
      const auth = create();
      const scope = TestBed.inject(TeamScopeService);
      await arrive(auth, 'viewer@example.com');
      expect(scope.activeTeamId()).toBe('b');

      // Taken off b since: the key is still there, and the root is theirs to fall back to.
      readMembers.mockResolvedValue(null);
      expect(await auth.confirmAccess()).toBe(true);
      expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
      expect(localStorage.getItem('bom-team:viewer@example.com')).toBe('b');
    });
  });
});

describe('AuthService in local mode', () => {
  beforeEach(() => {
    environment.firebase.apiKey = '';
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('is one admin on the one team, with no reads and no index', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const auth = TestBed.inject(AuthService);
    const scope = TestBed.inject(TeamScopeService);
    expect(auth.mode).toBe('local');
    expect(auth.ready()).toBe(true);
    expect(auth.isAuthed()).toBe(false);
    auth.enterLocal();
    expect(auth.userEmail()).toBe('local@preview');
    expect(auth.role()).toBe('admin');
    expect(auth.isRootAdmin()).toBe(true);
    expect(auth.canEdit()).toBe(true);
    expect(auth.canManageUsers()).toBe(true);
    expect(auth.teamsOf()).toEqual([]);
    expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
    expect(auth.roleFor('b')).toBe('admin');
    await auth.logout();
    expect(auth.isAuthed()).toBe(false);
    expect(auth.role()).toBeNull();
    expect(auth.isRootAdmin()).toBe(false);
  });
});
