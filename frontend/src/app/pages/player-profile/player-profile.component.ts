import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { PlayerEnrichmentService } from '../../services/player-enrichment.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { PlayerQueueStats, QueueMatchStats, RankedQueueStats } from '../../models/team.models';
import { ChampionChipComponent } from '../../shared/champion-chip.component';
import { ExternalProfilesComponent } from '../../shared/external-profiles.component';
import { OverflowMenuComponent } from '../../shared/overflow-menu.component';
import { PlayerAvatarComponent } from '../../shared/player-avatar.component';
import { TooltipDirective } from '../../shared/tooltip.directive';

@Component({
  selector: 'app-player-profile',
  imports: [RouterLink, PlayerAvatarComponent, ChampionChipComponent, ExternalProfilesComponent, OverflowMenuComponent, TooltipDirective],
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
  protected readonly selectedQueue = signal<'flex' | 'solo' | 'clash' | 'combined'>('flex');

  protected readonly player = computed(() => {
    const id = this.params()?.get('id');
    const players = this.data.players();
    return players.find((p) => p.id === id) ?? players[0];
  });

  protected readonly buildCount = computed(() => {
    const p = this.player();
    if (!p) return 0;
    return p.top3.length;
  });

  protected readonly selectedQueueLabel = computed(() => {
    const queue = this.selectedQueue();
    if (queue === 'flex') return 'Flex';
    if (queue === 'solo') return 'Solo/Duo';
    if (queue === 'clash') return 'Clash';
    return 'Combined ranked';
  });

  protected readonly selectedQueueStats = computed<PlayerQueueStats | undefined>(() => {
    const p = this.player();
    if (!p?.queueStats) return undefined;
    if (this.selectedQueue() === 'flex') return p.queueStats.flex;
    if (this.selectedQueue() === 'solo') return p.queueStats.solo;
    if (this.selectedQueue() === 'clash') return p.queueStats.clash;
    return { matches: this.combineMatchStats(p.queueStats.solo?.matches, p.queueStats.flex?.matches) };
  });

  protected readonly selectedRank = computed<RankedQueueStats | undefined>(() => this.selectedQueueStats()?.rank);
  protected readonly selectedMatches = computed<QueueMatchStats | undefined>(() => this.selectedQueueStats()?.matches);

  private combineMatchStats(first?: QueueMatchStats, second?: QueueMatchStats): QueueMatchStats | undefined {
    if (!first && !second) return undefined;
    if (!first) return second;
    if (!second) return first;
    const totalGames = first.games + second.games;
    const weighted = (a: number, b: number): number => (a * first.games + b * second.games) / totalGames;
    return {
      games: totalGames,
      wins: first.wins + second.wins,
      losses: first.losses + second.losses,
      winRate: Math.round(((first.wins + second.wins) / totalGames) * 100),
      avgKills: weighted(first.avgKills, second.avgKills),
      avgDeaths: weighted(first.avgDeaths, second.avgDeaths),
      avgAssists: weighted(first.avgAssists, second.avgAssists),
      avgKda: weighted(first.avgKda, second.avgKda),
      avgCsPerMin: weighted(first.avgCsPerMin, second.avgCsPerMin),
      avgKillParticipation: weighted(first.avgKillParticipation, second.avgKillParticipation),
      avgDamageShare: weighted(first.avgDamageShare, second.avgDamageShare),
      avgTankShare: weighted(first.avgTankShare, second.avgTankShare),
      avgBuildingDamage: weighted(first.avgBuildingDamage, second.avgBuildingDamage),
      avgVisionScore: weighted(first.avgVisionScore, second.avgVisionScore),
      playstyle: 'Combined ranked performance',
      strengths: [...new Set([...first.strengths, ...second.strengths])].slice(0, 3),
      weaknesses: [...new Set([...first.weaknesses, ...second.weaknesses])].slice(0, 3),
      top3: [...new Set([...first.top3, ...second.top3])].slice(0, 3),
      bans: [...new Set([...first.bans, ...second.bans])].slice(0, 3)
    };
  }

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
        bans: enriched.bans?.length ? enriched.bans : p.bans,
        queueStats: enriched.queueStats ?? p.queueStats
      });
      this.refreshStatus.set(enriched.source === 'provider'
        ? `Updated from ${enriched.provider}.`
        : `Couldn't fetch live Riot data: ${enriched.provider.replace(/^template-fallback:\s*/, '')}`);
    } catch (err) {
      this.refreshStatus.set(err instanceof Error ? err.message : 'Refresh failed.');
    } finally {
      this.refreshing.set(false);
      setTimeout(() => this.refreshStatus.set(''), 3000);
    }
  }
}
