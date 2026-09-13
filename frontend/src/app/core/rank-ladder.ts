import { RankPoint, RankQueue } from '../models/team.models';

/**
 * The rank climb on the home page, read off the ranks the morning refresh writes down (13 Sep 2026).
 *
 * Riot's ranks are a tier, a division and league points, which do not subtract. This puts them on one
 * scale — a hundred a division, four divisions a tier, and the apex tiers sharing one ladder of points
 * above Diamond I — so a climb from Gold II 80 LP to Gold I 20 LP reads as forty points up, and a line can
 * be drawn through a month of mornings. Pure: histories and a day come in, series come out.
 */

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'] as const;
const DIVISIONS = ['IV', 'III', 'II', 'I'];
const APEX = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);
/** Where Master's zero sits: the top of Diamond I. */
export const APEX_BASE = TIERS.length * 400;

/** How far back the climb draws, in days. */
export const CLIMB_DAYS = 60;
/** A line needs two mornings to be a line. */
export const CLIMB_MIN_POINTS = 2;

/** Today in Amsterdam, where the morning refresh names its days, as YYYY-MM-DD. */
export function amsterdamToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** A YYYY-MM-DD day as a count of days, so two days subtract. */
export function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** One rank as a number on the shared ladder; null for a tier this app does not know. */
export function ladderValue(p: Pick<RankPoint, 'tier' | 'division' | 'lp'>): number | null {
  const tier = p.tier.trim().toUpperCase();
  if (APEX.has(tier)) return APEX_BASE + Math.max(0, p.lp);
  const t = TIERS.indexOf(tier as (typeof TIERS)[number]);
  if (t < 0) return null;
  const d = Math.max(0, DIVISIONS.indexOf(p.division.trim().toUpperCase()));
  return t * 400 + d * 100 + Math.min(100, Math.max(0, p.lp));
}

/** "Gold II", or "Master" for the apex tiers, which have no division. */
export function rankWords(p: Pick<RankPoint, 'tier' | 'division'>): string {
  const tier = p.tier.trim().toUpperCase();
  const title = tier.charAt(0) + tier.slice(1).toLowerCase();
  return APEX.has(tier) || !p.division ? title : `${title} ${p.division}`;
}

/** The tier a ladder value falls in, for the chart's gridlines. */
export function tierAt(value: number): string {
  if (value >= APEX_BASE) return 'Master+';
  const t = TIERS[Math.max(0, Math.min(TIERS.length - 1, Math.floor(value / 400)))];
  return t.charAt(0) + t.slice(1).toLowerCase();
}

export interface ClimbLine {
  playerId: string;
  name: string;
  queue: RankQueue;
  /** Oldest first, inside the window. */
  points: { day: string; value: number; words: string; lp: number }[];
  /** Last value less first value. */
  delta: number;
}

const DAY_MS = 86_400_000;

/** The day `days` before `today`, both YYYY-MM-DD. */
function daysBefore(today: string, days: number): string {
  const [y, m, d] = today.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d) - days * DAY_MS);
  return at.toISOString().slice(0, 10);
}

/**
 * A line per player over the last `days` days: solo queue when the player has at least two mornings of
 * it, else flex, else nothing to draw. Players come back in the order given.
 */
export function climbLines(
  histories: readonly { playerId: string; name: string; points: readonly RankPoint[] }[],
  today: string,
  days = CLIMB_DAYS
): ClimbLine[] {
  const since = daysBefore(today, days);
  const out: ClimbLine[] = [];
  for (const h of histories) {
    const inWindow = h.points.filter((p) => p.day >= since && p.day <= today);
    for (const queue of ['solo', 'flex'] as const) {
      const points = inWindow
        .filter((p) => p.queue === queue)
        .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
        .flatMap((p) => {
          const value = ladderValue(p);
          return value === null ? [] : [{ day: p.day, value, words: rankWords(p), lp: p.lp }];
        });
      if (points.length >= CLIMB_MIN_POINTS) {
        out.push({ playerId: h.playerId, name: h.name, queue, points, delta: points[points.length - 1].value - points[0].value });
        break;
      }
    }
  }
  return out;
}

/** The tier boundaries inside a range of values, for gridlines: every 400, labelled by the tier above. */
export function tierLines(min: number, max: number): { value: number; label: string }[] {
  const lines: { value: number; label: string }[] = [];
  for (let v = Math.ceil(min / 400) * 400; v <= Math.min(max, APEX_BASE); v += 400) lines.push({ value: v, label: tierAt(v) });
  return lines;
}

/**
 * One player's climb in a small box (13 Sep 2026, the Roster sheet): the path across the days it covers,
 * the tier lines inside its range, and where it starts and ends. A flat line gets room around it, so it
 * sits mid-box as Home's chart has it; fewer than two points draw no path.
 */
export function sparkGeometry(
  points: readonly { day: string; value: number }[],
  w: number,
  h: number,
  pad = 6
): { d: string; grid: { value: number; label: string; y: number }[]; first: { x: number; y: number } | null; last: { x: number; y: number } | null } {
  if (points.length < 2) return { d: '', grid: [], first: null, last: null };
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const spread = Math.max(100, hi - lo);
  const mid = (lo + hi) / 2;
  const min = mid - spread * 0.6;
  const max = mid + spread * 0.6;
  const days = points.map((p) => dayNumber(p.day));
  const firstDay = Math.min(...days);
  const lastDay = Math.max(...days);
  const round = (n: number) => Math.round(n * 10) / 10;
  const x = (day: string) => round(lastDay > firstDay ? pad + ((dayNumber(day) - firstDay) / (lastDay - firstDay)) * (w - 2 * pad) : w / 2);
  const y = (value: number) => round(pad + (1 - (value - min) / (max - min)) * (h - 2 * pad));
  const at = points.map((p) => ({ x: x(p.day), y: y(p.value) }));
  return {
    d: at.map((p, k) => `${k ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '),
    grid: tierLines(min, max).map((t) => ({ ...t, y: y(t.value) })),
    first: at[0],
    last: at[at.length - 1]
  };
}
