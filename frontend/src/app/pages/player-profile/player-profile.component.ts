import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { RefreshService } from '../../services/refresh.service';
import { ActivityService } from '../../services/activity.service';
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
  protected readonly refresh = inject(RefreshService);
  private readonly activity = inject(ActivityService);
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

    // Vision and building damage can rest on fewer games than the queue played,
    // while cache v4 backfills. Weighting them by `games` would let a queue with
    // no numbers at all pull the other one towards zero, so they are weighted by
    // their own samples and fall back to the game count when those are absent.
    const bySample = (
      a: number,
      b: number,
      firstN = first.games,
      secondN = second.games
    ): number => (firstN + secondN > 0 ? (a * firstN + b * secondN) / (firstN + secondN) : 0);
    const visionA = first.visionSamples ?? first.games;
    const visionB = second.visionSamples ?? second.games;
    const buildA = first.buildingSamples ?? first.games;
    const buildB = second.buildingSamples ?? second.games;
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
      avgBuildingDamage: bySample(first.avgBuildingDamage, second.avgBuildingDamage, buildA, buildB),
      avgVisionScore: bySample(first.avgVisionScore, second.avgVisionScore, visionA, visionB),
      visionSamples: visionA + visionB,
      buildingSamples: buildA + buildB,
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
      const outcome = await this.activity.run(
        `Refreshing ${p.name}`,
        () => this.refresh.refreshPlayer(p),
        { detail: 'ranked history from Riot' }
      );
      this.refreshStatus.set(outcome === 'updated'
        ? 'Updated from Riot.'
        : "Couldn't fetch live Riot data for this player — check the Riot ID.");
    } catch (err) {
      this.refreshStatus.set(err instanceof Error ? err.message : 'Refresh failed.');
    } finally {
      this.refreshing.set(false);
      setTimeout(() => this.refreshStatus.set(''), 3000);
    }
  }

}
