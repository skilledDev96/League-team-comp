import { describe, expect, it } from 'vitest';
import { memberKeyOf, nextMembersDoc } from './members-index';

/** The index of a person's teams, as the `syncTeamMember` trigger recomputes it (release 3, 27 Sep 2026). */

describe('nextMembersDoc', () => {
  it('adds a team to a person with no index yet', () => {
    expect(nextMembersDoc(null, 'b', { active: true, role: 'contributor' })).toEqual({ teams: { b: 'contributor' } });
    expect(nextMembersDoc(undefined, 'b', { active: true, role: 'viewer' })).toEqual({ teams: { b: 'viewer' } });
    expect(nextMembersDoc({}, 'b', { active: true, role: 'admin' })).toEqual({ teams: { b: 'admin' } });
  });

  it('adds a team beside the ones already there', () => {
    expect(nextMembersDoc({ teams: { a: 'viewer' } }, 'b', { active: true, role: 'admin' })).toEqual({
      teams: { a: 'viewer', b: 'admin' }
    });
  });

  it('changes the role on a team already there', () => {
    expect(nextMembersDoc({ teams: { a: 'viewer', b: 'viewer' } }, 'b', { active: true, role: 'admin' })).toEqual({
      teams: { a: 'viewer', b: 'admin' }
    });
  });

  it('drops the team when the entry is switched off, and keeps the others', () => {
    expect(nextMembersDoc({ teams: { a: 'viewer', b: 'admin' } }, 'b', { active: false, role: 'admin' })).toEqual({
      teams: { a: 'viewer' }
    });
  });

  it('drops the team when the entry has no role', () => {
    expect(nextMembersDoc({ teams: { a: 'viewer', b: 'admin' } }, 'b', { active: true })).toEqual({ teams: { a: 'viewer' } });
    expect(nextMembersDoc({ teams: { a: 'viewer', b: 'admin' } }, 'b', { active: true, role: '' })).toEqual({ teams: { a: 'viewer' } });
  });

  it('drops the team when the entry is gone', () => {
    expect(nextMembersDoc({ teams: { a: 'viewer', b: 'admin' } }, 'b', null)).toEqual({ teams: { a: 'viewer' } });
    expect(nextMembersDoc({ teams: { a: 'viewer', b: 'admin' } }, 'b', undefined)).toEqual({ teams: { a: 'viewer' } });
  });

  it('is null when nothing is left, so the trigger deletes the document', () => {
    expect(nextMembersDoc({ teams: { b: 'admin' } }, 'b', null)).toBeNull();
    expect(nextMembersDoc({ teams: { b: 'admin' } }, 'b', { active: false, role: 'admin' })).toBeNull();
    expect(nextMembersDoc(null, 'b', null)).toBeNull();
    expect(nextMembersDoc(null, 'b', { active: false, role: 'viewer' })).toBeNull();
    expect(nextMembersDoc({ teams: {} }, 'b', { active: true })).toBeNull();
  });

  it('leaves the stored map alone and answers a new one', () => {
    const current = { teams: { a: 'viewer' } };
    const next = nextMembersDoc(current, 'b', { active: true, role: 'admin' });
    expect(current).toEqual({ teams: { a: 'viewer' } });
    expect(next).not.toBe(current);
    expect(next?.teams).not.toBe(current.teams);
  });

  it('carries only well-formed keys of the other teams', () => {
    const current = { teams: { a: 'viewer', odd: 42, blank: '' } } as unknown as { teams: Record<string, string> };
    expect(nextMembersDoc(current, 'b', { active: true, role: 'admin' })).toEqual({ teams: { a: 'viewer', b: 'admin' } });
  });
});

describe('memberKeyOf', () => {
  it('accepts a team id and a lower-case, trimmed email', () => {
    expect(memberKeyOf('b', 'x@example.com')).toEqual({ teamId: 'b', email: 'x@example.com' });
    expect(memberKeyOf('bom-squad-2', 'first.last@example.com')).toEqual({ teamId: 'bom-squad-2', email: 'first.last@example.com' });
  });

  it('skips a document id that is not a team id', () => {
    for (const teamId of ['default', 'teams', 'B', 'Team B', '', 'a/b']) {
      expect(memberKeyOf(teamId, 'x@example.com'), JSON.stringify(teamId)).toBeNull();
    }
  });

  it('skips an email that is not lower-case and trimmed, since the app never writes one', () => {
    for (const email of ['X@example.com', ' x@example.com', 'x@example.com ', '']) {
      expect(memberKeyOf('b', email), JSON.stringify(email)).toBeNull();
    }
  });
});
