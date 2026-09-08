import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { TeamDataService } from '../services/team-data.service';
import { TooltipDirective } from './tooltip.directive';

/**
 * The things the team does most, one press each, from the main page
 * (8 Sep 2026). Each is a pill that lands on the right page in the right
 * state: "We just practiced" refreshes the match data and opens the new
 * games, "Add a comp" opens the editor with a blank comp, "Ready to draft"
 * opens the draft room. The ones that write are for editors only.
 */
@Component({
  selector: 'app-quick-actions',
  imports: [RouterLink, TooltipDirective],
  template: `
    <section class="card quick-actions" aria-label="Quick actions">
      <span class="quick-actions-label"><span class="material-symbols-rounded" aria-hidden="true">bolt</span>Quick actions</span>
      <div class="quick-actions-row">
        @if (auth.canEdit()) {
          <a class="view-btn active quick-action" [routerLink]="['/games']" [queryParams]="{ refresh: 1 }"
             appTip="Fetch the games we just played from Riot, then open the new ones to look at">
            <span class="material-symbols-rounded" aria-hidden="true">sync</span>We just practiced
          </a>
        }
        <a class="view-btn quick-action" [routerLink]="['/tournaments']" [queryParams]="{ view: 'draft' }"
           appTip="The live draft room for the next series game">
          <span class="material-symbols-rounded" aria-hidden="true">swords</span>Ready to draft
        </a>
        @if (auth.canEdit()) {
          <a class="view-btn quick-action" [routerLink]="['/admin']" [queryParams]="{ tab: 'comps', add: 'comp' }"
             appTip="Open the comps editor with a blank comp to fill in">
            <span class="material-symbols-rounded" aria-hidden="true">add_circle</span>Add a comp
          </a>
        }
        <a class="view-btn quick-action" [routerLink]="['/games']" [queryParams]="{ tab: 'reviews' }"
           appTip="Every written review, newest first">
          <span class="material-symbols-rounded" aria-hidden="true">auto_awesome</span>Reviews
          @if (data.gameReviews().length) { <small>{{ data.gameReviews().length }}</small> }
        </a>
        <a class="view-btn quick-action" [routerLink]="['/review']"
           appTip="What keeps happening in our games: work on, keep doing">
          <span class="material-symbols-rounded" aria-hidden="true">insights</span>Patterns
        </a>
        <a class="view-btn quick-action" [routerLink]="['/tournaments']" [queryParams]="{ view: 'plan' }"
           appTip="Scout the next opponent and plan the bans">
          <span class="material-symbols-rounded" aria-hidden="true">travel_explore</span>Scout the opponent
        </a>
        @if (auth.canEdit()) {
          <a class="view-btn quick-action" [routerLink]="['/scrims']"
             appTip="Drop a .rofl replay from a scrim or a tournament game">
            <span class="material-symbols-rounded" aria-hidden="true">upload_file</span>Import a replay
          </a>
        }
      </div>
    </section>
  `
})
export class QuickActionsComponent {
  protected readonly auth = inject(AuthService);
  protected readonly data = inject(TeamDataService);
}
