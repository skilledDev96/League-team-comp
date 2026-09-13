import { Component, computed, input } from '@angular/core';
import { ringDash } from '../core/home-charts';
import { rateBand } from '../core/opponent-view';
import { ChampionRecord } from '../models/team.models';
import { CountUpDirective } from './count-up.directive';
import { TooltipDirective } from './tooltip.directive';

/**
 * A win rate as a ring with the percent inside and what it is underneath (13 Sep 2026, lifted from Home's
 * lineup for the Roster poster). The colour comes from `rateBand`, never a hand-coded threshold; a rate
 * nobody has yet draws the track alone and a dash. The figure can count up once its section is seen.
 */
@Component({
  selector: 'app-rate-ring',
  imports: [CountUpDirective, TooltipDirective],
  template: `
    <span class="rate-ring-wrap" [appTip]="words()">
      <span class="rate-ring" [class]="band()">
        <svg viewBox="0 0 36 36" aria-hidden="true">
          <circle class="rate-ring-track" cx="18" cy="18" r="15.915" pathLength="100" />
          @if (rate() !== null) {
            <circle class="rate-ring-fill" cx="18" cy="18" r="15.915" pathLength="100" [attr.stroke-dasharray]="dash()" />
          }
        </svg>
        @if (countUp()) {
          <b aria-hidden="true" [appCountUp]="rate()" countUpSuffix="%" [countUpGo]="go()"></b>
        } @else {
          <b aria-hidden="true">{{ rate() === null ? '—' : rate() + '%' }}</b>
        }
      </span>
      @if (label()) {
        <small class="rate-ring-label" aria-hidden="true">{{ label() }}</small>
      }
      <span class="visually-hidden">{{ words() }}</span>
    </span>
  `
})
export class RateRingComponent {
  readonly rate = input<number | null>(null);
  readonly games = input(0);
  readonly wins = input(0);
  /** What sits under the ring: "win rate" by default. */
  readonly label = input('win rate');
  /** How the tip ends: "all time", "this season". */
  readonly scope = input('');
  readonly countUp = input(false);
  readonly go = input(true);

  protected readonly band = computed(() => (this.games() > 0 ? rateBand({ games: this.games(), wins: this.wins() } as ChampionRecord) : ''));
  protected readonly dash = computed(() => ringDash(this.rate() ?? 0));
  protected readonly words = computed(() => {
    const scope = this.scope() ? `, ${this.scope()}` : '';
    return this.rate() === null ? `No games${scope}` : `${this.rate()}% of ${this.games()} ${this.games() === 1 ? 'game' : 'games'} won${scope}`;
  });
}
