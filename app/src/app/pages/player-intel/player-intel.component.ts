import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { ChampionChipComponent } from '../../shared/champion-chip.component';
import { ExternalProfilesComponent } from '../../shared/external-profiles.component';
import { OverflowMenuComponent } from '../../shared/overflow-menu.component';
import { PlayerAvatarComponent } from '../../shared/player-avatar.component';

@Component({
  selector: 'app-player-intel',
  imports: [RouterLink, PlayerAvatarComponent, ChampionChipComponent, ExternalProfilesComponent, OverflowMenuComponent],
  templateUrl: './player-intel.component.html'
})
export class PlayerIntelComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);

  protected readonly fullView = signal(false);
  private readonly expanded = signal<Set<string>>(new Set());

  protected isExpanded(id: string): boolean {
    return this.fullView() || this.expanded().has(id);
  }

  protected toggle(id: string): void {
    const next = new Set(this.expanded());
    next.has(id) ? next.delete(id) : next.add(id);
    this.expanded.set(next);
  }
}
