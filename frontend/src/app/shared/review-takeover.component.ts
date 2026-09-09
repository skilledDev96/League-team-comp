import { afterRenderEffect, Component, computed, DestroyRef, effect, ElementRef, HostListener, inject, signal, untracked, viewChild } from '@angular/core';
import { MotionService } from '../services/motion.service';
import { ReviewTakeoverService } from '../services/review-takeover.service';
import { ReviewTakeoverStageComponent } from './review-takeover-stage.component';

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
        <!-- The stage, the Rift and the scrubber load with the first Roll it, not with the app shell. -->
        @defer (when live(); prefetch on idle) {
          <app-review-takeover-stage [flipFrom]="flipFrom()" />
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
  private wasOn = false;
  private overflowBefore = '';

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

  /** Escape on the gate is Not now; the stage handles its own. */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.phase() === 'gate') this.svc.close();
  }

  protected onBackdrop(): void {
    if (this.phase() === 'gate') this.svc.close();
  }

  /** Roll it: the card's box is read before it goes, so the stage can grow out of it. */
  protected rollIt(): void {
    const card = this.card()?.nativeElement;
    this.flipFrom.set(card ? card.getBoundingClientRect() : null);
    this.svc.roll();
  }
}
