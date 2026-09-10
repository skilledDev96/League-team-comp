import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { buildFilm } from '../../core/film-build';
import { tallyLine } from '../../core/film-progress';
import { AnalysisGame, GameReview } from '../../models/team.models';
import { ReviewTakeoverService } from '../../services/review-takeover.service';
import { UiService } from '../../services/ui.service';
import { UserPrefsService } from '../../services/user-prefs.service';
import { TooltipDirective } from '../tooltip.directive';

/** Where a person left a film, per browser: the page writes the chapter index here and the poster reads it. */
export const FILM_CHAPTER_KEY = 'bom-film-chapter:';

/**
 * The poster for a review (9 Sep 2026): the protagonist's splash as a wide
 * strip under the stock's tint, and the pill that opens the film room. On the
 * Reviews tab card the headline sits over the art and the pill reads
 * "Continue · 3 of 4" or "Watched" from this person's progress; on a game
 * row the drawer bar already shows the headline, so the strip carries only
 * that progress line and the pill. Self-contained, so both can drop it in.
 * Since 10 Sep 2026 the pill is the row's one door to the film: it lights up
 * (`is-ready`) when a review landed while the takeover was minimised, and
 * pressing it clears the mark.
 */
@Component({
  selector: 'app-film-poster',
  imports: [TooltipDirective],
  template: `
    @let r = review();
    <div class="film-poster" [class]="'stock-' + stock()" [class.is-row]="size() === 'row'" [class.is-card]="size() === 'card'" [class.is-win]="win()" [class.is-loss]="!win()">
      <div class="film-poster-art" aria-hidden="true">
        @if (champion()) {
          <img class="film-splash" [src]="ui.championArtUrl(champion())" (error)="ui.artFallback($event, champion())" alt="" loading="lazy" />
        }
        <span class="film-poster-shade"></span>
      </div>
      <div class="film-poster-text">
        @if (size() === 'card') {
          <span class="film-poster-kicker">{{ win() ? 'Win' : 'Loss' }}@if (opponent()) { · vs {{ opponent() }} }</span>
          <span class="film-poster-headline">{{ headline() }}</span>
        } @else if (line()) {
          <span class="film-poster-kicker">{{ line() }}</span>
        }
      </div>
      <!-- The one door to the film (10 Sep 2026): a review that landed while the takeover was minimised lights this pill until it is pressed.
           A button, as every action is (10 Sep 2026, second fix pass: it was a routerLink styled as a pill). -->
      <button type="button" class="view-btn active film-poster-open" [class.is-ready]="takeover.ready(r.matchId)" (click)="openFilm(r.matchId)"
              [appTip]="takeover.ready(r.matchId) ? 'The film is ready' : 'The review as a film: the tape, the map, the one thing, the draft again, your seat, the card'">
        <span class="material-symbols-rounded" aria-hidden="true">movie</span>
        {{ (size() === 'card' && line()) || 'Open the film room' }}
      </button>
    </div>
  `
})
export class FilmPosterComponent {
  readonly review = input.required<GameReview>();
  readonly game = input<AnalysisGame | undefined>(undefined);
  readonly opponent = input<string | undefined>(undefined);
  /** A 5:1 strip on a game row, a 3:1 one on the Reviews tab card. */
  readonly size = input<'row' | 'card'>('row');

  protected readonly ui = inject(UiService);
  private readonly prefs = inject(UserPrefsService);
  private readonly router = inject(Router);
  /** The takeover's "ready" mark: the review landed while its stage was minimised, and this pill is where it is announced now that the row has one door (10 Sep 2026). */
  protected readonly takeover = inject(ReviewTakeoverService);

  /** The title card's model, without a timeline or a previous film: the protagonist and the headline need neither. */
  private readonly model = computed(() => buildFilm(this.review(), this.game(), null, null, this.opponent()));
  protected readonly champion = computed(() => this.model().title.protagonist.champion);
  protected readonly headline = computed(() => this.model().title.headline);
  protected readonly win = computed(() => this.model().title.win);
  /** The film's stock, so the row hints at the look before the film opens. */
  protected readonly stock = computed(() => this.model().style.stock);

  protected readonly line = computed(() => {
    const m = this.model();
    const progress = this.prefs.filmProgress(m.matchId);
    let at: number | undefined;
    try {
      const stored = localStorage.getItem(FILM_CHAPTER_KEY + m.matchId);
      if (stored !== null && Number.isInteger(Number(stored))) at = Number(stored);
    } catch {
      /* private mode: the pill says Continue without the count */
    }
    return tallyLine(progress, m.chapters.length, at);
  });

  /** Into the film room, clearing the takeover's landing mark on the way: this pill is where it was announced. */
  protected openFilm(matchId: string): void {
    this.takeover.clearReady(matchId);
    void this.router.navigate(['/film', matchId]);
  }
}
