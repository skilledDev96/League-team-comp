import { Component, computed, input } from '@angular/core';
import { decidedByOf } from '../../core/review-view';
import { GameReview } from '../../models/team.models';
import { FilmGlyphComponent } from '../film/film-glyph.component';
import { TooltipDirective } from '../tooltip.directive';

/**
 * What decided the game, as one glyph and one word (12 Sep 2026).
 *
 * The first thing the review panel shows, and the largest. The lead's complaint about the old panel
 * was that he had to read it to find out what he was looking at: *"I want to look at something and
 * instantly know what its about, not wonder what am I looking at."* An eight-word headline is still
 * a sentence to read. A glyph and a word is not.
 *
 * It renders **nothing at all** when there is no theme to name — a review with no work-ons, or a
 * point that carries none, since `ReviewPoint.theme` is optional in the type even though every
 * stored review has one. A blank glyph over an empty word reads as a thing that failed to load,
 * which is worse than an honest absence.
 *
 * Its own component rather than inline markup because the Reviews tab card shows the same thing
 * about the same review, and two copies of a verdict is how two surfaces end up disagreeing.
 */
@Component({
  selector: 'app-decided-by',
  imports: [FilmGlyphComponent, TooltipDirective],
  template: `
    @if (decided(); as d) {
      <p class="review-decided" [appTip]="d.tip">
        <app-film-glyph [name]="d.glyph" [size]="1.6" />
        <span class="review-decided-label">Decided by</span>
        <b class="review-decided-word">{{ d.word }}</b>
      </p>
    }
  `
})
export class DecidedByComponent {
  readonly review = input<GameReview | undefined>(undefined);

  protected readonly decided = computed(() => decidedByOf(this.review()));
}
