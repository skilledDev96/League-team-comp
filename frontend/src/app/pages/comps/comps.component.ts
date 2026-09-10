import { ChampionFilterService } from '../../services/champion-filter.service';
import { ChampionFilterComponent } from '../../shared/champion-filter.component';
import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastService } from '../../services/toast.service';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Comp, CompExpectation, CompOutcome, CompPerformance, CompPicks, CompRecord, CompResult, ExpectLevel, Play, Role, ROLES } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { ChampionDataService } from '../../services/champion-data.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { ChampionChipComponent } from '../../shared/champion-chip.component';
import { ChampionPickerComponent } from '../../shared/champion-picker.component';
import { CompBoardComponent } from '../../shared/comp-board.component';
import { compIconFor } from '../../core/comp-identity';
import { effectiveComp } from '../../core/comp-alias';
import { EXPECT_AXES, EXPECT_LABEL, ExpectAxis, LEVEL_LABEL, LEVELS } from '../../core/comp-expectation';
import { CompExpectationService } from '../../services/comp-expectation.service';
import { MotionService } from '../../services/motion.service';
import { OverflowMenuComponent } from '../../shared/overflow-menu.component';
import { TacticalBoardComponent } from './tactical-board.component';
import { NoteRollup, rollupNotes } from './note-insights.util';
import { compToOpen, revealBehavior } from './open-comp.util';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { TourPillComponent } from '../../shared/tour-pill.component';
import { NgModelNameDirective } from '../../shared/ng-model-name.directive';

interface ResultDraft {
  outcome: CompOutcome;
  opponent: string;
  note: string;
  playedOn: string;
}

