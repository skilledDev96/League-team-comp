import { WritableSignal, isSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { environment } from '../../environments/environment';
import { AccessRole } from '../models/team.models';
import { AuthService } from './auth.service';
import { TeamDataService } from './team-data.service';

/**
 * When TeamDataService listens, in Firebase mode (27 Sep 2026).
 *
 * The rules went members-only: nothing but meta/settings is readable without a signed-in account whose access entry
 * is active, and a listen the rules refuse ends for good. The service used to open all ~28 listeners at construction,
 * on the signed-out login page, so every one was refused and nothing opened them again after sign-in — the shell sat
 * on "Loading team data…" for ever. These pin the lifecycle that replaced it: meta/settings from the start, the rest
 * only while someone is let in, closed and emptied when they leave, the whole access list only while they manage
 * users, and a refusal that settles the page instead of hanging it — and, when it means the person's access was taken
 * away while the app was open, signs them out rather than leaving the last snapshot frozen on screen.
 *
 * Firestore never runs here. The one listen and the one error-log write are methods on the service (the
 * ReplayRecordingService pattern), stubbed on the prototype so they are in place before the constructor runs; the
 * references handed to them are real, so what is asserted is the path each listen was opened on.
 */

type Snap = { docs: { id: string; data: () => Record<string, unknown> }[] } | { data: () => Record<string, unknown> | undefined; exists: () => boolean };
type Listen = (target: { path: string }, next: (snap: Snap) => void, error: (error: { code: string }) => void) => () => void;

interface Feed {
  path: string;
  next: (snap: Snap) => void;
  error: (error: { code: string }) => void;
  stop: Mock<() => void>;
}

/** Every member listen the service keeps: all of it closes on sign-out, none of it opens before sign-in. */
const MEMBER_PATHS = [
  'players', 'fillIns', 'comps', 'scrims', 'scrimOpponents', 'compResults', 'plays', 'painPoints', 'learnEntries',
  'trophies', 'tournaments', 'tournamentSeries', 'seriesGames', 'matchNotes', 'compOverrides', 'practiceGames',
  'gameReviews', 'filmCommitments', 'filmNotes',
  'meta/teamIdentity', 'meta/selfScout', 'meta/refreshLog', 'meta/keyHealth', 'meta/compAnalysis',
  'meta/championTraits', 'meta/resourceLinks'
];

/**
 * The writable signals that are not one account's data: the public settings the login page prints, and the flag the
 * shell waits on. Every other writable signal on the service is found, not listed (below), so an entity added later
 * is held to the same rule without anyone remembering to add it here.
 */
const NOT_MEMBER_DATA = new Set(['settings', 'ready']);

/** Every writable signal on the service, by property name. A computed has no `set`, so it is not one. */
function writableSignals(data: TeamDataService): Map<string, WritableSignal<unknown>> {
  const found = new Map<string, WritableSignal<unknown>>();
  for (const [key, value] of Object.entries(data)) {
    if (isSignal(value) && typeof (value as { set?: unknown }).set === 'function') found.set(key, value as WritableSignal<unknown>);
  }
  return found;
}

/** What each of the named signals holds right now, as one object, so a mismatch prints as a readable diff. */
function holding(data: TeamDataService, keys: string[]): Record<string, unknown> {
  const all = writableSignals(data);
  return Object.fromEntries(keys.map((key) => [key, structuredClone(all.get(key)!())]));
}

const sorted = (list: string[]) => [...list].sort();
const isEmpty = (value: unknown) =>
  value === null || (Array.isArray(value) ? value.length === 0 : typeof value === 'object' && Object.keys(value as object).length === 0);
/** Let the awaits inside a refusal's answer run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** One document in every shape a listener reads, so each signal it fills visibly holds something. */
const ROW = { order: 0, reviewedAt: '2026-09-20T18:00:00.000Z', matchId: 'EUW1_1', role: 'admin', active: true };
const DOC = { teamName: 'Bom Squad', traits: { Ahri: { tags: ['Mage'] } }, groups: { Tools: [] }, games: [] };
const querySnap = (): Snap => ({ docs: [{ id: 'row-1', data: () => ({ ...ROW }) }] });
const docSnap = (): Snap => ({ data: () => ({ ...DOC }), exists: () => true });

let savedApiKey = '';
beforeAll(() => {
  savedApiKey = environment.firebase.apiKey;
});
afterAll(() => {
  environment.firebase.apiKey = savedApiKey;
});

describe('TeamDataService listeners', () => {
  let feeds: Feed[];
  let reportError: Mock<(error: Error) => void>;
  let warn: Mock<(...args: unknown[]) => void>;
  let consoleError: Mock<(...args: unknown[]) => void>;
  const auth = {
    mode: 'firebase' as const,
    userEmail: signal<string | null>(null),
    role: signal<AccessRole | null>(null),
    canManageUsers: signal(false),
    confirmAccess: vi.fn<() => Promise<boolean>>()
  };

  const open = () => feeds.filter((f) => f.stop.mock.calls.length === 0);
  const openPaths = () => sorted(open().map((f) => f.path));
  const feed = (path: string) => {
    const found = open().filter((f) => f.path === path);
    expect(found, `one open listen on ${path}`).toHaveLength(1);
    return found[0];
  };

  function create(): TeamDataService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: auth }] });
    const data = TestBed.inject(TeamDataService);
    TestBed.tick();
    return data;
  }

  /** What AuthService does once its access check passes: the role, then the email. */
  function signIn(email: string, role: AccessRole): void {
    auth.role.set(role);
    auth.canManageUsers.set(role === 'admin');
    auth.userEmail.set(email);
    TestBed.tick();
  }

  function signOut(): void {
    auth.userEmail.set(null);
    auth.role.set(null);
    auth.canManageUsers.set(false);
    TestBed.tick();
  }

  /** Answer every open listen with a document, as a member's first snapshots would. */
  function fillEverything(): void {
    for (const f of open()) f.next(f.path.includes('/') ? docSnap() : querySnap());
  }

  beforeEach(() => {
    feeds = [];
    auth.userEmail.set(null);
    auth.role.set(null);
    auth.canManageUsers.set(false);
    auth.confirmAccess.mockReset();
    auth.confirmAccess.mockResolvedValue(true);
    localStorage.clear();
    vi.spyOn(TeamDataService.prototype as unknown as { listen: Listen }, 'listen').mockImplementation((target, next, error) => {
      const entry: Feed = { path: target.path, next, error, stop: vi.fn() };
      feeds.push(entry);
      return entry.stop;
    });
    reportError = vi.fn();
    vi.spyOn(TeamDataService.prototype as unknown as { reportError: (error: Error) => void }, 'reportError').mockImplementation(reportError);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined) as unknown as Mock<(...args: unknown[]) => void>;
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined) as unknown as Mock<(...args: unknown[]) => void>;
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('in Firebase mode', () => {
    let data: TeamDataService;
    /** Every writable signal that is one account's data, found on the service rather than listed. */
    let members: string[];
    /** What each of them held before anyone signed in. */
    let before: Record<string, unknown>;

    beforeEach(() => {
      environment.firebase.apiKey = savedApiKey || 'spec-api-key';
      data = create();
      members = [...writableSignals(data).keys()].filter((key) => !NOT_MEMBER_DATA.has(key));
      before = holding(data, members);
    });

    it('opens nothing but meta/settings while nobody is signed in', () => {
      expect(data.mode).toBe('firebase');
      expect(feeds.map((f) => f.path)).toEqual(['meta/settings']);
      expect(data.ready()).toBe(false);
      // The public document still reaches the signed-out shell.
      feed('meta/settings').next(docSnap());
      expect(data.settings().teamName).toBe('Bom Squad');
    });

    it('opens every member listen once someone is let in, and data.ready follows the players', () => {
      signIn('viewer@example.com', 'viewer');
      expect(openPaths()).toEqual(sorted(['meta/settings', ...MEMBER_PATHS]));
      expect(data.ready()).toBe(false);

      feed('players').next(querySnap());
      expect(data.ready()).toBe(true);
      expect(data.players().map((p) => p.id)).toEqual(['row-1']);

      // Nothing about the session changed, so nothing opens twice.
      auth.role.set('viewer');
      TestBed.tick();
      expect(feeds).toHaveLength(MEMBER_PATHS.length + 1);
    });

    it('closes every listen on sign-out, empties what they held and resets ready, then opens afresh on the next sign-in', () => {
      // Found, not listed: a hand-kept list let an entity wired into openMemberListeners but not clearMemberData pass.
      expect(members.length).toBeGreaterThanOrEqual(MEMBER_PATHS.length + 1);
      signIn('admin@example.com', 'admin');
      feed('meta/settings').next(docSnap());
      fillEverything();
      expect(data.ready()).toBe(true);
      // Every one of them is filled by some member listen (the access list included, for an admin), so the check
      // after sign-out below is a real one for each. A new writable signal no listen fills belongs in NOT_MEMBER_DATA.
      expect(members.filter((key) => isEmpty(writableSignals(data).get(key)!()))).toEqual([]);
      const first = open().filter((f) => f.path !== 'meta/settings');
      expect(first).toHaveLength(MEMBER_PATHS.length + 1);

      signOut();
      expect(first.filter((f) => f.stop.mock.calls.length !== 1).map((f) => f.path)).toEqual([]);
      expect(openPaths()).toEqual(['meta/settings']);
      expect(data.ready()).toBe(false);
      // Every one back to what it held before anyone signed in: nothing of the last account's stays in memory.
      expect(holding(data, members)).toEqual(before);
      // The public document is not the account's: the login page keeps the team name.
      expect(data.settings().teamName).toBe('Bom Squad');

      signIn('admin@example.com', 'admin');
      expect(openPaths()).toEqual(sorted(['meta/settings', 'access', ...MEMBER_PATHS]));
      expect(feeds).toHaveLength(1 + 2 * (MEMBER_PATHS.length + 1));
      expect(data.ready()).toBe(false);
      feed('players').next(querySnap());
      expect(data.ready()).toBe(true);
    });

    it('closes and empties the first account before opening for another that takes over without a sign-out', () => {
      signIn('first@example.com', 'viewer');
      fillEverything();
      const first = open().filter((f) => f.path !== 'meta/settings');

      signIn('second@example.com', 'viewer');
      expect(first.every((f) => f.stop.mock.calls.length === 1)).toBe(true);
      expect(openPaths()).toEqual(sorted(['meta/settings', ...MEMBER_PATHS]));
      expect(data.ready()).toBe(false);
      expect(holding(data, members)).toEqual(before);
    });

    it('opens the whole access list only while the account manages users, and closes it when that stops', () => {
      signIn('contributor@example.com', 'contributor');
      expect(openPaths()).not.toContain('access');

      auth.role.set('admin');
      auth.canManageUsers.set(true);
      TestBed.tick();
      const access = feed('access');
      access.next(querySnap());
      expect(data.accessEntries().map((a) => a.email)).toEqual(['row-1']);

      auth.role.set('contributor');
      auth.canManageUsers.set(false);
      TestBed.tick();
      expect(access.stop).toHaveBeenCalledTimes(1);
      expect(openPaths()).not.toContain('access');
      expect(data.accessEntries()).toEqual([]);
      // Only the access list went: the member listens stay open.
      expect(openPaths()).toEqual(sorted(['meta/settings', ...MEMBER_PATHS]));

      // And an admin signing out takes theirs down with the rest.
      signIn('admin@example.com', 'admin');
      const adminAccess = feed('access');
      signOut();
      expect(adminAccess.stop).toHaveBeenCalledTimes(1);
    });

    it('settles ready when the players listen is refused and, the person still being let in, reports it once as a warning', async () => {
      signIn('viewer@example.com', 'viewer');
      feed('players').error({ code: 'permission-denied' });
      expect(data.ready()).toBe(true);
      expect(data.players()).toEqual([]);

      // Every other listen refused in the same breath adds nothing: one access check, one report.
      feed('comps').error({ code: 'permission-denied' });
      feed('meta/compAnalysis').error({ code: 'permission-denied' });
      await settle();
      expect(auth.confirmAccess).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('players');
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError.mock.calls[0][0].message).toContain('players');
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('signs out, and writes nothing, when the refusals mean an admin took the access away mid-session', async () => {
      // What AuthService.confirmAccess does for an entry unticked or removed: signs out, and says so.
      auth.confirmAccess.mockImplementation(async () => {
        signOut();
        return false;
      });
      signIn('viewer@example.com', 'viewer');
      fillEverything();
      expect(data.ready()).toBe(true);

      // The next stream restart: every listen refused at once.
      for (const f of open().filter((f) => f.path !== 'meta/settings')) f.error({ code: 'permission-denied' });
      await settle();

      expect(auth.confirmAccess).toHaveBeenCalledTimes(1);
      // No row for Diagnostics (the rules would refuse it to them too) and no warning: nothing disagrees.
      expect(reportError).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      // And the tab does not keep the last snapshot frozen on screen: closed, emptied, not ready.
      expect(openPaths()).toEqual(['meta/settings']);
      expect(holding(data, members)).toEqual(before);
      expect(data.ready()).toBe(false);
    });

    it('reports the refusal when whether the person is still let in cannot be read', async () => {
      auth.confirmAccess.mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }));
      signIn('viewer@example.com', 'viewer');
      feed('comps').error({ code: 'permission-denied' });
      await settle();
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError.mock.calls[0][0].message).toContain('comps');
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('asks nothing about a refusal that is not a permission one, and reports it', async () => {
      signIn('viewer@example.com', 'viewer');
      feed('seriesGames').error({ code: 'resource-exhausted' });
      await settle();
      expect(auth.confirmAccess).not.toHaveBeenCalled();
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError.mock.calls[0][0].message).toContain('seriesGames listener (resource-exhausted)');
    });

    it('lets a demoted admin keep the team data and quietly loses the access list, still checking later refusals', async () => {
      // What confirmAccess does for an entry that is still active in another role: takes the role back.
      auth.confirmAccess.mockImplementation(async () => {
        auth.role.set('contributor');
        auth.canManageUsers.set(false);
        TestBed.tick();
        return true;
      });
      signIn('admin@example.com', 'admin');
      feed('access').error({ code: 'permission-denied' });
      await settle();
      expect(auth.confirmAccess).toHaveBeenCalledTimes(1);
      expect(openPaths()).toEqual(sorted(['meta/settings', ...MEMBER_PATHS]));
      expect(reportError).not.toHaveBeenCalled();

      // The access list does not use up the session's one check: a member listen refused later is still asked about.
      feed('players').error({ code: 'permission-denied' });
      await settle();
      expect(auth.confirmAccess).toHaveBeenCalledTimes(2);
    });

    it('stays quiet about the refusals signing out causes, and ignores a refusal from a closed session', async () => {
      signIn('viewer@example.com', 'viewer');
      const old = feed('players');
      // Signing out re-sends the open listens without a token; the refusals can land before the effect closes them.
      auth.userEmail.set(null);
      old.error({ code: 'permission-denied' });
      TestBed.tick();
      await settle();
      expect(warn).not.toHaveBeenCalled();
      expect(reportError).not.toHaveBeenCalled();
      expect(auth.confirmAccess).not.toHaveBeenCalled();

      signIn('viewer@example.com', 'viewer');
      old.error({ code: 'permission-denied' });
      await settle();
      expect(data.ready()).toBe(false);
      expect(warn).not.toHaveBeenCalled();
      expect(auth.confirmAccess).not.toHaveBeenCalled();
    });
  });

  describe('in local mode', () => {
    beforeEach(() => {
      environment.firebase.apiKey = '';
    });

    it('opens no listener and reads its data from localStorage, whoever signs in', () => {
      const data = create();
      expect(data.mode).toBe('local');
      expect(data.ready()).toBe(true);
      expect(data.players().length).toBeGreaterThan(0);
      signIn('local@preview', 'admin');
      signOut();
      expect(feeds).toEqual([]);
      expect(data.ready()).toBe(true);
      expect(data.players().length).toBeGreaterThan(0);
    });
  });
});
