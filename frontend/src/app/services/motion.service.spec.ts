// @vitest-environment jsdom
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MotionService } from './motion.service';

/** A handle on a promise nobody is allowed to await: the tests assert on whether it has settled yet. */
function watch(p: Promise<void>): { done: boolean } {
  const state = { done: false };
  void p.then(() => {
    state.done = true;
  });
  return state;
}

interface FakeAnimation {
  cancel: ReturnType<typeof vi.fn>;
  finished: Promise<void>;
}

/**
 * Stand in for `el.animate`. `settle` is how the animation ends: 'finish' and
 * 'cancel' are the two the Web Animations API promises, and 'never' is the one
 * it does not rule out — a hidden tab stalls WAAPI and `finished` is simply
 * never settled. That last one is the whole reason `play` has a watchdog.
 */
function stubAnimate(el: HTMLElement, settle: 'finish' | 'cancel' | 'never'): FakeAnimation & { end: () => void } {
  let end = (): void => undefined;
  const finished =
    settle === 'never'
      ? new Promise<void>(() => undefined)
      : new Promise<void>((resolve, reject) => {
          end = () => (settle === 'finish' ? resolve() : reject(new DOMException('aborted', 'AbortError')));
        });
  const anim: FakeAnimation = { cancel: vi.fn(), finished };
  el.animate = vi.fn(() => anim) as unknown as HTMLElement['animate'];
  return { ...anim, end };
}

