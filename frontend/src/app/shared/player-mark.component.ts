import { Component, computed, inject, input } from '@angular/core';
import { TeamDataService } from '../services/team-data.service';
import { UiService } from '../services/ui.service';

/**
 * A summoner's icon at text size, for a name in a table cell or a chip
 * (9 Sep 2026). Looks the name up on the roster and the fill-ins; a name
 * nobody on our side carries renders nothing, so the cell reads as before.
 */
@Component({
  selector: 'app-player-mark',
  template: `@if (src(); as s) { <img class="player-mark" [src]="s" alt="" loading="lazy" /> }`
})
export class PlayerMarkComponent {
  private readonly data = inject(TeamDataService);
  private readonly ui = inject(UiService);

  readonly name = input<string>('');

  protected readonly src = computed(() => {
    const wanted = this.name().trim().toLowerCase();
    if (!wanted) return null;
    const player = this.data.players().find((p) => p.name.toLowerCase() === wanted);
    const icon = player?.icon ?? this.data.fillIns().find((f) => f.summoner.toLowerCase() === wanted)?.icon;
    return icon ? this.ui.summonerIconUrl(icon) || null : null;
  });
}
