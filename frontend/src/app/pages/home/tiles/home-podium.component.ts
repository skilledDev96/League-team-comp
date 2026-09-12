import { Component, computed, input } from '@angular/core';
import { PodiumPlace } from '../../../core/mvp-race';
import { InViewDirective } from '../../../shared/in-view.directive';
import { PlayerAvatarComponent } from '../../../shared/player-avatar.component';

interface Step {
  place: 1 | 2 | 3;
  entries: PodiumPlace['entry'][];
}

/**
 * The podium (13 Sep 2026): the three highest title counts this season, shared on a tie, second on the
 * left, first in the middle and third on the right as a podium stands. A step nobody has reached yet is
 * drawn empty rather than left out, so the podium is a thing to climb from the first day.
 */
@Component({
  selector: 'app-home-podium',
  imports: [InViewDirective, PlayerAvatarComponent],
  template: `
    <section class="card home-tile home-podium" appInView aria-labelledby="home-podium-title">
      <header class="home-card-head">
        <h2 id="home-podium-title"><span class="material-symbols-rounded" aria-hidden="true">social_leaderboard</span> Podium</h2>
        <span class="home-card-scope">Series MVP titles {{ scope() }}</span>
      </header>
      <ol class="home-podium-steps">
        @for (step of steps(); track step.place) {
          <li class="home-podium-step" [class.is-first]="step.place === 1" [class.is-empty]="!step.entries.length" [attr.aria-label]="label(step)">
            <div class="home-podium-who">
              @for (e of step.entries; track e.playerId) {
                <span class="home-podium-person">
                  <app-player-avatar [name]="e.name" [icon]="e.icon" [role]="e.role" />
                  <b>{{ e.name }}</b>
                </span>
              } @empty {
                <span class="home-podium-open" aria-hidden="true">?</span>
              }
            </div>
            <div class="home-podium-block" aria-hidden="true">
              <span class="home-podium-place">{{ step.place }}</span>
              @if (step.entries.length) {
                <small>{{ step.entries[0].titles }} {{ step.entries[0].titles === 1 ? 'title' : 'titles' }}</small>
              }
            </div>
          </li>
        }
      </ol>
      @if (!podium().length) {
        <p class="home-tile-note">Nobody on it yet: each finished series puts its MVP a step up.</p>
      }
    </section>
  `
})
export class HomePodiumComponent {
  readonly podium = input.required<readonly PodiumPlace[]>();
  readonly scope = input.required<string>();

  /** Second, first, third, as a podium stands. */
  protected readonly steps = computed<Step[]>(() =>
    ([2, 1, 3] as const).map((place) => ({ place, entries: this.podium().filter((p) => p.place === place).map((p) => p.entry) }))
  );

  protected label(step: Step): string {
    const ordinal = step.place === 1 ? 'First' : step.place === 2 ? 'Second' : 'Third';
    if (!step.entries.length) return `${ordinal}: nobody yet`;
    const titles = step.entries[0].titles;
    return `${ordinal}: ${step.entries.map((e) => e.name).join(' and ')}, ${titles} ${titles === 1 ? 'title' : 'titles'}`;
  }
}
