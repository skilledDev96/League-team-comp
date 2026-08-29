import { Role } from '../models/team.models';
import { CHAMPION_LANES } from '../data/champion-lanes';

/**
 * Where a champion is actually played.
 *
 * The map is generated from pro match data because Riot's champion tags are
 * classes, not lanes — see `scripts/gen-champion-lanes.mjs`. It keeps every
 * lane a champion genuinely flexes into rather than picking one winner, so
 * Yasuo answers Mid, Top *and* ADC and a draft can offer the choice.
 */

/** Match the way champion names are compared everywhere else. */
function key(name: string): string {
  return (name ?? '').trim().toLowerCase();
}

const BY_KEY: ReadonlyMap<string, readonly Role[]> = new Map(
  Object.entries(CHAMPION_LANES).map(([name, roles]) => [key(name), roles])
);

/**
 * Lanes for a champion, most played first.
 *
 * Empty for a champion nobody has played in a pro game — Evelynn was the only
 * one in the 2026 season, and a champion released mid-season would be another.
 * Empty means "unknown", never "plays nowhere", so callers must not read it as
 * a reason to hide a champion.
 */
export function lanesOf(champion: string): readonly Role[] {
  return BY_KEY.get(key(champion)) ?? [];
}

/**
 * Whether a champion is played in a lane.
 *
 * A champion with no data answers **true** for every lane. Filtering one out of
 * every list would make it unpickable, which is a far worse failure than
 * showing it in a lane it does not belong to.
 */
export function playsRole(champion: string, role: Role): boolean {
  const lanes = lanesOf(champion);
  return lanes.length === 0 || lanes.includes(role);
}

/** The lane a champion is most often played in, for a first guess at a seat. */
export function primaryLane(champion: string): Role | null {
  return lanesOf(champion)[0] ?? null;
}
