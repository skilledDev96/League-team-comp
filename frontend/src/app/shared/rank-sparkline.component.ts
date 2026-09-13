import { Component, computed, effect, inject, input, untracked } from '@angular/core';
import { amsterdamToday, CLIMB_DAYS, climbLines, sparkGeometry } from '../core/rank-ladder';
import { RankHistoryService } from '../services/rank-history.service';

const W = 260;
const H = 70;

/**
 * One player's rank over the last sixty mornings, small (13 Sep 2026, the Roster's player sheet). Reads
 * that player's history once, when the sheet first shows them, through the same service Home's climb uses.
 * Until the morning refresh has written two mornings it says when it will draw, and prints the rank now.
 */
@Component({
  selector: 'app-rank-sparkline',
  template: `
    @if (line(); as l) {
      <figure class="rank-spark" [attr.aria-label]="summary()">
        <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" preserveAspectRatio="none" aria-hidden="true">
          @for (g of geometry().grid; track g.value) {
            <line class="rank-spark-grid" x1="0" [attr.x2]="w" [attr.y1]="g.y" [attr.y2]="g.y" />
          }
          <path class="rank-spark-line" [attr.d]="geometry().d" />
        </svg>
        @if (geometry().last; as p) {
          <span class="rank-spark-now" [style.left.%]="(p.x / w) * 100" [style.top.%]="(p.y / h) * 100" aria-hidden="true"></span>
        }
        <figcaption class="rank-spark-caption">
          <span>{{ l.points[0].words }} <span class="rank-spark-arrow" aria-hidden="true">→</span> <b>{{ l.points[l.points.length - 1].words }}</b></span>
          <span class="rank-spark-delta" [class.is-up]="l.delta > 0" [class.is-down]="l.delta < 0">{{ l.delta > 0 ? '+' : '' }}{{ l.delta }} LP</span>
          <small>{{ l.queue === 'solo' ? 'Solo' : 'Flex' }}, last {{ days }} mornings</small>
        </figcaption>
      </figure>
    } @else {
      <p class="rank-spark-empty">
        @if (now()) { <b>{{ now() }}</b> now. }
        Fills from tomorrow: the morning refresh writes the rank down each day and the line draws from the second.
      </p>
    }
  `
})
export class RankSparklineComponent {
  readonly playerId = input.required<string>();
  readonly name = input('');
  /** The rank Riot gave last, printed while the line waits. */
  readonly now = input('');

  private readonly history = inject(RankHistoryService);
  protected readonly w = W;
  protected readonly h = H;
  protected readonly days = CLIMB_DAYS;
  private readonly today = amsterdamToday();

  constructor() {
    effect(() => {
      const id = this.playerId();
      untracked(() => void this.history.load(id));
    });
  }

  protected readonly line = computed(() => {
    const doc = this.history.known().get(this.playerId());
    return doc ? (climbLines([{ playerId: this.playerId(), name: this.name(), points: doc.points }], this.today)[0] ?? null) : null;
  });

  protected readonly geometry = computed(() => sparkGeometry(this.line()?.points ?? [], W, H));

  protected readonly summary = computed(() => {
    const l = this.line();
    if (!l) return '';
    return `${this.name()}: ${l.points[0].words} to ${l.points[l.points.length - 1].words}, ${l.delta >= 0 ? 'up' : 'down'} ${Math.abs(l.delta)} points over the last ${CLIMB_DAYS} mornings`;
  });
}
