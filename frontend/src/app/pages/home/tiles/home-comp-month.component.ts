import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { COMP_MONTH_DAYS, COMP_MONTH_MIN_GAMES, CompOfTheMonth } from '../../../core/comp-month';
import { rateBand } from '../../../core/opponent-view';
import { ChampionRecord, ROLES } from '../../../models/team.models';
import { championOf } from '../../../shared/comp-board.util';
import { InViewDirective } from '../../../shared/in-view.directive';
import { UiService } from '../../../services/ui.service';

/**
 * The comp of the month (13 Sep 2026, the lead: "I did like the records to beat and the comp of the
 * month stats"): the saved comp with the best record over the last thirty days among those played at
 * least three times, its five faces and its record, opening it on Comps. The pill is a button that
 * names the comp: the e2e sign-in check finds the nav by a link whose name contains "Comps", and a
 * second such link on the landing page would make it ambiguous.
 */
@Component({
  selector: 'app-home-comp-month',
  imports: [InViewDirective],
  template: `
    <section class="card home-tile home-comp-month" appInView aria-labelledby="home-comp-title">
      <header class="home-card-head">
        <h2 id="home-comp-title"><span class="material-symbols-rounded" aria-hidden="true">stars</span> Comp of the month</h2>
        <span class="home-card-scope">Last {{ days }} days</span>
      </header>
      @if (best(); as b) {
        <div class="home-comp-body">
          <div class="home-comp-top">
            <p class="home-comp-name">{{ b.name }}</p>
            <p class="home-comp-rate" [class]="band()"><b>{{ b.winRate }}%</b> won <span>{{ b.wins }}–{{ b.losses }} over {{ b.games }} games</span></p>
          </div>
          <ul class="home-comp-faces" aria-label="Its five picks">
            @for (face of faces(); track face.role) {
              <li class="home-comp-face">
                @if (face.champion) {
                  <img [src]="ui.championArtUrl(face.champion)" (error)="ui.artFallback($event, face.champion)" [alt]="ui.championName(face.champion)" loading="lazy" />
                } @else {
                  <span class="home-comp-face-empty" aria-hidden="true"></span>
                }
                <span class="home-comp-face-label"><small>{{ face.role }}</small>@if (face.champion) { <b>{{ ui.championName(face.champion) }}</b> }</span>
              </li>
            }
          </ul>
          <button type="button" class="view-btn home-pill home-comp-open" (click)="open(b.compId)">
            <span class="material-symbols-rounded" aria-hidden="true">open_in_new</span> Open {{ b.name }}
          </button>
        </div>
      } @else {
        <div class="home-tile-empty">
          <span class="material-symbols-rounded" aria-hidden="true">stars</span>
          <p>Play a comp {{ min }} times this month to crown one@if (compMonth().nearest; as n) { — {{ n.name }} is on {{ n.games }}}.</p>
        </div>
      }
    </section>
  `
})
export class HomeCompMonthComponent {
  readonly compMonth = input.required<{ best: CompOfTheMonth | null; nearest: { name: string; games: number } | null }>();

  protected readonly ui = inject(UiService);
  private readonly router = inject(Router);
  protected readonly days = COMP_MONTH_DAYS;
  protected readonly min = COMP_MONTH_MIN_GAMES;

  protected readonly best = computed(() => this.compMonth().best);
  protected readonly faces = computed(() => {
    const picks = this.best()?.picks;
    return ROLES.map((role) => ({ role, champion: championOf(picks?.[role]) }));
  });
  protected readonly band = computed(() => {
    const b = this.best();
    return b ? rateBand({ games: b.games, wins: b.wins } as ChampionRecord) : '';
  });

  protected open(compId: string): void {
    void this.router.navigate(['/comps'], { queryParams: { comp: compId } });
  }
}
