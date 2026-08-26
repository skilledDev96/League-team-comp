import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Comp, CompOutcome, CompPerformance, CompRecord, CompResult, Play, Role, ROLES } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { ChampionDataService } from '../../services/champion-data.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { ChampionChipComponent } from '../../shared/champion-chip.component';
import { ChampionPickerComponent } from '../../shared/champion-picker.component';
import { OverflowMenuComponent } from '../../shared/overflow-menu.component';
import { TacticalBoardComponent } from './tactical-board.component';
import { NoteRollup, rollupNotes } from './note-insights.util';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { NgModelNameDirective } from '../../shared/ng-model-name.directive';

interface ResultDraft {
  outcome: CompOutcome;
  opponent: string;
  note: string;
  playedOn: string;
}

@Component({
  selector: 'app-comps',
  imports: [DatePipe, FormsModule, RouterLink, ChampionChipComponent, ChampionPickerComponent, OverflowMenuComponent, TacticalBoardComponent, TooltipDirective, NgModelNameDirective],
  templateUrl: './comps.component.html'
})
export class CompsComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  private readonly champData = inject(ChampionDataService);
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

  protected compBanList(comp: Comp): string[] {
    return this.compBansValue(comp)
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);
  }

  protected saveCompBans(comp: Comp, bans: string[]): void {
    this.banDrafts.update((s) => ({ ...s, [comp.id]: bans.join(', ') }));
    this.saveCompMeta(comp);
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


  // Collapsed-panel badge: prefer the manually logged record, else fall back to
  // the backend's match-history record. The strictness slider lives on the
  // Analysis page, so this reads the backend value rather than re-deriving it.

  // Match-history record for a comp, straight from the backend result. The
  // strictness slider lives on Analysis, so this page shows the stored value.
  // ---- Retro notes ------------------------------------------------------
  //
  // Every note written on a game this comp was played in. Deliberately kept out
  // of the comp panel itself and behind a disclosure: fifty games means fifty
  // notes, and the useful part is the pattern across them, not the transcript.
  // What surfaces first is which champions keep getting named when we lose.

  protected retro(compId: string): NoteRollup | null {
    const games = this.data.compAnalysis()?.games.filter((g) => g.compId === compId) ?? [];
    const notes = games
      .map((game) => ({
        matchId: game.matchId,
        text: this.data.matchNote(game.matchId),
        win: game.win,
        date: game.date
      }))
      .filter((note) => Boolean(note.text));

    if (!notes.length) return null;
    return rollupNotes(notes, this.champData.champions().map((c) => c.name));
  }

  /** Collapsed to the newest few until asked; comps with history get long. */
  private readonly expandedRetros = signal<Set<string>>(new Set());
  protected readonly retroPreviewSize = 3;

  protected retroExpanded(compId: string): boolean {
    return this.expandedRetros().has(compId);
  }

  protected toggleRetroAll(compId: string): void {
    this.expandedRetros.update((set) => {
      const next = new Set(set);
      if (next.has(compId)) {
        next.delete(compId);
      } else {
        next.add(compId);
      }
      return next;
    });
  }

  protected rankedRecord(compId: string): CompPerformance | undefined {
    return this.data.compAnalysis()?.comps.find((c) => c.compId === compId);
  }
  protected panelBadge(
    compId: string
  ): { wins: number; losses: number; winRate: number; source: 'log' | 'ranked' } | null {
    const logged = this.recordFor(compId);
    if (logged) {
      return { wins: logged.wins, losses: logged.losses, winRate: logged.winRate, source: 'log' };
    }
    const ranked = this.data.compAnalysis()?.comps.find((c) => c.compId === compId);
    if (ranked) {
      return { wins: ranked.wins, losses: ranked.losses, winRate: ranked.winRate, source: 'ranked' };
    }
    return null;
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
