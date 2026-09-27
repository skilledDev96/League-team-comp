import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { Team } from '../models/team.models';
import { AuthService } from './auth.service';
import { TeamDataService } from './team-data.service';
import { TeamScopeService } from './team-scope.service';

/**
 * What the three team batches write (27 Sep 2026, release 3, added by its review): the create batch, the copy of
 * Bom Squad's members onto a team, and the delete batch. Admin › Teams' spec replaces TeamDataService with a fake
 * and the listeners spec never commits a batch, so until this nothing pinned decision 2 of release 3: the creator
 * seeded as the team's admin in the create batch, every ACTIVE root entry copied with its root role and an
 * inactive or role-less one skipped, a copied entry never overriding the creator's admin seat, the copy leaving
 * an entry already on the team alone and counting it as kept, and the delete batch taking every entry of the
 * list with the three documents.
 *
 * Firestore never runs here. The batch and the whole-collection read are methods on the service (`batch`,
 * `readAll`, the `listen` pattern), stubbed on the prototype so they are in place before a call; the references
 * the service hands the batch are real, so what is asserted is the exact path and payload of every operation.
 * `teamHasData` reads through `getDocs` and `getDoc` of its own and is stubbed whole for the delete cases.
 */

interface Op {
  op: 'set' | 'delete';
  path: string;
  data?: Record<string, unknown>;
}

/** One stored document as `readAll` answers it: the id, a ref with the path the delete batch uses, and the data. */
const stored = (collectionPath: string, id: string, data: Record<string, unknown>) => ({
  id,
  ref: { path: `${collectionPath}/${id}` },
  data: () => ({ ...data })
});

const CREATOR = 'lead@example.com';
const TEAM: Team = { id: 'b', name: 'The B Team', region: 'euw', createdBy: CREATOR, createdAt: '2026-09-27T09:00:00.000Z', refresh: 'on' };

