import { Injectable, signal, computed } from '@angular/core';

/** The per-browser toggle, beside the OS setting. Never in userPrefs: motion is a property of the screen, not the account. */
const MOTION_KEY = 'bom-motion';

/**
 * How much longer than its own running time `play` waits for an animation to
 * say it has finished before it gives up on it (11 Sep 2026).
 *
 * The slack has to clear everything that makes a *healthy* animation late, so
 * that the watchdog can never beat one that is merely running: the frame
 * before it starts, the frame its finish is noticed in, the microtask that
 * resolves `finished`, and any long task sitting on the main thread. The
 * first three are frames — 16 ms each, 33 ms on a loaded screen — so a whole
 * second is two orders of magnitude past them. The fourth is the only real
 * competition, and by the time the main thread has been blocked for a solid
 * second nothing on the page is painting anyway, so landing on the last frame
 * early costs nothing anyone can see. Pulling the other way: this is how long
 * someone who pressed Minimise waits before the takeover answers, which is
 * why it is a second and not a minute.
 */
const WATCHDOG_SLACK_MS = 1000;

/** The least patience any animation gets, so a 180 ms fade is not judged on a couple of frames' worth. */
const WATCHDOG_FLOOR_MS = 1500;

/**
 * Whether this screen wants motion, and one way to animate that respects it
 * (9 Sep 2026, the film room). `reduced` is the OS setting or the toggle in
 * the film's chrome, so a chapter can lay itself out as a second, still
 * layout instead of skipping frames. `play` is the one door to the Web
 * Animations API: anything animated from a measured value (a FLIP, a pan)
 * goes through it, and when motion is off it lands on the final frame and
 * resolves at once, so a caller can always await it and carry on.
 */
@Injectable({ providedIn: 'root' })
export class MotionService {
  private readonly osReduced = signal(readOsSetting());
  private readonly still = signal(readToggle());

  /** True when motion should stay off: the OS asks, or this browser's toggle does. */
  readonly reduced = computed(() => this.osReduced() || this.still());

  constructor() {
    const media = queryMedia();
    if (media?.addEventListener) {
      media.addEventListener('change', (e) => this.osReduced.set(e.matches));
    }
  }

  /** Switch this browser's toggle; the OS setting still wins when it asks for less. */
  setStill(still: boolean): void {
    this.still.set(still);
    try {
      localStorage.setItem(MOTION_KEY, still ? 'off' : 'on');
    } catch {
      /* private mode: the signal holds for this page */
    }
  }

  /**
   * The film's tempo, read off the element: `--film-tempo` scales every
   * duration in the stylesheet, and a script-driven duration reads the same
   * number so the two never drift. 1 when it is unset or unreadable.
   */
  tempo(el: Element): number {
    try {
      const v = parseFloat(getComputedStyle(el).getPropertyValue('--film-tempo'));
      return Number.isFinite(v) && v > 0 ? v : 1;
    } catch {
      return 1;
    }
  }

  /**
   * Count a number up in the element's text, eased out so the last digits
   * settle. With motion off, or without frames to draw on, the final value
   * is written at once; either way the promise resolves when it is there.
   * An element that leaves the page mid-count stops the frames with it.
   */
  count(el: Element, from: number, to: number, ms: number, format: (n: number) => string = (n) => String(Math.round(n))): Promise<void> {
    const write = (n: number) => {
      el.textContent = format(n);
    };
    if (this.reduced() || ms <= 0 || typeof requestAnimationFrame !== 'function' || typeof performance === 'undefined') {
      write(to);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const start = performance.now();
      const step = (now: number) => {
        if (!el.isConnected) {
          resolve();
          return;
        }
        const t = Math.min(1, (now - start) / ms);
        const eased = 1 - Math.pow(1 - t, 3);
        write(t < 1 ? from + (to - from) * eased : to);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      write(from);
      requestAnimationFrame(step);
    });
  }

