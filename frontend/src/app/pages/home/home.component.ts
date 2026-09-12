import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { buildHome } from '../../core/home-build';
import { SeasonMode, seasonWindow } from '../../core/team-season';
import { MotionService } from '../../services/motion.service';
import { TeamDataService } from '../../services/team-data.service';
import { UserPrefsService } from '../../services/user-prefs.service';
import { HomeHeroComponent } from './home-hero.component';
import { HomeRaceComponent } from './home-race.component';
import { HomeSpotlightComponent } from './home-spotlight.component';
import { HomeTilesComponent } from './home-tiles.component';
import { HomeWelcomeComponent } from './home-welcome.component';

const SEASON_KEY = 'bom-home-season';
const SEAT_DISMISSED_KEY = 'bom-home-seat-dismissed';

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the signal holds for this visit */
  }
}

/**
 * Home, the landing page (13 Sep 2026, the lead: "this is the home page, the landing spot… a welcoming
 * page for our team with animations, stats with graphs, splash art… highlight a team member who has been
 * the MVP of the previous series to create some inner competition").
 *
 * The shell builds the whole page once through `buildHome` and hands each part its slice. Its own state
 * is small: the season switch (per browser, like the Patterns filters), whether the reader waved away
 * the seat question, and a clock that moves once a minute so a season that ends at midnight ends.
 *
 * Home is the one expressive page: its own stage instead of the page toolbar, still drawn entirely from
 * the theme tokens so every theme gets its own version. `is-still` switches every animation off at once.
 */
@Component({
  selector: 'app-home',
  imports: [HomeHeroComponent, HomeRaceComponent, HomeSpotlightComponent, HomeTilesComponent, HomeWelcomeComponent],
  template: `
    @let h = home();
    <div class="home" [class.is-still]="motion.reduced()">
      <app-home-hero
        [teamName]="h.teamName"
        [season]="h.season"
        [seasonWord]="seasonWord()"
        [mode]="mode()"
        [slides]="h.slides"
        [record]="h.record"
        [next]="h.next"
        (modeChange)="setMode($event)"
      />
      <app-home-welcome [welcome]="h.welcome" [scope]="scope()" (dismiss)="dismissSeat()" />
      <div class="home-duo">
        <app-home-spotlight [spotlight]="h.spotlight" [scope]="scope()" />
        <app-home-race [race]="h.race" [seasonLabel]="h.season.label" />
      </div>
      <!-- The tour's anchor stands outside the deferred block, so a step can find it before the chunk arrives. -->
      <section class="home-tiles" data-tour="home-tiles" aria-label="The season at a glance">
        @defer (on viewport; prefetch on idle) {
          <app-home-tiles [home]="h" [scope]="scope()" />
        } @placeholder {
          <div class="home-bento is-shell" aria-hidden="true">
            @for (cell of cells; track cell) {
              <div class="home-cell home-cell-{{ cell }}"><div class="card home-tile home-tile-shell"></div></div>
            }
          </div>
        } @loading (after 150ms; minimum 300ms) {
          <div class="home-bento is-shell" role="status" aria-label="Loading the season">
            @for (cell of cells; track cell) {
              <div class="home-cell home-cell-{{ cell }}"><div class="card home-tile home-tile-shell"></div></div>
            }
          </div>
        } @error {
          <div class="card home-tile-error" role="alert">
            <p><b>A newer version is live.</b> This tab was open while the site was updated, so this part of the page could not load.</p>
            <button type="button" class="view-btn home-pill" (click)="reload()"><span class="material-symbols-rounded" aria-hidden="true">refresh</span> Reload</button>
          </div>
        }
      </section>
    </div>
  `
})
export class HomeComponent {
  private readonly data = inject(TeamDataService);
  private readonly prefs = inject(UserPrefsService);
  protected readonly motion = inject(MotionService);

  /** The bento's cells, top to bottom: the placeholder draws each as an empty shell of the same size, so nothing moves when the tiles land. */
  protected readonly cells = ['podium', 'record', 'trend', 'comp', 'records', 'advice', 'lineup', 'objectives', 'trophies'] as const;

  protected readonly mode = signal<SeasonMode>(readStored(SEASON_KEY) === 'all' ? 'all' : 'season');
  private readonly seatDismissed = signal(readStored(SEAT_DISMISSED_KEY) === '1');
  private readonly now = signal(Date.now());

  protected readonly home = computed(() => {
    const now = this.now();
    return buildHome({
      now,
      hour: new Date(now).getHours(),
      mode: this.mode(),
      seat: this.prefs.filmSeat(),
      seatDismissed: this.seatDismissed(),
      teamName: this.data.settings().teamName || 'Bom Squad',
      players: this.data.players(),
      comps: this.data.comps(),
      analysis: this.data.compAnalysis()?.games ?? [],
      tournaments: this.data.tournaments(),
      series: this.data.tournamentSeries(),
      seriesGames: this.data.seriesGames(),
      scrims: this.data.scrims(),
      practice: this.data.practiceSet(),
      compOverride: (id) => this.data.compOverride(id)
    });
  });

  /** What the season switch calls the season, whichever side of it is showing. */
  protected readonly seasonWord = computed(() => (seasonWindow(this.data.tournaments(), this.now(), 'season').tournamentId ? 'This split' : 'Last 90 days'));

  /** The season in words that sit after a count: "3 games this split". */
  protected readonly scope = computed(() => {
    const season = this.home().season;
    if (season.mode === 'all') return 'all time';
    return season.tournamentId ? 'this split' : 'in the last 90 days';
  });

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected setMode(mode: SeasonMode): void {
    this.mode.set(mode);
    writeStored(SEASON_KEY, mode);
  }

  protected reload(): void {
    if (typeof location !== 'undefined') location.reload();
  }

  protected dismissSeat(): void {
    this.seatDismissed.set(true);
    writeStored(SEAT_DISMISSED_KEY, '1');
  }
}
