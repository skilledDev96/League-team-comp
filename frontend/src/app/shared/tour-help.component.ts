import { Component, inject } from '@angular/core';
import { TourService } from '../services/tour.service';
import { ModalDirective } from './modal.directive';
import { TooltipDirective } from './tooltip.directive';

/** The list of tours, from the user menu: what each shows, whether you have seen it, and a Start. */
@Component({
  selector: 'app-tour-help',
  imports: [TooltipDirective, ModalDirective],
  template: `
    <!-- A native dialog: modal, in the top layer; Escape and a backdrop click close it (see appModal). -->
    @if (tours.helpOpen()) {
      <dialog appModal class="modal-card tour-help" aria-label="Help and tours" (closed)="tours.helpOpen.set(false)">
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
      </dialog>
    }
  `
})
export class TourHelpComponent {
  protected readonly tours = inject(TourService);
}
