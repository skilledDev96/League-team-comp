import { TestBed } from '@angular/core/testing';
import type { Auth, User } from 'firebase/auth';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { environment } from '../../environments/environment';
import { AccessRole } from '../models/team.models';
import { AuthService } from './auth.service';

/**
 * AuthService's gate in Firebase mode (27 Sep 2026): the first auth state always lets the guards go, and a signed-in
 * person can be asked about again when the rules start refusing them.
 *
 * Under the members-only rules the own-access read can fail: a session from a door the rules do not count is refused
 * it, and it fails offline. That failure used to escape the auth-state callback before `markReady`, so viewerGuard and
 * authGuard waited for good and a shared link opened onto an empty outlet, with an uncaught rejection on the console.
 *
 * Firebase never runs here. Auth, the auth-state subscription, the access read and the sign-out are methods on the
 * service (the ReplayRecordingService pattern), stubbed on the prototype before the constructor runs.
 */

type AccessDoc = { role?: AccessRole; active?: boolean };
type Proto = {
  authInstance: () => Auth | null;
  watchAuthState: (auth: Auth, next: (user: User | null) => void) => void;
  readAccess: (email: string) => Promise<AccessDoc | null>;
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
    const proto = AuthService.prototype as unknown as Proto;
    vi.spyOn(proto, 'authInstance').mockReturnValue(FAKE_AUTH);
    vi.spyOn(proto, 'watchAuthState').mockImplementation((_auth, callback) => {
      next = callback;
    });
    readAccess = vi.fn();
    vi.spyOn(proto, 'readAccess').mockImplementation(readAccess);
    // Firebase reports a sign-out as the next auth state, as the real one does.
    signOutOf = vi.fn(async () => next(null));
    vi.spyOn(proto, 'signOutOf').mockImplementation(signOutOf);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined) as unknown as Mock<(...args: unknown[]) => void>;
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined) as unknown as Mock<(...args: unknown[]) => void>;
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
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
});
