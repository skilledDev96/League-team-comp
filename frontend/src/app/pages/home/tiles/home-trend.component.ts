import { Component, computed, input } from '@angular/core';
import { trendPath } from '../../../core/home-charts';
import { HomeTrend } from '../../../core/home-model';
import { TREND_WINDOW } from '../../../core/team-season';
import { InViewDirective } from '../../../shared/in-view.directive';
import { TooltipDirective } from '../../../shared/tooltip.directive';

const W = 320;
const H = 120;
const PAD = 8;
/** Fewer games than this and a rolling rate is noise, so the chart waits. */
const TREND_MIN_POINTS = 3;

/**
 * The form line (13 Sep 2026): a rolling win rate over the last ten games at each game, the even line
 * dashed across it, a dot a game in the result's colour and a flag where each finished series ended.
 * Undated games are counted in the record but cannot be put on a line, and the tile says how many.
 */
@Component({
  selector: 'app-home-trend',
  imports: [InViewDirective, TooltipDirective],
  template: `
    @let t = trend();
    <section class="card home-tile home-trend" appInView aria-labelledby="home-trend-title">
      <header class="home-card-head">
        <h2 id="home-trend-title"><span class="material-symbols-rounded" aria-hidden="true">show_chart</span> Form</h2>
        <span class="home-card-scope" [appTip]="'The win rate over the ' + window + ' games up to each game, oldest on the left'">Last {{ window }} games, rolling</span>
      </header>
      <figure class="home-trend-chart" [attr.aria-label]="summary()">
        <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" preserveAspectRatio="none" aria-hidden="true">
          <line class="home-trend-even" [attr.x1]="pad" [attr.x2]="w - pad" [attr.y1]="geometry().midY" [attr.y2]="geometry().midY" />
          @if (ready()) {
            @for (m of markers(); track m.key) {
              <line class="home-trend-flag" [class.is-win]="m.result === 'won'" [class.is-loss]="m.result === 'lost'" [attr.x1]="m.x" [attr.x2]="m.x" [attr.y1]="pad" [attr.y2]="h - pad" />
            }
            <path class="home-trend-line" [attr.d]="geometry().d" />
          }
        </svg>
        @if (ready()) {
          @for (d of dots(); track d.key) {
            <span class="home-trend-dot" [class.is-win]="d.win" [class.is-loss]="!d.win" [style.left.%]="d.left" [style.top.%]="d.top" aria-hidden="true"></span>
          }
          @for (m of markers(); track m.key) {
            <span class="home-trend-marker" [class.is-win]="m.result === 'won'" [class.is-loss]="m.result === 'lost'" [style.left.%]="m.left"
                  tabindex="0" [appTip]="m.tip"><span class="material-symbols-rounded" aria-hidden="true">flag</span><span class="visually-hidden">{{ m.tip }}</span></span>
          }
        } @else {
          <p class="home-trend-wait">Needs {{ min }} dated games to draw — {{ t.points.length }} so far.</p>
        }
      </figure>
      @if (t.undated) {
        <p class="home-tile-note">{{ t.undated }} undated {{ t.undated === 1 ? 'game is' : 'games are' }} in the record but not on the line.</p>
      }
    </section>
  `
})
export class HomeTrendComponent {
  readonly trend = input.required<HomeTrend>();

  protected readonly w = W;
  protected readonly h = H;
  protected readonly pad = PAD;
  protected readonly window = TREND_WINDOW;
  protected readonly min = TREND_MIN_POINTS;

  protected readonly ready = computed(() => this.trend().points.length >= TREND_MIN_POINTS);
  protected readonly geometry = computed(() => trendPath(this.trend().points, W, H, PAD));

  protected readonly dots = computed(() =>
    this.geometry().dots.map((d, i) => ({ key: this.trend().points[i].rowId, win: this.trend().points[i].win, left: (d.x / W) * 100, top: (d.y / H) * 100 }))
  );

  protected readonly markers = computed(() => {
    const dots = this.geometry().dots;
    return this.trend().markers.flatMap((m) => {
      const dot = dots[m.i];
      if (!dot) return [];
      const word = m.result === 'won' ? 'Won' : m.result === 'lost' ? 'Lost' : 'Drew';
      return [{ key: `${m.i}-${m.opponent}`, x: dot.x, left: (dot.x / W) * 100, result: m.result, tip: `${word} the series vs ${m.opponent}` }];
    });
  });

  protected readonly summary = computed(() => {
    const points = this.trend().points;
    if (points.length < TREND_MIN_POINTS) return 'Not enough games to draw the form yet';
    return `Rolling win rate from ${points[0].rate}% to ${points[points.length - 1].rate}% over ${points.length} games`;
  });
}
