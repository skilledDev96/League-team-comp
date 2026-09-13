import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ringDash } from '../../../core/home-charts';
import { HomeLineupCard } from '../../../core/home-model';
import { rateBand } from '../../../core/opponent-view';
import { ChampionRecord } from '../../../models/team.models';
import { InViewDirective } from '../../../shared/in-view.directive';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { UiService } from '../../../services/ui.service';

/**
 * The five (13 Sep 2026): each starter over their main's splash, with the seat, the rank, a ring for
 * their win rate this season and a crown on whoever holds the most series MVP titles. A card opens the
 * player's profile.
 */
@Component({
  selector: 'app-home-lineup',
  imports: [InViewDirective, RouterLink, TooltipDirective],
  template: `
    <section class="card home-tile home-lineup" appInView aria-labelledby="home-lineup-title">
      <header class="home-card-head">
        <h2 id="home-lineup-title"><span class="material-symbols-rounded" aria-hidden="true">groups</span> The lineup</h2>
        <span class="home-card-scope">Win rates {{ scope() }}</span>
      </header>
      <ul class="home-lineup-cards">
        @for (c of lineup(); track c.playerId) {
          <li>
            <a class="home-lineup-card" [routerLink]="['/player', c.playerId]" [class.is-crowned]="c.crowned">
              @if (c.champion) {
                <img class="home-lineup-art" [src]="ui.championArtUrl(c.champion)" (error)="ui.artFallback($event, c.champion)" alt="" loading="lazy" />
              }
              <span class="home-lineup-shade" aria-hidden="true"></span>
              @if (c.crowned) {
                <span class="home-lineup-crown material-symbols-rounded" aria-hidden="true">workspace_premium</span>
              }
              <span class="home-lineup-top">
                <span class="home-lineup-role">{{ c.role }}</span>
                <span class="home-lineup-rate" [appTip]="c.winRate === null ? 'No games ' + scope() : c.winRate + '% of ' + c.games + ' games won, ' + scope()">
                <span class="home-ring" [class]="band(c)" [attr.aria-label]="c.winRate === null ? 'No games ' + scope() : c.winRate + '% won over ' + c.games + ' games'">
                  <svg viewBox="0 0 36 36" aria-hidden="true">
                    <circle class="home-ring-track" cx="18" cy="18" r="15.915" pathLength="100" />
                    @if (c.winRate !== null) {
                      <circle class="home-ring-fill" cx="18" cy="18" r="15.915" pathLength="100" [attr.stroke-dasharray]="dash(c.winRate)" />
                    }
                  </svg>
                  <b aria-hidden="true">{{ c.winRate === null ? '—' : c.winRate + '%' }}</b>
                </span>
                <small class="home-ring-label" aria-hidden="true">win rate</small>
                </span>
              </span>
              <span class="home-lineup-foot">
                <b class="home-lineup-name">{{ c.name }}</b>
                <small>
                  @if (c.rank; as r) { {{ r.label }} <span class="home-lineup-queue">{{ r.queue }}</span> } @else { Unranked }
                  @if (c.champion) { · {{ ui.championName(c.champion) }} }
                </small>
                <small class="home-lineup-games">{{ c.games }} {{ c.games === 1 ? 'game' : 'games' }}</small>
              </span>
            </a>
          </li>
        }
      </ul>
    </section>
  `
})
export class HomeLineupComponent {
  readonly lineup = input.required<readonly HomeLineupCard[]>();
  readonly scope = input.required<string>();

  protected readonly ui = inject(UiService);

  protected dash(rate: number): string {
    return ringDash(rate);
  }

  protected band(c: HomeLineupCard): string {
    return c.winRate === null ? '' : rateBand({ games: c.games, wins: Math.round((c.winRate / 100) * c.games) } as ChampionRecord);
  }
}
