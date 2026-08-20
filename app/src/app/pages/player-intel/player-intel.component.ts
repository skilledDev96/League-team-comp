import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PainPoint } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { ChampionChipComponent } from '../../shared/champion-chip.component';
import { ExternalProfilesComponent } from '../../shared/external-profiles.component';
import { OverflowMenuComponent } from '../../shared/overflow-menu.component';
import { PlayerAvatarComponent } from '../../shared/player-avatar.component';

interface PainRow extends PainPoint {
  playerName: string;
}

@Component({
  selector: 'app-player-intel',
  imports: [
    FormsModule,
    RouterLink,
    PlayerAvatarComponent,
    ChampionChipComponent,
    ExternalProfilesComponent,
    OverflowMenuComponent
  ],
  templateUrl: './player-intel.component.html'
})
export class PlayerIntelComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);

  protected readonly fullView = signal(false);
  private readonly expanded = signal<Set<string>>(new Set());

  protected isExpanded(id: string): boolean {
    return this.fullView() || this.expanded().has(id);
  }

  protected toggle(id: string): void {
    const next = new Set(this.expanded());
    next.has(id) ? next.delete(id) : next.add(id);
    this.expanded.set(next);
  }

  // ---- Pain points / practice board -------------------------------------

  protected readonly ppPlayerFilter = signal<string>('all');
  protected readonly ppStatusFilter = signal<'all' | 'open' | 'resolved'>('open');
  protected readonly ppNewPlayer = signal<string>('');
  protected readonly ppNewText = signal<string>('');
  protected readonly ppSaving = signal(false);

  protected playerName(id: string): string {
    return this.data.players().find((p) => p.id === id)?.name ?? 'Unknown';
  }

  // Pain points for one player, open first then resolved.
  protected painFor(playerId: string): PainPoint[] {
    return this.data
      .painPoints()
      .filter((p) => p.playerId === playerId)
      .sort((a, b) => Number(a.resolved) - Number(b.resolved) || a.order - b.order);
  }

  // The filtered team board rows.
  protected readonly painRows = computed<PainRow[]>(() => {
    const player = this.ppPlayerFilter();
    const status = this.ppStatusFilter();
    return this.data
      .painPoints()
      .filter((p) => player === 'all' || p.playerId === player)
      .filter((p) => status === 'all' || (status === 'resolved' ? p.resolved : !p.resolved))
      .map((p) => ({ ...p, playerName: this.playerName(p.playerId) }))
      .sort((a, b) => Number(a.resolved) - Number(b.resolved) || a.order - b.order);
  });

  protected readonly painSummary = computed(() => {
    const all = this.data.painPoints();
    const open = all.filter((p) => !p.resolved).length;
    return { open, resolved: all.length - open, total: all.length };
  });

  protected async addPain(): Promise<void> {
    const playerId = this.ppNewPlayer();
    const text = this.ppNewText().trim();
    if (this.ppSaving() || !playerId || !text) return;
    this.ppSaving.set(true);
    try {
      await this.data.createPainPoint({ playerId, text, resolved: false });
      this.ppNewText.set('');
    } finally {
      this.ppSaving.set(false);
    }
  }

  protected toggleResolved(pain: PainPoint): void {
    void this.data.updatePainPoint({ ...pain, resolved: !pain.resolved });
  }

  protected deletePain(id: string): void {
    void this.data.deletePainPoint(id);
  }
}
