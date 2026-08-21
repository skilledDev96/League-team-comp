import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AnalysisGame, Comp, CompOutcome, CompPerformance, CompPicks, CompRecord, CompResult, Play, Role, ROLES } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { CompAnalysisService } from '../../services/comp-analysis.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { ChampionChipComponent } from '../../shared/champion-chip.component';
import { OverflowMenuComponent } from '../../shared/overflow-menu.component';
import { compVerdict, formatDamage, winLossRecord } from './comp-stats.util';
import { TacticalBoardComponent } from './tactical-board.component';

interface ResultDraft {
  outcome: CompOutcome;
  opponent: string;
  note: string;
  playedOn: string;
}

interface LogRow {
  id: string;
  compId: string | null;
  compName: string;
  outcome: CompOutcome;
  opponent?: string;
  note?: string;
  playedOn: string;
  // Epoch ms used only for sorting (match-history games carry a real timestamp).
  sortKey: number;
  source: 'logged' | 'match';
  // Present for manually-logged rows so they can be deleted.
  result?: CompResult;
}

@Component({
  selector: 'app-comps',
  imports: [DatePipe, NgTemplateOutlet, FormsModule, RouterLink, ChampionChipComponent, OverflowMenuComponent, TacticalBoardComponent],
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

  // ---- Comp categories + notes -----------------------------------------

  protected readonly categorySuggestions = ['Meta', 'Comfort', 'For Fun', 'Themed', 'Practice'];
  protected readonly compCategoryFilter = signal<string>('all');

  // Distinct categories actually in use, for the filter control.
  protected readonly compCategories = computed<string[]>(() => {
    const seen = new Set<string>();
    for (const c of this.data.comps()) {
      if (c.category) seen.add(c.category);
    }
    return [...seen].sort();
  });

  protected readonly visibleComps = computed<Comp[]>(() => {
    const filter = this.compCategoryFilter();
    const comps = this.data.comps();
    return filter === 'all' ? comps : comps.filter((c) => (c.category ?? '') === filter);
  });

  // Per-comp game plan, phase by phase — the macro that applies to this draft.
  protected readonly gamePlanPhases = [
    { key: 'early' as const, label: 'Early', hint: 'Lanes, jungle path, first objectives…' },
    { key: 'mid' as const, label: 'Mid', hint: 'Grouping, tempo, objective priority…' },
    { key: 'late' as const, label: 'Late', hint: 'Win condition, teamfight shape…' }
  ];

  // Per-comp inline edit drafts (category + notes + game plan + bans), saved on blur.
  private readonly catDrafts = signal<Record<string, string>>({});
  private readonly noteDrafts = signal<Record<string, string>>({});
  private readonly planDrafts = signal<Record<string, Partial<Record<'early' | 'mid' | 'late', string>>>>({});
  private readonly banDrafts = signal<Record<string, string>>({});

  protected compCategoryValue(comp: Comp): string {
    return this.catDrafts()[comp.id] ?? comp.category ?? '';
  }

  protected compNotesValue(comp: Comp): string {
    return this.noteDrafts()[comp.id] ?? comp.notes ?? '';
  }

  protected setCategoryDraft(comp: Comp, value: string): void {
    this.catDrafts.update((s) => ({ ...s, [comp.id]: value }));
  }

  protected setNotesDraft(comp: Comp, value: string): void {
    this.noteDrafts.update((s) => ({ ...s, [comp.id]: value }));
  }

  protected hasGamePlan(comp: Comp): boolean {
    const p = comp.gamePlan;
    return !!(p && (p.early || p.mid || p.late));
  }

  protected gamePlanValue(comp: Comp, phase: 'early' | 'mid' | 'late'): string {
    return this.planDrafts()[comp.id]?.[phase] ?? comp.gamePlan?.[phase] ?? '';
  }

  protected setGamePlanDraft(comp: Comp, phase: 'early' | 'mid' | 'late', value: string): void {
    this.planDrafts.update((s) => ({ ...s, [comp.id]: { ...s[comp.id], [phase]: value } }));
  }

  protected compBansValue(comp: Comp): string {
    return this.banDrafts()[comp.id] ?? (comp.bans ?? []).join(', ');
  }

  protected setBansDraft(comp: Comp, value: string): void {
    this.banDrafts.update((s) => ({ ...s, [comp.id]: value }));
  }

  protected saveCompMeta(comp: Comp): void {
    const category = this.compCategoryValue(comp).trim();
    const notes = this.compNotesValue(comp).trim();
    const early = this.gamePlanValue(comp, 'early').trim();
    const mid = this.gamePlanValue(comp, 'mid').trim();
    const late = this.gamePlanValue(comp, 'late').trim();
    const gamePlan = early || mid || late
      ? { ...(early && { early }), ...(mid && { mid }), ...(late && { late }) }
      : undefined;
    const bansList = this.compBansValue(comp)
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);
    const bans = bansList.length ? bansList : undefined;
    const planUnchanged =
      (early || undefined) === comp.gamePlan?.early &&
      (mid || undefined) === comp.gamePlan?.mid &&
      (late || undefined) === comp.gamePlan?.late;
    const bansUnchanged = bansList.join('|') === (comp.bans ?? []).join('|');
    if (
      (category || undefined) === comp.category &&
      (notes || undefined) === comp.notes &&
      planUnchanged &&
      bansUnchanged
    ) {
      return;
    }
    void this.data.updateComp({
      ...comp,
      category: category || undefined,
      notes: notes || undefined,
      gamePlan,
      bans
    });
  }

  // Which roster players can fill a given role, so a comp shows its cover:
  // the main-role player first, then anyone who can flex into it.
  protected rolePlayers(role: Role): { name: string; flex: boolean }[] {
    return this.data
      .players()
      .filter((p) => p.role === role || (p.secondaryRoles ?? []).includes(role))
      .map((p) => ({ name: p.name, flex: p.role !== role }));
  }

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

  // The game log merges two sources so it reflects every known game: games
  // manually logged per comp, and games auto-detected from Riot match history.
  // Match-history rows are read-only; manual rows can be deleted.
  protected readonly logRows = computed<LogRow[]>(() => {
    const comp = this.logCompFilter();
    const result = this.logResultFilter();

    const logged: LogRow[] = this.data.compResults().map((r) => ({
      id: r.id,
      compId: r.compId,
      compName: this.compName(r.compId),
      outcome: r.outcome,
      opponent: r.opponent,
      note: r.note,
      playedOn: r.playedOn,
      sortKey: Date.parse(r.playedOn) || 0,
      source: 'logged' as const,
      result: r
    }));

    const matches: LogRow[] = (this.data.compAnalysis()?.games ?? [])
      .filter((g) => g.compId)
      .map((g) => ({
        id: `match-${g.matchId}`,
        compId: g.compId,
        compName: g.compName ?? this.compName(g.compId as string),
        outcome: (g.win ? 'win' : 'loss') as CompOutcome,
        opponent: undefined,
        note: g.queue,
        playedOn: new Date(g.date).toLocaleDateString(),
        sortKey: g.date,
        source: 'match' as const
      }));

    return [...logged, ...matches]
      .filter(
        (r) =>
          (comp === 'all' || r.compId === comp) && (result === 'all' || r.outcome === result)
      )
      .sort((a, b) => b.sortKey - a.sortKey);
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

  // Queue filter for the analysis panel ('all' or a specific queue label).
  protected readonly analysisQueue = signal<string>('all');

  // Queues present in the analysed games, for the filter control.
  protected readonly analysisQueues = computed<string[]>(() => {
    const seen = new Set<string>();
    for (const g of this.data.compAnalysis()?.games ?? []) {
      if (g.queue) seen.add(g.queue);
    }
    return [...seen];
  });

  // Games after the queue filter is applied.
  protected readonly filteredGames = computed<AnalysisGame[]>(() => {
    const games = this.data.compAnalysis()?.games ?? [];
    const queue = this.analysisQueue();
    return queue === 'all' ? games : games.filter((g) => g.queue === queue);
  });

  // Per-comp performance aggregated from the filtered games, so the queue
  // filter drives the table (not just the game lists). `partials` counts games
  // that were 4-stacks (one player subbed), so the record stays transparent.
  protected readonly compRows = computed<(CompPerformance & { partials: number })[]>(() => {
    const byComp = new Map<string, { compId: string; compName: string; games: number; wins: number; partials: number }>();
    for (const g of this.filteredGames()) {
      if (!g.compId) continue;
      const acc = byComp.get(g.compId) ?? { compId: g.compId, compName: g.compName ?? 'Comp', games: 0, wins: 0, partials: 0 };
      acc.games += 1;
      if (g.win) acc.wins += 1;
      if ((g.rosterCount ?? 5) < 5) acc.partials += 1;
      byComp.set(g.compId, acc);
    }
    return [...byComp.values()]
      .map((a) => ({ ...a, losses: a.games - a.wins, winRate: a.games ? Math.round((a.wins / a.games) * 100) : 0 }))
      .sort((a, b) => b.games - a.games || b.winRate - a.winRate);
  });

  // Off-book games: stacks not credited to a comp record — either a full team
  // game whose champs don't match any comp, or a 3-of-5 partial stack.
  protected readonly offBookGames = computed<AnalysisGame[]>(() =>
    this.filteredGames().filter((g) => !g.compId)
  );

  protected offBookRecord = winLossRecord;

  // The champions that make up a defined comp, by name — for the "what comp is
  // this" tag shown on each analysed game.
  protected compChampions(name: string | null | undefined): string[] {
    if (!name) return [];
    const comp = this.data.comps().find((c) => c.name === name);
    if (!comp) return [];
    return ROLES.map((r) => this.ui.parseCompLine(comp.picks[r] ?? '').champion).filter(Boolean);
  }

  private normChamp(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Whether a played champion is one of the (matched or closest) comp's picks —
  // drives the per-row "part of this comp" indicator.
  protected champInComp(game: AnalysisGame, champion: string): boolean {
    const picks = this.compChampions(game.compName || game.nearCompName);
    if (!picks.length) return false;
    const target = this.normChamp(champion);
    return picks.some((c) => this.normChamp(c) === target);
  }

  // "4/5" style label for how much of the roster was on our team that game.
  protected stackLabel(game: AnalysisGame): string {
    const n = game.rosterCount ?? 5;
    return `${n}/5`;
  }

  // ---- Analytics from the filtered games -------------------------------

  // Win rate by map side (blue/red).
  protected readonly sideSplit = computed(() => {
    const record = (side: 'blue' | 'red') => {
      const list = this.filteredGames().filter((g) => g.side === side);
      const wins = list.filter((g) => g.win).length;
      return {
        games: list.length,
        wins,
        losses: list.length - wins,
        winRate: list.length ? Math.round((wins / list.length) * 100) : 0
      };
    };
    return { blue: record('blue'), red: record('red') };
  });

  // Most recent games (already newest-first) for a W/L form strip.
  protected readonly recentForm = computed(() => this.filteredGames().slice(0, 12));

  // Win rate against each enemy champion, split into toughest and best (min 2 games).
  protected readonly matchups = computed(() => {
    const byChamp = new Map<string, { champion: string; games: number; wins: number }>();
    for (const g of this.filteredGames()) {
      for (const champ of g.enemyChampions ?? []) {
        const acc = byChamp.get(champ) ?? { champion: champ, games: 0, wins: 0 };
        acc.games += 1;
        if (g.win) acc.wins += 1;
        byChamp.set(champ, acc);
      }
    }
    const rows = [...byChamp.values()]
      .filter((c) => c.games >= 2)
      .map((c) => ({ ...c, losses: c.games - c.wins, winRate: Math.round((c.wins / c.games) * 100) }));
    return {
      toughest: [...rows].sort((a, b) => a.winRate - b.winRate || b.games - a.games).slice(0, 5),
      best: [...rows].sort((a, b) => b.winRate - a.winRate || b.games - a.games).slice(0, 5)
    };
  });

  // Compact damage label, e.g. 24312 -> "24.3k".
  protected fmtDamage = formatDamage;

  // ---- Define a comp from an off-book game ------------------------------

  // matchId -> draft comp name being typed.
  protected readonly compDrafts = signal<Record<string, string>>({});
  // matchIds already saved as a comp this session.
  protected readonly savedComps = signal<Set<string>>(new Set());

  protected compDraft(matchId: string): string {
    return this.compDrafts()[matchId] ?? '';
  }

  protected setCompDraft(matchId: string, name: string): void {
    this.compDrafts.update((state) => ({ ...state, [matchId]: name }));
  }

  protected isSavedAsComp(matchId: string): boolean {
    return this.savedComps().has(matchId);
  }

  protected async saveAsComp(game: AnalysisGame): Promise<void> {
    const name = this.compDraft(game.matchId).trim();
    if (!name || this.isSavedAsComp(game.matchId)) return;
    const picks = {} as CompPicks;
    for (const role of ROLES) {
      picks[role] = '';
    }
    for (const p of game.players) {
      if ((ROLES as string[]).includes(p.position)) {
        picks[p.position as Role] = p.champion;
      }
    }
    await this.data.createComp({ name, picks });
    this.savedComps.update((set) => new Set(set).add(game.matchId));
  }

  // Match-analysis record for a comp panel, keyed by comp id.
  protected analysisFor(compId: string): CompPerformance | undefined {
    return this.data.compAnalysis()?.comps.find((c) => c.compId === compId);
  }

  // Collapsed-panel badge: prefer the manually logged record, fall back to the
  // match-history record so comps with only Riot data still show a win ratio.
  protected panelBadge(
    compId: string
  ): { wins: number; losses: number; winRate: number; source: 'log' | 'ranked' } | null {
    const logged = this.recordFor(compId);
    if (logged) {
      return { wins: logged.wins, losses: logged.losses, winRate: logged.winRate, source: 'log' };
    }
    const ranked = this.analysisFor(compId);
    if (ranked) {
      return { wins: ranked.wins, losses: ranked.losses, winRate: ranked.winRate, source: 'ranked' };
    }
    return null;
  }

  // The full-5-stack games credited to one comp, for its expandable detail.
  protected analysisGamesFor(compId: string): AnalysisGame[] {
    return this.filteredGames().filter((g) => g.compId === compId);
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
  protected verdict = compVerdict;

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
