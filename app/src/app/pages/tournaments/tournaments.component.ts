import { Component, inject, signal } from '@angular/core';
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

  protected readonly view = signal<'plan' | 'draft'>('plan');
}
