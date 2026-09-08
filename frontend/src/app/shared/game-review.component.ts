import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { GameReview } from '../models/team.models';
import { TooltipDirective } from './tooltip.directive';

/**
 * A written review of one game: the team's summary, what to work on with
 * the minute beside it, what to keep doing, whether the comp played out as
 * drafted, and a note per player. Read-only; the button that writes one
 * lives on the row.
 */
@Component({
  selector: 'app-game-review',
  imports: [DatePipe, TooltipDirective],
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
        @if (r.team.summary) { <p class="game-review-summary">{{ r.team.summary }}</p> }
        @if (r.team.compWhy) { <p class="muted game-review-why">{{ r.team.compWhy }}</p> }
        <div class="advice-columns">
          @if (r.team.workOn.length) {
            <div>
              <p class="advice-head is-warn">Work on</p>
              <ul class="advice-list">
                @for (w of r.team.workOn; track $index) {
                  <li class="advice-item">
                    @if (w.minute !== null) { <span class="review-minute">{{ w.minute }} min</span> }
                    {{ w.text }} <small class="advice-n">{{ w.evidence }}</small>
                  </li>
                }
              </ul>
            </div>
          }
          @if (r.team.keepDoing.length) {
            <div>
              <p class="advice-head is-ok">Keep doing</p>
              <ul class="advice-list">
                @for (k of r.team.keepDoing; track $index) {
                  <li class="advice-item">
                    @if (k.minute !== null) { <span class="review-minute">{{ k.minute }} min</span> }
                    {{ k.text }} <small class="advice-n">{{ k.evidence }}</small>
                  </li>
                }
              </ul>
            </div>
          }
        </div>
        @if (r.players.length) {
          <div class="split-scroll">
            <table class="split-table game-review-players">
              <thead><tr><th>Player</th><th>Strength</th><th>Work on</th></tr></thead>
              <tbody>
                @for (p of r.players; track p.name) {
                  <tr>
                    <td><b>{{ p.name }}</b><small class="muted"> {{ p.seat }} · {{ p.champion }}</small></td>
                    <td>@if (p.strength.text) { {{ p.strength.text }} <small class="advice-n">{{ p.strength.evidence }}</small> } @else { <span class="muted">—</span> }</td>
                    <td>@if (p.workOn.text) { @if (p.workOn.minute !== null) { <span class="review-minute">{{ p.workOn.minute }} min</span> } {{ p.workOn.text }} <small class="advice-n">{{ p.workOn.evidence }}</small> } @else { <span class="muted">—</span> }</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        <p class="muted game-review-foot">
          Written {{ r.reviewedAt | date: 'd MMM, HH:mm' }} by {{ models() }} for about {{ cost() }}{{ r.trigger === 'auto' ? ', by the morning run' : '' }}.
          Every point should match a fact in "How the game went"; if one does not, the review is wrong, not the game.
        </p>
      </section>
    }
  `
})
export class GameReviewComponent {
  readonly review = input<GameReview | undefined>(undefined);

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
