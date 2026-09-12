import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChampionDataService } from '../../../services/champion-data.service';
import { TeamDataService } from '../../../services/team-data.service';
import { UiService } from '../../../services/ui.service';
import { NgModelNameDirective } from '../../../shared/ng-model-name.directive';
import { RouterLink } from '@angular/router';
import { AdminContextService } from '../admin-context.service';

/** Team-wide settings. */
@Component({
  selector: 'app-admin-settings',
  imports: [NgModelNameDirective, FormsModule, RouterLink],
  templateUrl: './settings.component.html'
})
export class AdminSettingsComponent {
  protected readonly ctx = inject(AdminContextService);
  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  private readonly champions = inject(ChampionDataService);
  protected readonly championNames = computed(() => this.champions.champions().map((c) => c.name).sort((a, b) => a.localeCompare(b)));
  /** The preview's splash would not load: that champion has no skin under that number. */
  protected readonly previewFailed = signal(false);
}
