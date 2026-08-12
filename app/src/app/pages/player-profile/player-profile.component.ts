import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { ChampionChipComponent } from '../../shared/champion-chip.component';
import { PlayerAvatarComponent } from '../../shared/player-avatar.component';

@Component({
  selector: 'app-player-profile',
  imports: [RouterLink, PlayerAvatarComponent, ChampionChipComponent],
  templateUrl: './player-profile.component.html'
})
export class PlayerProfileComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  private readonly route = inject(ActivatedRoute);

  private readonly params = toSignal(this.route.paramMap);

  protected readonly player = computed(() => {
    const id = this.params()?.get('id');
    const players = this.data.players();
    return players.find((p) => p.id === id) ?? players[0];
  });

  protected readonly buildCount = computed(() => {
    const p = this.player();
    if (!p) return 0;
    return p.top3.length + (p.learn ? 1 : 0);
  });
}
