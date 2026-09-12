import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { HomeLineupCard } from '../../../core/home-model';
import { CLIMB_DAYS, climbLines, tierLines } from '../../../core/rank-ladder';
import { InViewDirective } from '../../../shared/in-view.directive';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { RankHistoryService } from '../../../services/rank-history.service';

const W = 600;
const H = 180;
const PAD = 10;
/** One colour a line, from the theme, in lineup order. */
const STROKES = ['var(--accent-2)', 'var(--ok)', 'var(--text-0)', 'var(--warn)', 'var(--accent)'];

/** Today in Amsterdam, where the refresh names its days. */
function amsterdamToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/**
 * The rank climb (13 Sep 2026): each starter's rank over the last sixty mornings on one ladder, solo
 * queue where they have it and flex where they do not, with how far each has come. The refresh has only
 * written ranks down since this shipped, so for the first mornings the tile says how long until it can
 * draw rather than drawing a dot. Reads the histories once, when the tile first comes on screen.
 */
@Component({
  selector: 'app-home-rank-climb',
  imports: [InViewDirective, TooltipDirective],
  template: `
    <section class="card home-tile home-climb" appInView (firstSeen)="seen.set(true)" aria-labelledby="home-climb-title">
      <header class="home-card-head">
        <h2 id="home-climb-title"><span class="material-symbols-rounded" aria-hidden="true">trending_up</span> Rank climb</h2>
        <span class="home-card-scope">Last {{ days }} mornings</span>
      </header>
      @if (lines().length) {
        <div class="home-climb-body">
          <figure class="home-climb-chart" [attr.aria-label]="summary()">
            <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" preserveAspectRatio="none" aria-hidden="true">
              @for (g of grid(); track g.value) {
                <line class="home-climb-grid" [attr.x1]="pad" [attr.x2]="w - pad" [attr.y1]="g.y" [attr.y2]="g.y" />
              }
              @for (l of drawn(); track l.playerId) {
                <path class="home-climb-line" [attr.d]="l.d" [style.stroke]="l.stroke" />
              }
            </svg>
            @for (g of grid(); track g.value) {
              <span class="home-climb-tier" [style.top.%]="(g.y / h) * 100">{{ g.label }}</span>
            }
          </figure>
          <ul class="home-climb-legend">
            @for (l of drawn(); track l.playerId) {
              <li [appTip]="l.tip" tabindex="0">
                <span class="home-climb-key" [style.background]="l.stroke" aria-hidden="true"></span>
                <b>{{ l.name }}</b>
                <small>{{ l.now }}</small>
                <span class="home-climb-delta" [class.is-up]="l.delta > 0" [class.is-down]="l.delta < 0">{{ l.delta > 0 ? '+' : '' }}{{ l.delta }}</span>
                <span class="visually-hidden">{{ l.tip }}</span>
              </li>
            }
          </ul>
        </div>
      } @else {
        <div class="home-tile-empty">
          <span class="material-symbols-rounded" aria-hidden="true">trending_up</span>
          <p>{{ waiting() }}</p>
        </div>
      }
    </section>
  `
})
export class HomeRankClimbComponent {
  readonly lineup = input.required<readonly HomeLineupCard[]>();

  private readonly history = inject(RankHistoryService);
  protected readonly seen = signal(false);
  protected readonly w = W;
  protected readonly h = H;
  protected readonly pad = PAD;
  protected readonly days = CLIMB_DAYS;
  private readonly today = amsterdamToday();

  constructor() {
    effect(() => {
      if (!this.seen()) return;
      const ids = this.lineup().map((c) => c.playerId);
      untracked(() => void this.history.loadAll(ids));
    });
  }

  protected readonly lines = computed(() => {
    const known = this.history.known();
    const histories = this.lineup().flatMap((c) => {
      const doc = known.get(c.playerId);
      return doc ? [{ playerId: c.playerId, name: c.name, points: doc.points }] : [];
    });
    return climbLines(histories, this.today);
  });

  private readonly range = computed(() => {
    const values = this.lines().flatMap((l) => l.points.map((p) => p.value));
    const min = Math.min(...values);
    const max = Math.max(...values);
    // A flat line gets room around it, so it sits mid-chart instead of on an edge.
    const spread = Math.max(100, max - min);
    const mid = (min + max) / 2;
    return { min: mid - spread * 0.6, max: mid + spread * 0.6 };
  });

  private readonly span = computed(() => {
    const days = this.lines().flatMap((l) => l.points.map((p) => dayNumber(p.day)));
    return { first: Math.min(...days), last: Math.max(...days) };
  });

  private y(value: number): number {
    const { min, max } = this.range();
    return PAD + (1 - (value - min) / (max - min)) * (H - 2 * PAD);
  }

  private x(day: string): number {
    const { first, last } = this.span();
    return last > first ? PAD + ((dayNumber(day) - first) / (last - first)) * (W - 2 * PAD) : W / 2;
  }

  protected readonly grid = computed(() => {
    const { min, max } = this.range();
    return tierLines(min, max).map((t) => ({ ...t, y: this.y(t.value) }));
  });

  protected readonly drawn = computed(() =>
    this.lines().map((l, i) => {
      const first = l.points[0];
      const last = l.points[l.points.length - 1];
      const queue = l.queue === 'solo' ? 'Solo' : 'Flex';
      return {
        playerId: l.playerId,
        name: l.name,
        delta: l.delta,
        stroke: STROKES[i % STROKES.length],
        d: l.points.map((p, k) => `${k ? 'L' : 'M'} ${this.x(p.day).toFixed(1)} ${this.y(p.value).toFixed(1)}`).join(' '),
        now: `${last.words} · ${queue}`,
        tip: `${l.name}, ${queue.toLowerCase()} queue: ${first.words} ${first.lp} LP on ${first.day}, ${last.words} ${last.lp} LP on ${last.day}`
      };
    })
  );

  protected readonly summary = computed(() => this.drawn().map((l) => `${l.name} ${l.delta >= 0 ? 'up' : 'down'} ${Math.abs(l.delta)} points`).join('; '));

  protected readonly waiting = computed(() => {
    const known = this.history.known();
    const mornings = Math.max(0, ...this.lineup().map((c) => new Set(known.get(c.playerId)?.points.map((p) => p.day) ?? []).size));
    return mornings === 1
      ? 'The morning refresh wrote down the first ranks; the climb draws from the second morning on.'
      : 'The morning refresh writes down each rank from now on; the climb draws once there are two mornings.';
  });
}
