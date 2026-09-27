import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../services/auth.service';
import { TeamScopeService } from '../../../services/team-scope.service';
import { NgModelNameDirective } from '../../../shared/ng-model-name.directive';
import { OverflowMenuComponent } from '../../../shared/overflow-menu.component';
import { ROLE_HELP } from '../../../core/access';
import { DEFAULT_TEAM_ID } from '../../../core/team-scope';
import { AdminContextService } from '../admin-context.service';

/**
 * Who can read and who can edit: the active team's own list (release 3, 27 Sep 2026). On the default team it is
 * Bom Squad's root list and the tab reads exactly as before; on any other team it is that team's, and the head
 * says so.
 */
@Component({
  selector: 'app-admin-access',
  imports: [OverflowMenuComponent, NgModelNameDirective, FormsModule],
  templateUrl: './access.component.html'
})
export class AdminAccessComponent {
  protected readonly roleHelp = ROLE_HELP;
  protected readonly ctx = inject(AdminContextService);
  protected readonly auth = inject(AuthService);
  private readonly scope = inject(TeamScopeService);
  /** True on a team that is not the default, whose list is its own. */
  protected readonly onTeam = computed(() => this.scope.activeTeamId() !== DEFAULT_TEAM_ID);
}
