import { ChampionFilterService } from '../../services/champion-filter.service';
import { ChampionFilterComponent } from '../../shared/champion-filter.component';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TeamDataService } from '../../services/team-data.service';
import { OverviewComponent } from '../overview/overview.component';
import { RosterPlayersComponent } from './players/roster-players.component';
import { RosterView, rosterViewOf } from './roster-view';
import { ScoutReportComponent } from './scout-report.component';
import { QuickActionsComponent } from '../../shared/quick-actions.component';
import { TourPillComponent } from '../../shared/tour-pill.component';
import { DetailToggleComponent } from '../../shared/detail-toggle.component';
import { UserPrefsService } from '../../services/user-prefs.service';
import { MotionService } from '../../services/motion.service';
import { rosterCards, buildRoster, ROSTER_SCOPE } from '../../core/roster-build';
import { InViewDirective } from '../../shared/in-view.directive';

/**
 * The roster, three ways: Cards, Players and the Scout report.
 *
 * Overview, Profiles and Player Intel were three nav entries answering the same
 * question — who is on this team and what do they play — at different depths.
 * They became modes of one page, and on 13 Sep 2026 the Table and Scouting modes
 * became one Players view (the lead: "the table and scouting feel like they can
 * be merged… not sure what they actually show"): the Table's only job was the
 * per-queue numbers side by side, Scouting's the practice board and the learn
 * list, and the rest of both repeated the Cards sheet.
 *
 * One Starter | Full switch speaks for all three (12 Sep 2026), and the shell
 * builds the one roster model every view reads.
 */
@Component({
  selector: 'app-roster',
  imports: [OverviewComponent, RosterPlayersComponent, ScoutReportComponent, ChampionFilterComponent, QuickActionsComponent, TourPillComponent, TooltipDirective, DetailToggleComponent, InViewDirective],
  templateUrl: './roster.component.html'
})
export class RosterComponent {
  protected readonly filter = inject(ChampionFilterService);

  /**
   * Everyone on the roster who plays or lists the champion being asked about: the same pool the cards light up by,
   * played for the team and written down (13 Sep 2026; it read the written-down pool alone, so a card could light up
   * while this line said nobody lists them).
   */
  protected readonly playersWith = computed(() => rosterCards(this.model()).filter((c) => this.filter.passes(c.pool.map((e) => e.champion))));

  protected readonly data = inject(TeamDataService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly prefs = inject(UserPrefsService);
  protected readonly motion = inject(MotionService);

  /**
   * The whole roster, built once for all four views (13 Sep 2026): every player's record, form, crown,
   * pool and practice over all time, the way Home reads them. Rebuilt when the team's data moves.
   */
  protected readonly model = computed(() =>
    buildRoster({
      now: Date.now(),
      mode: ROSTER_SCOPE,
      players: this.data.players(),
      fillIns: this.data.fillIns(),
      painPoints: this.data.painPoints(),
      learnEntries: this.data.learnEntries(),
      comps: this.data.comps(),
      analysis: this.data.compAnalysis()?.games ?? [],
      tournaments: this.data.tournaments(),
      series: this.data.tournamentSeries(),
      seriesGames: this.data.seriesGames(),
      scrims: this.data.scrims(),
      practice: this.data.practiceSet(),
      compOverride: (id) => this.data.compOverride(id)
    })
  );

  protected readonly view = signal<RosterView>('cards');
  /** A player to open on Players, from `?player=`: the Cards sheet's Open in Players. */
  protected readonly focusPlayer = signal<string | null>(null);
  /** Every view reads the one preference: Starter is what a reader acts on, Full everything expanded. */
  protected readonly full = computed(() => this.prefs.depthOf('roster') === 'full');

  protected readonly heading = computed(() => {
    const team = this.data.settings().teamName || 'Bom Squad';
    const m = this.model();
    const count = m.starters.length + m.bench.length;
    const kicker = `${count} ${count === 1 ? 'player' : 'players'}${m.fillIns.length ? ` · ${m.fillIns.length} ${m.fillIns.length === 1 ? 'fill-in' : 'fill-ins'}` : ''} · ${m.games} team games`;
    switch (this.view()) {
      case 'players':
        return { title: `${team} Roster`, kicker, blurb: 'Every player’s numbers side by side — open a row for what they are working on and learning.' };
      case 'report':
        return { title: `${team} Roster`, kicker, blurb: 'Us, the way an opponent scouts us: ranks, pools, what beats us, and what they would ban.' };
      default:
        return { title: `${team} Roster`, kicker, blurb: 'Click a player for their sheet.' };
    }
  });

  constructor() {
    // The old routes still resolve here and each names its own mode, so a bookmark to /players or /profiles lands on
    // Players rather than the default; so does a link that still says table or scouting.
    this.route.data.pipe(takeUntilDestroyed()).subscribe((data) => {
      const fromRoute = rosterViewOf(data['view'] as string | undefined);
      if (fromRoute) this.view.set(fromRoute);
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const requested = rosterViewOf(params.get('view'));
      if (requested) this.view.set(requested);
      this.focusPlayer.set(params.get('player'));
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
