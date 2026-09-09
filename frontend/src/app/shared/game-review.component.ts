import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { AnalysisGame, GameReview, ReviewPoint, ReviewTheme } from '../models/team.models';
import { evidenceChips, playerStatLine, reviewAsText, scoreline } from '../core/review-view';
import { ToastService } from '../services/toast.service';
import { UiService } from '../services/ui.service';
import { InfoTipComponent } from './info-tip.component';
import { PlayerMarkComponent } from './player-mark.component';
import { TooltipDirective } from './tooltip.directive';

/**
 * A written review of one game (9 Sep 2026): the headline on how it was
 * decided over the scoreline every point refers to, the first thing to fix
 * next game as a callout, the other points in two content-sized columns,
 * and a row per player with their stat line beside the notes. Read-only,
 * apart from copying itself as text for the team chat; the button that
 * writes a review lives on the row.
 */
@Component({
  selector: 'app-game-review',
  imports: [DatePipe, NgTemplateOutlet, TooltipDirective, InfoTipComponent, PlayerMarkComponent],
  template: `
    @if (review(); as r) {
      <section class="game-review" aria-label="Game review">
        <div class="game-review-head">
          <span class="material-symbols-rounded" aria-hidden="true">auto_awesome</span>
          <strong>Review</strong>
          <span class="tag" [appTip]="r.tier === 'timeline' ? 'Read from Riot\\'s minute-by-minute timeline' : 'A replay carries end-of-game totals only; nothing here is timed'">
            {{ r.tier === 'timeline' ? 'From the timeline' : 'End-of-game totals only' }}
          </span>
          <span class="game-review-verdict" [class.is-good]="r.team.compVerdict === 'as drafted'" [class.is-bad]="r.team.compVerdict === 'off plan'"
                [appTip]="r.team.compWhy || 'Whether the comp did what its four axes and game plan expected'">
            {{ r.compName ? r.compName + ': ' : 'Comp: ' }}{{ r.team.compVerdict }}
          </span>
          <button type="button" class="view-btn game-review-copy" (click)="copy()" appTip="Copies the headline, the points and every player's note as text, ready to paste in the team chat">
            <span class="material-symbols-rounded" aria-hidden="true">content_copy</span> Copy for Discord
          </button>
        </div>

        @if (r.team.headline) { <h3 class="game-review-headline">{{ r.team.headline }}</h3> }
        @if (score().length) {
          <ul class="list-clean game-review-scoreline" aria-label="Scoreline">
            @for (c of score(); track c.label) {
              <li class="score-chip" [class.is-good]="c.good === true" [class.is-bad]="c.good === false">
                @if (c.ours) { <small>{{ c.label }}</small><b>{{ c.ours }}</b>@if (c.theirs) { <em>–{{ c.theirs }}</em> } } @else { <b>{{ c.label }}</b> }
              </li>
            }
          </ul>
        }
        @if (r.team.summary) { <p class="game-review-summary">{{ r.team.summary }}</p> }
        @if (r.team.compWhy) { <p class="muted game-review-why">{{ r.team.compWhy }}</p> }

        @if (first(); as f) {
          <div class="game-review-first">
            <p class="advice-head is-warn">First thing next game</p>
            <ng-container *ngTemplateOutlet="pointTpl; context: { $implicit: f }" />
          </div>
        }
        @if (rest().length || r.team.keepDoing.length) {
          <div class="game-review-grid" [class.is-single]="!rest().length">
            @if (rest().length) {
              <div class="game-review-col is-warn">
                <p class="advice-head is-warn">Also work on</p>
                <ul class="game-review-points">
                  @for (w of rest(); track $index) { <li class="game-review-point"><ng-container *ngTemplateOutlet="pointTpl; context: { $implicit: w }" /></li> }
                </ul>
              </div>
            }
            @if (r.team.keepDoing.length) {
              <div class="game-review-col is-ok">
                <p class="advice-head is-ok">Keep doing</p>
                <ul class="game-review-points">
                  @for (k of r.team.keepDoing; track $index) { <li class="game-review-point"><ng-container *ngTemplateOutlet="pointTpl; context: { $implicit: k }" /></li> }
                </ul>
              </div>
            }
          </div>
        }

        @if (r.players.length) {
          <div class="game-review-people" role="table" aria-label="Player notes">
            @for (p of r.players; track p.name) {
              <div class="game-review-person" role="row">
                <div class="person-head" role="cell">
                  <span class="person-avatar">
                    <app-player-mark [name]="p.name" />
                    <img class="champ-badge" [src]="ui.championIconUrl(p.champion)" [alt]="p.champion" loading="lazy" />
                  </span>
                  <span class="person-text">
                    <b>{{ p.name }}</b>
                    <small>{{ p.seat }} · {{ p.champion }}</small>
                    @if (stats(p.name); as line) { <span class="person-stats">{{ line }}</span> }
                  </span>
                </div>
                <div class="game-review-line is-ok" role="cell">
                  <b>Strength</b>
                  @if (p.strength.text) { <span>{{ p.strength.text }}</span> <ng-container *ngTemplateOutlet="chipsTpl; context: { $implicit: p.strength.evidence }" /> } @else { <span class="muted">—</span> }
                </div>
                <div class="game-review-line is-warn" role="cell">
                  <b>Work on</b>
                  @if (p.workOn.text) {
                    <span>@if (p.workOn.minute !== null) { <span class="review-minute">{{ p.workOn.minute }} min</span> }{{ p.workOn.text }}</span>
                    <ng-container *ngTemplateOutlet="chipsTpl; context: { $implicit: p.workOn.evidence }" />
                  } @else { <span class="muted">—</span> }
                </div>
              </div>
            }
          </div>
        }

        <p class="muted game-review-foot">
          Written {{ r.reviewedAt | date: 'd MMM, HH:mm' }} by {{ models() }} for about {{ cost() }}{{ r.trigger === 'auto' ? ', by the morning run' : '' }}.
          <app-info-tip text="Every point should match a fact in How the game went; if one does not, the review is wrong, not the game." label="How to read the review" />
        </p>
      </section>

      <ng-template #pointTpl let-p>
        @if (p.theme || p.minute !== null) {
          <span class="game-review-point-tags">
            @if (p.theme) { <span class="review-theme"><span class="material-symbols-rounded" aria-hidden="true">{{ icon(p.theme) }}</span>{{ p.theme }}</span> }
            @if (p.minute !== null) { <span class="review-minute">{{ p.minute }} min</span> }
          </span>
        }
        <span class="game-review-point-text">{{ p.text }}</span>
        <ng-container *ngTemplateOutlet="chipsTpl; context: { $implicit: p.evidence }" />
      </ng-template>

      <ng-template #chipsTpl let-evidence>
        @if (chips(evidence); as list) {
          @if (list.length) {
            <span class="evidence-chips">
              @for (c of list; track $index) { <span class="evidence-chip">{{ c }}</span> }
            </span>
          }
        }
      </ng-template>
    }
  `
})
export class GameReviewComponent {
  readonly review = input<GameReview | undefined>(undefined);
  /** The game the review is about, for the scoreline and each player's stat line. */
  readonly game = input<AnalysisGame | undefined>(undefined);
  readonly opponent = input<string | undefined>(undefined);

