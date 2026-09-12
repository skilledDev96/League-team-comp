import { DestroyRef, Directive, ElementRef, inject, input, output, signal } from '@angular/core';

/** How long to wait for the observer's first word before counting the host as seen. */
export const SEEN_FALLBACK_MS = 1200;

/**
 * Tells a section it is on screen (13 Sep 2026, for the home page).
 *
 * The host gets `is-seen` the first time any part of it enters the viewport, and `inView` fires with
 * true or false as it comes and goes. Animations key off `is-seen`, so nothing below the fold plays
 * where nobody can watch it, and the one ability clip on the home page only runs while its card can be
 * seen. `once` (the default) stops observing after the first sighting.
 *
 * Without IntersectionObserver (jsdom in the specs, very old browsers) the host counts as seen at once,
 * so nothing is ever left waiting for an event that cannot come. And a page that is not being drawn at all
 * (a window behind another, a thumbnail capture) never hears from the observer either, while a section
 * held at `opacity: 0` until it is seen would stay blank there; so when the observer has said nothing
 * within `SEEN_FALLBACK_MS` the host counts as seen anyway. `firstSeen` fires once, either way; `inView`
 * only ever reports what the observer saw, so a clip or a rotation keyed on it never starts on a guess.
 */
@Directive({
  selector: '[appInView]',
  host: { '[class.is-seen]': 'seen()' }
})
export class InViewDirective {
  readonly once = input(true, { alias: 'appInViewOnce' });
  readonly inView = output<boolean>();
  readonly firstSeen = output<void>();

  protected readonly seen = signal(false);

  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    if (typeof IntersectionObserver === 'undefined') {
      queueMicrotask(() => {
        this.markSeen();
        this.inView.emit(true);
      });
      return;
    }
    let heard = false;
    const observer = new IntersectionObserver(
      (entries) => {
        heard = true;
        const visible = entries.some((e) => e.isIntersecting);
        if (visible) this.markSeen();
        this.inView.emit(visible);
        if (visible && this.once()) observer.disconnect();
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.01 }
    );
    observer.observe(el);
    const fallback = setTimeout(() => {
      if (!heard) this.markSeen();
    }, SEEN_FALLBACK_MS);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(fallback);
      observer.disconnect();
    });
  }

  private markSeen(): void {
    if (this.seen()) return;
    this.seen.set(true);
    this.firstSeen.emit();
  }
}
