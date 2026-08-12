import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { PlayerEnrichmentService } from '../../services/player-enrichment.service';
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
  protected readonly auth = inject(AuthService);
  private readonly enrichment = inject(PlayerEnrichmentService);
  private readonly route = inject(ActivatedRoute);

  private readonly params = toSignal(this.route.paramMap);

  protected readonly refreshing = signal(false);
  protected readonly refreshStatus = signal('');

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

  async refreshData(): Promise<void> {
    const p = this.player();
    if (!p || this.refreshing()) {
      return;
    }
    this.refreshing.set(true);
    this.refreshStatus.set('Refreshing from Riot...');
    try {
      const enriched = await this.enrichment.enrichPlayer({
        summonerName: p.name,
        riotTag: p.profile?.riotTag,
        region: p.profile?.region,
        role: p.role,
        mobalyticsSlug: p.profile?.mobalyticsSlug
      });
      await this.data.updatePlayer({
        ...p,
        role: enriched.role ?? p.role,
        icon: enriched.iconUrl ?? p.icon,
        playstyle: enriched.playstyle || p.playstyle,
        strengths: enriched.strengths.length ? enriched.strengths : p.strengths,
        weaknesses: enriched.weaknesses.length ? enriched.weaknesses : p.weaknesses,
        top3: enriched.top3?.length ? enriched.top3 : p.top3,
        learn: enriched.learn ?? p.learn,
        bans: enriched.bans?.length ? enriched.bans : p.bans
      });
      this.refreshStatus.set(`Updated from ${enriched.provider}.`);
    } catch (err) {
      this.refreshStatus.set(err instanceof Error ? err.message : 'Refresh failed.');
    } finally {
      this.refreshing.set(false);
      setTimeout(() => this.refreshStatus.set(''), 3000);
    }
  }
}
