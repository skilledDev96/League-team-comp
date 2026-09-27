import { describe, expect, it } from 'vitest';
import { isBootstrapAdminEmail, isEditableRole, normalizeEmail, canEditWith, canManageUsersWith } from './access';

describe('access helpers', () => {
  describe('normalizeEmail', () => {
    it('trims and lowercases', () => {
      expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
    });

    it('handles null and undefined', () => {
      expect(normalizeEmail(null)).toBe('');
      expect(normalizeEmail(undefined)).toBe('');
    });
  });

  describe('isBootstrapAdminEmail', () => {
    it('matches the bootstrap admin regardless of case/spacing', () => {
      expect(isBootstrapAdminEmail('  RuanHart7@gmail.com ')).toBe(true);
    });

    it('rejects other emails', () => {
      expect(isBootstrapAdminEmail('someone@else.com')).toBe(false);
      expect(isBootstrapAdminEmail('')).toBe(false);
    });
  });

  describe('isEditableRole', () => {
    it('allows admin and contributor', () => {
      expect(isEditableRole('admin')).toBe(true);
      expect(isEditableRole('contributor')).toBe(true);
    });

    it('rejects viewer and empty roles', () => {
      expect(isEditableRole('viewer')).toBe(false);
      expect(isEditableRole(null)).toBe(false);
      expect(isEditableRole(undefined)).toBe(false);
    });
  });

  describe('canEditWith', () => {
    it('lets an admin and a contributor edit', () => {
      expect(canEditWith('firebase', 'admin')).toBe(true);
      expect(canEditWith('firebase', 'contributor')).toBe(true);
    });

    it('does not let a viewer edit', () => {
      expect(canEditWith('firebase', 'viewer')).toBe(false);
    });

    it('does not let someone with no role edit', () => {
      // Signed in but with no access document, or not signed in at all.
      expect(canEditWith('firebase', null)).toBe(false);
      expect(canEditWith('firebase', undefined)).toBe(false);
    });

    it('is unrestricted in local mode, which has no backend to gate', () => {
      expect(canEditWith('local', null)).toBe(true);
      expect(canEditWith('local', 'viewer')).toBe(true);
    });
  });

  describe('canManageUsersWith', () => {
    it('is admin only', () => {
      expect(canManageUsersWith('firebase', 'admin')).toBe(true);
      expect(canManageUsersWith('firebase', 'contributor')).toBe(false);
      expect(canManageUsersWith('firebase', 'viewer')).toBe(false);
      expect(canManageUsersWith('firebase', null)).toBe(false);
    });

    it('is unrestricted in local mode', () => {
      expect(canManageUsersWith('local', null)).toBe(true);
    });

    it('never grants management without also granting editing', () => {
      const roles = ['admin', 'contributor', 'viewer', null] as const;
      for (const role of roles) {
        if (canManageUsersWith('firebase', role)) {
          expect(canEditWith('firebase', role)).toBe(true);
        }
      }
    });
  });
});

import { ROLE_HELP } from './access';

describe('ROLE_HELP', () => {
  it('has a sentence for every role, and names edit mode for the ones that get it', () => {
    expect(Object.keys(ROLE_HELP).sort()).toEqual(['admin', 'contributor', 'viewer']);
    expect(ROLE_HELP.viewer).toMatch(/No edit mode/);
    expect(ROLE_HELP.contributor).toMatch(/Edit mode/);
    expect(ROLE_HELP.admin).toMatch(/Settings/);
  });
});

import { activeRoleOf, firstTeam, letIn, maySee, memberTeamIds, roleOnTeam, teamRolesOf } from './access';
import { DEFAULT_TEAM_ID } from './team-scope';

/**
 * A role per team (27 Sep 2026, release 3): the root entry answers for the root, a root admin is an admin of every
 * team, and anyone else has on a team only what that team's own list gives them, read from their `members/{email}`
 * index. The same rule as `api/src/roles.ts` and the release 3 rules.
 */
