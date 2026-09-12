import { Component, computed, input } from '@angular/core';
import { HomeObjectives } from '../../../core/home-model';
import { ObjectiveShare } from '../../../core/team-season';
import { InViewDirective } from '../../../shared/in-view.directive';
import { TooltipDirective } from '../../../shared/tooltip.directive';

const LABELS: Record<ObjectiveShare['key'], { label: string; icon: string }> = {
  dragons: { label: 'Dragons', icon: 'local_fire_department' },
  barons: { label: 'Barons', icon: 'pest_control' },
  heralds: { label: 'Heralds', icon: 'visibility' },
  grubs: { label: 'Grubs', icon: 'bug_report' },
  towers: { label: 'Towers', icon: 'fort' },
  inhibitors: { label: 'Inhibitors', icon: 'domain_disabled' }
};

/**
 * How much of the map we take (13 Sep 2026): our share of each objective both sides took this season,
 * as one bar split ours against theirs, and how often we drew first blood and took the first tower in
 * Riot's games — a replay stores both firsts as false, so it is left out of them.
 */
@Component({
  selector: 'app-home-objectives',
  imports: [InViewDirective, TooltipDirective],
  template: `
    @let o = objectives();
    <section class="card home-tile home-objectives" appInView aria-labelledby="home-objectives-title">
      <header class="home-card-head">
        <h2 id="home-objectives-title"><span class="material-symbols-rounded" aria-hidden="true">flag</span> Objective control</h2>
        <span class="home-card-scope">Our share {{ scope() }}</span>
      </header>
      <div class="home-objectives-body">
        <ul class="home-objectives-bars">
          @for (row of rows(); track row.key) {
            <li class="home-objectives-row" [class.is-empty]="row.share === null" [style.--home-share]="row.share ?? 0.5"
                [attr.aria-label]="row.share === null ? row.label + ': neither side took one' : row.label + ': ' + row.ours + ' ours, ' + row.theirs + ' theirs, over ' + row.games + ' games'">
              <span class="home-objectives-label"><span class="material-symbols-rounded" aria-hidden="true">{{ row.icon }}</span>{{ row.label }}</span>
              <span class="home-objectives-bar" aria-hidden="true"><span class="home-objectives-ours"></span></span>
              <span class="home-objectives-figure" aria-hidden="true">{{ row.share === null ? '—' : pct(row.share) + '%' }}</span>
            </li>
          }
        </ul>
        <dl class="home-objectives-firsts">
          <div [appTip]="'Riot games only: a replay stores first blood as false either way'">
            <dt>First blood</dt>
            <dd>{{ first(o.firstBlood) }}</dd>
          </div>
          <div [appTip]="'Riot games only: a replay stores first tower as false either way'">
            <dt>First tower</dt>
            <dd>{{ first(o.firstTower) }}</dd>
          </div>
        </dl>
      </div>
    </section>
  `
})
export class HomeObjectivesComponent {
  readonly objectives = input.required<HomeObjectives>();
  readonly scope = input.required<string>();

  protected readonly rows = computed(() => this.objectives().shares.map((s) => ({ ...s, ...LABELS[s.key] })));

  protected pct(share: number): number {
    return Math.round(share * 100);
  }

  protected first(f: { hit: number; of: number }): string {
    return f.of ? `${Math.round((f.hit / f.of) * 100)}% · ${f.hit} of ${f.of}` : '—';
  }
}
