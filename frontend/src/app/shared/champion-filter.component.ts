import { Component, inject, input } from '@angular/core';
import { ChampionFilterService } from '../services/champion-filter.service';

/**
 * The one-champion filter box, the same on every page that has an answer for
 * it. The page passes what it counted and what to call it, so the line reads
 * "2 comps with Tristana" here and "5 scrims with Tristana" there.
 */
@Component({
  selector: 'app-champion-filter',
  template: `
    <div class="champ-filter">
      <label class="champ-filter-input">
        <span class="material-symbols-rounded" aria-hidden="true">filter_alt</span>
        <input type="search" [attr.list]="listId" autocomplete="off"
               [placeholder]="placeholder()"
               aria-label="Filter by champion"
               [value]="filter.value()" (input)="filter.set($any($event.target).value)" />
      </label>
      <datalist [id]="listId">
        @for (n of filter.names(); track n) { <option [value]="n"></option> }
      </datalist>
      @if (filter.active()) {
        <span class="champ-filter-count">
          <b>{{ count() }}</b> {{ count() === 1 ? singular() : noun() }} with {{ filter.active() }}
        </span>
        <button type="button" class="link-btn" (click)="filter.clear()">Clear</button>
      }
    </div>
  `
})
export class ChampionFilterComponent {
  protected readonly filter = inject(ChampionFilterService);

  /** How many of the page's things matched. */
  readonly count = input.required<number>();
  /** Plural noun for the count line: games, comps, scrims, players. */
  readonly noun = input<string>('games');
  readonly placeholder = input<string>('One champion — Tristana, Rakan…');

  private static seq = 0;
  protected readonly listId = 'champFilterList' + ChampionFilterComponent.seq++;

  protected singular(): string {
    const n = this.noun();
    return n.endsWith('s') ? n.slice(0, -1) : n;
  }
}