describe('a role per team (release 3)', () => {
  const teams = { b: 'contributor' as const, c: 'viewer' as const };

  describe('activeRoleOf', () => {
    it('is the role when active and role are both truthy, and nothing otherwise', () => {
      expect(activeRoleOf({ role: 'viewer', active: true })).toBe('viewer');
      expect(activeRoleOf({ role: 'admin', active: false })).toBeNull();
      expect(activeRoleOf({ active: true })).toBeNull();
      expect(activeRoleOf({ role: 'owner', active: true })).toBeNull();
      expect(activeRoleOf(null)).toBeNull();
      expect(activeRoleOf(undefined)).toBeNull();
    });
  });

  describe('teamRolesOf', () => {
    it('keeps the keys that are team ids and the values that are roles, and drops the rest', () => {
      expect(teamRolesOf({ teams: { b: 'contributor', Alpha: 'admin', default: 'admin', c: 'owner', 'd-1': 'viewer' } })).toEqual({ b: 'contributor', 'd-1': 'viewer' });
      expect(teamRolesOf({ teams: 'b' })).toEqual({});
      expect(teamRolesOf({})).toEqual({});
      expect(teamRolesOf(null)).toEqual({});
    });
  });

  describe('roleOnTeam and maySee', () => {
    it('answers the root with the root role alone', () => {
      expect(roleOnTeam('viewer', teams, DEFAULT_TEAM_ID)).toBe('viewer');
      expect(roleOnTeam(null, teams, DEFAULT_TEAM_ID)).toBeNull();
      expect(maySee(null, teams, DEFAULT_TEAM_ID)).toBe(false);
      expect(maySee('viewer', {}, DEFAULT_TEAM_ID)).toBe(true);
    });

    it('makes a root admin an admin of every team, listed or not', () => {
      expect(roleOnTeam('admin', {}, 'b')).toBe('admin');
      expect(roleOnTeam('admin', { b: 'viewer' }, 'b')).toBe('admin');
      expect(maySee('admin', {}, 'never-heard-of')).toBe(true);
    });

    it("gives anyone else only what the team's own list gives them", () => {
      expect(roleOnTeam('contributor', teams, 'b')).toBe('contributor');
      expect(roleOnTeam('viewer', teams, 'b')).toBe('contributor');
      expect(roleOnTeam(null, teams, 'c')).toBe('viewer');
      expect(roleOnTeam('contributor', teams, 'd')).toBeNull();
      expect(roleOnTeam(null, {}, 'b')).toBeNull();
      expect(maySee('viewer', teams, 'd')).toBe(false);
    });
  });

  describe('memberTeamIds and letIn', () => {
    it('lists the teams sorted, and lets a person in with a root role or at least one team', () => {
      expect(memberTeamIds({ c: 'viewer', b: 'admin' })).toEqual(['b', 'c']);
      expect(memberTeamIds({})).toEqual([]);
      expect(letIn('viewer', {})).toBe(true);
      expect(letIn(null, { b: 'viewer' })).toBe(true);
      expect(letIn(null, {})).toBe(false);
    });
  });

  describe('firstTeam', () => {
    it('is the wanted team when the person may see it', () => {
      expect(firstTeam('b', 'viewer', teams)).toBe('b');
      expect(firstTeam('b', null, teams)).toBe('b');
      expect(firstTeam('x', 'admin', {})).toBe('x');
      expect(firstTeam(DEFAULT_TEAM_ID, 'viewer', {})).toBe(DEFAULT_TEAM_ID);
    });

    it('falls back to the root for a root member, and to their first team for anyone else', () => {
      // A stored key naming a team that has since taken them off its list.
      expect(firstTeam('gone', 'viewer', teams)).toBe(DEFAULT_TEAM_ID);
      expect(firstTeam('gone', null, teams)).toBe('b');
      // A person on other teams alone never lands on the root, even asked for.
      expect(firstTeam(DEFAULT_TEAM_ID, null, teams)).toBe('b');
      // Nobody: the default, as the login page is nobody's team.
      expect(firstTeam(DEFAULT_TEAM_ID, null, {})).toBe(DEFAULT_TEAM_ID);
      expect(firstTeam('b', null, {})).toBe(DEFAULT_TEAM_ID);
    });
  });
});
