import { describe, expect, it } from 'vitest';
import { jitter, pick, rng, seedOf, shuffle } from './seed';

const THEMES = ['draft', 'lanes', 'fights', 'objectives', 'vision', 'tempo', 'macro'] as const;

describe('seedOf', () => {
  it('is FNV-1a 32-bit, unsigned, on the reference vectors and on a match id', () => {
    expect(seedOf('')).toBe(2166136261);
    expect(seedOf('a')).toBe(3826002220);
    expect(seedOf('EUW1_7000000001')).toBe(360062704);
    expect(seedOf('film')).toBe(3001705435);
  });
});

describe('rng', () => {
  it('is mulberry32: the reference stream for seed 1, and a pinned stream for a film seed', () => {
    const r = rng(1);
    expect(r()).toBeCloseTo(0.6270739405881613, 15);
    expect(r()).toBeCloseTo(0.002735721180215478, 15);
    expect(r()).toBeCloseTo(0.5274470399599522, 15);
    const f = rng(seedOf('film'));
    expect(f()).toBeCloseTo(0.1986807982902974, 15);
    expect(f()).toBeCloseTo(0.23146958439610898, 15);
  });

  it('stays in [0, 1)', () => {
    const r = rng(seedOf('range'));
    for (let i = 0; i < 2000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('pick and shuffle', () => {
  it('pin their outputs for a seed and a salt', () => {
    expect(pick(7, THEMES, 'title')).toBe('vision');
    expect(pick(7, THEMES, 'other')).toBe('draft');
    expect(shuffle(7, THEMES, 'title')).toEqual(['draft', 'objectives', 'lanes', 'tempo', 'macro', 'fights', 'vision']);
    expect(shuffle(7, THEMES, 'title-order')).toEqual(['fights', 'objectives', 'draft', 'vision', 'tempo', 'lanes', 'macro']);
    expect(shuffle(seedOf('film'), THEMES, 'order')).toEqual(['tempo', 'fights', 'draft', 'macro', 'lanes', 'vision', 'objectives']);
  });

  it('are deterministic across calls and leave the list alone', () => {
    const list = [...THEMES];
    const first = shuffle(3001705435, list, 'x');
    expect(shuffle(3001705435, list, 'x')).toEqual(first);
    expect(list).toEqual([...THEMES]);
    expect(pick(3001705435, list, 'x')).toBe(pick(3001705435, list, 'x'));
    expect(first.slice().sort()).toEqual(list.slice().sort());
  });

  it('give each salt its own draw, so a new salt never changes an old one', () => {
    const before = shuffle(7, THEMES, 'title');
    shuffle(7, THEMES, 'a-new-salt');
    pick(7, THEMES, 'another');
    expect(shuffle(7, THEMES, 'title')).toEqual(before);
    expect(shuffle(7, THEMES, 'title')).not.toEqual(shuffle(7, THEMES, 'title-order'));
  });
});

describe('jitter', () => {
  it('pins its outputs and stays within [-1, 1]', () => {
    expect(jitter(7, 'x')).toBeCloseTo(-0.33881567837670445, 15);
    expect(jitter(7, 'y')).toBeCloseTo(-0.6842085877433419, 15);
    expect(jitter(seedOf('film'), 'x')).toBeCloseTo(-0.07376036187633872, 15);
    for (let i = 0; i < 500; i++) {
      const v = jitter(i, 'salt');
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
