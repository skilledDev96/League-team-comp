import { describe, expect, it } from 'vitest';
import { seedOf } from '../../core/seed';
import { CROSSFADE_MS, dropFailed, nextIndex, ROTATE_MS, rotationFor } from './splash-rotation';

const moving = { still: false, saveData: false, daySeed: '2026-09-14' };
const FIVE = ['Ahri', 'Jinx', 'Leona', 'Vi', 'Akali'];

describe('rotationFor', () => {
  it('drops blanks and repeats without regard to case, keeping the first spelling in order', () => {
    const r = rotationFor(['Ahri', null, '', '   ', undefined, 'ahri', ' Jinx ', 'AHRI', 'Leona', 'jinx'], moving);
    expect(r.slides).toEqual(['Ahri', 'Jinx', 'Leona']);
  });

  it('opens on no slide for an empty list, and never rotates it', () => {
    expect(rotationFor([], moving)).toEqual({ slides: [], start: 0, rotate: false });
    expect(rotationFor([null, undefined, ''], moving)).toEqual({ slides: [], start: 0, rotate: false });
  });

  it('seeds the opening slide by the day: the same all day, different the next', () => {
    // FNV-1a of "2026-09-14" is 2429564653 (3 of 5) and of "2026-09-15" is 2412787034 (4 of 5).
    const monday = rotationFor(FIVE, { ...moving, daySeed: '2026-09-14' });
    const again = rotationFor(FIVE, { ...moving, daySeed: '2026-09-14' });
    const tuesday = rotationFor(FIVE, { ...moving, daySeed: '2026-09-15' });
    expect(monday.start).toBe(3);
    expect(monday.start).toBe(seedOf('2026-09-14') % 5);
    expect(again.start).toBe(monday.start);
    expect(tuesday.start).toBe(4);
    expect(tuesday.start).not.toBe(monday.start);
  });

  it('seeds against the list after repeats are gone, not the list it was given', () => {
    // Seven entries, five champions: 2429564653 is 5 of 7 but 3 of 5.
    const r = rotationFor(['Ahri', 'Jinx', 'ahri', 'Leona', 'Vi', 'JINX', 'Akali'], moving);
    expect(r.slides).toEqual(FIVE);
    expect(r.start).toBe(3);
  });

  it('rotates five slides with motion on and no Save-Data', () => {
    expect(rotationFor(FIVE, moving).rotate).toBe(true);
  });

  it('never rotates when still, on Save-Data, or with a single slide', () => {
    expect(rotationFor(FIVE, { ...moving, still: true }).rotate).toBe(false);
    expect(rotationFor(FIVE, { ...moving, saveData: true }).rotate).toBe(false);
    expect(rotationFor(FIVE, { ...moving, still: true, saveData: true }).rotate).toBe(false);
    const one = rotationFor(['Ahri', 'ahri', null], moving);
    expect(one).toEqual({ slides: ['Ahri'], start: 0, rotate: false });
  });

  it('crossfades well inside the hold', () => {
    expect(CROSSFADE_MS).toBeLessThan(ROTATE_MS);
  });
});

describe('nextIndex', () => {
  it('steps on and wraps from the last slide to the first', () => {
    expect(nextIndex(0, 5)).toBe(1);
    expect(nextIndex(3, 5)).toBe(4);
    expect(nextIndex(4, 5)).toBe(0);
    expect(nextIndex(0, 1)).toBe(0);
  });

  it('comes back to where it started after a full turn', () => {
    const start = rotationFor(FIVE, moving).start;
    let at = start;
    const seen: number[] = [];
    for (let i = 0; i < FIVE.length; i++) {
      at = nextIndex(at, FIVE.length);
      seen.push(at);
    }
    expect(seen).toEqual([4, 0, 1, 2, 3]);
    expect(at).toBe(start);
  });

  it('is 0 with no slides, and lands inside a list that shrank under it', () => {
    expect(nextIndex(0, 0)).toBe(0);
    expect(nextIndex(4, 0)).toBe(0);
    expect(nextIndex(7, 3)).toBe(2);
    expect(nextIndex(-1, 3)).toBe(0);
    expect(nextIndex(Number.NaN, 3)).toBe(0);
  });
});

describe('dropFailed', () => {
  it('removes a champion whose art failed, without regard to case', () => {
    expect(dropFailed(FIVE, new Set(['jinx', 'AKALI']))).toEqual(['Ahri', 'Leona', 'Vi']);
  });

  it('leaves the list alone when nothing failed or the failure is not on it', () => {
    const slides = ['Ahri', 'Jinx'];
    const kept = dropFailed(slides, new Set<string>());
    expect(kept).toEqual(['Ahri', 'Jinx']);
    expect(kept).not.toBe(slides);
    expect(dropFailed(slides, new Set(['Leona']))).toEqual(['Ahri', 'Jinx']);
    expect(slides).toEqual(['Ahri', 'Jinx']);
  });

  it('can leave nothing when every splash failed', () => {
    expect(dropFailed(['Ahri', 'Jinx'], new Set(['ahri', 'jinx']))).toEqual([]);
  });
});
