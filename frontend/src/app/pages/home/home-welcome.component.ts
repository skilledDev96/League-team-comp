import { Component, inject, input, output } from '@angular/core';
import { MvpBannerComponent } from '../../shared/mvp-banner.component';
import { HomeWelcome } from '../../core/home-model';
import { Role, ROLES } from '../../models/team.models';
import { InViewDirective } from '../../shared/in-view.directive';
import { PlayerAvatarComponent } from '../../shared/player-avatar.component';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { UserPrefsService } from '../../services/user-prefs.service';

/**
 * The line under the hero that knows who is reading (13 Sep 2026).
 *
 * An account carries no player id, so the reader is whoever sits in the seat they told the film room is
 * theirs (`UserPrefs.film.seat`). Nobody has said: the band asks once, with the five seats and a Not now
 * that the page remembers in this browser. A coach or an analyst who waves it away sees no band at all.
 *
 * The reader's rank frames the band (13 Sep 2026, the lead: "add the ranked banner around this as well"): Riot's
 * emblem for the tier stands in the rank pill and the card takes the tier's tint, through `data-tier`. An emblem
 * that fails to load hides itself, so a tier the CDN has renamed leaves the pill as it was.
 */
@Component({
  selector: 'app-home-welcome',
  imports: [MvpBannerComponent, InViewDirective, PlayerAvatarComponent, TooltipDirective],
  template: `
    @let w = welcome();
    @if (w.player || w.needsSeat) {
      <section class="card home-welcome" aria-label="Welcome" appInView [attr.data-tier]="w.solo?.tier ?? null">
        <div class="home-welcome-hello">
          @if (w.player; as p) {
            <app-player-avatar [name]="p.name" [icon]="p.icon" [role]="p.role" />
          } @else {
            <span class="home-welcome-wave material-symbols-rounded" aria-hidden="true">waving_hand</span>
          }
          <div class="home-welcome-text">
            <h2 class="home-welcome-greeting">{{ w.greeting }}@if (w.player; as p) { <app-mvp-banner [playerId]="p.id" [name]="p.name" /> }</h2>
            @if (w.player) {
              <p class="home-welcome-line">
                @if (w.solo; as s) {
                  <span [appTip]="s.from === 'season' ? 'Ranked solo/duo this season, from Riot: ' + s.wins + 'W-' + (s.games - s.wins) + 'L' : 'The ranked solo/duo games Riot last read for you'"><b>{{ s.games }}</b> solo {{ s.games === 1 ? 'game' : 'games' }}</span>
                  <span><b>{{ s.winRate }}%</b> won</span>
                  @if (s.kda !== null) { <span appTip="Over the solo games Riot last read for you"><b>{{ kda(s.kda) }}</b> KDA</span> }
                } @else {
                  <span>No ranked solo games read from Riot yet</span>
                }
                @if (w.titles) {
                  <span class="home-welcome-titles"><span class="material-symbols-rounded" aria-hidden="true">workspace_premium</span>
                    <b>{{ w.titles }}</b> series MVP {{ w.titles === 1 ? 'title' : 'titles' }}</span>
                }
              </p>
            } @else {
              <p class="home-welcome-line">Say which seat is yours and this line follows your games.</p>
            }
          </div>
        </div>

        @if (w.player && w.solo?.rank; as rank) {
          <span class="home-welcome-rank" appTip="Your ranked solo/duo rank, from Riot">
            @if (w.solo?.tier; as tier) {
              <span class="home-welcome-crest"><img [src]="crestUrl(tier)" alt="" (error)="hideCrest($event)" /></span>
            }
            <span class="home-welcome-rank-text">
              <span class="home-welcome-rank-queue">Solo</span>{{ rank }}@if (w.solo?.lp !== null && w.solo?.lp !== undefined) { <small>{{ w.solo!.lp }} LP</small> }
            </span>
          </span>
        }

        @if (w.needsSeat) {
          <div class="home-seat-ask" role="group" aria-label="Which seat is yours?">
            <span class="home-seat-q">Which seat is yours?</span>
            @for (role of roles; track role) {
              <button type="button" class="view-btn home-pill home-seat-btn" (click)="pick(role)">{{ role }}</button>
            }
            <button type="button" class="view-btn home-pill home-seat-later" (click)="dismiss.emit()">Not now</button>
          </div>
        }
      </section>
    }
  `
})
export class HomeWelcomeComponent {
  readonly welcome = input.required<HomeWelcome>();
  readonly dismiss = output<void>();

  private readonly prefs = inject(UserPrefsService);
  protected readonly roles: readonly Role[] = ROLES;

  protected pick(role: Role): void {
    void this.prefs.setFilmSeat(role);
  }

  protected kda(value: number): string {
    return value.toFixed(1);
  }

  /** Riot's ranked emblem for a tier, from CommunityDragon (every tier from iron to challenger answers). */
  protected crestUrl(tier: string): string {
    return `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${tier}.png`;
  }

  /** An emblem that does not load leaves the pill as it was rather than a broken image. */
  protected hideCrest(event: Event): void {
    const crest = (event.target as HTMLElement).closest<HTMLElement>('.home-welcome-crest');
    if (crest) crest.hidden = true;
  }
}
