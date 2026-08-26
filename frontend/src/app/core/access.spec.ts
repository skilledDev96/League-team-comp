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
