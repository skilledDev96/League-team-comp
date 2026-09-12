import { Component, inject, input, output } from '@angular/core';
import { HomeWelcome } from '../../core/home-model';
import { Role, ROLES } from '../../models/team.models';
import { PlayerAvatarComponent } from '../../shared/player-avatar.component';
import { UserPrefsService } from '../../services/user-prefs.service';

/**
 * The line under the hero that knows who is reading (13 Sep 2026).
 *
 * An account carries no player id, so the reader is whoever sits in the seat they told the film room is
 * theirs (`UserPrefs.film.seat`). Nobody has said: the band asks once, with the five seats and a Not now
 * that the page remembers in this browser. A coach or an analyst who waves it away sees no band at all.
 */
@Component({
  selector: 'app-home-welcome',
  imports: [PlayerAvatarComponent],
  template: `
    @let w = welcome();
    @if (w.player || w.needsSeat) {
      <section class="card home-welcome" aria-label="Welcome">
        <div class="home-welcome-hello">
          @if (w.player; as p) {
            <app-player-avatar [name]="p.name" [icon]="p.icon" [role]="p.role" />
          } @else {
            <span class="home-welcome-wave material-symbols-rounded" aria-hidden="true">waving_hand</span>
          }
          <div class="home-welcome-text">
            <h2 class="home-welcome-greeting">{{ w.greeting }}</h2>
            @if (w.player) {
              <p class="home-welcome-line">
                @if (w.line; as l) {
                  <span><b>{{ l.games }}</b> {{ l.games === 1 ? 'game' : 'games' }} {{ scope() }}</span>
                  <span><b>{{ l.winRate }}%</b> won</span>
                  <span><b>{{ kda(l.kda) }}</b> KDA</span>
                } @else {
                  <span>No games for you {{ scope() }} yet</span>
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

        @if (w.form.length) {
          <ol class="home-form" aria-label="Your last games, newest first">
            @for (r of w.form; track $index) {
              <li class="home-form-pip" [class.is-win]="r === 'W'" [class.is-loss]="r === 'L'">
                <span aria-hidden="true">{{ r }}</span><span class="visually-hidden">{{ r === 'W' ? 'Win' : 'Loss' }}</span>
              </li>
            }
          </ol>
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
  /** "this split", "in the last 90 days" or "all time". */
  readonly scope = input.required<string>();
  readonly dismiss = output<void>();

  private readonly prefs = inject(UserPrefsService);
  protected readonly roles: readonly Role[] = ROLES;

  protected pick(role: Role): void {
    void this.prefs.setFilmSeat(role);
  }

  protected kda(value: number): string {
    return value.toFixed(1);
  }
}
