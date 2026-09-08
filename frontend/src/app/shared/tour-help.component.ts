import { Component, HostListener, inject } from '@angular/core';
import { TourService } from '../services/tour.service';
import { TooltipDirective } from './tooltip.directive';

/** The list of tours, from the user menu: what each shows, whether you have seen it, and a Start. */
@Component({
  selector: 'app-tour-help',
  imports: [TooltipDirective],
  template: `
    @if (tours.helpOpen()) {
      <div class="modal-backdrop" (click)="tours.helpOpen.set(false)">
        <div class="modal-card tour-help" role="dialog" aria-modal="true" aria-label="Help and tours" (click)="$event.stopPropagation()">
          <h2 class="title-with-icon"><span class="section-icon material-symbols-rounded">tour</span>Help and tours</h2>
          <p class="muted">Each one walks the page and points at the real controls. Escape leaves a tour at any step.</p>
          <ul class="list-clean tour-help-list">
            @for (t of tours.available(); track t.id) {
              <li class="tour-help-row">
                <span class="tour-help-mark material-symbols-rounded" [class.is-seen]="tours.seen(t)" aria-hidden="true">{{ tours.seen(t) ? 'check_circle' : 'radio_button_unchecked' }}</span>
                <span class="tour-help-text"><b>{{ t.title }}</b><small class="muted">{{ t.blurb }}</small></span>
                <button type="button" class="view-btn" [class.active]="!tours.seen(t)" [disabled]="!!tours.blocker(t)" [appTip]="tours.blocker(t) || ''" (click)="tours.start(t.id)">
                  {{ tours.seen(t) ? 'Start again' : 'Start' }}
                </button>
              </li>
            }
          </ul>
          <div class="links"><button type="button" class="view-btn" (click)="tours.helpOpen.set(false)">Close</button></div>
        </div>
      </div>
    }
  `
})
export class TourHelpComponent {
  protected readonly tours = inject(TourService);

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.tours.helpOpen()) this.tours.helpOpen.set(false);
  }
}
