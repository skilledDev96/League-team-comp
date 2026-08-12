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