describe('MotionService', () => {
  let motion: MotionService;
  let el: HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    TestBed.configureTestingModule({});
    motion = TestBed.inject(MotionService);
    el = document.createElement('div');
    document.body.appendChild(el);
  });

  afterEach(() => {
    vi.useRealTimers();
    el.remove();
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  describe('play', () => {
    const fade: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];

    it('resolves when the animation finishes, and lets the watchdog go', async () => {
      const anim = stubAnimate(el, 'finish');
      const state = watch(motion.play(el, fade, { duration: 320, fill: 'forwards' }));

      expect(state.done).toBe(false);
      anim.end();
      await vi.advanceTimersByTimeAsync(0);
      expect(state.done).toBe(true);

      // Long past the watchdog's window: it was cleared, so nothing cancels the animation or
      // writes over where it left the element.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(anim.cancel).not.toHaveBeenCalled();
      expect(el.style.opacity).toBe('');
    });

    it('resolves when the animation is cancelled out from under it', async () => {
      const anim = stubAnimate(el, 'cancel');
      const state = watch(motion.play(el, fade, { duration: 320 }));

      anim.end();
      await vi.advanceTimersByTimeAsync(0);
      expect(state.done).toBe(true);
      expect(anim.cancel).not.toHaveBeenCalled();
    });

    it('resolves on its own when `finished` never settles, and leaves the element on the last frame', async () => {
      const anim = stubAnimate(el, 'never');
      const state = watch(motion.play(el, fade, { duration: 320, fill: 'forwards' }));

      // 320 ms of animation plus a second of slack is under the floor, so the floor decides.
      await vi.advanceTimersByTimeAsync(1499);
      expect(state.done).toBe(false);
      expect(el.style.opacity).toBe('');

      await vi.advanceTimersByTimeAsync(1);
      expect(state.done).toBe(true);
      // The animation is dropped first: a live effect, stalled or not, sits above inline style.
      expect(anim.cancel).toHaveBeenCalledTimes(1);
      expect(el.style.opacity).toBe('0');
    });

    it('gives a long animation all of its own running time, delay included, before giving up', async () => {
      const anim = stubAnimate(el, 'never');
      const state = watch(motion.play(el, fade, { duration: 4000, delay: 500, fill: 'forwards' }));

      await vi.advanceTimersByTimeAsync(5499);
      expect(state.done).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(state.done).toBe(true);
      expect(anim.cancel).toHaveBeenCalledTimes(1);
    });

    it('counts the repeats of an animation that runs more than once', async () => {
      stubAnimate(el, 'never');
      const state = watch(motion.play(el, fade, { duration: 1000, iterations: 3 }));

      await vi.advanceTimersByTimeAsync(3999);
      expect(state.done).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(state.done).toBe(true);
    });

    it('never cuts off an animation that is meant to run forever', async () => {
      const anim = stubAnimate(el, 'never');
      const state = watch(motion.play(el, fade, { duration: 1000, iterations: Infinity }));

      // An endless animation's `finished` not settling is the contract, not a stall; a watchdog
      // here would stop an animation the caller asked to keep running.
      await vi.advanceTimersByTimeAsync(600_000);
      expect(state.done).toBe(false);
      expect(anim.cancel).not.toHaveBeenCalled();
    });

    it('waits out the floor when the timing says nothing readable', async () => {
      const anim = stubAnimate(el, 'never');
      const state = watch(motion.play(el, fade, { fill: 'forwards' }));

      await vi.advanceTimersByTimeAsync(1499);
      expect(state.done).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(state.done).toBe(true);
      expect(anim.cancel).toHaveBeenCalledTimes(1);
    });

    it('with motion off, writes the last frame and never reaches for the Web Animations API', async () => {
      const anim = stubAnimate(el, 'never');
      motion.setStill(true);

      const state = watch(motion.play(el, fade, { duration: 320 }));
      await vi.advanceTimersByTimeAsync(0);

      expect(state.done).toBe(true);
      expect(el.animate).not.toHaveBeenCalled();
      expect(anim.cancel).not.toHaveBeenCalled();
      expect(el.style.opacity).toBe('0');
    });

    it('writes the last frame on a browser with no `animate`', async () => {
      (el as unknown as { animate: undefined }).animate = undefined;

      const state = watch(motion.play(el, fade, { duration: 320 }));
      await vi.advanceTimersByTimeAsync(0);

      expect(state.done).toBe(true);
      expect(el.style.opacity).toBe('0');
    });

    it('writes the last frame when `animate` itself throws', async () => {
      el.animate = vi.fn(() => {
        throw new TypeError('no');
      }) as unknown as HTMLElement['animate'];

      const state = watch(motion.play(el, fade, { duration: 320 }));
      await vi.advanceTimersByTimeAsync(0);

      expect(state.done).toBe(true);
      expect(el.style.opacity).toBe('0');
    });

    /**
     * The stall this service was written around, seen coming instead of waited out (12 Sep 2026).
     *
     * A tab in the background does not advance WAAPI, so an animation started there holds keyframe
     * ONE — and keyframe one is the deliberately-wrong-looking end: a grow's card-sized box, a
     * fade's nothing. The watchdog did rescue it, but only after its floor, and the review
     * takeover's stage sat as a small box in the middle of the screen for that second and a half.
     */
    it('lands at once in a hidden tab rather than holding the first frame', async () => {
      const visibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      try {
        let animated = false;
        el.animate = ((): Animation => {
          animated = true;
          return { finished: new Promise(() => {}), cancel: () => {} } as unknown as Animation;
        }) as unknown as HTMLElement['animate'];

        const state = watch(motion.play(el, [{ transform: 'scale(0.3)' }, { transform: 'none' }], { duration: 420 }));
        await vi.advanceTimersByTimeAsync(0);

        // Resolved on the spot, the element where the animation would have left it, and nothing started.
        expect(state.done).toBe(true);
        expect(el.style.transform).toBe('none');
        expect(animated).toBe(false);
      } finally {
        if (visibility) Object.defineProperty(document, 'visibilityState', visibility);
      }
    });

    it('writes the last frame as CSS: camelCase becomes kebab, bookkeeping is skipped', async () => {
      motion.setStill(true);

      await motion.play(
        el,
        [
          { transform: 'scale(0.5)', borderRadius: '14px' },
          { transform: 'none', borderRadius: '0px', offset: 1, easing: 'ease', composite: 'replace' }
        ],
        { duration: 320 }
      );

      expect(el.style.transform).toBe('none');
      expect(el.style.borderRadius).toBe('0px');
      const style = el.getAttribute('style') ?? '';
      expect(style).not.toContain('offset');
      expect(style).not.toContain('easing');
      expect(style).not.toContain('composite');
    });
  });

  describe('the motion toggle', () => {
    it('is off by default, on once this browser asks for still, and remembered', () => {
      expect(motion.reduced()).toBe(false);

      motion.setStill(true);
      expect(motion.reduced()).toBe(true);
      expect(localStorage.getItem('bom-motion')).toBe('off');

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      expect(TestBed.inject(MotionService).reduced()).toBe(true);
    });
  });

  describe('tempo', () => {
    it('is 1 on an element that sets no --film-tempo', () => {
      expect(motion.tempo(el)).toBe(1);
    });
  });
});
