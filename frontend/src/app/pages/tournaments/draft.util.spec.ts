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

  it('ranks playable comps by win rate, best first', () => {
    const rated = [
      { ...COMPS[0], winRate: 40 },
      { ...COMPS[1], winRate: 80 },
      { ...COMPS[2], winRate: 60 }
    ];
    const rows = compAvailability(rated, blockedSet());
    expect(rows.map((r) => r.name)).toEqual(['Poke', 'Dive', 'Engage']);
  });

  it('sinks a comp with no record below one that has won', () => {
    const rows = compAvailability([{ ...COMPS[0] }, { ...COMPS[1], winRate: 10 }], blockedSet());
    expect(rows.map((r) => r.name)).toEqual(['Poke', 'Engage']);
  });

  it('still ranks broken comps by damage before win rate', () => {
    // Poke loses one champion, Engage two; the nearer fix leads regardless of record.
    const rated = [
      { ...COMPS[0], winRate: 90 },
      { ...COMPS[1], winRate: 10 }
    ];
    const rows = compAvailability(rated, blockedSet(['Maokai', 'Vi', 'Jayce']));
    expect(rows.map((r) => r.name)).toEqual(['Poke', 'Engage']);
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
    { name: 'Go10x', role: 'Jungle', pool: ['Vi', 'Sejuani', 'Nidalee'] },
    { name: 'Rulukuku', role: 'Top', pool: ['Yorick', 'Maokai', 'Camille', 'Ornn'] }
  ];

  it('splits each pool into what is left and what is gone', () => {
    const jungler = poolPressure(players, blockedSet(['Vi', 'Sejuani'])).find(
      (r) => r.name === 'Go10x'
    );
    expect(jungler?.left).toEqual(['Nidalee']);
    expect(jungler?.gone).toEqual(['Vi', 'Sejuani']);
  });

  it('lists players in draft order rather than by how thin their pool is', () => {
    // Sorting by pressure reordered the list between picks, which moves a row
    // out from under the cursor in the middle of a draft. Go10x has the thinner
    // pool here and still comes second, because Top is drafted before Jungle.
    const rows = poolPressure(players, blockedSet(['Vi']));
    expect(rows.map((r) => r.name)).toEqual(['Rulukuku', 'Go10x']);
  });

  it('still flags a thin pool wherever it sits in the order', () => {
    const rows = poolPressure(players, blockedSet(['Vi', 'Sejuani']));
    expect(rows.find((r) => r.name === 'Go10x')?.critical).toBe(true);
    expect(rows.find((r) => r.name === 'Rulukuku')?.critical).toBe(false);
  });

  it('flags a pool down to two champions', () => {
    const rows = poolPressure([{ name: 'Solo', pool: ['Ahri', 'Zed', 'Sylas'] }], blockedSet(['Sylas']));
    expect(rows[0].left).toHaveLength(2);
    expect(rows[0].critical).toBe(true);
  });

  it('leaves a pool of three alone — that is depth, not a warning', () => {
    const rows = poolPressure([{ name: 'Solo', pool: ['Ahri', 'Zed', 'Sylas'] }], blockedSet());
    expect(rows[0].critical).toBe(false);
  });

  it('flags an empty pool', () => {
    const rows = poolPressure([{ name: 'Solo', pool: ['Ahri'] }], blockedSet(['Ahri']));
    expect(rows[0].left).toEqual([]);
    expect(rows[0].critical).toBe(true);
  });
});
