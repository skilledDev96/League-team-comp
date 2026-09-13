import { Component, computed, inject, input, output } from '@angular/core';
import { EXPECT_AXES, EXPECT_LABEL, LEVEL_LABEL } from '../../core/comp-expectation';
import { championsOf, CompCard } from '../../core/comps-build';
import { playedAgo } from '../../core/team-season';
import { ChampionFilterService } from '../../services/champion-filter.service';
import { UiService } from '../../services/ui.service';
import { RateRingComponent } from '../../shared/rate-ring.component';
import { TooltipDirective } from '../../shared/tooltip.directive';

/**
 * One comp on the poster (13 Sep 2026, the lead: "I love the look we have now, let's bring this over to the comps
 * page"): the face of the comp as its splash, the shape it plays, a ring for its record, the name, the category,
 * how many games and when, its five as icons, and its form. The whole tile opens the comp's sheet through the
 * name — one stretched button, so the tile is one tab stop that says what it is and whether its sheet is open.
 *
 * At Full the plate also carries the four things the comp is expected to do, inside the same height, so switching
 * depth moves nothing on the page.
 */
@Component({
  selector: 'app-comp-tile',
  imports: [RateRingComponent, TooltipDirective],
  template: `
    @let c = card();
    <article class="splash-tile comps-tile" [class.is-selected]="selected()" [class.is-building]="!c.complete"
             [class.is-match]="match() === true" [class.is-dimmed]="match() === false">
      @if (c.face) {
        <img class="splash-art" [src]="ui.championArtUrl(c.face)" (error)="ui.artFallback($event, c.face)" alt="" [attr.loading]="eager() ? 'eager' : 'lazy'" />
      }
      <span class="splash-shade" aria-hidden="true"></span>
      <div class="comps-tile-top">
        <span class="role-pill comps-tile-identity"><span class="material-symbols-rounded" aria-hidden="true">{{ c.icon }}</span>{{ c.identityLabel }}</span>
        <app-rate-ring [rate]="c.headline?.winRate ?? null" [games]="c.headline?.games ?? 0" [wins]="c.headline?.wins ?? 0" label="win rate"
                       [scope]="c.headline?.source === 'logged' ? 'logged by hand' : 'from match history'" [countUp]="true" [go]="go()" />
      </div>
      <div class="comps-tile-plate">
        @if (full() && c.expect; as ex) {
          <ul class="comps-tile-expect" aria-label="What we expect from it">
            @for (axis of axes; track axis) {
              <li [class.is-high]="ex.expect[axis] === 'high'" [class.is-low]="ex.expect[axis] === 'low'">{{ axisLabel[axis] }} <b>{{ levelLabel[ex.expect[axis]] }}</b></li>
            }
          </ul>
        }
        <h3 class="comps-tile-name">
          <button type="button" class="comps-tile-open" [id]="'comps-open-' + c.id" [attr.aria-expanded]="selected()" aria-controls="comps-sheet"
                  (click)="open.emit($event.detail === 0)">{{ c.name }}</button>
        </h3>
        <p class="comps-tile-meta">
          @if (c.category) { <span class="chip">{{ c.category }}</span> }
          @if (c.headline; as h) { <span>{{ h.games }} {{ h.games === 1 ? 'game' : 'games' }}</span> } @else { <span>No games yet</span> }
          @if (ago(); as a) { <span>played {{ a }}</span> }
        </p>
        <ol class="comps-tile-five" aria-label="The five">
          @for (s of c.seats; track s.role; let k = $index) {
            <li [style.--seat-i]="k" [class.is-empty]="!s.champion" [class.is-match]="s.champion && filter.matches(s.champion)"
                [appTip]="s.role + (s.champion ? ': ' + ui.championName(s.champion) : ': empty')">
              @if (s.champion) {
                <img [src]="ui.championIconUrl(s.champion)" [alt]="s.role + ' ' + ui.championName(s.champion)" loading="lazy" />
              }
            </li>
          }
        </ol>
        <div class="comps-tile-foot">
          @if (c.played?.form?.length) {
            <ol class="form-pips" aria-label="Last results, newest first">
              @for (r of c.played!.form; track $index) {
                <li class="form-pip" [class.is-win]="r === 'W'" [class.is-loss]="r === 'L'" [style.--pip-i]="$index"><span class="visually-hidden">{{ r === 'W' ? 'Win' : 'Loss' }}</span></li>
              }
            </ol>
          }
          @if (c.plays.length) {
            <small class="comps-tile-plays"><span class="material-symbols-rounded" aria-hidden="true">map</span>{{ c.plays.length }} {{ c.plays.length === 1 ? 'play' : 'plays' }}</small>
          }
        </div>
      </div>
    </article>
  `
})
export class CompTileComponent {
  readonly card = input.required<CompCard>();
  readonly selected = input(false);
  readonly full = input(false);
  /** Start the ring's count: the grid has come on screen. */
  readonly go = input(true);
  /** The first row loads its art at once; the rest as they come near. */
  readonly eager = input(false);
  /** True when opened from the keyboard, so the sheet can take focus. */
  readonly open = output<boolean>();

  protected readonly ui = inject(UiService);
  protected readonly filter = inject(ChampionFilterService);
  protected readonly axes = EXPECT_AXES;
  protected readonly axisLabel = EXPECT_LABEL;
  protected readonly levelLabel = LEVEL_LABEL;

  /** Lit when the champion being asked about is one of its five, dimmed when not, neither without a question. */
  protected readonly match = computed(() => (this.filter.active() ? this.filter.passes(championsOf(this.card())) : null));
  protected readonly ago = computed(() => {
    const at = this.card().lastPlayed;
    return at ? playedAgo(at, Date.now()) : '';
  });
}
