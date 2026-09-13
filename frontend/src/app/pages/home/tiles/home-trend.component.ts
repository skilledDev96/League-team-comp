import { Component, computed, input } from '@angular/core';
import { trendPath } from '../../../core/home-charts';
import { HomeTrend } from '../../../core/home-model';
import { TREND_WINDOW } from '../../../core/team-season';
import { InfoTipComponent } from '../../../shared/info-tip.component';
import { InViewDirective } from '../../../shared/in-view.directive';
import { TooltipDirective } from '../../../shared/tooltip.directive';

const W = 320;
const H = 120;
const PAD = 8;
/** Fewer games than this and a rolling rate is noise, so the chart waits. */
const TREND_MIN_POINTS = 3;
/**
 * How many games the line spans (13 Sep 2026, the lead: "the form graph is a bit unclear"). All time
 * drew all 154 games as dots, which read as noise; form is the recent stretch, so the line shows the
 * last thirty and the headline the last ten.
 */
export const FORM_SPAN = 30;

/**
 * Form (13 Sep 2026): how many of the last ten games we won, as a figure and a strip of results, over a
 * line of the win rate across the last thirty — each point the share of the ten games up to it, so the
 * line rises through a good run and falls through a bad one without jumping on every result. The 50%
 * line is labelled, and a flag marks where a finished series ended.
 */
@Component({
  selector: 'app-home-trend',
  imports: [InfoTipComponent, InViewDirective, TooltipDirective],
  template: `
    @let t = trend();
    <section class="card home-tile home-trend" appInView aria-labelledby="home-trend-title">
      <header class="home-card-head">
        <h2 id="home-trend-title"><span class="material-symbols-rounded" aria-hidden="true">show_chart</span> Form
          <app-info-tip [text]="'The figure is the last ' + window + ' games. The line is the last ' + span + ': each point is the share of the ' + window + ' games up to that game that we won, so it climbs through a winning run and drops through a losing one. A flag marks the end of a finished series.'" label="How to read the form" />
        </h2>
        <span class="home-card-scope">Last {{ recent().length }} games</span>
      </header>
      @if (ready()) {
        <div class="home-form-head">
          <p class="home-form-figure"><b>{{ lastTen().wins }}</b><span>of the last {{ lastTen().games }} won</span></p>
          <ol class="home-form-strip" aria-label="The last ten results, oldest first">
            @for (r of lastTen().results; track $index) {
              <li [class.is-win]="r" [class.is-loss]="!r"><span class="visually-hidden">{{ r ? 'Win' : 'Loss' }}</span></li>
            }
          </ol>
        </div>
      }
      <figure class="home-trend-chart" [attr.aria-label]="summary()">
        <span class="home-trend-axis" style="top: 0%">100%</span>
        <span class="home-trend-axis" [style.top.%]="(geometry().midY / h) * 100">50%</span>
        <span class="home-trend-axis" style="top: 100%">0%</span>
        <div class="home-trend-plot">
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
            @if (lastDot(); as d) {
              <span class="home-trend-now" [style.left.%]="d.left" [style.top.%]="d.top" aria-hidden="true"></span>
            }
            @for (m of markers(); track m.key) {
              <span class="home-trend-marker" [class.is-win]="m.result === 'won'" [class.is-loss]="m.result === 'lost'" [style.left.%]="m.left"
                    tabindex="0" [appTip]="m.tip"><span class="material-symbols-rounded" aria-hidden="true">flag</span><span class="visually-hidden">{{ m.tip }}</span></span>
            }
          } @else {
            <p class="home-trend-wait">Needs {{ min }} dated games to draw — {{ t.points.length }} so far.</p>
          }
        </div>
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
  protected readonly span = FORM_SPAN;
  protected readonly min = TREND_MIN_POINTS;

  /** The last thirty points; the rolling rates in them still read the games before the first. */
  protected readonly recent = computed(() => this.trend().points.slice(-FORM_SPAN));
  private readonly offset = computed(() => this.trend().points.length - this.recent().length);

  protected readonly ready = computed(() => this.recent().length >= TREND_MIN_POINTS);
  protected readonly geometry = computed(() => trendPath(this.recent(), W, H, PAD));

  protected readonly lastTen = computed(() => {
    const games = this.trend().points.slice(-TREND_WINDOW);
    return { games: games.length, wins: games.filter((p) => p.win).length, results: games.map((p) => p.win) };
  });

  protected readonly lastDot = computed(() => {
    const dots = this.geometry().dots;
    const d = dots[dots.length - 1];
    return d ? { left: (d.x / W) * 100, top: (d.y / H) * 100 } : null;
  });

  protected readonly markers = computed(() => {
    const dots = this.geometry().dots;
    return this.trend().markers.flatMap((m) => {
      const dot = dots[m.i - this.offset()];
      if (!dot) return [];
      const word = m.result === 'won' ? 'Won' : m.result === 'lost' ? 'Lost' : 'Drew';
      return [{ key: `${m.i}-${m.opponent}`, x: dot.x, left: (dot.x / W) * 100, result: m.result, tip: `${word} the series vs ${m.opponent}` }];
    });
  });

  protected readonly summary = computed(() => {
    const points = this.recent();
    if (points.length < TREND_MIN_POINTS) return 'Not enough games to draw the form yet';
    const ten = this.lastTen();
    return `${ten.wins} of the last ${ten.games} won; the ten-game win rate went from ${points[0].rate}% to ${points[points.length - 1].rate}% over the last ${points.length} games`;
  });
}
