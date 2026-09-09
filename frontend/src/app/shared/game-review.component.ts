import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { GameReview, ReviewTheme } from '../models/team.models';
import { InfoTipComponent } from './info-tip.component';
import { PlayerMarkComponent } from './player-mark.component';
import { TooltipDirective } from './tooltip.directive';

/**
 * A written review of one game: a headline on how it was decided, the
 * team's summary, what to work on and what to keep doing, each point tagged
 * with what it is about and the minute beside it, whether the comp played
 * out as drafted, and a card per player. Read-only; the button that writes
 * one lives on the row.
 */
@Component({
  selector: 'app-game-review',
  imports: [DatePipe, TooltipDirective, InfoTipComponent, PlayerMarkComponent],
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
        </div>
        @if (r.team.headline) { <h3 class="game-review-headline">{{ r.team.headline }}</h3> }
        @if (r.team.summary) { <p class="game-review-summary">{{ r.team.summary }}</p> }
        @if (r.team.compWhy) { <p class="muted game-review-why">{{ r.team.compWhy }}</p> }
        <div class="game-review-grid">
          @if (r.team.workOn.length) {
            <div class="game-review-col is-warn">
              <p class="advice-head is-warn">Work on</p>
              <ul class="game-review-points">
                @for (w of r.team.workOn; track $index) {
                  <li class="game-review-point">
                    @if (w.theme || w.minute !== null) {
                      <span class="game-review-point-tags">
                        @if (w.theme) { <span class="review-theme"><span class="material-symbols-rounded" aria-hidden="true">{{ icon(w.theme) }}</span>{{ w.theme }}</span> }
                        @if (w.minute !== null) { <span class="review-minute">{{ w.minute }} min</span> }
                      </span>
                    }
                    <span>{{ w.text }}</span>
                    <small class="advice-n">{{ w.evidence }}</small>
                  </li>
                }
              </ul>
            </div>
          }
          @if (r.team.keepDoing.length) {
            <div class="game-review-col is-ok">
              <p class="advice-head is-ok">Keep doing</p>
              <ul class="game-review-points">
                @for (k of r.team.keepDoing; track $index) {
                  <li class="game-review-point">
                    @if (k.theme || k.minute !== null) {
                      <span class="game-review-point-tags">
                        @if (k.theme) { <span class="review-theme"><span class="material-symbols-rounded" aria-hidden="true">{{ icon(k.theme) }}</span>{{ k.theme }}</span> }
                        @if (k.minute !== null) { <span class="review-minute">{{ k.minute }} min</span> }
                      </span>
                    }
                    <span>{{ k.text }}</span>
                    <small class="advice-n">{{ k.evidence }}</small>
                  </li>
                }
              </ul>
            </div>
          }
        </div>
        @if (r.players.length) {
          <div class="game-review-people">
            @for (p of r.players; track p.name) {
              <article class="game-review-person">
                <div class="game-review-person-head">
                  <app-player-mark [name]="p.name" />
                  <span><b>{{ p.name }}</b><small>{{ p.seat }} · {{ p.champion }}</small></span>
                </div>
                @if (p.strength.text) {
                  <p class="game-review-line is-ok"><b>Strength</b>{{ p.strength.text }} <small class="advice-n">{{ p.strength.evidence }}</small></p>
                }
                @if (p.workOn.text) {
                  <p class="game-review-line is-warn"><b>Work on</b>@if (p.workOn.minute !== null) { <span class="review-minute">{{ p.workOn.minute }} min</span> }{{ p.workOn.text }} <small class="advice-n">{{ p.workOn.evidence }}</small></p>
                }
              </article>
            }
          </div>
        }
        <p class="muted game-review-foot">
          Written {{ r.reviewedAt | date: 'd MMM, HH:mm' }} by {{ models() }} for about {{ cost() }}{{ r.trigger === 'auto' ? ', by the morning run' : '' }}.
          <app-info-tip text="Every point should match a fact in How the game went; if one does not, the review is wrong, not the game." label="How to read the review" />
        </p>
      </section>
    }
  `
})
export class GameReviewComponent {
  readonly review = input<GameReview | undefined>(undefined);

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
