import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { ChampionChipComponent } from '../../shared/champion-chip.component';
import { ExternalProfilesComponent } from '../../shared/external-profiles.component';
import { PlayerAvatarComponent } from '../../shared/player-avatar.component';

@Component({
  selector: 'app-overview',
  imports: [RouterLink, PlayerAvatarComponent, ChampionChipComponent, ExternalProfilesComponent],
  templateUrl: './overview.component.html'
})
export class OverviewComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);

  protected readonly fullView = signal(false);
  private readonly expanded = signal<Set<string>>(new Set());

  protected readonly resourceGroups = computed(() => Object.entries(this.data.resourceLinks()));
  protected readonly resourceIcon: Record<string, string> = {
    DraftTools: 'DT',
    MacroAndObjectives: 'MO',
    MatchupResearch: 'MR'
  };
  protected readonly resourceIconSymbol: Record<string, string> = {
    DraftTools: 'construction',
    MacroAndObjectives: 'map',
    MatchupResearch: 'query_stats'
  };

  protected isExpanded(id: string): boolean {
    return this.expanded().has(id);
  }

  protected toggle(id: string): void {
    const next = new Set(this.expanded());
    next.has(id) ? next.delete(id) : next.add(id);
    this.expanded.set(next);
  }

  protected groupLabel(group: string): string {
    return group.replace(/([A-Z])/g, ' $1').trim();
  }
}
