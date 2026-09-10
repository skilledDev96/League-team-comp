import type { FilmHeatCell } from '../shared/film/rift-map.component';
import { FilmDeathPin, FilmWard } from './film-model';

/**
 * The vision heat map (Part C, 10 Sep 2026; the lead: "based on our wards
 * placed, where do we have vision, safe zones and danger zones, almost like
 * a heat map"): where our wards stood against where we died, over the whole
 * game, as cells the Rift draws as a wash under everything (`.rift-heat`).
 * A ward's cell is its sight, weighted by how long it stood; a death's cell
 * is a fixed patch at full weight. Overlapping cells stack on the map, so a
 * bush warded ten times reads heavy and a corner never warded reads bare
 * next to the deaths in it, which is the question the layer answers: were
 * we warding the wrong side. A ward stands where the placer stood at the
 * nearest frame, so the corner note says approximate while the layer shows.
 *
 * The cell type is the map's own contract (`FilmHeatCell` on
 * `app-rift-map`); the import is type-only, so this file stays pure.
 */

/**
 * A ward that stood this long reads at full weight; shorter lives read
 * lighter, so a trinket (90 s, weight 0.3) is a light wash and a control
 * ward that held a bush for five minutes or more is a heavy one. Five
 * minutes because the plan read the heat per five minutes, and because a
 * control ward that lived longer had done its job whatever came after.
 */
export const HEAT_FULL_LIFE_SEC = 300;
/** A death's cell radius in percent of the map: about a screen's worth, so a cluster of deaths reads as one warm patch rather than pinpricks. */
export const HEAT_DEATH_R = 6;

const hundredth = (v: number): number => Math.round(v * 100) / 100;

/**
 * The cells: one per ward at its spot with its sight and its lifetime share
 * (`untilSec - sec` over HEAT_FULL_LIFE_SEC, capped at one; a ward killed
 * the second it went down weighs nothing and still reads as the lightest
 * wash), then one per death of ours at full weight. Wards first, so the
 * deaths draw on top of the sight in the SVG's order.
 */
export function buildHeat(wards: readonly FilmWard[] | undefined, pins: readonly FilmDeathPin[] | undefined): FilmHeatCell[] {
  const cells: FilmHeatCell[] = [];
  for (const w of wards ?? []) {
    if (!Number.isFinite(w.x) || !Number.isFinite(w.y)) continue;
    const life = Math.max(0, (Number.isFinite(w.untilSec) ? w.untilSec : w.sec) - w.sec);
    cells.push({ x: w.x, y: w.y, r: w.r, kind: 'ward', weight: hundredth(Math.min(1, life / HEAT_FULL_LIFE_SEC)) });
  }
  for (const p of pins ?? []) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    cells.push({ x: p.x, y: p.y, r: HEAT_DEATH_R, kind: 'death', weight: 1 });
  }
  return cells;
}
