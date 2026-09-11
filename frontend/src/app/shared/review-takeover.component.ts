import { afterRenderEffect, Component, computed, DestroyRef, effect, ElementRef, HostListener, inject, signal, untracked, viewChild } from '@angular/core';
import { MotionService } from '../services/motion.service';
import { ReviewTakeoverService } from '../services/review-takeover.service';
import { ReviewTakeoverStageComponent } from './review-takeover-stage.component';

/** A second Escape within this always closes the takeover, however stuck the stage is. The film room's own figure. */
const ESCAPE_TWICE_MS = 2000;

/**
 * The review takeover (9 Sep 2026), hosted once in the app shell beside the
 * tour overlay. A row's Review button opens the gate, a modal card that
 * says what it costs; nothing is spent before Roll it. Roll it starts the
 * review and hands the card's box to the stage, which grows out of it and
 * plays the game while the coach writes. The stage and everything it
 * needs (the Rift, the scrubber, the film's builders) sit in a deferred
 * block, so the shell's bundle carries only this: the gate, the backdrop,
 * the page behind made inert, and focus back to the button on close.
 */
@Component({
  selector: 'app-review-takeover',
  imports: [ReviewTakeoverStageComponent],
  host: { class: 'review-takeover', '[class.is-on]': 'on()', '[class.is-still]': 'motion.reduced()' },
  template: `
    @if (on()) {
      <div class="rt-backdrop" [class.is-deep]="phase() !== 'gate'" (click)="onBackdrop()"></div>
      @if (phase() === 'gate') {
        <div class="modal-card rt-gate" role="dialog" aria-modal="true" aria-labelledby="rt-gate-title" #card>
          <h2 id="rt-gate-title" class="title-with-icon"><span class="section-icon material-symbols-rounded" aria-hidden="true">auto_awesome</span>{{ svc.again() ? 'Write the review again?' : 'Review this game?' }}</h2>
          <p class="muted">Two Opus calls over the facts, about a dime.</p>
          <div class="links rt-gate-pills">
            <button type="button" class="view-btn active" #roll (click)="rollIt()"><span class="material-symbols-rounded" aria-hidden="true">auto_awesome</span> Roll it</button>
            <button type="button" class="view-btn" (click)="svc.close()">Not now</button>
          </div>
        </div>
      } @else {
        <!--
          The stage, the Rift and the scrubber load with the first Roll it, not with the app shell.

          Every branch below is load-bearing (11 Sep 2026). The backdrop above renders for every
          phase, so a deferred block with nothing to show while it waits, and nothing to show when it
          fails, leaves a full-screen dim scrim over an empty page — with no exit either, because the
          Minimise pill lives inside the stage. That is what a teammate hit after a deploy changed the
          chunk names under an open tab.

          A "prefetch on idle" was here and did nothing: this whole template is the else branch, so
          it is not instantiated until the phase is already past the gate, by which point "when
          live()" is true and fires in the same pass. It went rather than read as a safety net that
          was never armed.
        -->
        @defer (when live()) {
          <app-review-takeover-stage [flipFrom]="flipFrom()" />
        } @loading (after 600ms; minimum 400ms) {
          <!-- Only for a genuinely slow load: under 600ms the stage wins the race and this never paints. -->
          <div class="modal-card rt-gate" role="status" aria-live="polite">
            <p class="muted">Opening the review…</p>
            <div class="links rt-gate-pills">
              <button type="button" class="view-btn" (click)="svc.close()">Close</button>
            </div>
          </div>
        } @error {
          <div class="modal-card rt-gate" role="alertdialog" aria-modal="true" aria-labelledby="rt-stale-title">
            <h2 id="rt-stale-title" class="title-with-icon"><span class="section-icon material-symbols-rounded" aria-hidden="true">refresh</span>A newer version is live</h2>
            <p class="muted">This tab was open while the site was updated, so this screen could not load. Reload to pick up the new one — the review itself is already running and will be waiting on the row when you come back.</p>
            <div class="links rt-gate-pills">
              <button type="button" class="view-btn active" (click)="reload()"><span class="material-symbols-rounded" aria-hidden="true">refresh</span> Reload</button>
              <button type="button" class="view-btn" (click)="svc.close()">Not now</button>
            </div>
          </div>
        }
      }
    }
  `
})
export class ReviewTakeoverComponent {
  protected readonly svc = inject(ReviewTakeoverService);
  protected readonly motion = inject(MotionService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly phase = this.svc.phase;
  protected readonly on = computed(() => this.phase() !== 'closed');
  protected readonly live = computed(() => this.phase() !== 'closed' && this.phase() !== 'gate');
  /** The gate card's box at Roll it, for the stage to grow out of. */
  protected readonly flipFrom = signal<DOMRect | null>(null);

  private readonly card = viewChild<ElementRef<HTMLElement>>('card');
  private readonly rollBtn = viewChild<ElementRef<HTMLButtonElement>>('roll');
  /** The deferred stage, once it has actually rendered. Absent while it loads, and absent for good if it fails. */
  private readonly stage = viewChild(ReviewTakeoverStageComponent);
  private wasOn = false;
  private overflowBefore = '';
  private lastEscapeAt = 0;

  constructor() {
    // The page behind: no scroll and inert while the takeover is up; focus back to the button when it goes.
    effect(() => {
      const on = this.on();
      untracked(() => {
        if (typeof document === 'undefined') return;
        // Another overlay may have locked the scroll first: its lock is handed back, not cleared.
        if (on && !this.wasOn) this.overflowBefore = document.body.style.overflow;
        document.body.style.overflow = on ? 'hidden' : this.overflowBefore;
        document.querySelector('.page')?.toggleAttribute('inert', on);
        if (!on && this.wasOn) {
          const el = this.svc.fromEl?.isConnected ? this.svc.fromEl : document.querySelector<HTMLElement>('[data-tour="games-review-btn"]');
          // The button reads Reviewing... and is disabled while the call runs, so the row's summary takes the focus then.
          const target = el && !(el as HTMLButtonElement).disabled ? el : (el?.closest('details')?.querySelector<HTMLElement>('summary') ?? null);
          this.svc.fromEl = null;
          this.flipFrom.set(null);
          setTimeout(() => target?.focus({ preventScroll: true }), 0);
        }
        this.wasOn = on;
      });
    });

    // The gate's primary pill takes focus.
    afterRenderEffect(() => {
      const btn = this.rollBtn()?.nativeElement;
      if (btn) untracked(() => btn.focus({ preventScroll: true }));
    });

    this.destroyRef.onDestroy(() => {
      if (typeof document === 'undefined') return;
      if (this.wasOn) document.body.style.overflow = this.overflowBefore;
      document.querySelector('.page')?.removeAttribute('inert');
    });
  }

  /**
   * Escape on the gate is Not now; the stage handles its own — unless it cannot.
   *
   * The last branch is a way out of a takeover that has stopped answering (11 Sep 2026). While it is
   * up the page behind is `inert` and the body cannot scroll, and both of the stage's own exits —
   * the Minimise pill and its Escape — are inside the stage, so anything that leaves the stage on
   * screen but unresponsive seals the tab until it is reloaded. The known one is an animation whose
   * promise never settles: `minimise()` awaits `MotionService.play` before it closes, and a hidden
   * tab can stall WAAPI so `finished` never resolves. A second Escape within two seconds always
   * gets out, which is the film room's own idiom for the same problem.
   */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.phase() === 'gate') {
      this.svc.close();
      return;
    }
    // Nothing rendered: the loading and error cards carry their own buttons, but Escape is the
    // reflex and there is no stage listening for it.
    if (!this.stage()) {
      this.svc.close();
      return;
    }
    const now = Date.now();
    if (this.lastEscapeAt && now - this.lastEscapeAt <= ESCAPE_TWICE_MS) {
      this.svc.close();
      return;
    }
    this.lastEscapeAt = now;
  }

  protected onBackdrop(): void {
    // Past the gate the stage owns the click; with no stage on screen the backdrop is the only
    // thing there is to click, and a scrim that swallows every click is how a page feels broken.
    if (this.phase() === 'gate' || !this.stage()) this.svc.close();
  }

  /** The stale-build card's own pill. A press is explicit, so it is not subject to the reload-once guard. */
  protected reload(): void {
    if (typeof location !== 'undefined') location.reload();
  }

  /** Roll it: the card's box is read before it goes, so the stage can grow out of it. */
  protected rollIt(): void {
    const card = this.card()?.nativeElement;
    this.flipFrom.set(card ? card.getBoundingClientRect() : null);
    this.svc.roll();
  }
}