  protected readonly ui = inject(UiService);
  private readonly toast = inject(ToastService);

  private static readonly ICONS: Record<ReviewTheme, string> = {
    draft: 'swords',
    lanes: 'alt_route',
    fights: 'local_fire_department',
    objectives: 'flag',
    vision: 'visibility',
    tempo: 'schedule',
    macro: 'map'
  };

  protected icon(theme: ReviewTheme): string {
    return GameReviewComponent.ICONS[theme] ?? 'label';
  }

  protected readonly score = computed(() => scoreline(this.game()));
  protected readonly first = computed<ReviewPoint | undefined>(() => this.review()?.team.workOn[0]);
  protected readonly rest = computed<ReviewPoint[]>(() => this.review()?.team.workOn.slice(1) ?? []);

  protected chips(evidence: string): string[] {
    return evidenceChips(evidence ?? '');
  }

  protected stats(name: string): string {
    return playerStatLine(this.game()?.players.find((p) => p.name === name));
  }

  protected async copy(): Promise<void> {
    const r = this.review();
    if (!r) return;
    try {
      await navigator.clipboard.writeText(reviewAsText(r, this.game(), this.opponent()));
      this.toast.show('Review copied', { kind: 'ok', icon: 'content_copy', text: 'Paste it in the team chat; the headline, the points and every player’s note are in it.' });
    } catch {
      this.toast.show('Could not copy', { kind: 'warn', text: 'The browser refused the clipboard; select the text and copy it by hand.' });
    }
  }

  protected readonly models = computed(() => {
    const r = this.review();
    if (!r) return '';
    const short = (m: string) => m.replace(/^claude-/, '').replace(/-\d{8}$/, '');
    return r.models.team === r.models.players ? short(r.models.team) : `${short(r.models.team)} and ${short(r.models.players)}`;
  });

  protected readonly cost = computed(() => {
    const usd = this.review()?.usage.costUsd ?? 0;
    return usd < 0.01 ? 'a cent' : `${Math.round(usd * 100)} cents`;
  });
}
