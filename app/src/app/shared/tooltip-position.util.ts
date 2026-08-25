/** Where a tooltip goes, kept separate from the DOM so it can be tested. */

export interface TipBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface TipPlacement {
  top: number;
  left: number;
  /** True when there was no room above and the tooltip flipped under. */
  below: boolean;
  /** Arrow offset from the tooltip's own left edge. */
  arrow: number;
}

/** Distance from the anchor, matching the arrow height. */
const GAP = 8;
/** Keep this much clear of the viewport edges. */
const MARGIN = 8;

/**
 * Above the anchor by default, flipped below when there isn't room, and pulled
 * back inside the viewport so a tooltip on a right-hand control isn't half
 * off-screen. Clamping moves the body but not the anchor, so the arrow is
 * measured separately and can sit anywhere along the edge.
 */
export function placeTooltip(anchor: TipBox, tip: TipBox, viewportWidth: number): TipPlacement {
  const below = anchor.top - GAP - tip.height < MARGIN;
  const top = below ? anchor.top + anchor.height + GAP : anchor.top - GAP - tip.height;

  const centre = anchor.left + anchor.width / 2;
  const ideal = centre - tip.width / 2;
  // Math.max last, so a tooltip wider than the viewport stays pinned left
  // rather than being pushed off the other side by the clamp.
  const left = Math.max(MARGIN, Math.min(ideal, viewportWidth - tip.width - MARGIN));

  return { top, left, below, arrow: centre - left };
}
