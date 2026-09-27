import { describe, expect, it, vi } from 'vitest';
import { AccessEntryLike, activeRole, roleOf, rootRoleOf } from './roles';

/**
 * Who someone is on a team (release 3, 27 Sep 2026). The root case is what `getAccessRoleByEmail`
 * did before, entry for entry; the team cases are the new rule: a root admin everywhere, anyone
 * else only what the team's own list says.
 */

const BOOTSTRAP = 'ruanhart7@gmail.com';

function reads(root: Record<string, AccessEntryLike>, teams: Record<string, Record<string, AccessEntryLike>> = {}) {
  return {
    bootstrapAdmins: new Set([BOOTSTRAP]),
    rootEntry: vi.fn(async (email: string) => root[email] ?? null),
    teamEntry: vi.fn(async (teamId: string, email: string) => teams[teamId]?.[email] ?? null)
  };
}

const ROOT: Record<string, AccessEntryLike> = {
  'lead@example.com': { active: true, role: 'admin' },
  'editor@example.com': { active: true, role: 'contributor' },
  'viewer@example.com': { active: true, role: 'viewer' },
  'gone@example.com': { active: false, role: 'admin' },
  'roleless@example.com': { active: true },
  'odd@example.com': { active: true, role: 42 }
};

const TEAMS: Record<string, Record<string, AccessEntryLike>> = {
  b: {
    'teamonly@example.com': { active: true, role: 'contributor' },
    'editor@example.com': { active: true, role: 'viewer' },
    'left@example.com': { active: false, role: 'admin' }
  }
};

describe('activeRole', () => {
  it('is the role when active and role are both truthy, else nothing', () => {
    expect(activeRole({ active: true, role: 'viewer' })).toBe('viewer');
    expect(activeRole({ active: false, role: 'admin' })).toBeNull();
    expect(activeRole({ active: true })).toBeNull();
    expect(activeRole({ active: true, role: '' })).toBeNull();
    expect(activeRole({ role: 'admin' })).toBeNull();
    expect(activeRole(null)).toBeNull();
    expect(activeRole(undefined)).toBeNull();
  });

  it('grants nothing on a role that is not a string', () => {
    expect(activeRole({ active: true, role: 42 })).toBeNull();
    expect(activeRole({ active: true, role: { admin: true } })).toBeNull();
  });

  it("grants nothing on a role outside the three, as the app's activeRoleOf does, so a hand-written entry cannot be a member here and nobody there", () => {
    expect(activeRole({ active: true, role: 'owner' })).toBeNull();
    expect(activeRole({ active: true, role: 'Admin' })).toBeNull();
    for (const role of ['admin', 'contributor', 'viewer']) expect(activeRole({ active: true, role })).toBe(role);
  });
});

describe('the root, as before release 3', () => {
  it('is admin for the bootstrap email without reading anything', async () => {
    const r = reads({});
    expect(await rootRoleOf(BOOTSTRAP, r)).toBe('admin');
    expect(await roleOf(BOOTSTRAP, 'default', r)).toBe('admin');
    expect(r.rootEntry).not.toHaveBeenCalled();
  });

  it("is an active entry's role", async () => {
    const r = reads(ROOT);
    expect(await roleOf('lead@example.com', 'default', r)).toBe('admin');
    expect(await roleOf('editor@example.com', 'default', r)).toBe('contributor');
    expect(await roleOf('viewer@example.com', 'default', r)).toBe('viewer');
  });

  it('is nothing for an entry switched off, one without a role, or no entry at all', async () => {
    const r = reads(ROOT);
    expect(await roleOf('gone@example.com', 'default', r)).toBeNull();
    expect(await roleOf('roleless@example.com', 'default', r)).toBeNull();
    expect(await roleOf('odd@example.com', 'default', r)).toBeNull();
    expect(await roleOf('stranger@example.com', 'default', r)).toBeNull();
  });

  it('never reads a team list for the root', async () => {
    const r = reads(ROOT, TEAMS);
    await roleOf('editor@example.com', 'default', r);
    expect(r.teamEntry).not.toHaveBeenCalled();
  });
});

describe('a team', () => {
  it('a root admin is admin on any team, and the team list is not read', async () => {
    const r = reads(ROOT, TEAMS);
    expect(await roleOf('lead@example.com', 'b', r)).toBe('admin');
    expect(await roleOf('lead@example.com', 'never-heard-of', r)).toBe('admin');
    expect(await roleOf(BOOTSTRAP, 'b', r)).toBe('admin');
    expect(r.teamEntry).not.toHaveBeenCalled();
  });

  it("an active team entry gives its role, which is the team's and not the root's", async () => {
    const r = reads(ROOT, TEAMS);
    expect(await roleOf('teamonly@example.com', 'b', r)).toBe('contributor');
    // A root contributor listed as a viewer on b is a viewer there.
    expect(await roleOf('editor@example.com', 'b', r)).toBe('viewer');
    expect(r.teamEntry).toHaveBeenCalledWith('b', 'teamonly@example.com');
  });

  it('a root member with no team entry has nothing on the team', async () => {
    const r = reads(ROOT, TEAMS);
    expect(await roleOf('viewer@example.com', 'b', r)).toBeNull();
    expect(await roleOf('editor@example.com', 'c', r)).toBeNull();
  });

  it('an inactive team entry is refused, even as admin', async () => {
    expect(await roleOf('left@example.com', 'b', reads(ROOT, TEAMS))).toBeNull();
  });

  it('a team-only member has nothing on the root and nothing on another team', async () => {
    const r = reads(ROOT, TEAMS);
    expect(await roleOf('teamonly@example.com', 'default', r)).toBeNull();
    expect(await roleOf('teamonly@example.com', 'c', r)).toBeNull();
  });

  it('a root admin switched off at the root is not admin on a team either', async () => {
    // Their standing on b is then the team list's alone, and b does not list them.
    expect(await roleOf('gone@example.com', 'b', reads(ROOT, TEAMS))).toBeNull();
  });

  it('throws on a team id that is not one, the net under the parsers', async () => {
    const r = reads(ROOT, TEAMS);
    for (const teamId of ['B', 'teams', '', 'a/b', 'Team B']) {
      await expect(roleOf('lead@example.com', teamId, r), JSON.stringify(teamId)).rejects.toThrow('Not a team id');
    }
    expect(r.teamEntry).not.toHaveBeenCalled();
  });
});
