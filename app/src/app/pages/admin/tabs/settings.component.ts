import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TeamDataService } from '../../../services/team-data.service';
import { NgModelNameDirective } from '../../../shared/ng-model-name.directive';
import { AdminContextService } from '../admin-context.service';

/** Team-wide settings. */
@Component({
  selector: 'app-admin-settings',
  imports: [NgModelNameDirective, FormsModule],
  templateUrl: './settings.component.html'
})
export class AdminSettingsComponent {
  protected readonly ctx = inject(AdminContextService);
  protected readonly data = inject(TeamDataService);
}
