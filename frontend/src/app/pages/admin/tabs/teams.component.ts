import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgModelNameDirective } from '../../../shared/ng-model-name.directive';
import { OverflowMenuComponent } from '../../../shared/overflow-menu.component';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { AdminContextService } from '../admin-context.service';
import { RosterImportStatusComponent } from './roster-import-status.component';

/**
 * Admin › Teams (27 Sep 2026, release 2, Stage 3): the teams this site holds, a switch to each, and
 * the fold that creates one from an op.gg multi-link. Admin only, mounted inside the shell's
 * `canManageUsers()` guard. The state and the flow live in `AdminTeamsService`, reached through the
 * context like every other tab's.
 */
@Component({
  selector: 'app-admin-teams',
  imports: [FormsModule, NgModelNameDirective, OverflowMenuComponent, TooltipDirective, RosterImportStatusComponent],
  templateUrl: './teams.component.html'
})
export class AdminTeamsComponent {
  protected readonly ctx = inject(AdminContextService);
}
