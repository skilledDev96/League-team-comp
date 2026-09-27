/**
 * Who someone is on a team (27 Sep 2026, release 3 of the multi-team work).
 *
 * Until release 3 there was one membership list, the root `access/{email}`, and it answered for
 * every team. Now a team has a list of its own at `teams/{teamId}/access/{email}`, the same shape
 * (`{ email, role, active }`), and the rule is:
 *
 * - On the root (Bom Squad, `default`) a person's role is exactly what it was: the bootstrap
 *   admin, else an active root entry's role, else nothing.
 * - A root admin (the bootstrap email included) is an admin of every team.
 * - Anyone else has on a team only what that team's own list gives them, through the same
 *   truthiness gate the root applies: `active` and `role` both truthy, or nothing.
 *
 * The gate is the one `firestore.rules` and the app's AuthService apply (`!active || !role`), so the
 * three cannot disagree about who is in. Pure over injected reads, so the cases can be tested
 * without a project; `index.ts` binds the reads to Firestore.
 */
import { DEFAULT_TEAM_ID, isTeamId } from './team-scope';

export type AccessRole = 'admin' | 'contributor' | 'viewer';

/** An `access/{email}` document as stored, at the root or under a team. */
export interface AccessEntryLike {
  role?: unknown;
  active?: unknown;
}

export interface RoleReads {
  /** The bootstrap admins, admins everywhere without an entry. */
  bootstrapAdmins: ReadonlySet<string>;
  /** The root `access/{email}` document, or null when there is none. */
  rootEntry(email: string): Promise<AccessEntryLike | null | undefined>;
  /** The team's `teams/{teamId}/access/{email}` document, or null when there is none. */
  teamEntry(teamId: string, email: string): Promise<AccessEntryLike | null | undefined>;
}

/** The three roles the app knows; `activeRoleOf` in the app's `core/access.ts` keeps the same list. */
const ROLES: readonly AccessRole[] = ['admin', 'contributor', 'viewer'];

/**
 * The role an entry grants: its `role` when both `active` and `role` are truthy and the role is one
 * of the three, else null. An entry switched off keeps its role on the document and grants nothing;
 * a role that is not a string, or a string outside the three (a hand-written `owner`, say), grants
 * nothing either, exactly as the app's `activeRoleOf` reads it, so a hand-edited entry cannot be a
 * member to the functions and nobody to the app. The rules' `truthy()` is looser on this one point:
 * any non-empty role string passes their door for reads (`firestore.rules` says so on `truthy`).
 */
export function activeRole(entry: AccessEntryLike | null | undefined): AccessRole | null {
  if (!entry || !entry.active || !entry.role || typeof entry.role !== 'string') return null;
  return ROLES.includes(entry.role as AccessRole) ? (entry.role as AccessRole) : null;
}

/** The root role: the bootstrap admin, else the active root entry, else null. */
export async function rootRoleOf(email: string, reads: RoleReads): Promise<AccessRole | null> {
  if (reads.bootstrapAdmins.has(email)) return 'admin';
  return activeRole(await reads.rootEntry(email));
}

/**
 * The role `email` holds on `teamId`. For the root it is `rootRoleOf`, so a request that names no
 * team is checked exactly as before release 3. For a team, a root admin is its admin without a
 * team entry being read; anyone else has the team entry's active role, or nothing. A `teamId`
 * that is not a team id throws: the parsers refuse one before a handler gets here, and the throw
 * is the net under them, as in `teamPaths`.
 */
export async function roleOf(email: string, teamId: string, reads: RoleReads): Promise<AccessRole | null> {
  const root = await rootRoleOf(email, reads);
  if (teamId === DEFAULT_TEAM_ID) return root;
  if (!isTeamId(teamId)) throw new Error(`Not a team id: ${JSON.stringify(teamId)}`);
  if (root === 'admin') return 'admin';
  return activeRole(await reads.teamEntry(teamId, email));
}
