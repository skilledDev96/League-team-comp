import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { GameSource, RowPlayer } from '../pages/games/game-rows';
import { UiService } from '../services/ui.service';

type Metric = 'damage' | 'taken' | 'both' | 'cs' | 'vision' | 'ka' | 'gold';

/**
 * The post-game graphs (9 Sep 2026): one figure at a time across all ten
 * players, ours against theirs seat by seat, drawn from the same figures the
 * scoreboard table shows, so a replay and a Riot game get the same view.
 * A figure a row does not carry is a dash and an empty track, never a zero.
 */
@Component({
  selector: 'app-game-graphs',
  template: `
    <div class="game-graphs">
      <div class="view-segment" role="group" aria-label="Figure">
        @for (m of metrics(); track m.key) {
          <button type="button" [class.active]="metric() === m.key" (click)="metric.set(m.key)">{{ m.label }}</button>
        }
      </div>
      <div class="game-graphs-rows">
        @for (pair of rows(); track $index) {
          <div class="game-graphs-pair">
            @if (pair.ours; as p) { <ng-container *ngTemplateOutlet="bar; context: { $implicit: p, side: 'ours' }" /> }
            @if (pair.theirs; as p) { <ng-container *ngTemplateOutlet="bar; context: { $implicit: p, side: 'theirs' }" /> }
          </div>
        }
      </div>
      <p class="muted game-graphs-legend">
        Ours in colour, theirs in grey@if (metric() === 'both') {; damage taken in amber under damage dealt}. A dash means the game did not carry the figure.
      </p>
    </div>

    <ng-template #bar let-p let-side="side">
      <div class="game-graphs-bar" [class.is-theirs]="side === 'theirs'">
        <span class="who">
          <img [src]="ui.championIconUrl(p.champion)" [alt]="" loading="lazy" />
          <span>{{ p.player ?? p.champion }}</span>
        </span>
        <span class="game-graphs-track">
          @for (v of values(p); track $index) {
            <span class="game-graphs-fill" [class.is-taken]="$index === 1" [class.is-none]="v === undefined" [style.width.%]="width(v)"></span>
          }
        </span>
        <span class="value">{{ label(p) }}</span>
      </div>
    </ng-template>
  `,
  imports: [NgTemplateOutlet]
})
export class GameGraphsComponent {
  readonly ours = input.required<RowPlayer[]>();
  readonly theirs = input<RowPlayer[]>([]);
  readonly source = input<GameSource>('riot');

  protected readonly ui = inject(UiService);
  protected readonly metric = signal<Metric>('damage');

  private readonly everyone = computed(() => [...this.ours(), ...this.theirs()]);

  /** Only the figures at least one row carries. */
  protected readonly metrics = computed<{ key: Metric; label: string }[]>(() => {
    const has = (pick: (p: RowPlayer) => number | undefined) => this.everyone().some((p) => pick(p) !== undefined);
    const out: { key: Metric; label: string }[] = [{ key: 'damage', label: 'Damage dealt' }];
    if (has((p) => p.stats?.damageTaken)) out.push({ key: 'taken', label: 'Damage taken' }, { key: 'both', label: 'Dealt vs taken' });
    out.push({ key: 'cs', label: 'CS' });
    if (has((p) => p.stats?.vision)) out.push({ key: 'vision', label: 'Vision' });
    out.push({ key: 'ka', label: 'Kills + assists' });
    if (has((p) => p.stats?.gold)) out.push({ key: 'gold', label: 'Gold' });
    return out;
  });

  protected readonly rows = computed(() => {
    const ours = this.ours();
    const theirs = this.theirs();
    const n = Math.max(ours.length, theirs.length);
    return Array.from({ length: n }, (_, i) => ({ ours: ours[i], theirs: theirs[i] }));
  });

  private pick(p: RowPlayer, metric: Metric): number | undefined {
    const s = p.stats;
    if (!s) return undefined;
    switch (metric) {
      case 'damage':
        return s.damage;
      case 'taken':
        return s.damageTaken;
      case 'cs':
        return s.cs;
      case 'vision':
        return s.vision;
      case 'ka':
        return s.kills + s.assists;
      case 'gold':
        return s.gold;
      default:
        return undefined;
    }
  }

  /** The longest bar on the page, over both teams and, for dealt vs taken, both figures. */
  private readonly max = computed(() => {
    const m = this.metric();
    const keys: Metric[] = m === 'both' ? ['damage', 'taken'] : [m];
    let max = 0;
    for (const p of this.everyone()) for (const key of keys) max = Math.max(max, this.pick(p, key) ?? 0);
    return max;
  });

  protected values(p: RowPlayer): (number | undefined)[] {
    const m = this.metric();
    return m === 'both' ? [this.pick(p, 'damage'), this.pick(p, 'taken')] : [this.pick(p, m)];
  }

  protected width(v: number | undefined): number {
    const max = this.max();
    return v === undefined || !max ? 0 : Math.max(1, (v / max) * 100);
  }

  protected label(p: RowPlayer): string {
    const m = this.metric();
    const big = m === 'damage' || m === 'taken' || m === 'both' || m === 'gold';
    const fmt = (v: number | undefined) => (v === undefined ? '—' : big && v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v));
    return this.values(p).map(fmt).join(' / ');
  }
}
