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

export interface CardPlacement {
  top: number;
  left: number;
  side: 'bottom' | 'top' | 'right' | 'left' | 'center';
}

/** A tour card beside its anchor: below, else above, else beside, else centred. */
export function placeCard(
  anchor: TipBox,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  prefer: 'auto' | 'top' | 'bottom' | 'left' | 'right' = 'auto'
): CardPlacement {
  const gap = 12;
  const clampX = (x: number) => Math.max(MARGIN, Math.min(x, viewport.width - card.width - MARGIN));
  const clampY = (y: number) => Math.max(MARGIN, Math.min(y, viewport.height - card.height - MARGIN));
  const centreX = anchor.left + anchor.width / 2 - card.width / 2;
  const centreY = anchor.top + anchor.height / 2 - card.height / 2;
  const fits = {
    bottom: anchor.top + anchor.height + gap + card.height <= viewport.height - MARGIN,
    top: anchor.top - gap - card.height >= MARGIN,
    right: anchor.left + anchor.width + gap + card.width <= viewport.width - MARGIN,
    left: anchor.left - gap - card.width >= MARGIN
  };
  const order: ('bottom' | 'top' | 'right' | 'left')[] = prefer === 'auto' ? ['bottom', 'top', 'right', 'left'] : [prefer, 'bottom', 'top', 'right', 'left'];
  for (const side of order) {
    if (!fits[side]) continue;
    switch (side) {
      case 'bottom':
        return { top: anchor.top + anchor.height + gap, left: clampX(centreX), side };
      case 'top':
        return { top: anchor.top - gap - card.height, left: clampX(centreX), side };
      case 'right':
        return { top: clampY(centreY), left: anchor.left + anchor.width + gap, side };
      case 'left':
        return { top: clampY(centreY), left: anchor.left - gap - card.width, side };
    }
  }
  return { top: clampY((viewport.height - card.height) / 2), left: clampX((viewport.width - card.width) / 2), side: 'center' };
}
