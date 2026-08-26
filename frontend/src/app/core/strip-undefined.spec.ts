import { describe, expect, it } from 'vitest';
import { stripUndefined } from './strip-undefined';

describe('stripUndefined', () => {
  it('drops undefined fields', () => {
    expect(stripUndefined({ a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it('keeps the values that only look empty', () => {
    // Firestore accepts all of these; only undefined is the problem.
    const kept = stripUndefined({ zero: 0, empty: '', no: false, nothing: null });
    expect(kept).toEqual({ zero: 0, empty: '', no: false, nothing: null });
  });

  it('does not invent a key that was absent', () => {
    expect(Object.keys(stripUndefined({ a: undefined }))).toEqual([]);
  });

  it('recurses into nested objects', () => {
    const cleaned = stripUndefined({ profile: { region: 'euw', tag: undefined } });
    expect(cleaned).toEqual({ profile: { region: 'euw' } });
  });

  it('leaves an array of primitives exactly as it is', () => {
    // Picks are stored by position, so blanks must survive.
    const picks = ['Sion', '', 'Akali', '', ''];
    expect(stripUndefined({ picks }).picks).toEqual(picks);
  });

  it('cleans objects inside an array', () => {
    // A play token omits `role` for enemy tokens; a spread can make it explicit.
    const cleaned = stripUndefined({
      tokens: [
        { id: 'a', champion: 'Vi', role: 'Jungle' },
        { id: 'b', champion: '', role: undefined }
      ]
    });
    expect(cleaned.tokens).toEqual([
      { id: 'a', champion: 'Vi', role: 'Jungle' },
      { id: 'b', champion: '' }
    ]);
  });

  it('cleans objects nested deeper inside arrays', () => {
    const cleaned = stripUndefined({
      games: [{ players: [{ name: 'Go10x', cs: undefined }] }]
    });
    expect(cleaned.games).toEqual([{ players: [{ name: 'Go10x' }] }]);
  });

  it('does not mutate the input', () => {
    const input = { a: 1, b: undefined, nested: { c: undefined } };
    stripUndefined(input);
    expect('b' in input).toBe(true);
    expect('c' in input.nested).toBe(true);
  });

  it('handles an empty object', () => {
    expect(stripUndefined({})).toEqual({});
  });
});
