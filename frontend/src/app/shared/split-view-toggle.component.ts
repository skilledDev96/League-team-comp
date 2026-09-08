import { Component, inject } from '@angular/core';
import { TablePrefsService } from '../services/table-prefs.service';
import { TooltipDirective } from './tooltip.directive';

/** All games, or wins beside losses — one switch shared by every stat table. */
@Component({
  selector: 'app-split-view-toggle',
  imports: [TooltipDirective],
  template: `
    <div class="segmented split-view-toggle" role="group" aria-label="How the figures read">
      <button type="button" class="segment" [class.active]="prefs.view() === 'all'" [attr.aria-pressed]="prefs.view() === 'all'"
              (click)="prefs.setView('all')" appTip="One figure per column, over every game in the selection">All games</button>
      <button type="button" class="segment" [class.active]="prefs.view() === 'wl'" [attr.aria-pressed]="prefs.view() === 'wl'"
              (click)="prefs.setView('wl')" appTip="The same figure in wins (W) beside losses (L), green when the gap is in our favour">Wins vs losses</button>
    </div>
  `
})
export class SplitViewToggleComponent {
  protected readonly prefs = inject(TablePrefsService);
}
