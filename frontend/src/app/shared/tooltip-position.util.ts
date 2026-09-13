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

/**
 * A tour card beside its anchor: below, else above, else beside, else in the corner farthest from it.
 *
 * `rem` is the root size in px, so the gap and the edge margin grow with the interface (13 Sep 2026: the
 * root follows the window, and a 12px gap beside a card of 27px text read as touching). When nothing fits,
 * the card used to sit in the middle of the screen, which on a tall anchor is on top of the thing the step
 * describes; the corner diagonally away from the anchor's centre keeps it clear wherever it can be.
 */
export function placeCard(
  anchor: TipBox,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  prefer: 'auto' | 'top' | 'bottom' | 'left' | 'right' = 'auto',
  rem = 16
): CardPlacement {
  const gap = 0.75 * rem;
  const margin = 0.5 * rem;
  const clampX = (x: number) => Math.max(margin, Math.min(x, viewport.width - card.width - margin));
  const clampY = (y: number) => Math.max(margin, Math.min(y, viewport.height - card.height - margin));
  const centreX = anchor.left + anchor.width / 2 - card.width / 2;
  const centreY = anchor.top + anchor.height / 2 - card.height / 2;
  const fits = {
    bottom: anchor.top + anchor.height + gap + card.height <= viewport.height - margin,
    top: anchor.top - gap - card.height >= margin,
    right: anchor.left + anchor.width + gap + card.width <= viewport.width - margin,
    left: anchor.left - gap - card.width >= margin
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
  const awayRight = anchor.left + anchor.width / 2 < viewport.width / 2;
  const awayDown = anchor.top + anchor.height / 2 < viewport.height / 2;
  return { top: clampY(awayDown ? viewport.height : 0), left: clampX(awayRight ? viewport.width : 0), side: 'center' };
}
