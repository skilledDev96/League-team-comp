import { Component, computed, inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { TourService } from '../services/tour.service';
import { TooltipDirective } from './tooltip.directive';

/**
 * Two quiet pills for a page hero: "Show me around" when the page has a
 * tour for this role, and the reminder that the editing controls live
 * behind Edit mode, for an editor who has it off (8 Sep 2026).
 */
@Component({
  selector: 'app-tour-pill',
  imports: [TooltipDirective],
  template: `
    <span class="hero-tools">
      @if (tour(); as t) {
        <button type="button" class="view-btn hero-pill" [disabled]="!!tours.blocker(t)" [appTip]="tours.blocker(t) || t.blurb" (click)="tours.start(t.id)">
          <span class="material-symbols-rounded" aria-hidden="true">tour</span> Show me around
        </button>
      }
      @if (auth.canEdit() && !auth.editMode() && !tours.active()) {
        <button type="button" class="view-btn hero-pill hero-pill-edit" (click)="auth.editMode.set(true)" appTip="The editing controls on this page live behind Edit mode; click to turn it on">
          <span class="material-symbols-rounded" aria-hidden="true">edit</span> Changing something? Turn on Edit mode
        </button>
      }
    </span>
  `
})
export class TourPillComponent {
  protected readonly tours = inject(TourService);
  protected readonly auth = inject(AuthService);
  protected readonly tour = computed(() => (this.tours.active() ? null : this.tours.pillFor(this.tours.url())));
}
