import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Player, QueueMatchStats, RankedQueueStats } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { RefreshService } from '../../services/refresh.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { PlayerAvatarComponent } from '../../shared/player-avatar.component';
import { TooltipDirective } from '../../shared/tooltip.directive';

type QueueKey = 'solo' | 'flex' | 'clash';

interface ProfileRow {
  player: Player;
  rank?: RankedQueueStats;
  matches?: QueueMatchStats;
}

@Component({
  selector: 'app-team-profiles',
  imports: [DecimalPipe, RouterLink, PlayerAvatarComponent, TooltipDirective],
  templateUrl: './team-profiles.component.html'
})
export class TeamProfilesComponent {
  /** Hosted inside the Roster page, which supplies the heading and the mode switch. */
  readonly embedded = input(false);

  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  protected readonly refresh = inject(RefreshService);

  protected readonly selectedQueue = signal<QueueKey>('flex');

  protected readonly queueLabel = computed(() => {
    const q = this.selectedQueue();
    return q === 'solo' ? 'Solo/Duo' : q === 'clash' ? 'Clash' : 'Flex';
  });

  protected readonly rows = computed<ProfileRow[]>(() => {
    const queue = this.selectedQueue();
    return this.data.players().map((player) => {
      const stats = player.queueStats?.[queue];
      return { player, rank: stats?.rank, matches: stats?.matches };
    });
  });

  /**
   * Games actually behind the vision average.
   *
   * Absent means the stats were enriched before the count existed, so the game
   * count is the honest answer. Zero means the window genuinely carried no
   * vision score — a cache v4 backfill still working through — and the column
   * shows a dash, because a confident 0 reads as a player who never wards.
   */
  protected visionSample(m: QueueMatchStats): number {
    return m.visionSamples ?? m.games;
  }

  protected visionNote(m: QueueMatchStats): string {
    const n = this.visionSample(m);
    if (!n) return 'No vision score recorded in this sample yet; it fills in as matches refresh.';
    if (n < m.games) return `Vision score over the ${n} of ${m.games} games that recorded one.`;
    return `Average vision score over ${n} games.`;
  }

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

  // ---- Bulk refresh from Riot -------------------------------------------
  //
  // Owned by RefreshService so the run outlives this page: it used to live
  // here, and navigating away lost the progress line while the loop kept
  // writing. The button reads the service's state and cannot start it twice.

  protected readonly refreshingAll = this.refresh.playersRunning;
  protected readonly refreshProgress = this.refresh.playersProgress;

  refreshAll(): void {
    void this.refresh.refreshPlayers();
  }
}
