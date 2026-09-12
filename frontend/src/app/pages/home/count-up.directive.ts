import { DestroyRef, Directive, ElementRef, effect, inject, input, untracked } from '@angular/core';
import { MotionService } from '../../services/motion.service';

/**
 * A figure that counts up to its value (13 Sep 2026, the home page's counters).
 *
 * The directive owns the host's text, so the template binds the number to it and never prints it: a
 * text binding and a counter writing the same node would fight, and Angular would lose the node. It
 * counts from what it last showed, so a figure that grows when the team's data lands rolls on from where
 * it stood rather than starting again from zero. `null` is a figure nobody has yet, and prints a dash.
 * Held at zero until `countUpGo`, which the page ties to the section being on screen; with motion off the
 * final figure stands at once. The host should be `aria-hidden`, with the figure written out for a screen
 * reader beside it, because a number read out mid-count is noise.
 */
@Directive({ selector: '[appCountUp]' })
export class CountUpDirective {
  readonly value = input.required<number | null>({ alias: 'appCountUp' });
  readonly suffix = input('', { alias: 'countUpSuffix' });
  readonly go = input(true, { alias: 'countUpGo' });
  readonly ms = input(1100, { alias: 'countUpMs' });

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly motion = inject(MotionService);
  private shown: number | null = null;
  private frame = 0;
  private watchdog: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const value = this.value();
      const suffix = this.suffix();
      const go = this.go();
      const still = this.motion.reduced();
      untracked(() => this.render(value, suffix, go, still));
    });
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  private render(value: number | null, suffix: string, go: boolean, still: boolean): void {
    const format = (n: number) => `${Math.round(n)}${suffix}`;
    this.cancel();
    if (value === null) {
      this.shown = null;
      this.el.textContent = '—';
      return;
    }
    if (!go) {
      if (this.shown === null) this.el.textContent = format(0);
      return;
    }
    const from = this.shown ?? 0;
    this.shown = value;
    if (still || from === value || typeof requestAnimationFrame !== 'function' || typeof performance === 'undefined') {
      this.el.textContent = format(value);
      return;
    }
    const start = performance.now();
    const ms = this.ms();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      this.el.textContent = format(t < 1 ? from + (value - from) * eased : value);
      this.frame = t < 1 ? requestAnimationFrame(step) : 0;
    };
    this.el.textContent = format(from);
    this.frame = requestAnimationFrame(step);
    // Frames stall where the page is not drawn; the figure still has to end up right.
    this.watchdog = setTimeout(() => {
      this.cancel();
      this.el.textContent = format(value);
    }, ms + 1000);
  }

  private cancel(): void {
    if (this.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame);
    this.frame = 0;
    clearTimeout(this.watchdog);
  }
}
