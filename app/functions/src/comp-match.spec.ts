import { describe, expect, it } from 'vitest';
import { CompChampSet, matchComp, normalizeChampKey } from './comp-match';

const COMPS: CompChampSet[] = [
  { id: 'dive', name: 'Dive', champions: ['Vladimir', 'Diana', 'Yasuo', 'Tristana', 'Nautilus'] },
  { id: 'engage', name: 'Engage', champions: ['Maokai', 'Vi', 'Galio', 'Miss Fortune', 'Leona'] }
];

describe('normalizeChampKey', () => {
  it('reduces to lowercase alphanumerics', () => {
    expect(normalizeChampKey('Miss Fortune')).toBe('missfortune');
    expect(normalizeChampKey("Kai'Sa")).toBe('kaisa');
    expect(normalizeChampKey('')).toBe('');
  });
});

describe('matchComp', () => {
  it('matches a comp when overlap meets the threshold', () => {
    const played = ['Vladimir', 'Diana', 'Yasuo', 'Ashe', 'Thresh']; // 3/5 of Dive
    const result = matchComp(played, COMPS, 3);
    expect(result.compId).toBe('dive');
    expect(result.compName).toBe('Dive');
    expect(result.overlap).toBe(3);
    expect(result.nearName).toBe('Dive');
  });

  it('does not match below the threshold but still reports the near comp', () => {
    const played = ['Vladimir', 'Diana', 'Ashe', 'Thresh', 'Sett']; // 2/5 of Dive
    const result = matchComp(played, COMPS, 3);
    expect(result.compId).toBeNull();
    expect(result.compName).toBeNull();
    expect(result.overlap).toBe(2);
    expect(result.nearName).toBe('Dive');
  });

  it('picks the comp with the most overlap', () => {
    const played = ['Maokai', 'Vi', 'Galio', 'Leona', 'Ashe']; // 4/5 Engage, 0 Dive
    const result = matchComp(played, COMPS, 3);
    expect(result.compId).toBe('engage');
    expect(result.overlap).toBe(4);
  });

  it('reports no near comp when nothing overlaps', () => {
    const played = ['Ashe', 'Thresh', 'Sett', 'Lux', 'Ezreal'];
    const result = matchComp(played, COMPS, 3);
    expect(result.compId).toBeNull();
    expect(result.nearName).toBeNull();
    expect(result.overlap).toBe(0);
  });

  it('normalises names so punctuation/spacing does not matter', () => {
    const comps: CompChampSet[] = [
      { id: 'mf', name: 'MF', champions: ['Miss Fortune', "Kai'Sa", 'Ahri'] }
    ];
    const result = matchComp(['missfortune', 'kaisa', 'AHRI'], comps, 3);
    expect(result.overlap).toBe(3);
    expect(result.compId).toBe('mf');
  });
});

describe('matchComp tie-breaking', () => {
  // Two comps that overlap the played set equally. 'aaa' sorts before 'zzz'.
  const TIED: CompChampSet[] = [
    { id: 'zzz', name: 'Zed Comp', champions: ['Vladimir', 'Diana', 'Ashe', 'Thresh', 'Zed'] },
    { id: 'aaa', name: 'Ahri Comp', champions: ['Vladimir', 'Diana', 'Ashe', 'Braum', 'Ahri'] }
  ];
  const played = ['Vladimir', 'Diana', 'Ashe', 'Lulu', 'Sett']; // 3 of each

  it('breaks ties by comp id, not array order', () => {
    const result = matchComp(played, TIED, 3);
    expect(result.compId).toBe('aaa');
  });

  it('gives the same winner when the comps are reordered', () => {
    const reordered = matchComp(played, [...TIED].reverse(), 3);
    expect(reordered.compId).toBe('aaa');
  });

  it('reports every tied comp so the ambiguity can be surfaced', () => {
    const result = matchComp(played, TIED, 3);
    expect(result.tiedNames).toEqual(['Ahri Comp', 'Zed Comp']);
  });

  it('reports no tie when one comp overlaps more', () => {
    const clear = matchComp(['Maokai', 'Vi', 'Galio', 'Miss Fortune', 'Leona'], COMPS, 3);
    expect(clear.compId).toBe('engage');
    expect(clear.tiedNames).toEqual([]);
  });

  it('still reports the closest comp below threshold, with no match', () => {
    const result = matchComp(['Vladimir', 'Diana', 'Ashe', 'Lulu', 'Sett'], TIED, 5);
    expect(result.compId).toBeNull();
    expect(result.nearName).toBe('Ahri Comp');
    expect(result.overlap).toBe(3);
  });
});
