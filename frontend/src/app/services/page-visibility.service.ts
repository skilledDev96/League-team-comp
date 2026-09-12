import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/**
 * Whether this tab is the one being looked at (13 Sep 2026).
 *
 * A hidden tab throttles timers to about once a second and never gives a frame, so anything that
 * rotates or counts down on a timer should stop while hidden and pick up where it is when the tab comes
 * back — rather than firing a burst of queued changes at once. The home page's splash rotation and the
 * next-series countdown read this.
 */
@Injectable({ providedIn: 'root' })
export class PageVisibilityService {
  readonly visible = signal(typeof document === 'undefined' ? true : document.visibilityState !== 'hidden');

  constructor() {
    if (typeof document === 'undefined') return;
    const update = () => this.visible.set(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('visibilitychange', update));
  }
}
