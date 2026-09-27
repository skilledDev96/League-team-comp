import { WritableSignal, isSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { environment } from '../../environments/environment';
import { DEFAULT_TEAM_ID, scopedPath } from '../core/team-scope';
import { AccessRole } from '../models/team.models';
import { AuthService } from './auth.service';
import { TeamDataService } from './team-data.service';
import { TeamScopeService } from './team-scope.service';

/**
 * When TeamDataService listens, and on which paths, in Firebase mode (27 Sep 2026).
 *
 * The rules went members-only: nothing but meta/settings is readable without a signed-in account whose access entry
 * is active, and a listen the rules refuse ends for good. The service used to open all ~28 listeners at construction,
 * on the signed-out login page, so every one was refused and nothing opened them again after sign-in — the shell sat
 * on "Loading team data…" for ever. These pin the lifecycle that replaced it: meta/settings from the start, the rest
 * only while someone is let in, closed and emptied when they leave, the whole access list only while they manage
 * users, and a refusal that settles the page instead of hanging it — and, when it means the person's access was taken
 * away while the app was open, signs them out rather than leaving the last snapshot frozen on screen.
 *
 * Release 2 of the multi-team work (the same day) put every team-scoped reference through one `path()` over the
 * active team. The load-bearing check here is that for the default team, Bom Squad on the flat root paths, every
 * path a listen opens is the literal string it was before (`TODAYS_PATHS`, written out); and that a switch to
 * another team with the same account closes every member listen but the root teams list, empties every member
 * signal but that list, and reopens the same names under `teams/{id}/`, with the site's own documents and the
 * public settings left where they are.
 *
 * Firestore never runs here. The one listen and the one error-log write are methods on the service (the
 * ReplayRecordingService pattern), stubbed on the prototype so they are in place before the constructor runs; the
 * references handed to them are real, so what is asserted is the path each listen was opened on.
 */

/** A list snapshot carries whether the server answered it: the SDK raises an empty one from the cache for a fresh listen while offline. */
type Snap =
  | { docs: { id: string; data: () => Record<string, unknown> }[]; metadata: { fromCache: boolean } }
  | { data: () => Record<string, unknown> | undefined; exists: () => boolean };
type Listen = (target: { path: string }, next: (snap: Snap) => void, error: (error: { code: string }) => void) => () => void;

interface Feed {
  path: string;
  next: (snap: Snap) => void;
  error: (error: { code: string }) => void;
  stop: Mock<() => void>;
}

/** The list collections a member listens to, by their bare names. */
const LIST_NAMES = [
  'players', 'fillIns', 'comps', 'scrims', 'scrimOpponents', 'compResults', 'plays', 'painPoints', 'learnEntries',
  'trophies', 'tournaments', 'tournamentSeries', 'seriesGames', 'matchNotes', 'compOverrides', 'practiceGames',
  'gameReviews', 'filmCommitments', 'filmNotes'
];
/** The meta docs that are a team's own. */
const TEAM_META_IDS = ['teamIdentity', 'selfScout', 'refreshLog', 'compAnalysis', 'resourceLinks'];
/** What a member listens to at the root whatever the team: the site's two meta docs and the teams list itself. */
const ROOT_PATHS = ['meta/keyHealth', 'meta/championTraits', 'teams'];

/**
 * Every member listen the service keeps for a team: all of it closes on sign-out, none of it opens before sign-in,
 * and a team switch closes all of it but the root teams list, which follows the email alone (like the access list)
 * so the topbar never falls to the public root name between two snapshots. A team that is not the default also
 * listens to its own settings; the default's are the public doc.
 */
function memberPaths(teamId: string): string[] {
  return [
    ...LIST_NAMES.map((name) => scopedPath(teamId, name)),
    ...TEAM_META_IDS.map((id) => scopedPath(teamId, 'meta', id)),
    ...ROOT_PATHS,
    ...(teamId === DEFAULT_TEAM_ID ? [] : [scopedPath(teamId, 'meta', 'settings')])
  ];
}

/**
 * The 26 paths Bom Squad's member listeners opened before release 2, written out and never built. Bom Squad's data
 * stays on these and never moves: if `memberPaths(DEFAULT_TEAM_ID)` ever differs from this list, the prefix has
 * leaked onto the default team.
 */
const TODAYS_PATHS = [
  'players', 'fillIns', 'comps', 'scrims', 'scrimOpponents', 'compResults', 'plays', 'painPoints', 'learnEntries',
  'trophies', 'tournaments', 'tournamentSeries', 'seriesGames', 'matchNotes', 'compOverrides', 'practiceGames',
  'gameReviews', 'filmCommitments', 'filmNotes',
  'meta/teamIdentity', 'meta/selfScout', 'meta/refreshLog', 'meta/keyHealth', 'meta/compAnalysis',
  'meta/championTraits', 'meta/resourceLinks'
];

const MEMBER_PATHS = memberPaths(DEFAULT_TEAM_ID);

/**
 * The writable signals that are not one account's data: the public settings the login page prints (`settings`, and
 * the root copy kept behind it while another team's is showing), and the flag the shell waits on. Every other
 * writable signal on the service is found, not listed (below), so an entity added later is held to the same rule
 * without anyone remembering to add it here.
 */
const NOT_MEMBER_DATA = new Set(['settings', 'ready', 'publicSettings']);
/** Member data that only a team other than the default fills: its own settings. The switch case proves that one. */
const SCOPED_ONLY = ['scopedSettings'];

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
/** The one other team, as its root document holds it. */
const TEAM_B = { name: 'The B Team', region: 'euw', createdBy: 'admin@example.com', createdAt: '2026-09-27T09:00:00.000Z' };
const querySnap = (): Snap => ({ docs: [{ id: 'row-1', data: () => ({ ...ROW }) }], metadata: { fromCache: false } });
const docSnap = (): Snap => ({ data: () => ({ ...DOC }), exists: () => true });
const teamsSnap = (): Snap => ({ docs: [{ id: 'b', data: () => ({ ...TEAM_B }) }], metadata: { fromCache: false } });
/** An empty list the server answered. */
const emptyList = (): Snap => ({ docs: [], metadata: { fromCache: false } });
/** The empty list a fresh listen raises from the cache while the client is offline: it says nothing about the server. */
const cachedEmptyList = (): Snap => ({ docs: [], metadata: { fromCache: true } });
/** A document for a document path (an even number of segments), a list for a collection; the teams list names team b. */
const snapFor = (path: string): Snap => (path === 'teams' ? teamsSnap() : path.split('/').length % 2 === 0 ? docSnap() : querySnap());

let savedApiKey = '';
beforeAll(() => {
  savedApiKey = environment.firebase.apiKey;
});
afterAll(() => {
  environment.firebase.apiKey = savedApiKey;
});

describe('the member paths', () => {
  it("are, for the default team, exactly the 26 strings Bom Squad's listeners opened before release 2, plus the root teams list", () => {
    expect(TODAYS_PATHS).toHaveLength(26);
    expect(sorted(memberPaths(DEFAULT_TEAM_ID))).toEqual(sorted([...TODAYS_PATHS, 'teams']));
    // Written out, not built: nothing in this list may come through scopedPath.
    for (const path of TODAYS_PATHS) expect(path.startsWith('teams/')).toBe(false);
  });

  it('are, for another team, the same names under teams/{id}, plus its own settings, with the site docs and the list at the root', () => {
    const paths = memberPaths('b');
    expect(paths).toHaveLength(TODAYS_PATHS.length + 2);
    expect(paths).toContain('teams/b/players');
    expect(paths).toContain('teams/b/meta/compAnalysis');
    expect(paths).toContain('teams/b/meta/settings');
    expect(paths.filter((p) => !p.startsWith('teams/b/'))).toEqual(['meta/keyHealth', 'meta/championTraits', 'teams']);
  });
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
  /** The scope as the test drives it; the real one follows the account and localStorage (its own spec). */
  const scope = {
    activeTeamId: signal(DEFAULT_TEAM_ID),
    choose: vi.fn<(teamId: string) => void>()
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
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: TeamScopeService, useValue: scope }
      ]
    });
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

  /** Signing out takes the scope back to the default too, as the real TeamScopeService does. */
  function signOut(): void {
    auth.userEmail.set(null);
    auth.role.set(null);
    auth.canManageUsers.set(false);
    scope.activeTeamId.set(DEFAULT_TEAM_ID);
    TestBed.tick();
  }

  /** What the switcher will do: the same account, another team. */
  function switchTo(teamId: string): void {
    scope.activeTeamId.set(teamId);
    TestBed.tick();
  }

  /** Answer every open listen with a document, as a member's first snapshots would. */
  function fillEverything(): void {
    for (const f of open()) f.next(snapFor(f.path));
  }

  beforeEach(() => {
    feeds = [];
    auth.userEmail.set(null);
    auth.role.set(null);
    auth.canManageUsers.set(false);
    auth.confirmAccess.mockReset();
    auth.confirmAccess.mockResolvedValue(true);
    scope.activeTeamId.set(DEFAULT_TEAM_ID);
    scope.choose.mockReset();
    scope.choose.mockImplementation((teamId) => scope.activeTeamId.set(teamId));
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
      expect(data.teamName()).toBe('Bom Squad');
    });

    it('opens every member listen once someone is let in, on the root paths, and data.ready follows the players', () => {
      signIn('viewer@example.com', 'viewer');
      expect(openPaths()).toEqual(sorted(['meta/settings', ...MEMBER_PATHS]));
      // The paths Bom Squad has always used, verbatim: not one of them under a prefix.
      expect(openPaths()).toEqual(sorted(['meta/settings', 'teams', ...TODAYS_PATHS]));
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
      // The one exception is the team's own settings, which only a team other than the default opens.
      expect(members.filter((key) => isEmpty(writableSignals(data).get(key)!()))).toEqual(SCOPED_ONLY);
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
      expect(data.accessEntries()).toEqual([]);
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

    describe('on another team (release 2)', () => {
      it('switching team for the same account stops every member listen once and reopens the same names under teams/b/', () => {
        signIn('viewer@example.com', 'viewer');
        fillEverything();
        expect(data.ready()).toBe(true);
        const teams = feed('teams');
        const first = open().filter((f) => f.path !== 'meta/settings' && f.path !== 'teams');

        switchTo('b');
        expect(first.filter((f) => f.stop.mock.calls.length !== 1).map((f) => f.path)).toEqual([]);
        // The root teams list follows the email, not the team: the one member listen a switch leaves open.
        expect(teams.stop).not.toHaveBeenCalled();
        expect(openPaths()).toEqual(sorted(['meta/settings', ...memberPaths('b')]));
        // The team's own collections and meta docs moved under the prefix; the site's two docs and the list did not.
        expect(openPaths()).toContain('teams/b/players');
        expect(openPaths()).toContain('teams/b/meta/compAnalysis');
        expect(openPaths()).toContain('teams/b/meta/settings');
        expect(openPaths()).toContain('meta/keyHealth');
        expect(openPaths()).toContain('meta/championTraits');
        expect(openPaths()).toContain('teams');
        expect(openPaths().filter((p) => p.startsWith('teams/b/'))).toHaveLength(TODAYS_PATHS.length - 2 + 1);
        // Nothing of Bom Squad's stays in memory, and the page waits for the team's own players. The teams list is
        // the one member signal that keeps what it held, so the topbar names the team from the first tick of the
        // switch rather than printing the public root name until the list is answered again.
        const kept = holding(data, members);
        expect(kept['teams']).toEqual([{ id: 'b', ...TEAM_B }]);
        expect({ ...kept, teams: [] }).toEqual(before);
        expect(data.teamName()).toBe('The B Team');
        expect(data.ready()).toBe(false);
        feed('teams/b/players').next(querySnap());
        expect(data.ready()).toBe(true);

        // Every member signal is filled by some listen of the team's, the team's own settings included; the access
        // list is the one a viewer never opens.
        fillEverything();
        expect(members.filter((key) => isEmpty(writableSignals(data).get(key)!()))).toEqual(['accessEntries']);
        // And nothing opened twice: the teams list was not reopened.
        expect(feeds).toHaveLength(1 + MEMBER_PATHS.length + memberPaths('b').length - 1);
      });

      it("settles ready when the team's players listen is refused, and names the collection plainly", async () => {
        signIn('viewer@example.com', 'viewer');
        switchTo('b');
        feed('teams/b/players').error({ code: 'permission-denied' });
        expect(data.ready()).toBe(true);
        await settle();
        expect(auth.confirmAccess).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('players');
      });

      it("keeps the public name in settings until the team's own settings arrive, and puts it back on sign-out", () => {
        feed('meta/settings').next(docSnap());
        signIn('viewer@example.com', 'viewer');
        switchTo('b');
        // Before the team's own document: the public root copy, and the name is the team document's when the list has it.
        expect(data.settings().teamName).toBe('Bom Squad');
        expect(data.teamName()).toBe('Bom Squad');
        feed('teams').next(teamsSnap());
        expect(data.teamName()).toBe('The B Team');
        expect(data.settings().teamName).toBe('Bom Squad');
        // A change to the root document while the team's has not arrived still reaches settings.
        feed('meta/settings').next({ data: () => ({ teamName: 'Bom Squad, renamed' }), exists: () => true });
        expect(data.settings().teamName).toBe('Bom Squad, renamed');

        feed('teams/b/meta/settings').next({ data: () => ({ teamName: 'B, as its settings say', motto: 'Second' }), exists: () => true });
        expect(data.settings().teamName).toBe('B, as its settings say');
        expect(data.settings().motto).toBe('Second');
        expect(data.teamName()).toBe('B, as its settings say');
        // From here the root document is the login page's, not this team's.
        feed('meta/settings').next({ data: () => ({ teamName: 'Bom Squad' }), exists: () => true });
        expect(data.settings().teamName).toBe('B, as its settings say');

        signOut();
        expect(openPaths()).toEqual(['meta/settings']);
        expect(data.settings()).toEqual({ teamName: 'Bom Squad' });
        expect(data.teamName()).toBe('Bom Squad');
        expect(holding(data, members)).toEqual(before);
      });

      it("names the team from its own settings, else its document, else the public root, else the app's fallback", () => {
        signIn('viewer@example.com', 'viewer');
        switchTo('b');
        expect(data.teamName()).toBe('Bom Squad');
        feed('meta/settings').next({ data: () => ({ teamName: 'The root' }), exists: () => true });
        expect(data.teamName()).toBe('The root');
        feed('teams').next(teamsSnap());
        expect(data.teamName()).toBe('The B Team');
        // A settings document with no name yet defers to the team document.
        feed('teams/b/meta/settings').next({ data: () => ({ teamName: '' }), exists: () => true });
        expect(data.teamName()).toBe('The B Team');
        feed('teams/b/meta/settings').next({ data: () => ({ teamName: 'B, named' }), exists: () => true });
        expect(data.teamName()).toBe('B, named');
      });

      it("leaves an admin's root access list open across a team switch, and its entries with it", () => {
        signIn('admin@example.com', 'admin');
        const access = feed('access');
        access.next(querySnap());
        switchTo('b');
        expect(access.stop).not.toHaveBeenCalled();
        expect(data.accessEntries().map((a) => a.email)).toEqual(['row-1']);
        expect(openPaths()).toEqual(sorted(['meta/settings', 'access', ...memberPaths('b')]));
        // A refusal of it after the switch is still answered: the list outlives the members' session.
        auth.confirmAccess.mockImplementation(async () => {
          auth.role.set('contributor');
          auth.canManageUsers.set(false);
          TestBed.tick();
          return true;
        });
        access.error({ code: 'permission-denied' });
        return settle().then(() => {
          expect(auth.confirmAccess).toHaveBeenCalledTimes(1);
          expect(access.stop).toHaveBeenCalledTimes(1);
          expect(data.accessEntries()).toEqual([]);
          expect(reportError).not.toHaveBeenCalled();
        });
      });

      it('falls back to the default team when the teams list no longer holds the active one', () => {
        signIn('viewer@example.com', 'viewer');
        switchTo('b');
        const teams = feed('teams');
        teams.next(teamsSnap());
        expect(scope.choose).not.toHaveBeenCalled();
        expect(data.teams().map((t) => t.id)).toEqual(['b']);

        teams.next(emptyList());
        expect(scope.choose).toHaveBeenCalledWith(DEFAULT_TEAM_ID);
        TestBed.tick();
        expect(openPaths()).toEqual(sorted(['meta/settings', ...MEMBER_PATHS]));
        expect(data.ready()).toBe(false);
        // On the default team an empty list is simply an empty list.
        feed('teams').next(emptyList());
        expect(scope.choose).toHaveBeenCalledTimes(1);
      });

      it('leaves the scope alone on a list from the cache: an empty answer the server never gave says nothing about the team', () => {
        signIn('viewer@example.com', 'viewer');
        switchTo('b');
        const teams = feed('teams');
        // A fresh listen while the client is offline: the SDK raises an empty snapshot from the cache first.
        teams.next(cachedEmptyList());
        expect(data.teams()).toEqual([]);
        expect(scope.choose).not.toHaveBeenCalled();
        expect(scope.activeTeamId()).toBe('b');
        expect(openPaths()).toContain('teams/b/players');
        // The server's answer, when it comes, is what decides.
        teams.next(emptyList());
        expect(scope.choose).toHaveBeenCalledWith(DEFAULT_TEAM_ID);
      });

      it("answers the access list's refusal against its own session, so a team switch during the check does not drop it", async () => {
        signIn('admin@example.com', 'admin');
        const access = feed('access');
        // Still an admin, but the check takes long enough for a switch to land in the middle of it.
        auth.confirmAccess.mockImplementation(async () => {
          switchTo('b');
          return true;
        });
        access.error({ code: 'permission-denied' });
        await settle();
        expect(auth.confirmAccess).toHaveBeenCalledTimes(1);
        // The switch closed the member set, not the access list: the rules and the app disagree about a listen
        // that is still open, and that is reported.
        expect(access.stop).not.toHaveBeenCalled();
        expect(reportError).toHaveBeenCalledTimes(1);
        expect(reportError.mock.calls[0][0].message).toContain('access');
      });
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
