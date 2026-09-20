import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgModelNameDirective } from '../../../shared/ng-model-name.directive';
import { UiService } from '../../../services/ui.service';
import { AdminContextService } from '../admin-context.service';

/** Tournaments the team is entered in, and the one place a split is ended or reopened (21 Sep 2026). */
@Component({
  selector: 'app-admin-tournaments',
  imports: [NgModelNameDirective, FormsModule],
  templateUrl: './tournaments.component.html'
})
export class AdminTournamentsComponent {
  protected readonly ctx = inject(AdminContextService);
  /** For the day an ended split carries; the card prints it the way every other date on the page reads. */
  protected readonly ui = inject(UiService);
}
