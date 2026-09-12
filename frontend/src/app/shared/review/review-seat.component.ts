import { Component, computed, inject, input, signal } from '@angular/core';
import { AnalysisGame, GameReview, ReviewPoint } from '../../models/team.models';
import { gamePlayerFor, playerStatLine } from '../../core/review-view';
import { UiService } from '../../services/ui.service';
import { ReviewPointComponent } from './review-point.component';
import { TooltipDirective } from '../tooltip.directive';

type ReviewPlayer = GameReview['players'][number];

/**
 * One seat of a review, in two sizes.
 *
 * The block is the champion's face, who played it, the figures the game actually holds, the one
 * thing to work on under a heading that says so, and — behind a pill that looks like a pill — what
 * they did well and the further points. Everybody else is one line of the same `app-review-point`
 * shape the team's points wear.
 *
 * Rebuilt for readability on 12 Sep 2026, the lead: *"its hard to read… not sure where to click or
 * what to read, so can we redesign it to be better readable and let the user be guided to what to
 * know and what to click on"*. Four things were wrong and each had the same cause — nothing on the
 * row said what it was:
 *
 * - **Two faces side by side**, the champion's square and the player's round mark, for one person.
 *   One face now; the name is written beside it, which is what the second face was for.
 * - **A row of chips under no heading.** Figures with nothing naming them are a puzzle, however
 *   scannable they are. They sit under **Work on** now, the same label the team view uses.
 * - **A fold that did not look like one.** It was a `<summary>` in small capitals with a disclosure
 *   triangle; it is a pill button with a chevron now, which is what everything else clickable in
 *   this app is, and it says what opening it will show.
 * - **No mark of whose seat it is.** The reader's own carries a You badge and the accent ring; the
 *   other four are plain, so the eye lands on the right one without hunting for a name.
 */
@Component({
  selector: 'app-review-seat',
  imports: [ReviewPointComponent, TooltipDirective],
  template: `
    @if (mine()) {
      <div class="review-seat" [class.is-own]="own()">
        <div class="review-seat-head">
          <img class="review-seat-face" [src]="ui.championIconUrl(player().champion)" alt="" loading="lazy" />
          <span class="review-seat-who">
            <b class="review-seat-name">{{ player().name }}</b>
            @if (own()) { <span class="review-seat-you" appTip="The seat you picked in the film room">You</span> }
            <small class="review-seat-role">{{ player().seat }} · {{ ui.championName(player().champion) }}</small>
          </span>
          @if (statBits().length) {
            <span class="review-seat-stats" appTip="Straight off the game, not off the review">
              @for (s of statBits(); track $index) { <span class="review-seat-stat">{{ s }}</span> }
            </span>
          }
        </div>

        <h5 class="review-group-label is-warn">Work on</h5>
        <app-review-point [point]="player().workOn" tone="warn" [timed]="timed()" />

        @if (strength() || more().length) {
          <button type="button" class="view-btn review-seat-fold" (click)="open.set(!open())" [attr.aria-expanded]="open()">
            <span class="material-symbols-rounded" aria-hidden="true">{{ open() ? 'expand_less' : 'expand_more' }}</span>
            {{ open() ? 'Hide the rest' : foldLabel() }}
          </button>
          @if (open()) {
            @if (strength(); as s) {
              <h5 class="review-group-label is-ok">What went well</h5>
              <app-review-point [point]="s" tone="ok" [timed]="timed()" />
            }
            @if (more().length) {
              <h5 class="review-group-label is-warn">More to work on</h5>
              @for (m of more(); track $index) {
                <app-review-point [point]="m" tone="warn" [timed]="timed()" />
              }
            }
          }
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
   * Whether this seat is the reader's. Separate from `mine`: `mine` is "how much of it to draw" and
   * `own` is "whose it is". Only `own` gets the ring and the badge — five ringed blocks ring nothing.
   */
  readonly own = input<boolean>(false);
  readonly timed = input<boolean>(false);

  protected readonly ui = inject(UiService);

  /** Shut to start: the ask is the point of the block, and five open blocks is the wall this replaced. */
  protected readonly open = signal(false);

  protected readonly stats = computed(() =>
    playerStatLine(gamePlayerFor(this.game(), this.player().seat, this.player().name, this.player().champion))
  );

  /**
   * The stat line split at its own separator (12 Sep 2026, the lead: "lets make the cs and vision a
   * bit more visible"). As one muted string the farm and the vision were the hardest figures on the
   * block to find, which is backwards — they are the two a coach checks first. Each stands in its
   * own quiet box now, the same shape the evidence chips use, so the eye can land on one.
   */
  protected readonly statBits = computed(() => this.stats().split(' · ').filter(Boolean));

  /** What they did well, and the further work-ons — the two the panel showed nowhere until 12 Sep 2026. */
  protected readonly strength = computed<ReviewPoint | undefined>(() => {
    const s = this.player().strength;
    return s?.text ? s : undefined;
  });
  protected readonly more = computed<ReviewPoint[]>(() => (this.player().more ?? []).filter((m) => m?.text));

  /** What the pill promises, so pressing it is never a guess: "What went well + 3 more to work on". */
  protected readonly foldLabel = computed(() => {
    const rest = this.more().length;
    const bits = [this.strength() ? 'What went well' : '', rest ? `${rest} more to work on` : ''].filter(Boolean);
    return bits.join(' + ');
  });
}
