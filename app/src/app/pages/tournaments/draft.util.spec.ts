import { describe, expect, it } from 'vitest';
import { blockedSet, compAvailability, CompChampions, poolPressure } from './draft.util';

const COMPS: CompChampions[] = [
  { id: 'engage', name: 'Engage', champions: ['Maokai', 'Vi', 'Yasuo', 'Miss Fortune', 'Nautilus'] },
  { id: 'poke', name: 'Poke', champions: ['Jayce', 'Nidalee', 'Xerath', 'Ezreal', 'Karma'] },
  { id: 'dive', name: 'Dive', champions: ['Camille', 'Vi', 'Ahri', 'Kaisa', 'Rakan'] }
];

describe('blockedSet', () => {
  it('folds several lists into one normalised set', () => {
    const set = blockedSet(['Vi'], ['Miss Fortune'], undefined, ["Kai'Sa"]);
    expect(set.has('vi')).toBe(true);
    expect(set.has('missfortune')).toBe(true);
    expect(set.has('kaisa')).toBe(true);
  });

  it('matches regardless of punctuation or casing', () => {
    expect(blockedSet(["Kai'Sa"]).has(blockedSet(['kaisa']).values().next().value!)).toBe(true);
  });

  it('ignores empty entries', () => {
    expect(blockedSet(['', 'Vi']).size).toBe(1);
  });
});

describe('compAvailability', () => {
  it('marks a comp playable when nothing it needs is gone', () => {
    const [first] = compAvailability([COMPS[1]], blockedSet(['Vi']));
    expect(first.playable).toBe(true);
    expect(first.blocked).toEqual([]);
  });

  it('breaks a comp that lost a champion, and says which', () => {
    const [engage] = compAvailability([COMPS[0]], blockedSet(['Vi']));
    expect(engage.playable).toBe(false);
    expect(engage.blocked).toEqual(['Vi']);
    expect(engage.available).toHaveLength(4);
  });

  it('puts playable comps first, then the least-damaged', () => {
    // Vi breaks Engage and Dive; Dive also loses Ahri, so Engage is the nearer fix.
    const rows = compAvailability(COMPS, blockedSet(['Vi', 'Ahri']));
    expect(rows.map((r) => r.name)).toEqual(['Poke', 'Engage', 'Dive']);
  });

  it('treats a differently punctuated pick as the same champion', () => {
    const [dive] = compAvailability([COMPS[2]], blockedSet(["kai'sa"]));
    expect(dive.blocked).toEqual(['Kaisa']);
  });

  it('does not call an empty comp playable', () => {
    const [empty] = compAvailability([{ id: 'x', name: 'Empty', champions: [] }], blockedSet());
    expect(empty.playable).toBe(false);
  });
});

describe('poolPressure', () => {
  const players = [
    { name: 'Go10x', pool: ['Vi', 'Sejuani', 'Nidalee'] },
    { name: 'Rulukuku', pool: ['Yorick', 'Maokai', 'Camille', 'Ornn'] }
  ];

  it('splits each pool into what is left and what is gone', () => {
    const [thinnest] = poolPressure(players, blockedSet(['Vi', 'Sejuani']));
    expect(thinnest.name).toBe('Go10x');
    expect(thinnest.left).toEqual(['Nidalee']);
    expect(thinnest.gone).toEqual(['Vi', 'Sejuani']);
  });

  it('lists the thinnest pool first, since that is who to plan around', () => {
    const rows = poolPressure(players, blockedSet(['Vi']));
    expect(rows.map((r) => r.name)).toEqual(['Go10x', 'Rulukuku']);
  });

  it('flags a player with no room left for the games remaining', () => {
    const [go10x] = poolPressure(players, blockedSet(['Vi', 'Sejuani']), 2);
    expect(go10x.critical).toBe(true);
  });

  it('does not flag a player who still has depth', () => {
    const rows = poolPressure(players, blockedSet(['Vi']), 1);
    expect(rows.find((r) => r.name === 'Rulukuku')!.critical).toBe(false);
  });

  it('counts a player with exactly one champion left as critical for one game', () => {
    const rows = poolPressure([{ name: 'Solo', pool: ['Ahri', 'Zed'] }], blockedSet(['Zed']), 1);
    expect(rows[0].critical).toBe(true);
  });
});
