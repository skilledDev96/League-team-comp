import { describe, expect, it } from 'vitest';
import { formatRiotId, parseRiotId, parseRiotIds } from './riot-id';

describe('parseRiotIds', () => {
  it('reads a plain Riot ID', () => {
    expect(parseRiotIds('Faker#KR1')).toEqual([{ name: 'Faker', tag: 'KR1', region: undefined }]);
  });

  it('reads a whole op.gg multi-search link, which is how a roster arrives', () => {
    // The league rulebook requires every team to publish one of these.
    const ids = parseRiotIds('https://www.op.gg/multisearch/euw?summoners=Alpha%23EUW,Bravo%23123');
    expect(ids).toEqual([
      { name: 'Alpha', tag: 'EUW', region: 'euw' },
      { name: 'Bravo', tag: '123', region: 'euw' }
    ]);
  });

  it('reads a single op.gg summoner page, where the tag is dash-separated', () => {
    const ids = parseRiotIds('https://op.gg/summoners/euw/Some-Name-EUW');
    expect(ids).toEqual([{ name: 'Some-Name', tag: 'EUW', region: 'euw' }]);
  });

  it('reads a pasted list however it was separated', () => {
    expect(parseRiotIds('A#1, B#2\nC#3; D#4').map(formatRiotId)).toEqual(['A#1', 'B#2', 'C#3', 'D#4']);
  });

  it('survives a hash that was url-encoded on the way out of an address bar', () => {
    expect(parseRiotId('Alpha%23EUW')).toEqual({ name: 'Alpha', tag: 'EUW', region: undefined });
  });

  it('keeps a name that contains spaces', () => {
    expect(parseRiotId('Big Bad Wolf#EUW')?.name).toBe('Big Bad Wolf');
  });

  it('never lists the same player twice', () => {
    expect(parseRiotIds('A#1, A#1, a#1')).toHaveLength(1);
  });

  it('skips anything it cannot read rather than guessing', () => {
    // A wrong Riot ID scouts a stranger, which is worse than an empty row.
    expect(parseRiotIds('just a name with no tag')).toEqual([]);
    expect(parseRiotIds('#TAGONLY')).toEqual([]);
    expect(parseRiotIds('')).toEqual([]);
  });

  it('keeps the good entries when only some of them parse', () => {
    expect(parseRiotIds('A#1, nonsense, B#2').map(formatRiotId)).toEqual(['A#1', 'B#2']);
  });

  it('carries the region the link named, so scouting hits the right platform', () => {
    expect(parseRiotId('https://www.op.gg/multisearch/kr?summoners=Faker%23KR1')?.region).toBe('kr');
  });

  it('leaves the region unset when nothing said one', () => {
    expect(parseRiotId('Faker#KR1')?.region).toBeUndefined();
  });

  it('takes the last hash, so a name containing one still parses', () => {
    expect(parseRiotId('od#d#EUW')).toEqual({ name: 'od#d', tag: 'EUW', region: undefined });
  });
});

describe('formatRiotId', () => {
  it('round-trips through the form a person reads', () => {
    const id = parseRiotId('Alpha#EUW')!;
    expect(formatRiotId(id)).toBe('Alpha#EUW');
    expect(parseRiotId(formatRiotId(id))).toEqual(id);
  });
});
