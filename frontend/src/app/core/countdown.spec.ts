import { describe, expect, it } from 'vitest';
import { countdownOf, LIVE_WINDOW_MS } from './countdown';

const now = Date.UTC(2026, 8, 13, 12, 0, 0);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('countdownOf', () => {
  it('is nothing without a start time', () => {
    expect(countdownOf(null, now)).toBeNull();
  });

  it('counts the whole days, hours, minutes and seconds until the start', () => {
    const at = now + 2 * DAY + 3 * HOUR + 4 * MINUTE + 5 * SECOND + 999;
    expect(countdownOf(at, now)).toEqual({ days: 2, hours: 3, minutes: 4, seconds: 5, live: false });
    expect(countdownOf(now + SECOND, now)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 1, live: false });
    expect(countdownOf(now + 23 * HOUR + 59 * MINUTE + 59 * SECOND, now)).toEqual({ days: 0, hours: 23, minutes: 59, seconds: 59, live: false });
  });

  it('is live with every unit at zero from the start until the window closes', () => {
    const zero = { days: 0, hours: 0, minutes: 0, seconds: 0, live: true };
    expect(countdownOf(now, now)).toEqual(zero);
    expect(countdownOf(now - 2 * HOUR, now)).toEqual(zero);
    expect(countdownOf(now - LIVE_WINDOW_MS + 1, now)).toEqual(zero);
  });

  it('is nothing once the live window has passed', () => {
    expect(LIVE_WINDOW_MS).toBe(4 * HOUR);
    expect(countdownOf(now - LIVE_WINDOW_MS, now)).toBeNull();
    expect(countdownOf(now - 3 * DAY, now)).toBeNull();
  });
});
