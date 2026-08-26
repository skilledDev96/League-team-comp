import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgModelNameDirective } from '../../../shared/ng-model-name.directive';
import { AdminContextService } from '../admin-context.service';

/** Tournaments the team is entered in. */
@Component({
  selector: 'app-admin-tournaments',
  imports: [NgModelNameDirective, FormsModule],
  templateUrl: './tournaments.component.html'
})
export class AdminTournamentsComponent {
  protected readonly ctx = inject(AdminContextService);
}