import { PlayerMarkComponent } from '../../shared/player-mark.component';
@Component({
  selector: 'app-comps',
  imports: [PlayerMarkComponent, DatePipe, FormsModule, RouterLink, ChampionChipComponent, ChampionPickerComponent, CompBoardComponent, OverflowMenuComponent, TacticalBoardComponent, TooltipDirective, NgModelNameDirective, ChampionFilterComponent, TourPillComponent],
  templateUrl: './comps.component.html'
})
export class CompsComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  private readonly champData = inject(ChampionDataService);
  protected readonly roles = ROLES;
  protected readonly filter = inject(ChampionFilterService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly motion = inject(MotionService);

  // ---- Adding a comp, here rather than in Admin (8 Sep 2026) ----------------

  /** The comp whose panel is held open because it was just made, or because a link asked for it. */
  protected readonly openCompId = signal<string | null>(null);

  /** The comp a link asked for with ?comp=<id>, until the list holds it and it has been opened. */
  private readonly wantedComp = signal<string | null>(null);

  constructor() {
    // "Add a comp" from the quick actions lands here with ?add=comp: one
    // blank comp, then the param is dropped so a reload does not add another.
    effect(() => {
      if (this.route.snapshot.queryParamMap.get('add') !== 'comp') return;
      void this.router.navigate([], { relativeTo: this.route, queryParams: { add: null }, queryParamsHandling: 'merge', replaceUrl: true });
      if (this.auth.canEdit()) {
        this.auth.editMode.set(true);
        void this.addComp();
      }
    });

    // The film's draft chapter lands here with ?comp=<id> (10 Sep 2026): after
    // it saved a variant, or when the review names the comp we played. Read as
    // a stream, the way the Games page reads its params, so a second arrival
    // with another id works and not only the first.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const id = params.get('comp');
      if (id) this.wantedComp.set(id);
    });
    // The list may still be empty on the first tick; the effect runs again
    // when the comps land. The decision itself is `compToOpen`, kept pure so
    // it has a spec of its own in bare vitest; the page's spec covers the reveal.
    effect(() => {
      const id = compToOpen(this.wantedComp(), this.data.comps());
      if (id) untracked(() => this.revealComp(id));
    });
    // Leaving the page before the reveal's timer fires must not scroll whatever
    // page comes next (10 Sep 2026: the spec caught one test's card scrolling in
    // the next test).
    inject(DestroyRef).onDestroy(() => clearTimeout(this.revealTimer));
  }

  /** The reveal's pending scroll, so leaving the page cancels it. */
  private revealTimer: ReturnType<typeof setTimeout> | undefined;

  /** Open one comp's panel, drop the param that asked for it and bring its card to the top of the screen. */
  private revealComp(id: string): void {
    this.wantedComp.set(null);
    // The category filter could hide the card; a link to a comp means that comp.
    this.compCategoryFilter.set('all');
    // So could the shared champion filter, which follows across pages (10 Sep 2026, second fix pass: a person who had filtered
    // Games on a champion and then pressed Open <name> in the film for a comp without it landed here with no card, the panel
    // marked open, the param already gone and nothing on screen saying why). Cleared only when it would hide this comp.
    const comp = this.data.comps().find((c) => c.id === id);
    if (comp && !this.filter.passes(this.championsOf(comp))) this.filter.clear();
    this.openCompId.set(id);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { comp: null }, queryParamsHandling: 'merge', replaceUrl: true });
    clearTimeout(this.revealTimer);
    this.revealTimer = setTimeout(() => {
      const card = document.querySelector<HTMLElement>(`[data-comp="${CSS.escape(id)}"]`);
      // Not every DOM has scrollIntoView (jsdom has none); opening the panel is the part that matters, the scroll is the courtesy.
      if (!card || typeof card.scrollIntoView !== 'function') return;
      card.scrollIntoView({ behavior: revealBehavior(this.motion.reduced()), block: 'start' });
    }, 80);
  }

  protected async addComp(): Promise<void> {
    const n = this.data.comps().length + 1;
    const picks = Object.fromEntries(this.roles.map((r) => [r, ''])) as CompPicks;
    const id = await this.data.createComp({ name: `New comp ${n}`, picks });
    this.openCompId.set(id);
    this.saved({ id, name: `New comp ${n}` });
    setTimeout(() => {
      const panel = document.querySelector<HTMLDetailsElement>(`[data-comp="${CSS.escape(id)}"] details.comp-panel`);
      if (!panel) return;
      panel.open = true;
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      panel.querySelector<HTMLElement>('input, .board-slot-main')?.focus();
    }, 80);
  }

  /** One quiet "Saved" per comp every couple of seconds; the page writes on every click. */
  private readonly savedAt = new Map<string, number>();
  private saved(comp: { id: string; name: string }): void {
    const last = this.savedAt.get(comp.id) ?? 0;
    if (Date.now() - last < 2000) return;
    this.savedAt.set(comp.id, Date.now());
    this.toast.show(`Saved ${comp.name}`, { kind: 'ok', timeout: 1800 });
  }

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
    const byCategory = filter === 'all' ? comps : comps.filter((c) => (c.category ?? '') === filter);
    // The shared champion filter: only the comps that champion is drafted in.
    return byCategory.filter((c) => this.filter.passes(this.championsOf(c)));
  });

  /** A comp's five champions as the filter compares them: the pick with its " - note" dropped. */
  private championsOf(comp: Comp): string[] {
    return this.roles.map((r) => this.ui.parseCompLine(comp.picks[r] ?? '').champion);
  }

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

  /**
   * Every other comp, as targets for "counts under".
   *
   * A comp cannot fold into itself, and offering it would create a cycle the
   * backend then has to defend against. Deeper cycles (A→B→A) are still
   * possible from two separate edits, which is why `resolveAlias` guards too.
   */
  protected compsExcept(comp: Comp): Comp[] {
    return this.data.comps().filter((other) => other.id !== comp.id);
  }

  /**
   * The board emits the whole picks object, so this is a straight write. No
   * draft state in between: a pick lands as soon as it is clicked, which is
   * how the rest of edit mode already behaves.
   */
  protected savePicks(comp: Comp, picks: CompPicks): void {
    void this.data.updateComp(this.stamped({ ...comp, picks })).then(() => this.saved(comp));
  }

  protected setCountsUnder(comp: Comp, value: string): void {
    const countsUnder = value || null;
    if ((comp.countsUnder ?? null) === countsUnder) return;
    void this.data.updateComp(this.stamped({ ...comp, countsUnder })).then(() => this.saved(comp));
  }

  // ---- What the comp is expected to do ------------------------------------
  //
  // Four axes read off the champions, overruled by hand on the panel. Written
  // on every save so the review function always finds a value on the comp;
  // rendered live so a trait refresh flows through the comps nobody edited.

  protected readonly expectAxes = EXPECT_AXES;
  protected readonly expectLabel = EXPECT_LABEL;
  protected readonly levelLabel = LEVEL_LABEL;
  protected readonly levels = LEVELS;

  private readonly expectations = inject(CompExpectationService);

  protected expectationOf(comp: Comp): { expect: CompExpectation; source: 'derived' | 'edited' } | null {
    return this.expectations.forComp(comp);
  }

  protected setExpectation(comp: Comp, axis: ExpectAxis, level: ExpectLevel, current: CompExpectation): void {
    if (current[axis] === level && comp.expectSource === 'edited') return;
    void this.data.updateComp({ ...comp, expect: { ...current, [axis]: level }, expectSource: 'edited' }).then(() => this.saved(comp));
  }

  protected resetExpectation(comp: Comp): void {
    void this.data.updateComp({ ...comp, expect: this.expectations.derived(comp) ?? undefined, expectSource: 'derived' });
  }

  /** The comp with its derived expectation on it, unless a person set one. */
  private stamped(comp: Comp): Comp {
    return this.expectations.stamped(comp);
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
    void this.data
      .updateComp(
        this.stamped({
          ...comp,
          category: category || undefined,
          notes: notes || undefined,
          gamePlan,
          bans
        })
      )
      .then(() => this.saved(comp));
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

  /** The games that count as a comp, overrides and countsUnder applied — never `game.compId` alone. */
  private gamesOf(compId: string) {
    const comps = this.data.comps();
    return (this.data.compAnalysis()?.games ?? []).filter((g) => effectiveComp(g.compId, this.data.compOverride(g.matchId), comps)?.id === compId);
  }

  /**
   * What the post-game reviews said about this comp: how many times the
   * game played out as drafted, and how many times it went off plan.
   */
  protected playedOut(compId: string): { reviewed: number; asDrafted: number; offPlan: number; unclear: number; offPlanWhy: string[] } | null {
    const ids = new Set(this.gamesOf(compId).map((g) => g.matchId));
    const reviews = this.data.gameReviews().filter((r) => ids.has(r.matchId));
    if (!reviews.length) return null;
    return {
      reviewed: reviews.length,
      asDrafted: reviews.filter((r) => r.team.compVerdict === 'as drafted').length,
      offPlan: reviews.filter((r) => r.team.compVerdict === 'off plan').length,
      unclear: reviews.filter((r) => r.team.compVerdict === 'unclear').length,
      offPlanWhy: reviews.filter((r) => r.team.compVerdict === 'off plan' && r.team.compWhy).map((r) => r.team.compWhy).slice(0, 3)
    };
  }

  protected retro(compId: string): NoteRollup | null {
    const games = this.gamesOf(compId);
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
    return (this.data.compAnalysis()?.comps ?? []).find((c) => c.compId === compId);
  }
  protected panelBadge(
    compId: string
  ): { wins: number; losses: number; winRate: number; source: 'log' | 'ranked' } | null {
    const logged = this.recordFor(compId);
    if (logged) {
      return { wins: logged.wins, losses: logged.losses, winRate: logged.winRate, source: 'log' };
    }
    const ranked = (this.data.compAnalysis()?.comps ?? []).find((c) => c.compId === compId);
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
    const when = this.ui.formatDay(result.playedOn);
    const who = result.opponent ? ` against ${result.opponent}` : '';
    if (!confirm(`Delete the logged ${result.outcome}${who} on ${when}?`)) return;
    void this.data.deleteCompResult(result.id);
  }

  private blankDraft(): ResultDraft {
    return { outcome: 'win', opponent: '', note: '', playedOn: this.today() };
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * The comp's shape as a glyph, read from its five champions.
   *
   * Shared with the draft room through compIconFor, so the same comp carries
   * the same mark in both places — which is the only thing an icon here is
   * for. This used to guess from the name alone and left most comps on the
   * generic fallback: Dive, Skirmish, Exodia and Arrows and Spears match no
   * keyword while their champions say plainly what they are.
   */
  protected compIcon(comp: Comp): string {
    return compIconFor(this.expectations.traitsOf(comp), comp.name);
  }
}
