import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HomeLineupCard } from '../../../core/home-model';
import { InViewDirective } from '../../../shared/in-view.directive';
import { RateRingComponent } from '../../../shared/rate-ring.component';
import { UiService } from '../../../services/ui.service';

/**
 * The five (13 Sep 2026): each starter over their main's splash, with the seat, the rank, a ring for
 * their own ranked win rate in the queue of that rank (the lead: "our own winrates, not based on the team")
 * and a crown on whoever holds the most series MVP titles. A card opens the player's profile.
 */
@Component({
  selector: 'app-home-lineup',
  imports: [InViewDirective, RateRingComponent, RouterLink],
  template: `
    <section class="card home-tile home-lineup" appInView aria-labelledby="home-lineup-title">
      <header class="home-card-head">
        <h2 id="home-lineup-title"><span class="material-symbols-rounded" aria-hidden="true">groups</span> The lineup</h2>
        <span class="home-card-scope">Own ranked win rates, from Riot</span>
      </header>
      <ul class="home-lineup-cards">
        @for (c of lineup(); track c.playerId) {
          <li>
            <a class="home-lineup-card" [routerLink]="['/player', c.playerId]" [class.is-crowned]="c.crowned">
              @if (c.champion) {
                <img class="splash-art" [src]="ui.championArtUrl(c.champion)" (error)="ui.artFallback($event, c.champion)" alt="" loading="lazy" />
              }
              <span class="splash-shade" aria-hidden="true"></span>
              @if (c.crowned) {
                <span class="home-lineup-crown splash-crown material-symbols-rounded" aria-hidden="true">workspace_premium</span>
              }
              <span class="home-lineup-top">
                <span class="role-pill">{{ c.role }}</span>
                <app-rate-ring [rate]="c.ranked?.winRate ?? null" [games]="c.ranked?.games ?? 0" [wins]="c.ranked?.wins ?? 0" [label]="(c.ranked?.queue ?? 'ranked') + ' win rate'" [scope]="c.ranked?.queue === 'Flex' ? 'in ranked flex' : 'in ranked solo/duo'" />
              </span>
              <span class="home-lineup-foot">
                <b class="home-lineup-name">{{ c.name }}</b>
                <small>
                  @if (c.rank; as r) { {{ r.label }} <span class="home-lineup-queue">{{ r.queue }}</span> } @else { Unranked }
                  @if (c.champion) { · {{ ui.championName(c.champion) }} }
                </small>
                <small class="home-lineup-games">@if (c.ranked; as r) { {{ r.games }} ranked {{ r.games === 1 ? 'game' : 'games' }} } @else { No ranked games }</small>
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

}