  /**
   * Animate an element, or, when motion is off, put it where the animation
   * would have left it. Resolves either way, on cancel too, so a chapter's
   * flow never hangs on a frame that will not come.
   *
   * And not on a frame that never comes at all. `anim.finished` is the only
   * thing the Web Animations API gives you to wait on, and it is not promised
   * to settle: a hidden tab stalls WAAPI, so an animation started as the tab
   * goes to the background can sit unfinished for as long as the tab is away.
   * The callers that await this *before* they change state — `minimise()` on
   * the review takeover, `go()` in the film room — would wait with it, and the
   * takeover's is how a page ends up sealed behind an inert backdrop with both
   * of its exits behind a `leaving` latch. So `finished` is raced against a
   * watchdog set from the animation's own timing: when the watchdog wins the
   * animation is dropped and the last keyframe written, exactly the way the
   * reduced-motion and no-Web-Animations branches above write it, and the
   * caller carries on. WATCHDOG_SLACK_MS says why it cannot beat an animation
   * that is only running.
   */
  play(el: Element, keyframes: Keyframe[], opts: KeyframeAnimationOptions): Promise<void> {
    const last = keyframes[keyframes.length - 1];
    const canAnimate = typeof (el as HTMLElement).animate === 'function';
    // A hidden document is the stall this watchdog was written for, and it can be seen coming
    // rather than waited out: WAAPI does not advance there, so the element would hold keyframe ONE
    // for the whole floor — and keyframe one is the deliberately-wrong-looking end of a grow or a
    // fade. Writing the last frame at once is what the reduced-motion branch already does, and it
    // is the right answer for the same reason: no motion is available, so land where it would have.
    if (this.reduced() || !canAnimate || hiddenDocument()) {
      if (last) applyFrame(el, last);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      try {
        const anim = (el as HTMLElement).animate(keyframes, opts);
        let over = false;
        const watchdog = armWatchdog(opts, () => {
          if (over) return;
          over = true;
          // Drop the animation before writing the frame. A running effect sits above inline style
          // in the cascade, and a stalled one is still running as far as the cascade is concerned,
          // so the write would be invisible with the animation left in place. Cancelling rejects
          // `finished`, which lands on `settle` and finds it already over.
          try {
            anim.cancel();
          } catch {
            /* nothing left to cancel */
          }
          if (last) applyFrame(el, last);
          resolve();
        });
        const settle = () => {
          if (over) return;
          over = true;
          if (watchdog !== undefined) clearTimeout(watchdog);
          resolve();
        };
        anim.finished.then(settle, settle);
      } catch {
        if (last) applyFrame(el, last);
        resolve();
      }
    });
  }
}

/**
 * The timer behind `play`'s watchdog, set to how long the animation says it
 * will run plus the slack. Undefined when the timing says it is not meant to
 * end — endless `iterations` — because there an unsettled `finished` is the
 * contract rather than a stall, and cutting it short would be the bug.
 */
/** True while the tab is in the background, where WAAPI does not advance and rAF is throttled. */
function hiddenDocument(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function armWatchdog(opts: KeyframeAnimationOptions, onStall: () => void): ReturnType<typeof setTimeout> | undefined {
  const iterations = typeof opts.iterations === 'number' ? opts.iterations : 1;
  const runs = timingMs(opts.delay) + timingMs(opts.duration) * iterations + timingMs(opts.endDelay);
  if (!Number.isFinite(runs)) return undefined;
  return setTimeout(onStall, Math.max(runs + WATCHDOG_SLACK_MS, WATCHDOG_FLOOR_MS));
}

/** A timing option in milliseconds; 0 for the shapes the API allows but this app never passes (a CSS numeric value, 'auto'), which leaves the floor to decide. */
function timingMs(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function queryMedia(): MediaQueryList | null {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
    return window.matchMedia('(prefers-reduced-motion: reduce)');
  } catch {
    return null;
  }
}

function readOsSetting(): boolean {
  return !!queryMedia()?.matches;
}

function readToggle(): boolean {
  try {
    return localStorage.getItem(MOTION_KEY) === 'off';
  } catch {
    return false;
  }
}

/** Write a keyframe's properties straight onto the element's style, the way a filled animation would leave them. */
function applyFrame(el: Element, frame: Keyframe): void {
  const style = (el as HTMLElement).style;
  if (!style) return;
  for (const [prop, value] of Object.entries(frame)) {
    // Keyframe bookkeeping, not styles.
    if (prop === 'offset' || prop === 'easing' || prop === 'composite') continue;
    if (value === null || value === undefined) continue;
    style.setProperty(toKebab(prop), String(value));
  }
}

function toKebab(prop: string): string {
  if (prop.startsWith('--')) return prop;
  if (prop === 'cssFloat') return 'float';
  return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
