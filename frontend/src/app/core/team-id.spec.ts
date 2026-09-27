import { describe, expect, it } from 'vitest';
import { SUFFIX_LENGTH, newTeamId, randomSuffix, slugTeamName } from './team-id';
import { isTeamId } from './team-scope';

/**
 * The id rule for a new team (27 Sep 2026): slug, hyphen, six random characters, never a collision,
 * never anything `isTeamId` refuses. The random source is handed in, so the collision cases are exact.
 */

/** A source that answers the given suffixes in turn, then the last one for ever. */
function answers(...list: string[]): () => string {
  let i = 0;
  return () => list[Math.min(i++, list.length - 1)];
}

describe('slugTeamName', () => {
  it('lower-cases, collapses runs of anything but letters and digits to one hyphen, and trims the ends', () => {
    expect(slugTeamName('  Bom   Squad!! ')).toBe('bom-squad');
    expect(slugTeamName('Team_B (2026)')).toBe('team-b-2026');
    expect(slugTeamName('---')).toBe('');
  });

  it('folds accents so a non-ASCII name still reads', () => {
    expect(slugTeamName('Équipe Ünïcode')).toBe('equipe-unicode');
    expect(slugTeamName('Señor Ñoño')).toBe('senor-nono');
  });

  it('slugs a name with nothing Latin in it to nothing', () => {
    expect(slugTeamName('日本語')).toBe('');
    expect(slugTeamName('')).toBe('');
  });

  it('cuts a long name so the whole id fits in forty characters, without a hyphen at the cut', () => {
    const slug = slugTeamName('a'.repeat(30) + ' ' + 'b'.repeat(30));
    expect(slug.length).toBeLessThanOrEqual(40 - 1 - SUFFIX_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
    const cutAtHyphen = slugTeamName('a'.repeat(32) + ' bbbbbbbb');
    expect(cutAtHyphen).toBe('a'.repeat(32));
  });
});

describe('newTeamId', () => {
  it('is the slug, a hyphen and the suffix, and satisfies isTeamId', () => {
    const id = newTeamId('Bom Squad Academy', [], answers('k3x9qa'));
    expect(id).toBe('bom-squad-academy-k3x9qa');
    expect(isTeamId(id)).toBe(true);
  });

  it('tries another suffix on a collision, and only then', () => {
    const id = newTeamId('Bom Squad', ['bom-squad-aaaaaa'], answers('aaaaaa', 'bbbbbb'));
    expect(id).toBe('bom-squad-bbbbbb');
    expect(newTeamId('Bom Squad', ['bom-squad-zzzzzz'], answers('aaaaaa', 'bbbbbb'))).toBe('bom-squad-aaaaaa');
  });

  it('gives up after a bounded number of collisions rather than looping', () => {
    expect(() => newTeamId('Bom Squad', ['bom-squad-aaaaaa'], answers('aaaaaa'))).toThrow(/free id/);
  });

  it('refuses a name that slugs to nothing', () => {
    expect(() => newTeamId('日本語', [], answers('aaaaaa'))).toThrow(/letter or digit/);
    expect(() => newTeamId('   ', [], answers('aaaaaa'))).toThrow(/letter or digit/);
  });

  it('refuses a suffix that is not six lower-case alphanumerics, so a bad source cannot build a path', () => {
    expect(() => newTeamId('Bom Squad', [], answers('ABCDEF'))).toThrow(/suffix/);
    expect(() => newTeamId('Bom Squad', [], answers('abc'))).toThrow(/suffix/);
    expect(() => newTeamId('Bom Squad', [], answers('ab-cde'))).toThrow(/suffix/);
  });

  it('keeps a long name inside the forty characters isTeamId allows', () => {
    const id = newTeamId('The Longest Team Name Anyone Has Ever Typed Into This Box', [], answers('abc123'));
    expect(id.length).toBeLessThanOrEqual(40);
    expect(isTeamId(id)).toBe(true);
    expect(id.endsWith('-abc123')).toBe(true);
  });

  it('never yields the reserved words: a team called default or teams still gets a suffix', () => {
    expect(isTeamId(newTeamId('default', [], answers('abc123')))).toBe(true);
    expect(isTeamId(newTeamId('teams', [], answers('abc123')))).toBe(true);
  });

  it('draws six characters from the suffix alphabet by default', () => {
    for (let i = 0; i < 20; i++) expect(randomSuffix()).toMatch(/^[a-z0-9]{6}$/);
    expect(isTeamId(newTeamId('Bom Squad', []))).toBe(true);
  });
});
