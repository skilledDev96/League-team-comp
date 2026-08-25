import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Player, QueueMatchStats, RankedQueueStats } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { PlayerEnrichmentService } from '../../services/player-enrichment.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { PlayerAvatarComponent } from '../../shared/player-avatar.component';

type QueueKey = 'solo' | 'flex' | 'clash';

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
  protected readonly auth = inject(AuthService);
  private readonly enrichment = inject(PlayerEnrichmentService);

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

  protected readonly refreshingAll = signal(false);
  protected readonly refreshProgress = signal('');
  protected readonly refreshMessage = signal('');

  async refreshAll(): Promise<void> {
    if (this.refreshingAll()) return;
    const players = this.data.players();
    this.refreshingAll.set(true);
    this.refreshMessage.set('');
    let done = 0;
    let failed = 0;
    for (const [i, p] of players.entries()) {
      this.refreshProgress.set(`${p.name} (${i + 1}/${players.length})`);
      try {
        const enriched = await this.enrichment.enrichPlayer({
          summonerName: p.name,
          riotTag: p.profile?.riotTag,
          region: p.profile?.region,
          role: p.role,
          mobalyticsSlug: p.profile?.mobalyticsSlug
        });
        if (enriched.source !== 'provider') {
          failed += 1;
          continue;
        }
        await this.data.updatePlayer({
          ...p,
          role: enriched.role ?? p.role,
          icon: enriched.iconUrl ?? p.icon,
          playstyle: enriched.playstyle || p.playstyle,
          strengths: enriched.strengths.length ? enriched.strengths : p.strengths,
          weaknesses: enriched.weaknesses.length ? enriched.weaknesses : p.weaknesses,
          top3: this.enrichment.mergeChampionPool(p.top3, enriched.top3),
          bans: enriched.bans?.length ? enriched.bans : p.bans,
          queueStats: enriched.queueStats ?? p.queueStats
        });
        done += 1;
      } catch {
        failed += 1;
      }
    }
    this.refreshProgress.set('');
    this.refreshingAll.set(false);
    this.refreshMessage.set(
      failed
        ? `Updated ${done}, ${failed} failed — check the Riot key and each player's Riot ID.`
        : `Updated all ${done} players from Riot.`
    );
    setTimeout(() => this.refreshMessage.set(''), 6000);
  }
}
