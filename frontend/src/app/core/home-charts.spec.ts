import { describe, expect, it } from 'vitest';
import { donutSegments, ringDash, trendPath } from './home-charts';

describe('ringDash', () => {
  it('fills the ring to the percent and leaves the rest as the gap', () => {
    expect(ringDash(64)).toBe('64 36');
    expect(ringDash(0)).toBe('0 100');
    expect(ringDash(100)).toBe('100 0');
  });

  it('rounds to one decimal place and clamps what falls outside the ring', () => {
    expect(ringDash(33.333)).toBe('33.3 66.7');
    expect(ringDash(-12)).toBe('0 100');
    expect(ringDash(140)).toBe('100 0');
  });
});

describe('donutSegments', () => {
  it('gives each part its share, one after another round the ring', () => {
    expect(donutSegments([{ key: 'win', value: 3 }, { key: 'loss', value: 1 }])).toEqual([
      { key: 'win', dash: '75 25', offset: 0 },
      { key: 'loss', dash: '25 75', offset: -75 }
    ]);
  });

  it('meets exactly between rounded pieces and closes the ring at 100', () => {
    const out = donutSegments([{ key: 'a', value: 1 }, { key: 'b', value: 1 }, { key: 'c', value: 1 }]);
    expect(out).toEqual([
      { key: 'a', dash: '33.3 66.7', offset: 0 },
      { key: 'b', dash: '33.4 66.6', offset: -33.3 },
      { key: 'c', dash: '33.3 66.7', offset: -66.7 }
    ]);
  });

  it('leaves out a part with nothing in it, and draws nothing when every part is empty', () => {
    expect(donutSegments([{ key: 'a', value: 0 }, { key: 'b', value: 2 }, { key: 'c', value: -1 }, { key: 'd', value: 2 }])).toEqual([
      { key: 'b', dash: '50 50', offset: 0 },
      { key: 'd', dash: '50 50', offset: -50 }
    ]);
    expect(donutSegments([{ key: 'a', value: 0 }])).toEqual([]);
    expect(donutSegments([])).toEqual([]);
  });
});

describe('trendPath', () => {
  it('spreads the points evenly inside the pad, 100% at the top and 0% at the bottom', () => {
    const out = trendPath([{ rate: 100 }, { rate: 50 }, { rate: 0 }], 100, 50);
    expect(out.dots).toEqual([
      { x: 4, y: 4 },
      { x: 50, y: 25 },
      { x: 96, y: 46 }
    ]);
    expect(out.d).toBe('M 4 4 L 50 25 L 96 46');
    expect(out.midY).toBe(25);
  });

  it('rounds every number to one decimal place', () => {
    const out = trendPath([{ rate: 60 }, { rate: 60 }, { rate: 60 }, { rate: 60 }], 100, 50);
    expect(out.dots.map((p) => p.x)).toEqual([4, 34.7, 65.3, 96]);
    expect(out.d).toBe('M 4 20.8 L 34.7 20.8 L 65.3 20.8 L 96 20.8');
  });

  it('puts a single point in the middle, and honours a pad that is given', () => {
    expect(trendPath([{ rate: 75 }], 120, 40)).toEqual({ d: 'M 60 12', dots: [{ x: 60, y: 12 }], midY: 20 });
    const padded = trendPath([{ rate: 100 }, { rate: 0 }], 100, 60, 10);
    expect(padded.d).toBe('M 10 10 L 90 50');
    expect(padded.midY).toBe(30);
  });

  it('draws no path and no dots for no points, but still says where 50% sits', () => {
    expect(trendPath([], 100, 50)).toEqual({ d: '', dots: [], midY: 25 });
  });
});
