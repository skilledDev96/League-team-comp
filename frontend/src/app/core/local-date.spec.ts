import { describe, expect, it } from 'vitest';
import { parseLocalDate } from './local-date';

describe('parseLocalDate', () => {
  it('reads a bare day as local midnight, not UTC midnight', () => {
    expect(parseLocalDate('2026-09-13')).toBe(new Date(2026, 8, 13).getTime());
  });

  it('reads a datetime-local value and an ISO stamp, and refuses free text', () => {
    expect(parseLocalDate('2026-09-13T20:00')).toBe(Date.parse('2026-09-13T20:00'));
    expect(parseLocalDate('2026-09-13T18:00:00.000Z')).toBe(Date.parse('2026-09-13T18:00:00.000Z'));
    expect(parseLocalDate('Sat 20:00')).toBeNull();
    expect(parseLocalDate('')).toBeNull();
    expect(parseLocalDate(undefined)).toBeNull();
  });
});
