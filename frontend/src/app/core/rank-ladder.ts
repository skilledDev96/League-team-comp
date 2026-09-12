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
