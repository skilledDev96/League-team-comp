import { Component, computed, inject, input } from '@angular/core';
import { HomeRace } from '../../core/home-model';
import { RaceEntry } from '../../core/mvp-race';
import { InViewDirective } from '../../shared/in-view.directive';
import { PlayerAvatarComponent } from '../../shared/player-avatar.component';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { UiService } from '../../services/ui.service';

/**
 * The MVP race beside the spotlight (13 Sep 2026): series MVP titles this season, every starter listed
 * from zero, and a foot naming the last series MVP the way the second mockup's podium did — who, on what,
 * against which team. A mark too thin to count shows as provisional beside the titles, and a finished
 * series still waiting on its replays says so, so importing them is plainly worth doing.
 */
@Component({
  selector: 'app-home-race',
  imports: [InViewDirective, PlayerAvatarComponent, TooltipDirective],
  template: `
    @let r = race();
    <section class="card home-race" appInView aria-labelledby="home-race-title">
      <header class="home-card-head">
        <h2 id="home-race-title"><span class="material-symbols-rounded" aria-hidden="true">emoji_events</span> MVP race</h2>
        <span class="home-card-scope">{{ seasonLabel() }}</span>
      </header>
      <ol class="home-race-list">
        @for (e of r.entries; track e.playerId) {
          <li class="home-race-row" [class.is-leader]="e.titles > 0 && e.titles === most()" [style.--home-share]="share(e)">
            <span class="home-race-rank">{{ rankOf(e) }}</span>
            <app-player-avatar [name]="e.name" [icon]="e.icon" [role]="e.role" />
            <span class="home-race-who"><b>{{ e.name }}</b><small>{{ e.role }}</small></span>
            <span class="home-race-bar" aria-hidden="true"><span class="home-race-fill"></span></span>
            <span class="home-race-titles">
              <b>{{ e.titles }}</b><span class="visually-hidden">{{ e.titles === 1 ? 'title' : 'titles' }}</span>
              @if (e.provisional) {
                <small class="home-race-provisional" tabindex="0" [appTip]="provisionalTip(e)">+{{ e.provisional }}</small>
              }
            </span>
          </li>
        } @empty {
          <li class="home-race-row is-empty">The roster is empty.</li>
        }
      </ol>
      <footer class="home-race-foot">
        @if (r.last; as l) {
          <p class="home-race-last">
            <span class="material-symbols-rounded" aria-hidden="true">military_tech</span>
            <span>Last series MVP: <b>{{ lastName() }}</b> on {{ ui.championName(l.champion) }} vs {{ l.opponent }}</span>
          </p>
        } @else {
          <p class="home-race-last is-empty">
            <span class="material-symbols-rounded" aria-hidden="true">military_tech</span>
            <span>The first finished series crowns the first MVP</span>
          </p>
        }
        @if (r.waitingOn) {
          <p class="home-race-waiting"><span class="material-symbols-rounded" aria-hidden="true">hourglass_top</span> vs {{ r.waitingOn }} is waiting on replays</p>
        }
      </footer>
    </section>
  `
})
export class HomeRaceComponent {
  readonly race = input.required<HomeRace>();
  readonly seasonLabel = input.required<string>();

  protected readonly ui = inject(UiService);

  protected readonly most = computed(() => Math.max(0, ...this.race().entries.map((e) => e.titles)));
  protected readonly lastName = computed(() => {
    const last = this.race().last;
    if (!last) return '';
    return this.race().entries.find((e) => e.playerId === last.playerId)?.name ?? last.name ?? last.seat;
  });

  /** Dense ranks, shared on a tie: two on one title are both 1, and nobody without a title is ranked. */
  protected rankOf(e: RaceEntry): string {
    if (!e.titles) return '–';
    const counts = [...new Set(this.race().entries.map((x) => x.titles))].sort((a, b) => b - a);
    return String(counts.indexOf(e.titles) + 1);
  }

  protected share(e: RaceEntry): string {
    const most = this.most();
    return most ? String(e.titles / most) : '0';
  }

  protected provisionalTip(e: RaceEntry): string {
    const n = e.provisional;
    return `${n} more ${n === 1 ? 'series names' : 'series name'} ${e.name}, but too few of ${n === 1 ? 'its' : 'their'} games carry figures to count yet. Import the replays and ${n === 1 ? 'it counts' : 'they count'}.`;
  }
}
