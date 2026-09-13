import { Component, computed, inject, input, output } from '@angular/core';
import { RosterCard } from '../../../core/roster-model';
import { ChampionFilterService } from '../../../services/champion-filter.service';
import { UiService } from '../../../services/ui.service';
import { RateRingComponent } from '../../../shared/rate-ring.component';
import { TooltipDirective } from '../../../shared/tooltip.directive';

/**
 * One of ours on the team poster (13 Sep 2026, the lead: "I love the look of this instead of the summoner
 * icons as main view point"): their main's splash, the seat, a win-rate ring, the crown on whoever holds
 * the most series MVP titles, and a plate with the name, rank, form and games. Tall on the poster, short
 * as a bench or fill-in tile.
 *
 * The whole panel opens the player's sheet, through the name: a stretched button, so the panel is one tab
 * stop that says who it is and whether their sheet is open. At Full the plate also carries what a reader
 * checks — three champions with their rates, the KDA and what they are working on — inside the same
 * height, so switching depth moves nothing on the page.
 */
@Component({
  selector: 'app-roster-panel',
  imports: [RateRingComponent, TooltipDirective],
  template: `
    @let c = card();
    <article class="splash-tile roster-panel" [class.is-tall]="size() === 'tall'" [class.is-tile]="size() === 'tile'"
             [class.is-selected]="selected()" [class.is-crowned]="c.crowned" [class.is-match]="match() === true" [class.is-dimmed]="match() === false">
      @if (c.champion) {
        <img class="splash-art" [src]="ui.championArtUrl(c.champion)" (error)="ui.artFallback($event, c.champion)" alt=""
             [attr.loading]="size() === 'tall' ? 'eager' : 'lazy'" />
      }
      <span class="splash-shade" aria-hidden="true"></span>
      <div class="roster-panel-top">
        <span class="roster-panel-seat">
          <span class="role-pill">{{ c.role }}</span>
          @if (c.group === 'bench') { <span class="sub-badge">Sub</span> }
        </span>
        <app-rate-ring [rate]="c.ranked?.winRate ?? null" [games]="c.ranked?.games ?? 0" [wins]="c.ranked?.wins ?? 0" [scope]="c.ranked?.queue === 'Flex' ? 'in ranked flex' : 'in ranked solo/duo'" [label]="size() === 'tall' ? (c.ranked?.queue ?? 'ranked') + ' win rate' : ''" [countUp]="true" [go]="go()" />
      </div>
      @if (c.crowned) {
        <span class="roster-panel-crown" [appTip]="crownTip()">
          <span class="splash-crown material-symbols-rounded" aria-hidden="true">workspace_premium</span>
          <span class="splash-chip">{{ c.titles }} MVP {{ c.titles === 1 ? 'title' : 'titles' }}</span>
        </span>
      }
      <div class="roster-panel-plate">
        @if (full() && size() === 'tall' && (c.pool.length || c.stats || c.working.length)) {
          <div class="roster-panel-check">
            <ul class="roster-panel-faces" aria-label="Most played">
              @for (e of topPool(); track e.champion) {
                <li [appTip]="ui.championName(e.champion) + (e.games ? ': ' + e.winRate + '% over ' + e.games + ' games' : ': not played yet')">
                  <img [src]="ui.championIconUrl(e.champion)" [alt]="ui.championName(e.champion)" loading="lazy" />
                  <b [class]="e.band">{{ e.games ? e.winRate + '%' : '—' }}</b>
                </li>
              }
            </ul>
            <p class="roster-panel-numbers">
              @if (c.stats) { <span><b>{{ c.stats.kda.toFixed(1) }}</b> KDA</span> }
              @if (c.working.length) { <span><b>{{ c.working.length }}</b> working on</span> }
            </p>
          </div>
        }
        <h3 class="roster-panel-name">
          <button type="button" class="roster-panel-open" [id]="'roster-open-' + c.id" [attr.aria-expanded]="selected()" aria-controls="roster-sheet"
                  (click)="open.emit($event.detail === 0)">{{ c.name }}</button>
        </h3>
        <p class="roster-panel-meta">
          @if (c.rank; as r) { {{ r.label }} <span class="roster-panel-queue">{{ r.queue }}</span> } @else { Unranked }
          @if (c.champion) { · {{ ui.championName(c.champion) }} }
        </p>
        <!-- Their other roles, said as such (13 Sep 2026, the lead: "state that these are non primary roles"): beside the
             game count they read as part of it. -->
        @if (c.secondaryRoles.length) {
          <p class="roster-panel-also pp-flex-roles">
            <span class="pp-flex-label">Also plays</span>
            @for (r of c.secondaryRoles; track r) { <span class="pp-role flex">{{ r }}</span> }
          </p>
        }
        <div class="roster-panel-foot">
          @if (c.form.length) {
            <ol class="form-pips" aria-label="Last results, newest first">
              @for (r of c.form; track $index) {
                <li class="form-pip" [class.is-win]="r === 'W'" [class.is-loss]="r === 'L'" [style.--pip-i]="$index"><span class="visually-hidden">{{ r === 'W' ? 'Win' : 'Loss' }}</span></li>
              }
            </ol>
          }
          <small class="roster-panel-games">
            @if (c.group === 'fillIns') { Fill-in } @else { {{ c.games }} team {{ c.games === 1 ? 'game' : 'games' }} }
          </small>
          @if (!c.crowned && c.titles) { <span class="splash-chip is-quiet">{{ c.titles }} MVP {{ c.titles === 1 ? 'title' : 'titles' }}</span> }
        </div>
      </div>
    </article>
  `
})
export class RosterPanelComponent {
  readonly card = input.required<RosterCard>();
  readonly size = input<'tall' | 'tile'>('tall');
  readonly selected = input(false);
  readonly full = input(false);
  /** Start the ring's count: the poster has come on screen. */
  readonly go = input(true);
  /** True when opened from the keyboard, so the sheet can take focus. */
  readonly open = output<boolean>();

  protected readonly ui = inject(UiService);
  private readonly filter = inject(ChampionFilterService);

  /** Highlighted when the champion being asked about is in their pool, dimmed when it is not, neither without a question. */
  protected readonly match = computed(() => (this.filter.active() ? this.filter.passes(this.card().pool.map((e) => e.champion)) : null));
  protected readonly topPool = computed(() => this.card().pool.slice(0, 3));
  protected readonly crownTip = computed(() => {
    const c = this.card();
    const last = c.lastTitle ? ` Last: vs ${c.lastTitle.opponent} on ${this.ui.championName(c.lastTitle.champion)}.` : '';
    return `The most series MVP titles on the team.${last}`;
  });
}
