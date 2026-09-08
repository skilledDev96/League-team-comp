import { Component, computed, input } from '@angular/core';
import { playerFigures } from '../core/game-figures';
import { matchLink } from '../core/match-link';
import { AnalysisGame } from '../models/team.models';
import { InfoTipComponent } from './info-tip.component';
import { TooltipDirective } from './tooltip.directive';

/**
 * Every stored figure for one game, folded away until someone doubts a
 * number. A Riot game links out to the same match on League of Graphs so
 * the figures can be compared; a replay names its file instead, because a
 * custom game exists nowhere else.
 */
@Component({
  selector: 'app-game-check',
  imports: [TooltipDirective, InfoTipComponent],
  template: `
    @if (game(); as g) {
      <details class="intel-collapse game-check">
        <summary>
          <span class="material-symbols-rounded" aria-hidden="true">fact_check</span>
          Check the numbers
          <span class="game-check-chevron material-symbols-rounded" aria-hidden="true">expand_more</span>
        </summary>
        <div class="game-check-body">
          <p class="game-check-meta">
            @if (link(); as href) {
              <a class="view-btn" [href]="href" target="_blank" rel="noopener">
                Same game on League of Graphs <span class="material-symbols-rounded" aria-hidden="true">open_in_new</span>
              </a>
            } @else {
              <span class="muted">Replay {{ g.matchId }} — a custom game has no page outside this app.</span>
            }
            <span class="muted">
              @if (g.durationSec) { {{ clock(g.durationSec) }} · }
              @if (g.kills) { kills {{ g.kills.ours }}–{{ g.kills.theirs }} · }
              lanes {{ g.laneData === 'none' ? 'not readable (replay)' : g.laneData === 'riot' ? 'read' : 'waiting on the backfill' }}
              · cache {{ g.cacheVersion !== undefined ? 'v' + g.cacheVersion : 'unstamped' }}
            </span>
          </p>
          <div class="split-scroll">
            <table class="split-table game-check-table">
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  @for (c of figures().columns; track c.key) {
                    <th scope="col" class="num" [appTip]="c.note">{{ c.label }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (r of figures().rows; track r.name) {
                  <tr>
                    <td>{{ r.name }} <small>{{ r.position }} · {{ r.champion }}</small></td>
                    @for (cell of r.cells; track $index) {
                      <td class="num">{{ cell ?? '—' }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="muted split-note"><app-info-tip text="A dash is a figure this game does not carry, never a zero. Hover a column for what it measures." label="How to read the figures" /></p>
        </div>
      </details>
    }
  `
})
export class GameCheckComponent {
  readonly game = input<AnalysisGame | undefined>(undefined);
  protected readonly figures = computed(() => {
    const g = this.game();
    return g ? playerFigures(g) : { columns: [], rows: [] };
  });
  protected readonly link = computed(() => {
    const g = this.game();
    return g && g.queue !== 'Scrim' ? matchLink(g.matchId) : null;
  });

  protected clock(seconds: number): string {
    return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
  }
}
