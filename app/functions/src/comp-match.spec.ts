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
