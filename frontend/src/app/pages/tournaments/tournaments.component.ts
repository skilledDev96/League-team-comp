import { Component, effect, inject, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TournamentDraftComponent } from './draft/draft.component';
import { TournamentPlanComponent } from './plan/plan.component';
import { TournamentContextService } from './tournament-context.service';
import { ChampionDataService } from '../../services/champion-data.service';

/**
 * Shell for the tournament page. Planning and drafting are different jobs —
 * one read at leisure, the other mid-draft with the clock running — so each
 * gets its own component, and this only chooses between them.
 */
@Component({
  selector: 'app-tournaments',
  imports: [TournamentPlanComponent, TournamentDraftComponent],
  templateUrl: './tournaments.component.html'
})
export class TournamentsComponent {
  protected readonly ctx = inject(TournamentContextService);
  protected readonly champData = inject(ChampionDataService);

  /**
   * Held on the context service, not here.
   *
   * The draft view links straight to an opponent's prep panel, which lives
   * on the plan view — so something both of them can see has to own which
   * one is showing.
   */
  protected readonly view = this.ctx.view;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  constructor() {
    // A shared link names the view, the series and the game. Read once on
    // open; after that the address bar follows the page, not the other way.
    const params = this.route.snapshot.queryParamMap;
    const series = params.get('series') ?? '';
    const game = params.get('game') ?? '';
    if (params.get('view') === 'draft' || series || game) {
      this.ctx.openDraft(series, game);
    }
    if (params.get('view') === 'plan') this.ctx.view.set('plan');

    // Keep the address bar current, so copying it always shares what is on
    // screen. Replaced rather than pushed: each pick is not a page in the
    // history and Back should leave the tournament, not walk the draft.
    effect(() => {
      const view = this.view();
      const seriesId = this.ctx.shownSeriesId();
      const gameId = this.ctx.shownGameId();
      const queryParams =
        view === 'draft' && seriesId
          ? { view, series: seriesId, game: gameId || null }
          : { view: null, series: null, game: null };
      untracked(() =>
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams,
          queryParamsHandling: 'merge',
          replaceUrl: true
        })
      );
    });
  }
}
