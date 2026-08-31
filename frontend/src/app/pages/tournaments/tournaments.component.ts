import { Component, inject } from '@angular/core';
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
}
