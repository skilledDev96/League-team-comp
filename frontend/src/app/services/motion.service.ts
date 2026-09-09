import { Injectable, signal, computed } from '@angular/core';

/** The per-browser toggle, beside the OS setting. Never in userPrefs: motion is a property of the screen, not the account. */
const MOTION_KEY = 'bom-motion';

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
   */
  play(el: Element, keyframes: Keyframe[], opts: KeyframeAnimationOptions): Promise<void> {
    const last = keyframes[keyframes.length - 1];
    const canAnimate = typeof (el as HTMLElement).animate === 'function';
    if (this.reduced() || !canAnimate) {
      if (last) applyFrame(el, last);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      try {
        const anim = (el as HTMLElement).animate(keyframes, opts);
        anim.finished.then(
          () => resolve(),
          () => resolve()
        );
      } catch {
        if (last) applyFrame(el, last);
        resolve();
      }
    });
  }
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
