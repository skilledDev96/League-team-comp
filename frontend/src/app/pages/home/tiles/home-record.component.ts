import { Component, computed, input } from '@angular/core';
import { HomeRecord } from '../../../core/home-model';
import { InViewDirective } from '../../../shared/in-view.directive';

/**
 * The season's record as a donut (13 Sep 2026): wins against losses, the win rate in the middle and the
 * run we are on under it. With no games the ring is drawn whole in a neutral stroke, so the tile reads
 * as waiting rather than broken.
 */
@Component({
  selector: 'app-home-record',
  imports: [InViewDirective],
  template: `
    @let r = record();
    <section class="card home-tile home-record" appInView aria-labelledby="home-record-title">
      <header class="home-card-head">
        <h2 id="home-record-title"><span class="material-symbols-rounded" aria-hidden="true">donut_large</span> Record</h2>
        <span class="home-card-scope">{{ scopeLabel() }}</span>
      </header>
      <div class="home-record-body">
        <figure class="home-donut" [attr.aria-label]="summary()">
          <svg viewBox="0 0 42 42" aria-hidden="true">
            <circle class="home-donut-track" cx="21" cy="21" r="15.915" pathLength="100" />
            @for (s of r.segments; track s.key) {
              <circle class="home-donut-part" [class.is-win]="s.key === 'wins'" [class.is-loss]="s.key === 'losses'"
                      cx="21" cy="21" r="15.915" pathLength="100" [attr.stroke-dasharray]="s.dash" [attr.stroke-dashoffset]="s.offset" />
            }
          </svg>
          <figcaption class="home-donut-centre" aria-hidden="true">
            <b>{{ r.counters.games ? r.counters.winRate + '%' : '—' }}</b>
            <small>{{ r.counters.games ? r.counters.wins + '–' + r.counters.losses : 'no games' }}</small>
          </figcaption>
        </figure>
        <dl class="home-record-facts">
          <div><dt><span class="home-key is-win" aria-hidden="true"></span>Wins</dt><dd>{{ r.counters.wins }}</dd></div>
          <div><dt><span class="home-key is-loss" aria-hidden="true"></span>Losses</dt><dd>{{ r.counters.losses }}</dd></div>
          <div><dt>Form</dt><dd>{{ runLine() }}</dd></div>
        </dl>
      </div>
    </section>
  `
})
export class HomeRecordComponent {
  readonly record = input.required<HomeRecord>();
  /** The season's own label: the tournament's name, "Last 90 days" or "All time". */
  readonly scopeLabel = input.required<string>();

  protected readonly summary = computed(() => {
    const c = this.record().counters;
    return c.games ? `${c.wins} wins and ${c.losses} losses, ${c.winRate}% won` : 'No games yet';
  });

  protected readonly runLine = computed(() => {
    const run = this.record().current;
    if (!run) return '—';
    return `${run.length} ${run.result === 'win' ? (run.length === 1 ? 'win' : 'wins') : run.length === 1 ? 'loss' : 'losses'} running`;
  });
}
