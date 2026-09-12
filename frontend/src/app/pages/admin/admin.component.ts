import { Component, inject, OnInit } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { TeamDataService } from '../../services/team-data.service';
import { AdminContextService } from './admin-context.service';
import { AdminPlayersService } from './state/admin-players.service';
import { AdminShellService } from './state/admin-shell.service';
import { AdminAccessComponent } from './tabs/access.component';
import { AdminCompsComponent } from './tabs/comps.component';
import { AdminDiagnosticsComponent } from './tabs/diagnostics.component';
import { AdminFillInsComponent } from './tabs/fill-ins.component';
import { AdminPlayersComponent } from './tabs/players.component';
import { AdminSettingsComponent } from './tabs/settings.component';
import { TourPillComponent } from '../../shared/tour-pill.component';
import { AdminTournamentsComponent } from './tabs/tournaments.component';
import { AdminTrophiesComponent } from './tabs/trophies.component';

/**
 * Shell for the admin page: the tab bar, and whichever tab is open.
 *
 * AdminContextService is provided here rather than in root so the working
 * drafts live and die with the page, as they did when this was one component.
 */
@Component({
  selector: 'app-admin',
  providers: [AdminShellService, AdminPlayersService, AdminContextService],
  imports: [AdminSettingsComponent,
    AdminPlayersComponent,
    AdminFillInsComponent,
    AdminCompsComponent,
    AdminTournamentsComponent,
    AdminTrophiesComponent,
    AdminAccessComponent,
    AdminDiagnosticsComponent, TourPillComponent],
  templateUrl: './admin.component.html'
})
export class AdminComponent implements OnInit {
  protected readonly ctx = inject(AdminContextService);
  protected readonly auth = inject(AuthService);
  protected readonly data = inject(TeamDataService);

  /**
   * Open in edit mode, like the draft and plan pages. Every field here is a
   * form: arriving with the header saying "Edit mode" off while the fields
   * accept typing read as a contradiction (5 Sep 2026).
   */
  ngOnInit(): void {
    if (this.auth.canEdit()) this.auth.editMode.set(true);
  }
}
