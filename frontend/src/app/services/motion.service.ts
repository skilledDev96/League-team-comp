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
