import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AnalysisGame, CompOutcome, CompPerformance, CompPicks, CompResult, Role, ROLES } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { ChampionDataService } from '../../services/champion-data.service';
import { CompAnalysisService } from '../../services/comp-analysis.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { MatchNoteButtonComponent } from '../../shared/match-note-button.component';
import { MatchNoteComponent } from '../../shared/match-note.component';
import { compVerdict, formatDamage, winLossRecord } from '../comps/comp-stats.util';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { NgModelNameDirective } from '../../shared/ng-model-name.directive';
import { effectiveComp } from '../../core/comp-alias';

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
  // Present for match-history rows so the row can jump to its game panel.
  matchId?: string;
  // Present for manually-logged rows so they can be deleted.
  result?: CompResult;
}

@Component({
  selector: 'app-analysis',
  imports: [DatePipe, NgTemplateOutlet, FormsModule, MatchNoteComponent, MatchNoteButtonComponent, TooltipDirective, NgModelNameDirective],
  templateUrl: './analysis.component.html'
})
export class AnalysisComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  private readonly analysis = inject(CompAnalysisService);
  private readonly champs = inject(ChampionDataService);
  protected readonly roles = ROLES;

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

    // Under a champion filter only games that carry champions can answer, so
    // the hand-logged results — a comp and a result, no picks — step aside.
    const want = this.championFilter().trim();
    const key = want ? this.championKey(want) : '';
    const matches: LogRow[] = (this.data.compAnalysis()?.games ?? [])
      .filter((g) => g.compId)
      .filter((g) => !key || g.players.some((p) => this.championKey(p.champion) === key))
      .map((g) => ({
        id: `match-${g.matchId}`,
        compId: g.compId,
        compName: g.compName ?? this.compName(g.compId as string),
        outcome: (g.win ? 'win' : 'loss') as CompOutcome,
        opponent: undefined,
        note: g.queue,
        playedOn: new Date(g.date).toLocaleDateString(),
        sortKey: g.date,
        source: 'match' as const,
        matchId: g.matchId
      }));

    return [...(key ? [] : logged), ...matches]
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

  /** Lives on the service so it survives navigating away mid-run. */
  protected readonly analysisLoading = this.analysis.running;
  protected readonly analysisError = signal('');
  protected readonly showOffBook = signal(false);

  // ---- Deep link to one game --------------------------------------------
  //
  // The tournament prep list links here with ?match=<id>. A game panel lives
  // inside a collapsed comp drill-down, or behind the off-book toggle, so
  // reaching one means opening everything above it — not just scrolling.

  private readonly route = inject(ActivatedRoute);
  protected readonly focusMatch = signal<string | null>(null);
  protected readonly focusComp = signal<string | null>(null);
  private revealed: string | null = null;

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.focusMatch.set(params.get('match'));
      this.focusComp.set(params.get('comp'));
    });

    effect(() => {
      const matchId = this.focusMatch();
      const compId = this.focusComp();
      const analysis = this.data.compAnalysis();
      if (!analysis) return;

      // Only chase a given target once. Refreshing from Riot rewrites the
      // analysis and would otherwise re-trigger the scroll long afterwards.
      if (matchId) {
        // Analysis loads from Firestore, so the game may not exist yet.
        if (!analysis.games.some((game) => game.matchId === matchId)) return;
        if (this.revealed === matchId) return;
        this.revealed = matchId;
        this.focusOn(matchId);
        return;
      }

      if (compId) {
        if (!analysis.comps.some((comp) => comp.compId === compId)) return;
        if (this.revealed === compId) return;
        this.revealed = compId;
        requestAnimationFrame(() => this.reveal(`[data-comp="${CSS.escape(compId)}"]`));
      }
    });
  }

  /**
   * Jump to a game panel from the Game Log further down the page. The log row
   * and the panel are two views of the same match, so the row acts as a link
   * into the drill-down rather than repeating the detail.
   */
  protected openGame(matchId: string | undefined): void {
    if (!matchId) return;
    this.focusMatch.set(matchId);
    this.revealed = matchId;
    this.focusOn(matchId);
  }

  private focusOn(matchId: string): void {
    if (this.offBookGames().some((game) => game.matchId === matchId)) {
      this.showOffBook.set(true);
    }
    // The panel renders after this settles, so wait for the frame.
    requestAnimationFrame(() => this.reveal(`[data-match="${CSS.escape(matchId)}"]`));
  }

  /** Open every disclosure above the target, then scroll it into view. */
  private reveal(selector: string): void {
    const panel = document.querySelector<HTMLElement>(selector);
    if (!panel) return;

    for (let node: HTMLElement | null = panel; node; node = node.parentElement) {
      if (node instanceof HTMLDetailsElement) {
        node.open = true;
      }
    }
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

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

  /**
   * "Where does Tristana sit in our comps?" One champion, typed by display
   * name; the games are keyed by Riot's id (Wukong is MonkeyKing), so both
   * sides resolve through the champion data before they are compared.
   */
  protected readonly championFilter = signal('');

  protected readonly championNames = computed(() => this.champs.champions().map((c) => c.name));

  private championKey(name: string): string {
    return (this.champs.resolveId(name) ?? name).replace(/[^a-z0-9]/gi, '').toLowerCase();
  }

  protected matchesChampionFilter(champion: string): boolean {
    const want = this.championFilter().trim();
    return !!want && this.championKey(champion) === this.championKey(want);
  }

  // Games after the queue and champion filters are applied. Everything below
  // — comp records, the strictness buckets, form and matchups — reads this,
  // so a champion filter answers "how do we do with Tristana in each comp".
  protected readonly filteredGames = computed<AnalysisGame[]>(() => {
    const games = this.data.compAnalysis()?.games ?? [];
    const queue = this.analysisQueue();
    const byQueue = queue === 'all' ? games : games.filter((g) => g.queue === queue);
    const want = this.championFilter().trim();
    if (!want) return byQueue;
    const key = this.championKey(want);
    return byQueue.filter((g) => g.players.some((p) => this.championKey(p.champion) === key));
  });

  // How many of a comp's 5 champions a game must share to be credited to it.
  // Adjustable live via the strictness slider — 3/5 by default. Re-buckets games
  // on the frontend using each game's overlap, so no re-fetch is needed.
  protected readonly compStrictness = signal(3);

  // The comp a game is credited to at the current strictness, or null (off the
  // books). Uses the closest comp + overlap the backend already computed.
  /**
   * The comp this game counts as, live.
   *
   * The champion match is re-derived here rather than read from `game.compId`
   * so the strictness slider responds without a Riot call. That must not
   * discard the two human corrections, which is exactly what it used to do: a
   * game placed by hand stayed off the books and its win rate never moved.
   * `effectiveComp` applies the override and `countsUnder` on top, so both land
   * immediately instead of waiting for the next refresh.
   */
  protected gameComp(game: AnalysisGame): { id: string; name: string } | null {
    const comps = this.data.comps();
    const name = game.nearCompName;
    const matched =
      name && (game.nearOverlap ?? 0) >= this.compStrictness()
        ? (comps.find((c) => c.name === name)?.id ?? null)
        : null;
    return effectiveComp(matched, this.data.compOverride(game.matchId), comps);
  }

  // Per-comp performance aggregated from the filtered games at the current
  // strictness. `partials` counts 4-stacks (one player subbed) for transparency.
  private readonly compPerf = computed(() => {
    const byComp = new Map<string, { compId: string; compName: string; games: number; wins: number; partials: number }>();
    for (const g of this.filteredGames()) {
      const gc = this.gameComp(g);
      if (!gc) continue;
      const acc = byComp.get(gc.id) ?? { compId: gc.id, compName: gc.name, games: 0, wins: 0, partials: 0 };
      acc.games += 1;
      if (g.win) acc.wins += 1;
      if ((g.rosterCount ?? 5) < 5) acc.partials += 1;
      byComp.set(gc.id, acc);
    }
    return byComp;
  });

  protected readonly compRows = computed<(CompPerformance & { partials: number })[]>(() =>
    [...this.compPerf().values()]
      .map((a) => ({ ...a, losses: a.games - a.wins, winRate: a.games ? Math.round((a.wins / a.games) * 100) : 0 }))
      .sort((a, b) => b.games - a.games || b.winRate - a.winRate)
  );

  // Off-book games: stacks not credited to any comp at the current strictness.
  protected readonly offBookGames = computed<AnalysisGame[]>(() =>
    this.filteredGames().filter((g) => !this.gameComp(g))
  );

  protected offBookRecord = winLossRecord;

  protected deleteResult(result: CompResult): void {
    void this.data.deleteCompResult(result.id);
  }

  // Whole-number win percentage from a wins/total pair.
  protected pct(wins: number, total: number): number {
    return total ? Math.round((wins / total) * 100) : 0;
  }

  // Overall win/loss across every stacked team game found (matched + off-book).
  protected readonly teamRecord = computed(() => {
    const { wins, losses } = winLossRecord(this.filteredGames());
    const games = wins + losses;
    return { wins, losses, games, winRate: games ? Math.round((wins / games) * 100) : 0 };
  });

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
    const picks = this.compChampions(this.gameComp(game)?.name || game.nearCompName);
    if (!picks.length) return false;
    const target = this.normChamp(champion);
    return picks.some((c) => this.normChamp(c) === target);
  }

  // A game that fits two or more comps equally well. The winner is a tie-break,
  // not a clear result, so say so rather than presenting it as certain.
  protected isAmbiguous(game: AnalysisGame): boolean {
    return (game.tiedNames?.length ?? 0) > 1 && Boolean(this.gameComp(game));
  }

  protected ambiguousLabel(game: AnalysisGame): string {
    return (game.tiedNames ?? []).join(' / ');
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

  /**
   * One thing worth knowing beyond the record, for the header.
   *
   * Side first, because it is actionable at draft and nothing else on this page
   * says it; recent form second, because a hot or cold run changes how much the
   * lifetime number is worth. Silent when neither has enough games to mean
   * anything rather than filling the space with noise.
   */
  protected readonly headlineStat = computed<string | null>(() => {
    const { blue, red } = this.sideSplit();
    const MIN_PER_SIDE = 8;
    if (blue.games >= MIN_PER_SIDE && red.games >= MIN_PER_SIDE) {
      const gap = blue.winRate - red.winRate;
      if (Math.abs(gap) >= 10) {
        const better = gap > 0 ? 'blue' : 'red';
        const worse = gap > 0 ? 'red' : 'blue';
        return `You are ${Math.abs(gap)} points better on ${better} side (${
          gap > 0 ? blue.winRate : red.winRate
        }% vs ${gap > 0 ? red.winRate : blue.winRate}% on ${worse}).`;
      }
    }

    const recent = this.recentForm();
    if (recent.length >= 8) {
      const wins = recent.filter((g) => g.win).length;
      return `Last ${recent.length}: ${wins}W–${recent.length - wins}L.`;
    }
    return null;
  });

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

  /**
   * A 0-1 share as a percentage, or a dash when it is genuinely absent.
   *
   * The dash matters: kill participation is missing on a game with no kills at
   * all, and rendering that as 0% would read as "was never there" rather than
   * "there was nothing to be there for".
   */
  protected fmtPercent(share: number | undefined): string {
    return share === undefined ? '—' : `${Math.round(share * 100)}%`;
  }

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

  /**
   * Place one game under a comp, overriding the champion matcher.
   *
   * The win rates are computed on the backend, so this write on its own moves
   * nothing on screen — the next Refresh is what applies it. The control says
   * so rather than leaving someone waiting for a number that will not change.
   */
  protected setGameComp(matchId: string, compId: string): void {
    void this.data.saveCompOverride(matchId, compId);
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
    const a = this.compPerf().get(compId);
    if (!a) return undefined;
    return {
      compId: a.compId,
      compName: a.compName,
      games: a.games,
      wins: a.wins,
      losses: a.games - a.wins,
      winRate: a.games ? Math.round((a.wins / a.games) * 100) : 0
    };
  }

  // Collapsed-panel badge: prefer the manually logged record, fall back to the
  // The games credited to one comp at the current strictness, for its detail.
  protected analysisGamesFor(compId: string): AnalysisGame[] {
    return this.filteredGames().filter((g) => this.gameComp(g)?.id === compId);
  }

  protected async refreshAnalysis(): Promise<void> {
    if (this.analysisLoading()) return;
    // Drop the deep-link highlight; the refresh is a fresh look at everything.
    this.focusMatch.set(null);
    this.focusComp.set(null);
    this.analysisError.set('');
    try {
      const result = await this.analysis.refresh(
        this.data.players(),
        this.data.comps(),
        this.data.compOverrideMap()
      );
      // In Firebase mode the cache doc updates via onSnapshot; set directly as a
      // fallback so the UI reflects the fresh result immediately.
      this.data.compAnalysis.set(result);
    } catch (err) {
      this.analysisError.set(err instanceof Error ? err.message : 'Analysis failed.');
    }
  }

  // Keep / work-on / drop signal from win rate and sample size.
  protected verdict = compVerdict;

}
