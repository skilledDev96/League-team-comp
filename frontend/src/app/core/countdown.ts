/**
 * How long until the next series, as the home page's countdown reads it (13 Sep 2026).
 *
 * A series is scheduled to a moment and then takes a few hours to play, so the countdown has three
 * states rather than two: counting down, live for a window after the start, and over. Once it is over
 * the countdown says nothing at all, because a clock stuck at zero reads as a match that never began.
 *
 * Pure: "now" comes in, so the page ticks it and the specs pin it.
 */

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** The start has passed and the series is still inside its window. Every unit is zero. */
  live: boolean;
}

/** How long a series counts as live after its start: four hours covers a Bo5 with its breaks. */
export const LIVE_WINDOW_MS = 4 * 60 * 60 * 1000;

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * The whole days, hours, minutes and seconds until `at`; live with every unit at zero from the start
 * until `LIVE_WINDOW_MS` after it; null when there is no start time, or once the window has closed.
 */
export function countdownOf(at: number | null, now: number): Countdown | null {
  if (at === null || !Number.isFinite(at)) return null;
  if (at > now) {
    const left = at - now;
    return {
      days: Math.floor(left / DAY_MS),
      hours: Math.floor((left % DAY_MS) / HOUR_MS),
      minutes: Math.floor((left % HOUR_MS) / MINUTE_MS),
      seconds: Math.floor((left % MINUTE_MS) / SECOND_MS),
      live: false
    };
  }
  if (now - at < LIVE_WINDOW_MS) return { days: 0, hours: 0, minutes: 0, seconds: 0, live: true };
  return null;
}
