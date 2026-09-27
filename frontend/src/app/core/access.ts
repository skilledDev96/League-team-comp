import { AccessRole } from '../models/team.models';
import { DEFAULT_TEAM_ID, isTeamId } from './team-scope';

export const BOOTSTRAP_ADMIN_EMAILS = ['ruanhart7@gmail.com'];

export function normalizeEmail(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase();
}

export function isBootstrapAdminEmail(email: string | null | undefined): boolean {
  return BOOTSTRAP_ADMIN_EMAILS.includes(normalizeEmail(email));
}

export function isEditableRole(role: AccessRole | null | undefined): boolean {
  return role === 'admin' || role === 'contributor';
}

/** Local mode has no backend and no roles, so it is deliberately unrestricted. */
export type AccessMode = 'firebase' | 'local';

/**
 * Who may write team data. Mirrored by canEdit() in firestore.rules, which also
 * requires an active access entry; the rules are the real enforcement — this
 * only decides whether the UI offers the controls.
 */
export function canEditWith(mode: AccessMode, role: AccessRole | null | undefined): boolean {
  return mode === 'local' || isEditableRole(role);
}

/** What each role can do, in the words the Access tab shows under the select. */
export const ROLE_HELP: Record<AccessRole, string> = {
  viewer: 'Reads everything except Admin. No edit mode.',
  contributor: 'Edit mode: comps (adding, editing, deleting), players, games, scouting, the draft room. Cannot change roles or settings, or delete players.',
  admin: 'Everything a contributor can, plus Settings, Access, Diagnostics and deleting players.'
};

/** Who may change roles and settings. Admin only, on top of being able to edit. */
export function canManageUsersWith(mode: AccessMode, role: AccessRole | null | undefined): boolean {
  return mode === 'local' || role === 'admin';
}

// ---- A role per team (27 Sep 2026, release 3) ---------------------------------
//
// Until release 3 there was one membership list, the root `access/{email}`, and it
// answered for every team. Now a team has a list of its own at
// `teams/{teamId}/access/{email}`, the same shape, and a person's teams are indexed
// in the root document `members/{email}` as `{ teams: { [teamId]: role } }`, which
// the `syncTeamMember` trigger writes and the app only reads. The rule, here as pure
// functions over the root role and that map so the cases run without Firebase:
//
// - On the root (Bom Squad, `default`) the role is exactly what it was: the root
//   entry's, or nothing.
// - A root admin is an admin of every team, listed or not.
// - Anyone else has on a team only what that team's own list gives them.
//
// `api/src/roles.ts` is the same rule for the functions, and `firestore.rules`
// (release 3) the same for the database, so the three cannot disagree about who is
// in and what they may do.

const ROLES: readonly AccessRole[] = ['admin', 'contributor', 'viewer'];

/** The role an `access/{email}` document grants: its role when `active` and `role` are both truthy, else null. */
export function activeRoleOf(entry: { role?: unknown; active?: unknown } | null | undefined): AccessRole | null {
  if (!entry || !entry.active || !entry.role) return null;
  return ROLES.includes(entry.role as AccessRole) ? (entry.role as AccessRole) : null;
}

/**
 * The teams map of a `members/{email}` document as stored, kept to what the app can use: a key that is a team
 * id and a value that is a role. A hand edit under any other key or value is dropped, never a path.
 */
export function teamRolesOf(doc: { teams?: unknown } | null | undefined): Record<string, AccessRole> {
  const teams: Record<string, AccessRole> = {};
  const raw = doc?.teams;
  if (!raw || typeof raw !== 'object') return teams;
  for (const [teamId, role] of Object.entries(raw as Record<string, unknown>)) {
    if (isTeamId(teamId) && ROLES.includes(role as AccessRole)) teams[teamId] = role as AccessRole;
  }
  return teams;
}

/** The role `rootRole` and the members map give on `teamId`: the root's own on the default, admin everywhere for a root admin, else the team's. */
export function roleOnTeam(rootRole: AccessRole | null, teams: Record<string, AccessRole>, teamId: string): AccessRole | null {
  if (teamId === DEFAULT_TEAM_ID) return rootRole;
  if (rootRole === 'admin') return 'admin';
  return teams[teamId] ?? null;
}

/** Whether the person may open `teamId` at all: any role on it. */
export function maySee(rootRole: AccessRole | null, teams: Record<string, AccessRole>, teamId: string): boolean {
  return roleOnTeam(rootRole, teams, teamId) !== null;
}

/** The ids the members map names, sorted, so "their first team" is the same on every device. */
export function memberTeamIds(teams: Record<string, AccessRole>): string[] {
  return Object.keys(teams).filter(isTeamId).sort();
}

/** Whether a signed-in person is let in at all: a root role, or at least one team. */
export function letIn(rootRole: AccessRole | null, teams: Record<string, AccessRole>): boolean {
  return rootRole !== null || memberTeamIds(teams).length > 0;
}

/**
 * The team to open: the one wanted (a stored preference, or the session's choice) when the person may see it,
 * else the root when they are a root member, else their first team. The default for a person with nothing,
 * which is nobody signed in.
 */
export function firstTeam(wanted: string, rootRole: AccessRole | null, teams: Record<string, AccessRole>): string {
  if (maySee(rootRole, teams, wanted)) return wanted;
  if (rootRole !== null) return DEFAULT_TEAM_ID;
  return memberTeamIds(teams)[0] ?? DEFAULT_TEAM_ID;
}
