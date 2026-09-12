import { Component, computed, effect, ElementRef, HostListener, inject, signal, untracked, viewChild } from '@angular/core';
import { placeCard } from './tooltip-position.util';
import { TourService } from '../services/tour.service';

/**
 * The spotlight: a dim over everything but the anchor, a ring around it,
 * and a card with the step beside it. Rendered once at the app root, so no
 * card's transform can re-root it, above the draft room's side modal.
 * Everything but the card lets clicks through, so a tour can never block a
 * page — or a test.
 */
@Component({
  selector: 'app-tour-overlay',
  template: `
    @if (tours.active(); as tour) {
      @let rect = tours.anchorRect();
      <div class="tour-layer" aria-live="polite">
        @if (rect) {
          <div class="tour-dim" [style.top.px]="0" [style.left.px]="0" [style.right.px]="0" [style.height.px]="max(rect.top - pad, 0)"></div>
          <div class="tour-dim" [style.top.px]="rect.bottom + pad" [style.left.px]="0" [style.right.px]="0" [style.bottom.px]="0"></div>
          <div class="tour-dim" [style.top.px]="rect.top - pad" [style.left.px]="0" [style.width.px]="max(rect.left - pad, 0)" [style.height.px]="rect.height + pad * 2"></div>
          <div class="tour-dim" [style.top.px]="rect.top - pad" [style.left.px]="rect.right + pad" [style.right.px]="0" [style.height.px]="rect.height + pad * 2"></div>
          <div class="tour-ring" [style.top.px]="rect.top - pad" [style.left.px]="rect.left - pad" [style.width.px]="rect.width + pad * 2" [style.height.px]="rect.height + pad * 2"></div>
        } @else {
          <div class="tour-dim tour-dim-all"></div>
        }
        @if (tours.step(); as step) {
          <section class="tour-card" #card role="dialog" aria-modal="false" [attr.aria-labelledby]="'tour-title'" tabindex="-1"
                   [class.is-sheet]="sheet()" [style.top.px]="sheet() ? null : pos().top" [style.left.px]="sheet() ? null : pos().left">
            <p class="tour-count">{{ tour.title }} · {{ tours.index() + 1 }} of {{ tours.steps().length }}</p>
            <h3 id="tour-title" class="tour-title">{{ step.title }}</h3>
            <p class="tour-text">
              {{ step.text }}
              @if (step.more) {
                <button type="button" class="tour-more-btn" [attr.aria-expanded]="more()"
                        [attr.aria-label]="more() ? 'Hide the detail' : 'More about this'"
                        (click)="more.set(!more())">
                  <span class="material-symbols-rounded" aria-hidden="true">info</span>
                </button>
              }
            </p>
            @if (step.more && more()) { <p class="tour-more">{{ step.more }}</p> }
            @if (tours.busy()) { <p class="muted tour-wait"><span class="btn-spinner" aria-hidden="true"></span> Finding it…</p> }
            <div class="tour-actions">
              @if (tours.index() > 0) { <button type="button" class="view-btn" (click)="tours.back()" [disabled]="tours.busy()">Back</button> }
              <button type="button" class="view-btn tour-skip" (click)="tours.skip()">Skip tour</button>
              @if (tours.index() < tours.steps().length - 1) {
                <button type="button" class="view-btn active" (click)="tours.next()" [disabled]="tours.busy()">Next</button>
              } @else {
                <button type="button" class="view-btn active" (click)="tours.finish()">Got it</button>
              }
            </div>
          </section>
        }
      </div>
    }
  `
})
export class TourOverlayComponent {
  protected readonly tours = inject(TourService);
  protected readonly pad = 6;
  private readonly card = viewChild<ElementRef<HTMLElement>>('card');
  /** The detail behind the card's ⓘ, shut again on every step so it never follows you. */
  protected readonly more = signal(false);
  private readonly cardSize = signal({ width: 352, height: 200 });
  private readonly viewport = signal({ width: 1200, height: 800 });

  protected readonly sheet = computed(() => this.viewport().width < 640);
  protected readonly pos = computed(() => {
    const rect = this.tours.anchorRect();
    const card = this.cardSize();
    const vp = this.viewport();
    if (!rect) return { top: Math.max(16, (vp.height - card.height) / 2), left: Math.max(16, (vp.width - card.width) / 2), side: 'center' as const };
    return placeCard({ top: rect.top, left: rect.left, width: rect.width, height: rect.height }, card, vp, this.tours.step()?.placement ?? 'auto');
  });

  constructor() {
    // The detail is shut again on every step, so it never follows you down the walk.
    effect(() => {
      this.tours.index();
      untracked(() => this.more.set(false));
    });
    if (typeof window !== 'undefined') {
      const read = () => this.viewport.set({ width: window.innerWidth, height: window.innerHeight });
      read();
      window.addEventListener('resize', read);
    }
    effect(() => {
      this.tours.step();
      this.tours.anchorRect();
      const el = this.card()?.nativeElement;
      if (!el) return;
      const box = el.getBoundingClientRect();
      if (box.width && box.height) this.cardSize.set({ width: box.width, height: box.height });
    });
    effect(() => {
      if (this.tours.active() && !this.tours.busy()) setTimeout(() => this.card()?.nativeElement.focus({ preventScroll: true }), 0);
    });
  }

  protected max(a: number, b: number): number {
    return Math.max(a, b);
  }

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    if (!this.tours.active()) return;
    // A modal dialog opened from a step (the draft room's Comps popup) makes the tour card inert
    // behind it. Its keys are its own: taking Escape here skipped the whole tour, marked it seen, and
    // cancelled the key so the dialog never closed (12 Sep 2026). The film lab opens with show()
    // while a tour walks, which is not :modal, so its walk is unaffected.
    if (modalDialogOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.tours.skip();
    } else if (event.key === 'ArrowRight' || (event.key === 'Enter' && !(event.target as HTMLElement)?.closest('button, input, textarea, select'))) {
      event.preventDefault();
      void this.tours.next();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      void this.tours.back();
    }
  }
}

/** True while a <dialog> is open with showModal. jsdom does not know :modal, and says so by throwing. */
function modalDialogOpen(): boolean {
  try {
    return !!document.querySelector('dialog:modal');
  } catch {
    return false;
  }
}
