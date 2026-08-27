import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LearnEntry, LearnPriority, PainPoint, Player } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { ChampionDataService } from '../../services/champion-data.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { ChampionChipComponent } from '../../shared/champion-chip.component';
import { ChampionPickerComponent } from '../../shared/champion-picker.component';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { ExternalProfilesComponent } from '../../shared/external-profiles.component';
import { OverflowMenuComponent } from '../../shared/overflow-menu.component';
import { PlayerAvatarComponent } from '../../shared/player-avatar.component';
import { NgModelNameDirective } from '../../shared/ng-model-name.directive';

interface PainRow extends PainPoint {
  playerName: string;
}

@Component({
  selector: 'app-player-intel',
  imports: [FormsModule,
    RouterLink,
    PlayerAvatarComponent,
    ChampionChipComponent,
    ChampionPickerComponent,
    TooltipDirective,
    ExternalProfilesComponent,
    OverflowMenuComponent, NgModelNameDirective],
  templateUrl: './player-intel.component.html'
})
export class PlayerIntelComponent {
  /** Hosted inside the Roster page, which supplies the heading and the mode switch. */
  readonly embedded = input(false);

  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  protected readonly champData = inject(ChampionDataService);

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

  // ---- Champs to learn --------------------------------------------------

  protected readonly learnPriorities: LearnPriority[] = ['high', 'med', 'low'];
  // Per-player add-form draft: playerId -> { champion, priority }.
  protected readonly learnDrafts = signal<Record<string, { champion: string; priority: LearnPriority }>>({});
  protected readonly learnSaving = signal(false);

  private readonly priorityRank: Record<LearnPriority, number> = { high: 0, med: 1, low: 2 };

  // A player's learn queue: still-learning first, then by priority, then order.
  protected learnFor(playerId: string): LearnEntry[] {
    return this.data
      .learnEntries()
      .filter((e) => e.playerId === playerId)
      .sort(
        (a, b) =>
          Number(a.status === 'ready') - Number(b.status === 'ready') ||
          this.priorityRank[a.priority] - this.priorityRank[b.priority] ||
          a.order - b.order
      );
  }

  protected priorityLabel(priority: LearnPriority): string {
    return priority === 'med' ? 'Medium' : priority === 'high' ? 'High' : 'Low';
  }

  /** The learn draft's champion as a list, for the single-slot picker. */
  protected learnPick(playerId: string): string[] {
    const champion = this.learnDraftFor(playerId).champion;
    return champion ? [champion] : [];
  }

  protected learnDraftFor(playerId: string): { champion: string; priority: LearnPriority } {
    return this.learnDrafts()[playerId] ?? { champion: '', priority: 'med' };
  }

  protected patchLearnDraft(playerId: string, patch: Partial<{ champion: string; priority: LearnPriority }>): void {
    this.learnDrafts.update((state) => ({
      ...state,
      [playerId]: { ...this.learnDraftFor(playerId), ...patch }
    }));
  }

  protected async addLearn(playerId: string): Promise<void> {
    const draft = this.learnDraftFor(playerId);
    const champion = draft.champion.trim();
    if (this.learnSaving() || !champion) return;
    this.learnSaving.set(true);
    try {
      await this.data.createLearnEntry({ playerId, champion, priority: draft.priority, status: 'learning' });
      this.patchLearnDraft(playerId, { champion: '' });
    } finally {
      this.learnSaving.set(false);
    }
  }

  // ---- Champion pool -----------------------------------------------------
  //
  // Editable here rather than only in admin: the pool is read on this page, so
  // the moment you notice it is wrong is the moment you want to fix it.

  private readonly poolOpenIds = signal<ReadonlySet<string>>(new Set());

  protected isPoolOpen(playerId: string): boolean {
    return this.poolOpenIds().has(playerId);
  }

  protected togglePoolEdit(playerId: string): void {
    this.poolOpenIds.update((ids) => {
      const next = new Set(ids);
      if (next.has(playerId)) {
        next.delete(playerId);
      } else {
        next.add(playerId);
      }
      return next;
    });
  }

  /** First entry is shown as the Main Champion, so order is meaningful. */
  protected savePool(player: Player, champions: string[]): void {
    void this.data.updatePlayer({ ...player, top3: champions });
  }

  protected toggleLearnStatus(entry: LearnEntry): void {
    void this.data.updateLearnEntry({ ...entry, status: entry.status === 'ready' ? 'learning' : 'ready' });
  }

  protected setLearnPriority(entry: LearnEntry, priority: LearnPriority): void {
    void this.data.updateLearnEntry({ ...entry, priority });
  }

  protected deleteLearn(id: string): void {
    void this.data.deleteLearnEntry(id);
  }
}
