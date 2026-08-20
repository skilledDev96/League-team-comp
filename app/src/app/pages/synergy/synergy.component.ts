import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { SynergyService } from '../../services/synergy.service';
import { TeamDataService } from '../../services/team-data.service';
import { PremadeGroupStats, SynergyQueue } from '../../models/team.models';
import { PlayerAvatarComponent } from '../../shared/player-avatar.component';

type GroupFilter = 'all' | 'duos' | 'trios' | 'full';
type SortMode = 'games' | 'winRate';
type ViewMode = 'groups' | 'individual';

@Component({
  selector: 'app-synergy',
  imports: [RouterLink, PlayerAvatarComponent],
  templateUrl: './synergy.component.html'
})
export class SynergyComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly auth = inject(AuthService);
  private readonly synergy = inject(SynergyService);
  protected readonly viewMode = signal<ViewMode>('groups');
  protected readonly queue = signal<SynergyQueue>('RANKED_FLEX_SR');
  protected readonly groupFilter = signal<GroupFilter>('all');
  protected readonly sortMode = signal<SortMode>('games');
  protected readonly groups = signal<PremadeGroupStats[]>([]);
  protected readonly loading = signal(false);
  protected readonly status = signal('');

  protected readonly visibleGroups = computed(() => {
    const queue = this.queue();
    const filter = this.groupFilter();
    return this.groups()
      .filter((group) => group.queueType === queue)
      .filter((group) => filter === 'all' || (filter === 'duos' && group.playerIds.length === 2) || (filter === 'trios' && group.playerIds.length === 3) || (filter === 'full' && group.playerIds.length >= 4))
      .sort((a, b) => this.sortMode() === 'games' ? b.games - a.games : b.winRate - a.winRate);
  });

  protected readonly rosterStats = computed(() => {
    const solo = this.queue() === 'RANKED_SOLO_5x5';
    return this.data.players().map((player) => ({
      player,
      stats: solo ? player.queueStats?.solo : player.queueStats?.flex
    }));
  });

  async refresh(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.status.set('Fetching recent ranked games...');
    try {
      this.groups.set(await this.synergy.load(this.data.players()));
      this.status.set(this.groups().length ? 'Updated from Riot match history.' : 'No shared ranked games found yet.');
    } catch (error) {
      this.status.set(error instanceof Error ? error.message : 'Unable to load team synergy.');
    } finally {
      this.loading.set(false);
    }
  }

  protected queueLabel(queue: SynergyQueue): string {
    return queue === 'RANKED_FLEX_SR' ? 'Flex' : 'Solo/Duo';
  }
}