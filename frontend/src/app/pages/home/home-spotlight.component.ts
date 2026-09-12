import { Component, computed, inject, input, signal } from '@angular/core';
import { HomeSpotlight } from '../../core/home-model';
import { ChampionMotionComponent } from '../../shared/film/champion-motion.component';
import { InViewDirective } from '../../shared/in-view.directive';
import { MvpChipComponent } from '../../shared/mvp-chip.component';
import { MotionService } from '../../services/motion.service';
import { PageVisibilityService } from '../../services/page-visibility.service';
import { UiService } from '../../services/ui.service';

/**
 * The MVP of the last series, in a gold frame (13 Sep 2026, the lead: "highlight a team member who has
 * been the MVP of the previous series to create some inner competition").
 *
 * Their champion's splash with its ability clip over it — the one clip on the page, fetched only while
 * this card is on screen and the tab is looked at, and never with motion off or on Save-Data — and the
 * Series MVP chip the Prep page shows, with its terms in the tip. Until a series has crowned anybody the
 * frame holds whoever took the most game MVPs this season; with no marks at all it says how the first
 * crown is won.
 */
@Component({
  selector: 'app-home-spotlight',
  imports: [ChampionMotionComponent, InViewDirective, MvpChipComponent],
  template: `
    <section class="home-spotlight" data-tour="home-spotlight" appInView [appInViewOnce]="false" (inView)="onScreen.set($event)"
             [class.is-empty]="!spotlight()" aria-labelledby="home-spotlight-name">
      @if (spotlight(); as s) {
        <app-champion-motion class="home-spotlight-art" [champion]="s.champion" slot="R" [active]="clipOn()" shade="home-spotlight-shade" />
        <span class="home-spotlight-sheen" aria-hidden="true"></span>
        <div class="home-spotlight-body">
          <p class="home-kicker home-spotlight-kicker">
            <span class="material-symbols-rounded" aria-hidden="true">workspace_premium</span>
            {{ s.kind === 'series' ? 'MVP of the last series' : 'Most game MVPs ' + scope() }}
          </p>
          <h2 class="home-spotlight-name" id="home-spotlight-name">{{ s.name }}</h2>
          <p class="home-spotlight-meta">
            <span>{{ s.seat }}</span>
            <span>{{ ui.championName(s.champion) }}</span>
            @if (s.kind === 'series') {
              <span [class.is-win]="s.result === 'won'" [class.is-loss]="s.result === 'lost'">{{ resultWord(s.result) }} {{ s.score.wins }}–{{ s.score.losses }} vs {{ s.opponent }}</span>
            } @else {
              <span>MVP in {{ s.mvps }} of {{ s.of }} {{ s.of === 1 ? 'game' : 'games' }}</span>
            }
          </p>
          <div class="home-spotlight-chips">
            @if (s.kind === 'series') {
              <app-mvp-chip kind="series" [compact]="true" [champion]="s.champion" [name]="s.name" [seat]="s.seat" [terms]="s.terms" [read]="s.read" [of]="s.of" />
              @if (s.titles) {
                <span class="home-chip"><span class="material-symbols-rounded" aria-hidden="true">military_tech</span>{{ s.titles }} {{ s.titles === 1 ? 'title' : 'titles' }} {{ scope() }}</span>
              }
            } @else {
              <app-mvp-chip kind="mvp" [compact]="true" [champion]="s.champion" [name]="s.name" [seat]="s.seat" [terms]="s.terms" />
            }
          </div>
        </div>
      } @else {
        <div class="home-spotlight-empty">
          <span class="home-spotlight-crown material-symbols-rounded" aria-hidden="true">workspace_premium</span>
          <p class="home-kicker">MVP of the last series</p>
          <h2 class="home-spotlight-name" id="home-spotlight-name">The first finished series crowns the first MVP</h2>
          <p class="home-spotlight-meta"><span>Import its replays on Prep &amp; Draft and the frame fills itself.</span></p>
        </div>
      }
    </section>
  `
})
export class HomeSpotlightComponent {
  readonly spotlight = input<HomeSpotlight | null>(null);
  readonly scope = input.required<string>();

  protected readonly ui = inject(UiService);
  private readonly motion = inject(MotionService);
  private readonly visibility = inject(PageVisibilityService);

  protected readonly onScreen = signal(false);
  protected readonly clipOn = computed(() => this.onScreen() && this.visibility.visible() && !this.motion.reduced());

  protected resultWord(result: 'won' | 'lost' | 'drawn'): string {
    return result === 'won' ? 'Won' : result === 'lost' ? 'Lost' : 'Drew';
  }
}
