import { describe, expect, it } from 'vitest';
import { withoutUnseenBans } from './draft-advisor.service';

describe('withoutUnseenBans', () => {
  it('takes every ban nobody saw out of the request, and leaves the rest alone (17 Sep 2026)', () => {
    const request = { action: 'ban', bans: ['Akshan', '-', '', 'Yuumi', '-'], candidates: ['Ahri'] };
    expect(withoutUnseenBans(request)).toEqual({ action: 'ban', bans: ['Akshan', 'Yuumi'], candidates: ['Ahri'] });
    // The caller's own object is not changed.
    expect(request.bans).toHaveLength(5);
  });

  it('passes a request with no bans list through as it is', () => {
    const request = { action: 'pick' };
    expect(withoutUnseenBans(request)).toBe(request);
  });
});
