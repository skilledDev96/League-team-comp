import { Component, computed, inject, input } from '@angular/core';
import { formatSide, gapIsGood, Split, SplitUnit } from '../pages/review/win-loss-splits';
import { TablePrefsService } from '../services/table-prefs.service';

/**
 * One split in a table cell: the figure over every game, or wins beside
 * losses, whichever the shared view says. Green or red only in the
 * comparison view, where the gap has a direction to be good or bad in.
 */
@Component({
  selector: 'app-split-cell',
  host: { class: 'split-cell', '[class.pos]': 'tone() === true', '[class.neg]': 'tone() === false' },
  template: `
    @if (prefs.view() === 'wl') {
      <span class="wl-pair"><small class="wl">W</small>{{ text(split().wins) }}</span>
      <span class="wl-pair"><small class="wl">L</small>{{ text(split().losses) }}</span>
    } @else {
      <span class="all-figure">{{ text(split().all) }}</span>
      @if (showN() && split().all.n) { <small class="all-n">{{ split().all.n }}</small> }
    }
  `
})
export class SplitCellComponent {
  protected readonly prefs = inject(TablePrefsService);
  readonly split = input.required<Split>();
  readonly unit = input<SplitUnit>('count');
  /** Whether a positive gap is good for us; leave unset for a figure with no direction. */
  readonly higherIsBetter = input<boolean | undefined>(undefined);
  /** Show the game count beside the all-games figure. */
  readonly showN = input(false);

  protected readonly tone = computed(() => {
    if (this.prefs.view() !== 'wl') return null;
    const better = this.higherIsBetter();
    return better === undefined ? null : gapIsGood({ split: this.split(), higherIsBetter: better });
  });

  protected text(s: { mean: number; n: number }): string {
    return formatSide(s, this.unit());
  }
}
