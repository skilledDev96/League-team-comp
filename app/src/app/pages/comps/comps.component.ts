import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CompOutcome, CompRecord, CompResult, ROLES } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { ChampionChipComponent } from '../../shared/champion-chip.component';
import { OverflowMenuComponent } from '../../shared/overflow-menu.component';

interface ResultDraft {
  outcome: CompOutcome;
  opponent: string;
  note: string;
  playedOn: string;
}

@Component({
  selector: 'app-comps',
  imports: [FormsModule, RouterLink, ChampionChipComponent, OverflowMenuComponent],
  templateUrl: './comps.component.html'
})
export class CompsComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  protected readonly roles = ROLES;

  protected readonly fullView = signal(true);
  protected readonly showPicks = signal(true);

  // Comp id -> whether its result-log form is expanded (editors only).
  protected readonly logging = signal<Record<string, boolean>>({});
  // Comp id -> draft being entered in that form.
  protected readonly drafts = signal<Record<string, ResultDraft>>({});
  protected readonly saving = signal(false);

  // Win/loss record per comp, keyed by comp id, with results newest-first.
  protected readonly recordsByComp = computed(() => {
    const map = new Map<string, CompRecord>();
    for (const result of this.data.compResults()) {
      const record = map.get(result.compId) ?? { games: 0, wins: 0, losses: 0, winRate: 0, results: [] };
      record.games += 1;
      if (result.outcome === 'win') {
        record.wins += 1;
      } else {
        record.losses += 1;
      }
      record.results.push(result);
      map.set(result.compId, record);
    }
    for (const record of map.values()) {
      record.winRate = record.games ? Math.round((record.wins / record.games) * 100) : 0;
      record.results.sort((a, b) => b.order - a.order);
    }
    return map;
  });

  protected recordFor(compId: string): CompRecord | undefined {
    return this.recordsByComp().get(compId);
  }

  protected readonly banRows = computed(() =>
    this.data.players().map((p) => ({ role: p.role, name: p.name, bans: p.bans }))
  );

  protected setView(full: boolean): void {
    this.fullView.set(full);
    this.showPicks.set(full);
  }

  protected isLogging(compId: string): boolean {
    return !!this.logging()[compId];
  }

  protected toggleLog(compId: string): void {
    const open = !this.isLogging(compId);
    this.logging.update((state) => ({ ...state, [compId]: open }));
    if (open && !this.drafts()[compId]) {
      this.drafts.update((state) => ({ ...state, [compId]: this.blankDraft() }));
    }
  }

  protected draftFor(compId: string): ResultDraft {
    return this.drafts()[compId] ?? this.blankDraft();
  }

  protected patchDraft(compId: string, patch: Partial<ResultDraft>): void {
    this.drafts.update((state) => ({
      ...state,
      [compId]: { ...this.draftFor(compId), ...patch }
    }));
  }

  protected async logResult(compId: string): Promise<void> {
    if (this.saving()) {
      return;
    }
    const draft = this.draftFor(compId);
    this.saving.set(true);
    try {
      await this.data.createCompResult({
        compId,
        outcome: draft.outcome,
        opponent: draft.opponent.trim() || undefined,
        note: draft.note.trim() || undefined,
        playedOn: draft.playedOn || this.today()
      });
      // Reset the draft but keep the form open for logging another game.
      this.drafts.update((state) => ({ ...state, [compId]: this.blankDraft() }));
    } finally {
      this.saving.set(false);
    }
  }

  protected deleteResult(result: CompResult): void {
    void this.data.deleteCompResult(result.id);
  }

  private blankDraft(): ResultDraft {
    return { outcome: 'win', opponent: '', note: '', playedOn: this.today() };
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  // Pick a Material Symbol that reflects the comp's playstyle from its name.
  protected compIcon(name: string): string {
    const n = (name || '').toLowerCase();
    if (n.includes('engage')) return 'bolt';
    if (n.includes('pick')) return 'my_location';
    if (n.includes('poke') || n.includes('siege')) return 'sports_esports';
    if (n.includes('split')) return 'call_split';
    if (n.includes('protect') || n.includes('peel')) return 'shield';
    if (n.includes('teamfight') || n.includes('aoe') || n.includes('wombo')) return 'groups';
    if (n.includes('scal')) return 'trending_up';
    return 'swords';
  }
}
