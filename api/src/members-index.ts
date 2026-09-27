/**
 * The index of a person's teams (27 Sep 2026, release 3 of the multi-team work).
 *
 * A team's membership list lives under the team, at `teams/{teamId}/access/{email}`, and under the
 * release 3 rules only that team's admins may list it. So a person signing in cannot ask "which
 * teams am I on" by querying; they read one root document, `members/{email}`, whose `teams` map
 * names each team they hold an active role on and the role: `{ teams: { b: 'contributor' } }`.
 *
 * The app never writes it. The `syncTeamMember` trigger in `index.ts` writes it through the admin
 * SDK on every write to a team's access entry, and this module is the pure part: given the index
 * as it is, the team and the entry as it now stands, what the index becomes. An entry that is
 * gone, switched off or without a role drops the team from the map, and a map with nothing left
 * in it is no document at all, so a person removed from their last team has no index entry to
 * find.
 *
 * A team's deletion needs nothing more: the app deletes the team's access entries in the delete
 * batch, and the trigger cleans the index one entry at a time.
 */
import { normalizeEmail } from './parse-request';
import { AccessEntryLike, activeRole } from './roles';
import { isTeamId } from './team-scope';

export interface MembersDoc {
  /** teamId -> role, for every team the person holds an active role on. */
  teams?: Record<string, string>;
}

/**
 * The index after one team's entry changed: `current` as stored (null when there is none), the
 * team, and the entry as it now stands (null when it was deleted). Null when the map would be
 * empty, which the trigger reads as "delete the document". Only the one team's key moves; the
 * others are carried as they are.
 */
export function nextMembersDoc(
  current: MembersDoc | null | undefined,
  teamId: string,
  entry: AccessEntryLike | null | undefined
): { teams: Record<string, string> } | null {
  const teams: Record<string, string> = {};
  for (const [id, role] of Object.entries(current?.teams ?? {})) {
    if (id !== teamId && typeof role === 'string' && role) teams[id] = role;
  }
  const role = activeRole(entry);
  if (role) teams[teamId] = role;
  return Object.keys(teams).length ? { teams } : null;
}

/**
 * The team and email a trigger event names, or null when the path is not one the index should
 * hold: a document id that is not a team id (`default`, `teams`, a capital letter, a space) or
 * an email that is not lower-case and trimmed. The app writes emails through `normalizeEmail`, so a
 * document under any other spelling was made by hand and would index a person nobody signs in as.
 */
export function memberKeyOf(teamId: string, email: string): { teamId: string; email: string } | null {
  if (!isTeamId(teamId)) return null;
  if (!email || email !== normalizeEmail(email)) return null;
  return { teamId, email };
}
