import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Player, QueueMatchStats, RankedQueueStats } from '../../models/team.models';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { PlayerAvatarComponent } from '../../shared/player-avatar.component';

type QueueKey = 'solo' | 'flex';

interface ProfileRow {
  player: Player;
  rank?: RankedQueueStats;
  matches?: QueueMatchStats;
}

@Component({
  selector: 'app-team-profiles',
  imports: [DecimalPipe, RouterLink, PlayerAvatarComponent],
  templateUrl: './team-profiles.component.html'
})
export class TeamProfilesComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);

  protected readonly selectedQueue = signal<QueueKey>('flex');

  protected readonly rows = computed<ProfileRow[]>(() => {
    const queue = this.selectedQueue();
    return this.data.players().map((player) => {
      const stats = player.queueStats?.[queue];
      return { player, rank: stats?.rank, matches: stats?.matches };
    });
  });

  // Roster totals for the selected queue.
  protected readonly summary = computed(() => {
    const withStats = this.rows().filter((r) => r.matches);
    const games = withStats.reduce((sum, r) => sum + (r.matches?.games ?? 0), 0);
    const wins = withStats.reduce((sum, r) => sum + (r.matches?.wins ?? 0), 0);
    return {
      players: withStats.length,
      games,
      winRate: games ? Math.round((wins / games) * 100) : 0
    };
  });

  protected rankLabel(rank?: RankedQueueStats): string {
    if (!rank?.tier) return 'Unranked';
    const tier = rank.tier.charAt(0) + rank.tier.slice(1).toLowerCase();
    return rank.rank ? `${tier} ${rank.rank}` : tier;
  }
}