describe('TeamDataService: the team batches (release 3)', () => {
  /** Every operation every batch recorded, in order, and how many batches were opened. */
  let ops: Op[];
  let batches: number;
  let committed: number;
  /** What `readAll` answers per collection path; a path not listed answers empty. */
  let collections: Record<string, ReturnType<typeof stored>[]>;
  let readAll: Mock<(path: string) => Promise<unknown>>;
  let teamHasData: Mock<(teamId: string) => Promise<string | null>>;
  const auth = {
    mode: 'firebase' as const,
    userEmail: signal<string | null>(CREATOR),
    canManageUsers: signal(false),
    isRootAdmin: signal(true),
    teamsOf: signal<string[]>([]),
    maySee: (_teamId: string) => true,
    confirmAccess: vi.fn(async () => true)
  };
  const scope = { activeTeamId: signal(DEFAULT_TEAM_ID), choose: vi.fn<(teamId: string) => void>() };
  let data: TeamDataService;

  const setsOf = (prefix: string) => ops.filter((o) => o.op === 'set' && o.path.startsWith(prefix));

  beforeEach(() => {
    ops = [];
    batches = 0;
    committed = 0;
    collections = {};
    auth.userEmail.set(CREATOR);
    auth.isRootAdmin.set(true);
    scope.activeTeamId.set(DEFAULT_TEAM_ID);
    const proto = TeamDataService.prototype as unknown as Record<string, unknown>;
    vi.spyOn(proto as { listen: () => () => void }, 'listen').mockImplementation(() => () => undefined);
    vi.spyOn(proto as { reportError: (error: Error) => void }, 'reportError').mockImplementation(() => undefined);
    vi.spyOn(proto as { batch: () => unknown }, 'batch').mockImplementation(() => {
      batches++;
      return {
        set: (ref: { path: string }, value: Record<string, unknown>) => ops.push({ op: 'set', path: ref.path, data: value }),
        delete: (ref: { path: string }) => ops.push({ op: 'delete', path: ref.path }),
        commit: async () => {
          committed++;
        }
      };
    });
    readAll = vi.fn(async (path: string) => ({ docs: collections[path] ?? [] }));
    vi.spyOn(proto as { readAll: (db: unknown, path: string) => Promise<unknown> }, 'readAll').mockImplementation((_db, path) => readAll(path));
    teamHasData = vi.fn(async (_teamId: string) => null);
    vi.spyOn(proto as { teamHasData: (teamId: string) => Promise<string | null> }, 'teamHasData').mockImplementation(teamHasData);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: TeamScopeService, useValue: scope }
      ]
    });
    data = TestBed.inject(TeamDataService);
    TestBed.tick();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('createTeam', () => {
    it('writes the team document, its settings, an empty resourceLinks and the creator as its admin, in one batch, reading nothing', async () => {
      await data.createTeam(TEAM);
      expect(batches).toBe(1);
      expect(committed).toBe(1);
      expect(readAll).not.toHaveBeenCalled();
      expect(ops).toEqual([
        { op: 'set', path: 'teams/b', data: { ...TEAM } },
        { op: 'set', path: 'teams/b/meta/settings', data: { teamName: 'The B Team' } },
        { op: 'set', path: 'teams/b/meta/resourceLinks', data: { groups: {} } },
        { op: 'set', path: `teams/b/access/${CREATOR}`, data: { email: CREATOR, role: 'admin', active: true } }
      ]);
    });

    it("copies every ACTIVE root entry with its root role when asked, skips an inactive or role-less one, and keeps the creator's admin seat whatever the root says", async () => {
      collections['access'] = [
        stored('access', 'viewer@example.com', { email: 'viewer@example.com', role: 'viewer', active: true }),
        stored('access', 'gone@example.com', { email: 'gone@example.com', role: 'contributor', active: false }),
        stored('access', 'norole@example.com', { email: 'norole@example.com', active: true }),
        stored('access', 'editor@example.com', { email: 'editor@example.com', role: 'contributor', active: true }),
        // The creator on the root list as a contributor: their team entry is admin all the same, written once.
        stored('access', CREATOR, { email: CREATOR, role: 'contributor', active: true })
      ];
      await data.createTeam(TEAM, { copyRootMembers: true });
      expect(readAll).toHaveBeenCalledWith('access');
      expect(batches).toBe(1);
      expect(ops.slice(0, 3).map((o) => o.path)).toEqual(['teams/b', 'teams/b/meta/settings', 'teams/b/meta/resourceLinks']);
      expect(setsOf('teams/b/access/')).toEqual([
        { op: 'set', path: 'teams/b/access/viewer@example.com', data: { email: 'viewer@example.com', role: 'viewer', active: true } },
        { op: 'set', path: 'teams/b/access/editor@example.com', data: { email: 'editor@example.com', role: 'contributor', active: true } },
        { op: 'set', path: `teams/b/access/${CREATOR}`, data: { email: CREATOR, role: 'admin', active: true } }
      ]);
      expect(ops.filter((o) => o.path === `teams/b/access/${CREATOR}`)).toHaveLength(1);
      expect(ops.some((o) => o.path.includes('gone@') || o.path.includes('norole@'))).toBe(false);
    });

    it('trims the name and writes it to both the document and the settings', async () => {
      await data.createTeam({ ...TEAM, name: '  The B Team  ' });
      expect(ops[0].data).toMatchObject({ name: 'The B Team' });
      expect(ops[1].data).toEqual({ teamName: 'The B Team' });
    });

    it('refuses anyone but a signed-in root admin, a bad id, an id already listed and an empty name, and writes nothing', async () => {
      auth.isRootAdmin.set(false);
      await expect(data.createTeam(TEAM)).rejects.toThrow('Only a signed-in root admin can create a team.');
      auth.isRootAdmin.set(true);
      auth.userEmail.set(null);
      await expect(data.createTeam(TEAM)).rejects.toThrow('Only a signed-in root admin can create a team.');
      auth.userEmail.set(CREATOR);
      await expect(data.createTeam({ ...TEAM, id: 'Not An Id' })).rejects.toThrow(/Not a team id/);
      await expect(data.createTeam({ ...TEAM, id: DEFAULT_TEAM_ID })).rejects.toThrow(/Not a team id/);
      await expect(data.createTeam({ ...TEAM, name: '  ' })).rejects.toThrow('The team needs a name.');
      data.teams.set([{ ...TEAM }]);
      await expect(data.createTeam(TEAM)).rejects.toThrow('A team with the id b already exists.');
      expect(batches).toBe(0);
      expect(readAll).not.toHaveBeenCalled();
    });
  });

  describe('copyRootMembers', () => {
    it('adds every active root entry the team does not hold yet, leaves the ones it holds alone, and counts both', async () => {
      collections['access'] = [
        stored('access', 'a@example.com', { email: 'a@example.com', role: 'admin', active: true }),
        stored('access', 'b@example.com', { email: 'b@example.com', role: 'contributor', active: true }),
        stored('access', 'c@example.com', { email: 'c@example.com', role: 'viewer', active: true }),
        stored('access', 'gone@example.com', { email: 'gone@example.com', role: 'viewer', active: false })
      ];
      // b is already on the team, as its admin: the team's decision stands and nothing is written over it.
      collections['teams/b/access'] = [stored('teams/b/access', 'b@example.com', { email: 'b@example.com', role: 'admin', active: true })];
      const counts = await data.copyRootMembers('b');
      expect(counts).toEqual({ added: 2, kept: 1 });
      expect(readAll).toHaveBeenCalledWith('access');
      expect(readAll).toHaveBeenCalledWith('teams/b/access');
      expect(batches).toBe(1);
      expect(ops).toEqual([
        { op: 'set', path: 'teams/b/access/a@example.com', data: { email: 'a@example.com', role: 'admin', active: true } },
        { op: 'set', path: 'teams/b/access/c@example.com', data: { email: 'c@example.com', role: 'viewer', active: true } }
      ]);
    });

    it('opens no batch when the team already holds everyone, and says so in the counts', async () => {
      collections['access'] = [stored('access', 'a@example.com', { email: 'a@example.com', role: 'admin', active: true })];
      collections['teams/b/access'] = [stored('teams/b/access', 'a@example.com', { email: 'a@example.com', role: 'viewer', active: true })];
      expect(await data.copyRootMembers('b')).toEqual({ added: 0, kept: 1 });
      expect(batches).toBe(0);
    });

    it('refuses anyone but a signed-in root admin and a bad id, reading nothing', async () => {
      auth.isRootAdmin.set(false);
      await expect(data.copyRootMembers('b')).rejects.toThrow('Only a signed-in root admin can copy the members.');
      auth.isRootAdmin.set(true);
      await expect(data.copyRootMembers(DEFAULT_TEAM_ID)).rejects.toThrow(/Not a team id/);
      expect(readAll).not.toHaveBeenCalled();
    });
  });

  describe('deleteTeam', () => {
    it("deletes every entry of the team's list, its two meta documents and the team document, in one batch", async () => {
      collections['teams/b/access'] = [
        stored('teams/b/access', 'a@example.com', { email: 'a@example.com', role: 'admin', active: true }),
        stored('teams/b/access', 'c@example.com', { email: 'c@example.com', role: 'viewer', active: true })
      ];
      await data.deleteTeam('b');
      expect(teamHasData).toHaveBeenCalledWith('b');
      expect(readAll).toHaveBeenCalledWith('teams/b/access');
      expect(batches).toBe(1);
      expect(committed).toBe(1);
      expect(ops).toEqual([
        { op: 'delete', path: 'teams/b/access/a@example.com' },
        { op: 'delete', path: 'teams/b/access/c@example.com' },
        { op: 'delete', path: 'teams/b/meta/settings' },
        { op: 'delete', path: 'teams/b/meta/resourceLinks' },
        { op: 'delete', path: 'teams/b' }
      ]);
    });

    it('refuses a team that still holds data, naming what stands in the way, before reading the list', async () => {
      teamHasData.mockResolvedValueOnce('players');
      await expect(data.deleteTeam('b')).rejects.toThrow('The team still has players; take that off first.');
      expect(readAll).not.toHaveBeenCalled();
      expect(batches).toBe(0);
    });

    it("refuses anyone but a signed-in root admin, a team's own admin included, and the default", async () => {
      auth.isRootAdmin.set(false);
      await expect(data.deleteTeam('b')).rejects.toThrow('Only a signed-in root admin can delete a team.');
      auth.isRootAdmin.set(true);
      await expect(data.deleteTeam(DEFAULT_TEAM_ID)).rejects.toThrow(/Not a team id/);
      expect(teamHasData).not.toHaveBeenCalled();
      expect(batches).toBe(0);
    });
  });
});
