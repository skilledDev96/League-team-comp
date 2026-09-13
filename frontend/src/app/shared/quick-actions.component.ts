import { Component, inject, input } from '@angular/core';
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
    @if (compact()) {
      <!-- In the Roster's slim title (13 Sep 2026): the same doors as pills, no card around them. -->
      <nav class="quick-actions is-compact" aria-label="Quick actions" data-tour="quick-actions">
        @if (auth.canEdit()) {
          <a class="view-btn hero-pill quick-action" [routerLink]="['/games']" [queryParams]="{ refresh: 1 }" appTip="Fetch the games we just played from Riot, then open the new ones to look at">
            <span class="material-symbols-rounded" aria-hidden="true">sync</span>We just practiced
          </a>
        }
        <a class="view-btn hero-pill quick-action" [routerLink]="['/tournaments']" [queryParams]="{ view: 'draft' }" appTip="The draft room on Prep &amp; Draft, on the next open game">
          <span class="material-symbols-rounded" aria-hidden="true">swords</span>Ready to draft
        </a>
        <a class="view-btn hero-pill quick-action" [routerLink]="['/tournaments']" [queryParams]="{ view: 'plan' }" appTip="Scout the next opponent and plan the bans">
          <span class="material-symbols-rounded" aria-hidden="true">travel_explore</span>Scout the opponent
        </a>
        @if (auth.canEdit()) {
          <a class="view-btn hero-pill quick-action" [routerLink]="['/comps']" [queryParams]="{ add: 'comp' }" appTip="A blank comp on the Comps page, opened with its board">
            <span class="material-symbols-rounded" aria-hidden="true">add_circle</span>Add a comp
          </a>
          <a class="view-btn hero-pill quick-action" [routerLink]="['/tournaments']" [queryParams]="{ view: 'plan', group: 'scrims' }" appTip="Drop a .rofl replay on Prep &amp; Draft; it becomes a game against that team">
            <span class="material-symbols-rounded" aria-hidden="true">upload_file</span>Import a replay
          </a>
        }
        <a class="view-btn hero-pill quick-action" [routerLink]="['/games']" [queryParams]="{ tab: 'reviews' }" appTip="The newest post-game review, open in full">
          <span class="material-symbols-rounded" aria-hidden="true">rate_review</span>Reviews@if (data.gameReviews().length) { <span class="quick-action-count">{{ data.gameReviews().length }}</span>}
        </a>
      </nav>
    } @else {
    <section class="card quick-actions" aria-label="Quick actions" data-tour="quick-actions">
      <span class="quick-actions-label"><span class="material-symbols-rounded" aria-hidden="true">bolt</span>Quick actions</span>
      <div class="quick-actions-row">
        @if (auth.canEdit()) {
          <a class="view-btn active quick-action" [routerLink]="['/games']" [queryParams]="{ refresh: 1 }"
             appTip="Fetch the games we just played from Riot, then open the new ones to look at">
            <span class="material-symbols-rounded" aria-hidden="true">sync</span>We just practiced
          </a>
        }
        <a class="view-btn quick-action" [routerLink]="['/tournaments']" [queryParams]="{ view: 'draft' }"
           appTip="The draft room on Prep &amp; Draft, on the next open game">
          <span class="material-symbols-rounded" aria-hidden="true">swords</span>Ready to draft
        </a>
        @if (auth.canEdit()) {
          <a class="view-btn quick-action" [routerLink]="['/comps']" [queryParams]="{ add: 'comp' }"
             appTip="A blank comp on the Comps page, opened with its board">
            <span class="material-symbols-rounded" aria-hidden="true">add_circle</span>Add a comp
          </a>
        }
        <a class="view-btn quick-action" [routerLink]="['/tournaments']" [queryParams]="{ view: 'plan' }"
           appTip="Scout the next opponent and plan the bans">
          <span class="material-symbols-rounded" aria-hidden="true">travel_explore</span>Scout the opponent
        </a>
        @if (auth.canEdit()) {
          <a class="view-btn quick-action" [routerLink]="['/tournaments']" [queryParams]="{ view: 'plan', group: 'scrims' }"
             appTip="Drop a .rofl replay on Prep &amp; Draft; it becomes a game against that team">
            <span class="material-symbols-rounded" aria-hidden="true">upload_file</span>Import a replay
          </a>
        }
      </div>
      <p class="quick-actions-also muted">
        Also:
        <a [routerLink]="['/games']" [queryParams]="{ tab: 'reviews' }">Reviews@if (data.gameReviews().length) { ({{ data.gameReviews().length }})}</a>
        ·
        <a [routerLink]="['/review']">Patterns</a>
      </p>
    </section>
    }
  `
})
export class QuickActionsComponent {
  /** Pills only, for a page title; the card with its label is the default. */
  readonly compact = input(false);

  protected readonly auth = inject(AuthService);
  protected readonly data = inject(TeamDataService);
}
