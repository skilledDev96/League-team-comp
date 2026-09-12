import { ChampionFilterService } from '../../services/champion-filter.service';
import { ChampionFilterComponent } from '../../shared/champion-filter.component';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TeamDataService } from '../../services/team-data.service';
import { OverviewComponent } from '../overview/overview.component';
import { PlayerIntelComponent } from '../player-intel/player-intel.component';
import { TeamProfilesComponent } from '../profiles/team-profiles.component';
import { ScoutReportComponent } from './scout-report.component';
import { QuickActionsComponent } from '../../shared/quick-actions.component';
import { TourPillComponent } from '../../shared/tour-pill.component';
import { DetailToggleComponent } from '../../shared/detail-toggle.component';
import { UserPrefsService } from '../../services/user-prefs.service';

export type RosterView = 'cards' | 'table' | 'scouting' | 'report';

const VIEWS: RosterView[] = ['cards', 'table', 'scouting', 'report'];

/**
 * The roster, four ways.
 *
 * Overview, Profiles and Player Intel were three nav entries answering the same
 * question — who is on this team and what do they play — at different depths,
 * so people had to remember which page held which fact. They are now modes of
 * one page, with the Scout report as the fourth.
 *
 * One Starter | Full switch speaks for all four (12 Sep 2026). There used to be
 * two unrelated ones — Cards' own and Scouting's own, neither remembered — and
 * none at all on the Scout report, the densest thing the app draws.
 *
 * A shell hosting the three existing components rather than one rewritten
 * page: each already works, carries its own tests and its own state, and
 * folding ~750 lines into a single component would risk all of it to gain
 * nothing a switch does not. Each suppresses its own heading via `embedded`,
 * so the page has one title instead of three.
 */
@Component({
  selector: 'app-roster',
  imports: [OverviewComponent, TeamProfilesComponent, PlayerIntelComponent, ScoutReportComponent, ChampionFilterComponent, QuickActionsComponent, TourPillComponent, TooltipDirective, DetailToggleComponent],
  templateUrl: './roster.component.html'
})
export class RosterComponent {
  protected readonly filter = inject(ChampionFilterService);

  /** Our players whose listed pool has the champion being asked about. */
  protected readonly playersWith = computed(() =>
    this.data.players().filter((p) => this.filter.passes(p.top3 ?? []))
  );

  protected readonly data = inject(TeamDataService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly prefs = inject(UserPrefsService);

  protected readonly view = signal<RosterView>('cards');
  /** Every view reads the one preference: Starter is what a reader acts on, Full everything expanded. */
  protected readonly full = computed(() => this.prefs.depthOf('roster') === 'full');

  protected readonly heading = computed(() => {
    const team = this.data.settings().teamName || 'Bom Squad';
    switch (this.view()) {
      case 'table':
        return { title: `${team} Roster`, blurb: 'Rank, form and champion by player — click a row for the full profile.' };
      case 'scouting':
        return { title: `${team} Roster`, blurb: 'Scouting cards, champion pools, matchup links and the practice board.' };
      case 'report':
        return { title: `${team} Roster`, blurb: 'Us, the way an opponent scouts us: ranks, pools, what beats us, and what they would ban.' };
      default:
        return { title: `${team} Roster`, blurb: 'Who plays what, and how they are playing right now.' };
    }
  });

  constructor() {
    // The old routes still resolve here and each names its own mode, so a
    // bookmark to /profiles lands on the table rather than the default.
    this.route.data.pipe(takeUntilDestroyed()).subscribe((data) => {
      const fromRoute = data['view'] as RosterView | undefined;
      if (fromRoute && VIEWS.includes(fromRoute)) this.view.set(fromRoute);
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const requested = params.get('view') as RosterView | null;
      if (requested && VIEWS.includes(requested)) this.view.set(requested);
    });
  }

  /**
   * Switching writes the mode into the URL, so a view can be linked and a
   * reload does not silently drop back to cards.
   */
  protected setView(view: RosterView): void {
    this.view.set(view);
    void this.router.navigate(['/roster'], { queryParams: { view }, replaceUrl: true });
  }
}
