import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { buildFilm } from '../../core/film-build';
import { tallyLine } from '../../core/film-progress';
import { AnalysisGame, GameReview } from '../../models/team.models';
import { UiService } from '../../services/ui.service';
import { UserPrefsService } from '../../services/user-prefs.service';

/** Where a person left a film, per browser: the page writes the chapter index here and the poster reads it. */
export const FILM_CHAPTER_KEY = 'bom-film-chapter:';

/**
 * The poster for a review (9 Sep 2026): the protagonist's splash as a wide
 * strip under the stock's tint, and the pill that opens the film room. On the
 * Reviews tab card the headline sits over the art and the pill reads
 * "Continue · 3 of 7" or "Watched · called 4 of 5" from this person's
 * progress; on a game row the drawer bar already shows the headline, so the
 * strip carries only the tally line and the pill. Self-contained, so both
 * can drop it in.
 */
@Component({
  selector: 'app-film-poster',
  imports: [RouterLink],
  template: `
    @let r = review();
    <div class="film-poster" [class.is-row]="size() === 'row'" [class.is-card]="size() === 'card'" [class.is-win]="win()" [class.is-loss]="!win()">
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
      <a class="view-btn active film-poster-open" [routerLink]="['/film', r.matchId]">
        <span class="material-symbols-rounded" aria-hidden="true">movie</span>
        {{ (size() === 'card' && line()) || 'Open the film room' }}
      </a>
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

  /** The title card's model, without a timeline or a previous film: the protagonist and the headline need neither. */
  private readonly model = computed(() => buildFilm(this.review(), this.game(), null, null, this.opponent()));
  protected readonly champion = computed(() => this.model().title.protagonist.champion);
  protected readonly headline = computed(() => this.model().title.headline);
  protected readonly win = computed(() => this.model().title.win);

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
}
