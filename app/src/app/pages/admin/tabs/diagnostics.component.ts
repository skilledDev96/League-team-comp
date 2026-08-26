import { Component, inject } from '@angular/core';
import { TeamDataService } from '../../../services/team-data.service';
import { AdminContextService } from '../admin-context.service';

/** Build, key health and the analysis funnel. */
@Component({
  selector: 'app-admin-diagnostics',
  templateUrl: './diagnostics.component.html'
})
export class AdminDiagnosticsComponent {
  protected readonly ctx = inject(AdminContextService);
  protected readonly data = inject(TeamDataService);
}
