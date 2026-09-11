import { Component, computed, inject, input } from '@angular/core';
import { AnalysisGame, GameReview, ReviewPoint } from '../../models/team.models';
import { gamePlayerFor, playerStatLine } from '../../core/review-view';
import { UiService } from '../../services/ui.service';
import { PlayerMarkComponent } from '../player-mark.component';
import { ReviewPointComponent } from './review-point.component';
import { TooltipDirective } from '../tooltip.directive';

type ReviewPlayer = GameReview['players'][number];

/**
 * One seat of a review (12 Sep 2026), in two sizes.
 *
 * The viewer's own seat is the block: the champion, the figures the game actually holds
 * (`3/8/3 · 218 CS · vision 29 · 43% KP`, straight off the analysed game rather than off the
 * model's prose), their one ask, and — behind a single fold — what they did well and the further
 * points the review wrote for them. Those last two have been stored since review version 3 and the
 * panel has never shown either; the film room was the only way to reach them.
 *
 * Everybody else is one line, the same `app-review-point` shape the team's points wear. A reader
 * opening a review is looking for their own name first and the other four as context, which is the
 * whole reason the panel now has a Team / My seat switch instead of five equal rows.
 */
@Component({
  selector: 'app-review-seat',
  imports: [PlayerMarkComponent, ReviewPointComponent, TooltipDirective],
  template: `
    @if (mine()) {
      <div class="review-seat" [class.is-own]="own()">
        <div class="review-seat-head">
          <img class="player-mark is-champ" [src]="ui.championIconUrl(player().champion)" alt="" loading="lazy" />
          <app-player-mark [name]="player().name" />
          <b class="review-seat-name">{{ player().name }}</b>
          <span class="review-seat-role">{{ player().seat }} · {{ ui.championName(player().champion) }}</span>
          @if (stats()) { <span class="review-seat-stats">{{ stats() }}</span> }
        </div>
        <app-review-point [point]="player().workOn" tone="warn" [timed]="timed()" />
        @if (folded().length) {
          <details class="review-seat-more">
            <summary>{{ foldLabel() }}</summary>
            @for (p of folded(); track $index) {
              <app-review-point [point]="p.point" [tone]="p.tone" [timed]="timed()" />
            }
          </details>
        }
      </div>
    } @else {
      <app-review-point [point]="player().workOn" tone="person" [timed]="timed()">
        <img class="player-mark is-champ" [src]="ui.championIconUrl(player().champion)" alt="" loading="lazy" />
        <b [appTip]="player().seat + ' · ' + ui.championName(player().champion)">{{ player().name }}</b>
      </app-review-point>
    }
  `
})
export class ReviewSeatComponent {
  readonly player = input.required<ReviewPlayer>();
  /** The analysed game, for the figures. A game the analysis no longer carries simply has no stat line. */
  readonly game = input<AnalysisGame | undefined>(undefined);
  /** Whether to draw the block rather than the one-line row. */
  readonly mine = input<boolean>(false);
  /**
   * Whether this seat is the reader's. Separate from `mine` since 12 Sep 2026, when an admin gained
   * the option of every seat as a block: `mine` is now "how much of it to draw" and `own` is "whose
   * it is", and only `own` gets the accent ring. Five equally ringed blocks ring nothing.
   */
  readonly own = input<boolean>(false);
  readonly timed = input<boolean>(false);

  protected readonly ui = inject(UiService);

  protected readonly stats = computed(() =>
    playerStatLine(gamePlayerFor(this.game(), this.player().seat, this.player().name, this.player().champion))
  );

  /** What they did well, then the further work-ons — the two the panel has never shown. */
  protected readonly folded = computed<{ point: ReviewPoint; tone: 'ok' | 'warn' }[]>(() => {
    const p = this.player();
    const out: { point: ReviewPoint; tone: 'ok' | 'warn' }[] = [];
    if (p.strength?.text) out.push({ point: p.strength, tone: 'ok' });
    for (const m of p.more ?? []) if (m?.text) out.push({ point: m, tone: 'warn' });
    return out;
  });

  protected readonly foldLabel = computed(() => {
    const more = this.folded().length - (this.player().strength?.text ? 1 : 0);
    const strength = this.player().strength?.text ? 'What went well' : '';
    const rest = more ? `${more} more to work on` : '';
    return [strength, rest].filter(Boolean).join(' · ');
  });
}
