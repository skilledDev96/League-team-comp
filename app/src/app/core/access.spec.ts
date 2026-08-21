import { describe, expect, it } from 'vitest';
import { isBootstrapAdminEmail, isEditableRole, normalizeEmail } from './access';

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
});
