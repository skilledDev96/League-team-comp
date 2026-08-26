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

/** Who may change roles and settings. Admin only, on top of being able to edit. */
export function canManageUsersWith(mode: AccessMode, role: AccessRole | null | undefined): boolean {
  return mode === 'local' || role === 'admin';
}
