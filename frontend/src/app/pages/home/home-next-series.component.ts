import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { countdownOf } from '../../core/countdown';
import { HomeEndedSplit, HomeNextSeries } from '../../core/home-model';
import { AuthService } from '../../services/auth.service';
import { PageVisibilityService } from '../../services/page-visibility.service';
import { UiService } from '../../services/ui.service';
import { TournamentContextService } from '../tournaments/tournament-context.service';

/**
 * The next opponent, in the corner of the hero (13 Sep 2026).
 *
 * One pill for everyone, **Scout them**, and it opens that series' prep on Prep & Draft's Plan view — the
 * same door the draft room's Opponent prep pill uses. It never opens the draft room: the lead asked for
 * scouting from here, and a draft room opened from a landing page is a game created by accident.
 *
 * The countdown ticks once a second, only while the tab is looked at and only for a kick-off that has a
 * time of day; a bare date or free text prints as it was typed and counts nothing down.
 *
 * There are two empty cases (21 Sep 2026), and telling them apart is the point: nothing is scheduled yet,
 * or the split is over. An ended tournament never reaches the first branch at all — `nextOpenSeries` will
 * not name a series of one — so the rung says the season is finished and says when, instead of asking
 * somebody to add an opponent to a league that has already been played.
 */
@Component({
  selector: 'app-home-next-series',
  template: `
    <div class="home-next" [class.is-empty]="!next()" [class.is-ended]="!next() && !!ended()" [class.is-live]="countdown()?.live">
      @if (next(); as n) {
        <p class="home-kicker">
          @if (countdown()?.live) { <span class="home-live-dot" aria-hidden="true"></span> Live now } @else { Next series }
        </p>
        <p class="home-next-vs"><span class="home-next-vs-word">vs</span> {{ n.opponent }}</p>
        <p class="home-next-meta">
          @if (n.tournament) { {{ n.tournament }} · }Bo{{ n.bestOf }}@if (n.when) { · {{ ui.formatDayTime(n.when) }} }
        </p>
        @if (countdown(); as c) {
          @if (!c.live) {
            <div class="home-countdown" role="timer" [attr.aria-label]="label()">
              <span class="home-countdown-unit"><b>{{ c.days }}</b><small>days</small></span>
              <span class="home-countdown-unit"><b>{{ pad(c.hours) }}</b><small>hrs</small></span>
              <span class="home-countdown-unit"><b>{{ pad(c.minutes) }}</b><small>min</small></span>
              <span class="home-countdown-unit"><b>{{ pad(c.seconds) }}</b><small>sec</small></span>
            </div>
          }
        }
        <button type="button" class="view-btn home-next-pill" (click)="scout(n.seriesId)">
          <span class="material-symbols-rounded" aria-hidden="true">travel_explore</span> Scout them
        </button>
      } @else if (ended(); as e) {
        <p class="home-kicker">Season over</p>
        <p class="home-next-vs">{{ e.name }} is finished</p>
        <p class="home-next-meta">
          Ended {{ ui.formatDay(e.endedAt) }}@if (e.finish) { · {{ e.finish }} }
        </p>
        <p class="home-next-meta home-next-finish">
          Every game of it still counts.@if (canEdit()) { Add the next tournament on Admin &rsaquo; Tournaments and it counts down here. }
        </p>
        <button type="button" class="view-btn home-next-pill" (click)="openPlan()">
          <span class="material-symbols-rounded" aria-hidden="true">event</span> Open Prep &amp; Draft
        </button>
      } @else {
        <p class="home-kicker">Next series</p>
        <p class="home-next-vs">No series scheduled yet</p>
        <p class="home-next-meta">Add the next opponent on Prep &amp; Draft and it counts down here.</p>
        <button type="button" class="view-btn home-next-pill" (click)="openPlan()">
          <span class="material-symbols-rounded" aria-hidden="true">event</span> Open Prep &amp; Draft
        </button>
      }
    </div>
  `
})
export class HomeNextSeriesComponent {
  readonly next = input<HomeNextSeries | null>(null);
  /**
   * The split that has ended, when that is why nothing is next (21 Sep 2026). Read only in the empty
   * case: "No series scheduled yet" read as somebody forgetting to type the schedule in, when the honest
   * answer was that the league was over.
   */
  readonly ended = input<HomeEndedSplit | null>(null);

  protected readonly ui = inject(UiService);
  /**
   * Whether the reader can do the thing the ended rung names (21 Sep 2026, review fix). A tournament is added
   * on Admin › Tournaments and nowhere else — Prep & Draft has no add-tournament control — so the sentence
   * says Admin, and a viewer who cannot reach Admin is told nothing to do rather than sent somewhere useless.
   */
  protected readonly canEdit = inject(AuthService).canEdit;
  private readonly router = inject(Router);
  private readonly ctx = inject(TournamentContextService);
  private readonly visibility = inject(PageVisibilityService);

  private readonly now = signal(Date.now());
  protected readonly countdown = computed(() => countdownOf(this.next()?.at ?? null, this.now()));
  protected readonly label = computed(() => {
    const c = this.countdown();
    if (!c) return '';
    const part = (n: number, word: string) => (n ? `${n} ${word}${n === 1 ? '' : 's'}` : '');
    return ['Starts in', part(c.days, 'day'), part(c.hours, 'hour'), part(c.minutes, 'minute')].filter(Boolean).join(' ');
  });

  constructor() {
    effect((onCleanup) => {
      if (this.next()?.at == null || !this.visibility.visible()) return;
      this.now.set(Date.now());
      const timer = setInterval(() => this.now.set(Date.now()), 1000);
      onCleanup(() => clearInterval(timer));
    });
  }

  protected pad(n: number): string {
    return String(n).padStart(2, '0');
  }

  protected scout(seriesId: string): void {
    this.ctx.openPrep(seriesId);
    void this.router.navigate(['/tournaments'], { queryParams: { view: 'plan' } });
  }

  protected openPlan(): void {
    void this.router.navigate(['/tournaments'], { queryParams: { view: 'plan' } });
  }
}
