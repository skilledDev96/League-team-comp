import { AccessRole } from '../models/team.models';

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
 * Who may write team data. Mirrored by canEdit() in firestore.rules, which is
 * the real enforcement — this only decides whether the UI offers the controls.
 */
export function canEditWith(mode: AccessMode, role: AccessRole | null | undefined): boolean {
  return mode === 'local' || isEditableRole(role);
}

/** What each role can do, in the words the Access tab shows under the select. */
export const ROLE_HELP: Record<AccessRole, string> = {
  viewer: 'Reads everything except Admin. No edit mode.',
  contributor: 'Edit mode: comps, players, games, scouting, the draft room. Cannot change roles, settings or delete.',
  admin: 'Everything a contributor can, plus Settings, Access, Diagnostics and deletes.'
};

/** Who may change roles and settings. Admin only, on top of being able to edit. */
export function canManageUsersWith(mode: AccessMode, role: AccessRole | null | undefined): boolean {
  return mode === 'local' || role === 'admin';
}
