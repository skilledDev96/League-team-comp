import { seedOf } from '../../core/seed';

/**
 * Which splash the home page's hero shows, and whether it moves on (13 Sep 2026).
 *
 * The hero holds one champion's splash at a time and crossfades to the next. The list comes from the
 * caller; this file only decides the order, the slide to open on and whether to rotate at all, so the
 * component holds a timer and nothing else. Nothing here reads the clock: the day arrives as a string.
 */

/** How long a splash holds before the next one comes in (13 Sep 2026): long enough to take one in, short enough to notice the change. */
export const ROTATE_MS = 9000;

/** How long one splash takes to fade into the next (13 Sep 2026). Well inside `ROTATE_MS`, so a slide always rests before it leaves. */
export const CROSSFADE_MS = 1400;

export interface Rotation {
  /** The champions to show, blanks and repeats gone, in the order they came. */
  slides: string[];
  /** The slide to open on; 0 when there are none. */
  start: number;
  /** Whether to move on at all. */
  rotate: boolean;
}

/**
 * The rotation for a list of champions (13 Sep 2026).
 *
 * A blank entry is dropped, and a champion named twice is kept once, the first spelling in place, since
 * "Ahri" and "ahri" are one splash. The opening slide is seeded by the day, so the page opens on the same
 * champion all day on every device and on a different one tomorrow, rather than always on the first.
 *
 * It rotates only when there is something to rotate to, motion is on (`still` is the reduced-motion
 * setting) and the browser has not asked to save data, because every slide is another splash to fetch.
 */
export function rotationFor(
  champions: readonly (string | null | undefined)[],
  o: { still: boolean; saveData: boolean; daySeed: string }
): Rotation {
  const slides = distinctChampions(champions);
  const start = slides.length > 0 ? seedOf(o.daySeed) % slides.length : 0;
  const rotate = slides.length > 1 && !o.still && !o.saveData;
  return { slides, start, rotate };
}

/** The slide after `current`, back to the first after the last; 0 when there are no slides. */
export function nextIndex(current: number, length: number): number {
  if (!(length > 0) || !Number.isFinite(current)) return 0;
  return (((Math.trunc(current) + 1) % length) + length) % length;
}

/**
 * The slides left once the champions whose art failed are taken out (13 Sep 2026).
 *
 * `failed` holds the champions whose splash failed from both sources the page tries, so there is nothing
 * left to show for them; a champion that failed once and loaded from the second source is not in it.
 * Matched without regard to case, the same way `rotationFor` removes a repeat.
 */
export function dropFailed(slides: readonly string[], failed: ReadonlySet<string>): string[] {
  if (failed.size === 0) return slides.slice();
  const gone = new Set<string>();
  for (const name of failed) gone.add(keyOf(name));
  return slides.filter((name) => !gone.has(keyOf(name)));
}

/** Blank entries out, the first of each champion kept, compared without regard to case. */
function distinctChampions(champions: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of champions) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) continue;
    const key = keyOf(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function keyOf(name: string): string {
  return name.trim().toLowerCase();
}
