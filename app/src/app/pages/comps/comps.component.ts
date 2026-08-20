import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Comp, CompOutcome, CompPerformance, CompRecord, CompResult, OffBookGame, Play, ROLES } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { CompAnalysisService } from '../../services/comp-analysis.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { ChampionChipComponent } from '../../shared/champion-chip.component';
import { OverflowMenuComponent } from '../../shared/overflow-menu.component';
import { TacticalBoardComponent } from './tactical-board.component';

interface ResultDraft {
  outcome: CompOutcome;
  opponent: string;
  note: string;
  playedOn: string;
}

interface LogRow extends CompResult {
  compName: string;
}

@Component({
  selector: 'app-comps',
  imports: [DatePipe, FormsModule, RouterLink, ChampionChipComponent, OverflowMenuComponent, TacticalBoardComponent],
  templateUrl: './comps.component.html'
})
export class CompsComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  private readonly analysis = inject(CompAnalysisService);
  protected readonly roles = ROLES;

  // Start calm: Starter view with comp panels collapsed.
  protected readonly fullView = signal(false);
  protected readonly showPicks = signal(false);

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

  // Saved tactical plays grouped by comp id.
  protected readonly playsByComp = computed(() => {
    const map = new Map<string, Play[]>();
    for (const play of this.data.plays()) {
      const list = map.get(play.compId) ?? [];
      list.push(play);
      map.set(play.compId, list);
    }
    return map;
  });

  protected playsFor(compId: string): Play[] {
    return this.playsByComp().get(compId) ?? [];
  }

  // Board overlay state: which comp/play is open, if any.
  protected readonly boardComp = signal<Comp | null>(null);
  protected readonly boardPlay = signal<Play | null>(null);

  protected openBoard(comp: Comp, play: Play | null): void {
    this.boardPlay.set(play);
    this.boardComp.set(comp);
  }

  protected closeBoard(): void {
    this.boardComp.set(null);
    this.boardPlay.set(null);
  }

  // ---- Team-wide game log ----------------------------------------------

  protected readonly logCompFilter = signal<string>('all');
  protected readonly logResultFilter = signal<'all' | 'win' | 'loss'>('all');

  private compName(compId: string): string {
    return this.data.comps().find((c) => c.id === compId)?.name ?? 'Unknown comp';
  }

  // Every logged game, newest-first, with its comp name, after the active filters.
  protected readonly logRows = computed<LogRow[]>(() => {
    const comp = this.logCompFilter();
    const result = this.logResultFilter();
    return this.data
      .compResults()
      .filter((r) => (comp === 'all' || r.compId === comp) && (result === 'all' || r.outcome === result))
      .map((r) => ({ ...r, compName: this.compName(r.compId) }))
      .sort((a, b) => (a.playedOn === b.playedOn ? b.order - a.order : b.playedOn.localeCompare(a.playedOn)));
  });

  // Win/loss totals for whatever the filters currently show.
  protected readonly logSummary = computed(() => {
    const rows = this.logRows();
    const wins = rows.filter((r) => r.outcome === 'win').length;
    const games = rows.length;
    return { games, wins, losses: games - wins, winRate: games ? Math.round((wins / games) * 100) : 0 };
  });

  // ---- Riot match analysis ---------------------------------------------

  protected readonly analysisLoading = signal(false);
  protected readonly analysisError = signal('');
  protected readonly showOffBook = signal(false);

  protected offBookRecord(games: OffBookGame[]): { wins: number; losses: number } {
    const wins = games.filter((g) => g.win).length;
    return { wins, losses: games.length - wins };
  }

  protected async refreshAnalysis(): Promise<void> {
    if (this.analysisLoading()) return;
    this.analysisLoading.set(true);
    this.analysisError.set('');
    try {
      const result = await this.analysis.refresh(this.data.players(), this.data.comps());
      // In Firebase mode the cache doc updates via onSnapshot; set directly as a
      // fallback so the UI reflects the fresh result immediately.
      this.data.compAnalysis.set(result);
    } catch (err) {
      this.analysisError.set(err instanceof Error ? err.message : 'Analysis failed.');
    } finally {
      this.analysisLoading.set(false);
    }
  }

  // Keep / work-on / drop signal from win rate and sample size.
  protected verdict(perf: CompPerformance): { label: string; tone: 'good' | 'warn' | 'neutral' } {
    if (perf.games < 3) return { label: 'Low sample', tone: 'neutral' };
    if (perf.winRate >= 60) return { label: 'Keep', tone: 'good' };
    if (perf.winRate < 40) return { label: 'Drop', tone: 'warn' };
    return { label: 'Work on', tone: 'neutral' };
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
