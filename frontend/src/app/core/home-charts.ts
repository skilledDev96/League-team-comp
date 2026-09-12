/**
 * The geometry behind the home page's three small charts: a ring, a donut and a trend line (13 Sep 2026).
 *
 * Every circle is drawn with `pathLength="100"`, so a dash is a percentage of the way round and the
 * template never needs to know a radius. The numbers are rounded to one decimal place because a tenth of
 * a percent is below what a screen can draw, and long floats in the markup only make it harder to read.
 *
 * Pure: the component hands in figures and binds the strings it gets back.
 */

/** One decimal place, and never a negative zero. */
function tenth(n: number): number {
  const r = Math.round(n * 10) / 10;
  return r === 0 ? 0 : r;
}

/** The stroke-dasharray for a ring filled to `percent`: the filled length, then the gap. Out-of-range values are clamped. */
export function ringDash(percent: number): string {
  const p = tenth(Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0)));
  return `${p} ${tenth(100 - p)}`;
}

export interface DonutSegment {
  key: string;
  /** The stroke-dasharray: this part's share of the ring, then the rest. */
  dash: string;
  /** The stroke-dashoffset: minus where the part starts, so each segment begins where the one before ended. */
  offset: number;
}

/**
 * A donut from parts, one segment each in the order given. A part with nothing in it draws nothing, and
 * with nothing at all there are no segments. Each segment runs between its rounded start and rounded end,
 * so the pieces meet exactly and the last one closes the ring at 100.
 */
export function donutSegments(parts: readonly { key: string; value: number }[]): DonutSegment[] {
  const kept = parts.filter((p) => Number.isFinite(p.value) && p.value > 0);
  const total = kept.reduce((n, p) => n + p.value, 0);
  if (total <= 0) return [];
  const out: DonutSegment[] = [];
  let running = 0;
  for (const p of kept) {
    const start = tenth((running / total) * 100);
    running += p.value;
    const end = tenth((running / total) * 100);
    const share = tenth(end - start);
    out.push({ key: p.key, dash: `${share} ${tenth(100 - share)}`, offset: start === 0 ? 0 : -start });
  }
  return out;
}

/**
 * A win-rate trend as an SVG path in a `width` by `height` box: the points spread evenly across it inside
 * `pad`, a single point in the middle, 100% at the top and 0% at the bottom (a rate outside that is held
 * to the edge), and `midY` where 50% sits so the template can draw the even line. No points is no path.
 */
export function trendPath(
  points: readonly { rate: number }[],
  width: number,
  height: number,
  pad = 4
): { d: string; dots: { x: number; y: number }[]; midY: number } {
  const inner = height - 2 * pad;
  const yOf = (rate: number) => tenth(pad + (1 - Math.min(100, Math.max(0, rate)) / 100) * inner);
  const midY = yOf(50);
  if (!points.length) return { d: '', dots: [], midY };
  const step = points.length > 1 ? (width - 2 * pad) / (points.length - 1) : 0;
  const dots = points.map((p, i) => ({ x: tenth(points.length > 1 ? pad + i * step : width / 2), y: yOf(p.rate) }));
  const d = dots.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  return { d, dots, midY };
}
