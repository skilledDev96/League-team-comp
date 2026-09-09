/**
 * Deterministic chance for the film room (9 Sep 2026). A film is seeded by
 * its match id so it reads the same on every visit and on every device, and
 * every draw takes its own salt: the state of a draw is derived from the
 * seed and the salt together, so adding a new draw later never changes what
 * an old one gave. Nothing here reads the clock.
 */

/** FNV-1a, 32-bit, unsigned. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small generator in [0, 1) from a 32-bit seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generator for one named draw. The seed and the salt make the state together, so no draw depends on another. */
function draw(seed: number, salt: string): () => number {
  return rng(seedOf(String(seed) + ':' + salt));
}

/** One item of the list. The list must not be empty. */
export function pick<T>(seed: number, list: readonly T[], salt: string): T {
  const r = draw(seed, salt);
  return list[Math.floor(r() * list.length)];
}

/** A copy of the list in a seeded order (Fisher-Yates). */
export function shuffle<T>(seed: number, list: readonly T[], salt: string): T[] {
  const r = draw(seed, salt);
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A number in [-1, 1], for placing something a little off its spot. */
export function jitter(seed: number, salt: string): number {
  return draw(seed, salt)() * 2 - 1;
}
