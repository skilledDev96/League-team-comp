import { ChampionFilterService } from '../../services/champion-filter.service';
import { ChampionFilterComponent } from '../../shared/champion-filter.component';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TeamDataService } from '../../services/team-data.service';
import { OverviewComponent } from '../overview/overview.component';
import { PlayerIntelComponent } from '../player-intel/player-intel.component';
import { TeamProfilesComponent } from '../profiles/team-profiles.component';

export type RosterView = 'cards' | 'table' | 'scouting';

const VIEWS: RosterView[] = ['cards', 'table', 'scouting'];

/**
 * The roster, three ways.
 *
 * Overview, Profiles and Player Intel were three nav entries answering the same
 * question — who is on this team and what do they play — at different depths,
 * so people had to remember which page held which fact. They are now modes of
 * one page.
 *
 * A shell hosting the three existing components rather than one rewritten
 * page: each already works, carries its own tests and its own state, and
 * folding ~750 lines into a single component would risk all of it to gain
 * nothing a switch does not. Each suppresses its own heading via `embedded`,
 * so the page has one title instead of three.
 */
@Component({
  selector: 'app-roster',
  imports: [OverviewComponent, TeamProfilesComponent, PlayerIntelComponent, ChampionFilterComponent],
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

  protected readonly view = signal<RosterView>('cards');

  protected readonly heading = computed(() => {
    const team = this.data.settings().teamName || 'Bom Squad';
    switch (this.view()) {
      case 'table':
        return { title: `${team} Roster`, blurb: 'Rank, form and champion by player — click a row for the full profile.' };
      case 'scouting':
        return { title: `${team} Roster`, blurb: 'Scouting cards, champion pools, matchup links and the practice board.' };
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
