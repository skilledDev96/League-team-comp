import { describe, expect, it } from 'vitest';
import { placeTooltip, TipBox } from './tooltip-position.util';

const VIEWPORT = 1000;
const tip: TipBox = { top: 0, left: 0, width: 200, height: 40 };

function anchorAt(left: number, top: number): TipBox {
  return { left, top, width: 100, height: 20 };
}

describe('placeTooltip', () => {
  it('sits above the anchor, centred, when there is room', () => {
    const at = placeTooltip(anchorAt(400, 300), tip, VIEWPORT);
    expect(at.below).toBe(false);
    expect(at.top).toBe(300 - 8 - 40);
    // Anchor centre is 450, so a 200-wide tooltip starts at 350.
    expect(at.left).toBe(350);
  });

  it('flips below when the anchor is near the top of the viewport', () => {
    const at = placeTooltip(anchorAt(400, 10), tip, VIEWPORT);
    expect(at.below).toBe(true);
    expect(at.top).toBe(10 + 20 + 8);
  });

  it('pulls back from the right edge', () => {
    const at = placeTooltip(anchorAt(950, 300), tip, VIEWPORT);
    expect(at.left).toBe(VIEWPORT - 200 - 8);
  });

  it('pulls back from the left edge', () => {
    const at = placeTooltip(anchorAt(0, 300), tip, VIEWPORT);
    expect(at.left).toBe(8);
  });

  it('keeps the arrow on the anchor after clamping', () => {
    const at = placeTooltip(anchorAt(950, 300), tip, VIEWPORT);
    // Anchor centre is 1000; the arrow points there from the clamped left edge.
    expect(at.left + at.arrow).toBe(1000);
  });

  it('centres the arrow when nothing was clamped', () => {
    const at = placeTooltip(anchorAt(400, 300), tip, VIEWPORT);
    expect(at.arrow).toBe(100);
  });

  it('pins a tooltip wider than the viewport to the left margin', () => {
    const wide: TipBox = { top: 0, left: 0, width: 1200, height: 40 };
    const at = placeTooltip(anchorAt(400, 300), wide, VIEWPORT);
    expect(at.left).toBe(8);
  });
});
