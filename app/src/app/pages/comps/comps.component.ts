import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ROLES } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { ChampionChipComponent } from '../../shared/champion-chip.component';
import { OverflowMenuComponent } from '../../shared/overflow-menu.component';

@Component({
  selector: 'app-comps',
  imports: [RouterLink, ChampionChipComponent, OverflowMenuComponent],
  templateUrl: './comps.component.html'
})
export class CompsComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  protected readonly roles = ROLES;

  protected readonly fullView = signal(true);
  protected readonly showPicks = signal(true);

  protected readonly banRows = computed(() =>
    this.data.players().map((p) => ({ role: p.role, name: p.name, bans: p.bans }))
  );

  protected setView(full: boolean): void {
    this.fullView.set(full);
    this.showPicks.set(full);
  }

  // Pick a Material Symbol that reflects the comp's playstyle from its name.
  protected compIcon(name: string): string {
    const n = (name || '').toLowerCase();
    if (n.includes('engage')) return 'bolt';
    if (n.includes('pick')) return 'my_location';
    if (n.includes('poke') || n.includes('siege')) return 'sports_esports';
    if (n.includes('split')) return 'call_split';
    if (n.includes('protect') || n.includes('peel')) return 'shield';
    if (n.includes('teamfight') || n.includes('aoe') || n.includes('wombo')) return 'groups';
    if (n.includes('scal')) return 'trending_up';
    return 'swords';
  }
}
