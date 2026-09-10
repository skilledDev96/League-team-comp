import { describe, expect, it } from 'vitest';
import { FilmDeathPin, FilmWard } from './film-model';
import { buildHeat, HEAT_DEATH_R, HEAT_FULL_LIFE_SEC } from './film-heat';

const scene = { could: [], killers: 2, executed: false, traded: 0, warded: false } as FilmDeathPin['scene'];

const pins: FilmDeathPin[] = [
  { key: 'd:4:ADC', sec: 252, minute: 4, seat: 'ADC', zone: 'bot', x: 85, y: 84, how: 'gank', could: ['ward'], line: '', read: 'avoidable', readLine: '', glyphs: [], scene },
  { key: 'd:20:Support', sec: 1210, minute: 20, seat: 'Support', zone: 'river', x: 50, y: 50, how: 'fight', could: [], line: '', read: 'traded', readLine: '', glyphs: [], scene }
];

const wards: FilmWard[] = [
  // A trinket that lived its 90 s.
  { sec: 300, untilSec: 390, seat: 'Jungle', type: 'trinket', x: 40, y: 60, r: 7.04 },
  // A control ward that held a bush for ten minutes.
  { sec: 320, untilSec: 920, seat: 'Support', type: 'control', x: 70, y: 72, r: 7.04 },
  // A trinket killed the second it went down.
  { sec: 600, untilSec: 600, seat: 'Top', type: 'trinket', x: 20, y: 30, r: 7.04 }
];

describe('buildHeat', () => {
  it('draws a cell per ward at its spot with its sight, weighted by its lifetime share of five minutes and capped at one', () => {
    expect(HEAT_FULL_LIFE_SEC).toBe(300);
    const cells = buildHeat(wards, []);
    expect(cells).toEqual([
      { x: 40, y: 60, r: 7.04, kind: 'ward', weight: 0.3 },
      { x: 70, y: 72, r: 7.04, kind: 'ward', weight: 1 },
      { x: 20, y: 30, r: 7.04, kind: 'ward', weight: 0 }
    ]);
  });

  it('draws a cell per death of ours at full weight, a fixed patch wide, after the wards', () => {
    expect(HEAT_DEATH_R).toBe(6);
    const cells = buildHeat(wards, pins);
    expect(cells).toHaveLength(5);
    expect(cells.slice(3)).toEqual([
      { x: 85, y: 84, r: 6, kind: 'death', weight: 1 },
      { x: 50, y: 50, r: 6, kind: 'death', weight: 1 }
    ]);
    expect(cells.slice(0, 3).every((c) => c.kind === 'ward')).toBe(true);
  });

  it('is empty with nothing to draw, and skips a cell with no place', () => {
    expect(buildHeat(undefined, undefined)).toEqual([]);
    expect(buildHeat([], [])).toEqual([]);
    expect(buildHeat([{ ...wards[0], x: Number.NaN }], [{ ...pins[0], y: Number.NaN }])).toEqual([]);
  });
});
