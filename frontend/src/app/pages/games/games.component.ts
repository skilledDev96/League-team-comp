import { DatePipe } from '@angular/common';
import { reviewFailure } from '../../core/review-error';
import { matchLink } from '../../core/match-link';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { effectiveComp } from '../../core/comp-alias';
import { GameMvp, mvpGameFromRow, mvpOf } from '../../core/game-mvp';
import { MvpChipComponent } from '../../shared/mvp-chip.component';
import { AuthService } from '../../services/auth.service';
import { UserPrefsService } from '../../services/user-prefs.service';
import { ChampionFilterService } from '../../services/champion-filter.service';
import { CompAnalysisService } from '../../services/comp-analysis.service';
import { RefreshService } from '../../services/refresh.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { ChampionFilterComponent } from '../../shared/champion-filter.component';
import { MatchNoteButtonComponent } from '../../shared/match-note-button.component';
import { MatchNoteComponent } from '../../shared/match-note.component';
import { NgModelNameDirective } from '../../shared/ng-model-name.directive';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { GameStoryComponent } from '../../shared/game-story.component';
import { ReplayRecordingService } from '../../services/replay-recording.service';
import { BeforeYouPlayComponent } from '../../shared/before-you-play.component';
import { GameReviewComponent } from '../../shared/game-review.component';
import { GameGraphsComponent } from '../../shared/game-graphs.component';
import { GameReviewService } from '../../services/game-review.service';
import { ReviewTakeoverService } from '../../services/review-takeover.service';
import { PlayerEditorService } from '../../services/player-editor.service';
import { ToastService } from '../../services/toast.service';
import { CompExpectationService } from '../../services/comp-expectation.service';
import { CompExpectation } from '../../models/team.models';
import { ReviewComponent } from '../review/review.component';
import { TourPillComponent } from '../../shared/tour-pill.component';
import {
  filterRows,
  fromAnalysis,
  fromScrim,
  fromSeriesGame,
  GameRow,
  GameSource,
  meanLength,
  playerLines,
  record,
  rosterIds,
  toughest, reviewBlockReason } from './game-rows';

type Tab = 'games' | 'patterns' | 'reviews';

/**
 * Every game we played, in one place: tournament games, scrims and the flex
 * and Clash games Riot knows about, newest first, each opening to the match.
 *
 * Replaced the comp-first Analysis page and folded Review in as a second tab
 * on 8 Sep 2026. Comps keep their own records on the Comps page; here a comp
 * is a tag on a game, not the thing the page is organised around.
 */
import { PlayerMarkComponent } from '../../shared/player-mark.component';
@Component({
  selector: 'app-games',
  imports: [PlayerMarkComponent, GameGraphsComponent, DatePipe,
    FormsModule,
    RouterLink,
    ChampionFilterComponent,
    MatchNoteComponent,
    MatchNoteButtonComponent,
    NgModelNameDirective,
    TooltipDirective,
    ReviewComponent,
    GameStoryComponent, GameReviewComponent, TourPillComponent, BeforeYouPlayComponent, MvpChipComponent],
  templateUrl: './games.component.html'
})
export class GamesComponent {
  /**
   * The same game on League of Graphs, for comparing a figure against somebody else's reading of it.
   * It is the one thing the "Check the numbers" drawer carried that lives nowhere else on this row;
   * the drawer's table was the scoreboard above it a second time, and it is still on the Patterns
   * tab where checking a number is the job. A custom game has no page outside this app, so a replay
   * simply gets no link.
   */
  protected outsideLink(matchId: string | undefined): string | null {
    return matchLink(matchId);
  }

  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  protected readonly refresh = inject(RefreshService);
  protected readonly filter = inject(ChampionFilterService);
  private readonly prefs = inject(UserPrefsService);
  private readonly analysis = inject(CompAnalysisService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly tab = signal<Tab>('games');

  // ---- Filters ----------------------------------------------------------------

  protected readonly source = signal<GameSource | 'all'>('all');
  protected readonly days = signal(30);
  protected readonly result = signal<'all' | 'win' | 'loss'>('all');
  protected readonly opponent = signal('');
  /** A comp id from a Comps-page link; narrows to the games under that comp. */
  protected readonly comp = signal('');
  protected readonly windows = [
    { days: 7, label: '7 days' },
    { days: 30, label: '30 days' },
    { days: 90, label: '90 days' },
    { days: 0, label: 'All' }
  ];

  // ---- Rows -------------------------------------------------------------------

  /** Every game from every source, newest first. */
  protected readonly allRows = computed<GameRow[]>(() => {
    const comps = this.data.comps();
    const ours = rosterIds(this.data.players());
    const riot = (this.data.compAnalysis()?.games ?? []).map((g) =>
      fromAnalysis(g, effectiveComp(g.compId, this.data.compOverride(g.matchId), comps))
    );
    // A tournament game with a replay imported against it owns that replay:
    // the same game must not also appear as a scrim, or as the Riot row the
    // analysis folds the stored scrim into.
    const seriesById = new Map(this.data.tournamentSeries().map((s) => [s.id, s]));
    const scrimsGroup = this.data.tournaments().find((t) => t.kind === 'scrims')?.id;
    const scrimSeries = new Set(this.data.tournamentSeries().filter((s) => s.tournamentId === scrimsGroup).map((s) => s.id));
    const scrimById = new Map(this.data.scrims().map((s) => [s.id, s]));
    const seatNames: Record<string, string> = {};
    for (const p of this.data.starters()) if (p.role && !seatNames[p.role]) seatNames[p.role] = p.name;
    const tournament = this.data
      .seriesGames()
      .map((g) => fromSeriesGame(g, seriesById.get(g.seriesId), seatNames, g.matchId ? scrimById.get(g.matchId) : undefined, ours, scrimSeries.has(g.seriesId)))
      .filter((r): r is GameRow => r !== null);
    const claimed = new Set(tournament.map((r) => r.matchId).filter(Boolean));
    const riotKept = riot.filter((r) => !claimed.has(r.matchId));
    const riotIds = new Set(riot.map((r) => r.matchId));
    const scrims = this.data
      .scrims()
      .filter((s) => !riotIds.has(s.id) && !claimed.has(s.id))
      .map((s) => fromScrim(s, ours))
      .filter((r): r is GameRow => r !== null);
    return [...riotKept, ...scrims, ...tournament].sort((a, b) => b.date - a.date);
  });

  /** Everything but the source filter, so the per-source tiles always have their counts. */
  private readonly rowsAnySource = computed<GameRow[]>(() => {
    const comp = this.comp();
    const rows = comp ? this.allRows().filter((r) => r.compId === comp) : this.allRows();
    return filterRows(rows, {
      source: 'all',
      days: this.days(),
      result: this.result(),
      opponent: this.opponent(),
      champion: (c) => this.filter.passes(c)
    });
  });

  /**
   * One game reached by a link, kept on the list whatever the window says (12 Sep 2026).
   *
   * `?match=` used to call `days.set(0)`, and `?match=` is how the film room's Back pill, the
   * Reviews tab's "Open the game" and every evidence link arrive — so the commonest way onto this
   * page opened the longest list it has, nine months and 181 games, to show one row.
   *
   * Widening also lies about everything above the list: the record, the form strip and the player
   * lines are all read off the same window, so following a link to a game from March silently
   * restated the team's record over nine months. Pinning keeps the window where the reader left it
   * and puts the one row they asked for at the top of it, carrying a chip that says why it is there.
   *
   * `?comp=` still widens: that is a deliberate filter with a chip on the bar announcing it.
   */
  protected readonly pinnedMatch = signal('');

  protected readonly rows = computed<GameRow[]>(() => {
    const source = this.source();
    return source === 'all' ? this.rowsAnySource() : this.rowsAnySource().filter((r) => r.source === source);
  });

  /**
   * The rows the list draws: the window's, plus the pinned game when the window does not already
   * hold it. Only the list reads this — the record, the form strip and the player lines keep
   * reading `rows()`, so a game arrived at by a link never moves a figure.
   */
  protected readonly listRows = computed<GameRow[]>(() => {
    const rows = this.rows();
    const id = this.pinnedMatch();
    if (!id || rows.some((r) => r.matchId === id)) return rows;
    const pinned = this.allRows().find((r) => r.matchId === id);
    return pinned ? [pinned, ...rows] : rows;
  });

  /** True for the row that is only here because a link asked for it, so it can say so. */
  protected isPinned(row: GameRow): boolean {
    const id = this.pinnedMatch();
    return !!id && row.matchId === id && !this.rows().some((r) => r.matchId === id);
  }

  protected readonly opponents = computed<string[]>(() => {
    const seen = new Set<string>();
    for (const r of this.allRows()) if (r.opponent) seen.add(r.opponent);
    return [...seen].sort((a, b) => a.localeCompare(b));
  });

  protected readonly compName = computed(() => this.data.comps().find((c) => c.id === this.comp())?.name ?? '');

  // ---- Records ----------------------------------------------------------------

  protected readonly overall = computed(() => record(this.rows()));
  protected readonly bySource = computed(() =>
    (['tournament', 'scrim', 'riot'] as const).map((source) => ({
      source,
      label: source === 'riot' ? 'Flex & Clash' : source === 'scrim' ? 'Scrims' : 'Tournament',
      ...record(this.rowsAnySource().filter((r) => r.source === source))
    }))
  );
  protected readonly sides = computed(() => ({
    blue: record(this.rows().filter((r) => r.side === 'blue')),
    red: record(this.rows().filter((r) => r.side === 'red'))
  }));
  protected readonly form = computed(() => this.rows().slice(0, 10));
  protected readonly length = computed(() => meanLength(this.rows()));
  /** The five starters by default; the bench joins on request (8 Sep 2026). */
  protected readonly showBench = signal(false);
  private readonly allPlayerLines = computed(() => playerLines(this.rows()));
  protected readonly benchCount = computed(() => {
    const starters = new Set(this.data.starters().map((p) => p.name));
    return this.allPlayerLines().filter((l) => !starters.has(l.name)).length;
  });
  protected isSub(name: string): boolean {
    return !!this.data.players().find((p) => p.name === name)?.sub;
  }

  /** The same sub flag Admin sets: benched players leave the five here and on Patterns. */
  protected setBench(name: string, sub: boolean): void {
    const player = this.data.players().find((p) => p.name === name);
    if (!player) return;
    void this.editor.patch(player, { sub: sub || undefined });
  }

  protected readonly players = computed(() => {
    const lines = this.allPlayerLines();
    if (this.showBench()) return lines;
    const starters = new Set(this.data.starters().map((p) => p.name));
    return starters.size ? lines.filter((l) => starters.has(l.name)) : lines;
  });
  protected readonly toughest = computed(() => toughest(this.rows()));

  // ---- Deep links: ?match= opens one Riot game, ?comp= narrows to a comp ----

  private revealed: string | null = null;

  constructor() {
    const tab = this.route.snapshot.data['tab'];
    if (tab === 'patterns') this.tab.set('patterns');
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const comp = params.get('comp');
      if (comp) {
        this.comp.set(comp);
        this.days.set(0);
      }
      const match = params.get('match');
      if (match) {
        this.tab.set('games');
        this.pinnedMatch.set(match);
        this.listOpen.set(true);
        this.matchFocus.set(match);
      }
      const tab = params.get('tab');
      if (tab === 'reviews' || tab === 'patterns' || tab === 'games') this.tab.set(tab);
      if (params.get('refresh') === '1') void this.justPracticed();
    });
    // The address bar follows the tab, so a link to ?tab=games works from
    // Patterns every time, not only the first (9 Sep 2026).
    effect(() => {
      const tab = this.tab();
      if (this.route.snapshot.queryParamMap.get('tab') === tab) return;
      void this.router.navigate([], { relativeTo: this.route, queryParams: { tab }, queryParamsHandling: 'merge', replaceUrl: true });
    });
    effect(() => {
      const id = this.focus();
      if (!id || this.revealed === id) return;
      if (!this.rows().some((r) => r.id === id)) return;
      this.revealed = id;
      // A timer, not requestAnimationFrame: a tab opened in the background
      // never gets a frame, and the link would land on a closed row.
      setTimeout(() => {
        const panel = document.querySelector<HTMLDetailsElement>(`[data-row="${CSS.escape(id)}"]`);
        if (!panel) return;
        panel.open = true;
        panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    });
  }

  protected readonly focus = signal<string | null>(null);

  /**
   * A match id to land on. Resolved to the row once the rows exist, because a
   * scrim replay's row is keyed by the scrim, not by riot-<match> (9 Sep 2026).
   */
  private readonly matchFocus = signal<string | null>(null);
  private readonly resolveMatchFocus = effect(() => {
    const match = this.matchFocus();
    if (!match) return;
    const row = this.allRows().find((r) => r.matchId === match);
    if (!row) return;
    this.matchFocus.set(null);
    this.focus.set(row.id);
  });

  protected clearComp(): void {
    this.comp.set('');
  }

  // ---- Row helpers ------------------------------------------------------------

  protected day(ms: number): string {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  protected clock(seconds: number | undefined): string {
    if (!seconds) return '';
    return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
  }

  protected compact(n: number | undefined): string {
    if (n === undefined) return '—';
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  }

  /** A per-game figure with one decimal, or a dash when no game carried it. */
  protected per(total: number, games: number): string {
    return games ? (total / games).toFixed(1) : '—';
  }

  protected pct(share: number | undefined): string {
    return share === undefined ? '—' : `${Math.round(share * 100)}%`;
  }

  protected sourceLabel(source: GameSource): string {
    return source === 'riot' ? 'Riot' : source === 'scrim' ? 'Scrim' : 'Tournament';
  }

  /** The analysed game behind a row, for the check drawer. */
  private readonly analysisById = computed(() => new Map((this.data.compAnalysis()?.games ?? []).map((g) => [g.matchId, g])));
  private readonly expectations = inject(CompExpectationService);
  protected readonly reviews = inject(GameReviewService);
  protected readonly takeover = inject(ReviewTakeoverService);
  private readonly editor = inject(PlayerEditorService);
  private readonly toast = inject(ToastService);

  // ---- The Reviews tab: every written review, newest first ----------------

  protected readonly reviewComp = signal<string>('all');

  protected readonly reviewRows = computed(() => {
    const comps = this.data.comps();
    const filter = this.reviewComp();
    const rowByMatch = new Map(this.allRows().filter((r) => r.matchId).map((r) => [r.matchId!, r]));
    return this.data
      .gameReviews()
      .map((review) => {
        const game = this.analysisById().get(review.matchId);
        // The team name comes off the row (a scrim or a series game), not the analysis.
        const opponent = rowByMatch.get(review.matchId)?.opponent;
        const comp = game ? effectiveComp(game.compId, this.data.compOverride(game.matchId), comps) : null;
        return { review, game, comp, opponent };
      })
      .filter((r) => filter === 'all' || r.comp?.id === filter)
      .sort((a, b) => (b.game?.date ?? 0) - (a.game?.date ?? 0));
  });

  /** Jump from a review to its row on the Games tab. */
  protected openMatch(matchId: string): void {
    this.tab.set('games');
    this.pinnedMatch.set(matchId);
    this.listOpen.set(true);
    this.revealed = null;
    this.matchFocus.set(matchId);
  }

  /**
   * Ask the model for a review of this game, through the takeover: it gates
   * the money first, plays the game while the coach writes, and the stored
   * document arrives through the listener (9 Sep 2026; it used to be a
   * confirm()). The button's box is where the stage grows from.
   */
  protected reviewGame(row: GameRow, event?: Event): void {
    if (!row.matchId || reviewBlockReason(row)) return;
    const button = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.takeover.open(row.matchId, this.expectFor(row), button?.getBoundingClientRect() ?? null, button);
  }

  /** The failure in the team's words; the provider's own JSON never reaches a row. */
  protected reviewSaid(matchId: string | undefined): string {
    return reviewFailure(matchId ? this.reviews.errorFor(matchId) : undefined)?.said ?? '';
  }

  protected removeReview(row: GameRow): void {
    if (!row.matchId || !this.data.reviewFor(row.matchId)) return;
    if (!confirm('Remove this review? The facts stay; writing it again costs about a dime.')) return;
    void this.data.deleteGameReview(row.matchId);
  }

  protected blockReason(row: GameRow): string | null {
    return reviewBlockReason(row);
  }

  /** The game list and the player table fold away, so the page can be the record and the form.
   *  The list starts folded (8 Sep 2026); a link to a game, a refresh with new games, or Show opens it. */
  protected readonly listOpen = signal(false);
  protected readonly playersOpen = signal(true);

  /** The scoreboard as a table or as the post-game graphs (9 Sep 2026); remembered per browser. */
  protected readonly scoreboardView = signal<'table' | 'graphs'>(GamesComponent.readScoreboardView());

  private static readonly SCOREBOARD_KEY = 'bom-games-scoreboard-view';

  private static readScoreboardView(): 'table' | 'graphs' {
    try {
      return localStorage.getItem(GamesComponent.SCOREBOARD_KEY) === 'graphs' ? 'graphs' : 'table';
    } catch {
      return 'table';
    }
  }

  protected setScoreboardView(view: 'table' | 'graphs'): void {
    this.scoreboardView.set(view);
    try {
      localStorage.setItem(GamesComponent.SCOREBOARD_KEY, view);
    } catch {
      // A private window; the choice lasts the page.
    }
  }

  /** The four axes of the comp this game counts as, for the story's curve lines. */
  protected expectFor(row: GameRow): CompExpectation | null {
    if (!row.matchId) return null;
    const comp = effectiveComp(row.compId ?? null, this.data.compOverride(row.matchId), this.data.comps());
    const full = comp ? this.data.comps().find((c) => c.id === comp.id) : undefined;
    return full ? (this.expectations.forComp(full)?.expect ?? null) : null;
  }

  protected analysisOf(row: GameRow) {
    return row.matchId ? this.analysisById().get(row.matchId) : undefined;
  }

  /**
   * Who carried each game, off the row's own figures (11 Sep 2026), so a
   * scrim's replay numbers and a Riot game's are read the same way and a
   * tournament game typed in by hand gets no chip at all. Computed for the
   * whole list at once: the summary calls this once a row on every change
   * detection, and the arithmetic should not run there.
   */
  private readonly mvpByRow = computed(() => new Map(this.rows().map((r) => [r.id, mvpOf(mvpGameFromRow(r))])));

  protected mvp(row: GameRow): GameMvp | null {
    return this.mvpByRow().get(row.id) ?? null;
  }

  /** True once this person reached the film's card for the game: the collapsed row's chip reads Watched instead of Reviewed (10 Sep 2026). */
  protected watched(matchId: string | undefined): boolean {
    return !!matchId && !!this.prefs.filmProgress(matchId)?.done;
  }

  // ---- The replay recorder's frames (10 Sep 2026) ---------------------------

  protected readonly recordings = inject(ReplayRecordingService);

  /**
   * Which rows are open. A game row keeps its drawer in the DOM whether it is
   * folded or not, so this is what tells the frames strip and the recording
   * read to hold off: the list of two hundred games would otherwise be two
   * hundred Firestore reads on arrival.
   */
  private readonly openRows = signal<ReadonlySet<string>>(new Set());

  protected rowOpen(id: string): boolean {
    return this.openRows().has(id);
  }

  protected onRowToggle(id: string, event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    this.openRows.update((set) => {
      const next = new Set(set);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /**
   * True when the recorder has written frames for this game. Read through the
   * service, which only knows about a game whose row has been opened — the
   * chip is a mark a row keeps once it has been looked at, not a promise the
   * folded list can make, because knowing would cost a read a row.
   */
  protected recorded(matchId: string | undefined): boolean {
    return this.recordings.has(matchId);
  }

  protected setGameComp(matchId: string, compId: string): void {
    void this.data.saveCompOverride(matchId, compId);
  }

  // ---- Data: the refresh controls that lived on Analysis --------------------

  protected readonly analysisLoading = this.analysis.running;
  protected readonly analysisError = signal('');

  // ---- "We just practiced": refresh, then open what came in ----------------

  /** Match ids that arrived with the last refresh started from the quick action. */
  protected readonly newIds = signal<ReadonlySet<string> | null>(null);
  protected readonly justRefreshed = signal(false);

  protected isNew(row: GameRow): boolean {
    return !!row.matchId && !!this.newIds()?.has(row.matchId);
  }

  /**
   * The quick action from the main page: refresh the match data, then show
   * the games that were not there before, newest first, with the first one
   * open. The query param is dropped so a reload does not refresh again.
   */
  protected async justPracticed(): Promise<void> {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { refresh: null }, queryParamsHandling: 'merge', replaceUrl: true });
    if (!this.auth.canEdit()) {
      this.toast.show('Refreshing needs edit rights', { text: 'Ask an editor to press "Refresh matches from Riot"; the games then appear here for everyone.', kind: 'info', timeout: 6000 });
      return;
    }
    if (this.analysisLoading()) return;
    const before = new Set((this.data.compAnalysis()?.games ?? []).map((g) => g.matchId));
    this.tab.set('games');
    await this.refreshAnalysis();
    const after = (this.data.compAnalysis()?.games ?? []).map((g) => g.matchId);
    const fresh = new Set(after.filter((id) => !before.has(id)));
    this.newIds.set(fresh);
    this.justRefreshed.set(true);
    this.source.set('all');
    this.days.set(7);
    const first = [...fresh][0];
    if (first) {
      this.listOpen.set(true);
      this.revealed = null;
      this.focus.set(`riot-${first}`);
    }
  }

  protected dismissNew(): void {
    this.justRefreshed.set(false);
    this.newIds.set(null);
  }

  protected async refreshAnalysis(): Promise<void> {
    if (this.analysisLoading()) return;
    this.analysisError.set('');
    try {
      const result = await this.analysis.refresh(this.data.players(), this.data.comps(), this.data.compOverrideMap());
      this.data.compAnalysis.set(result);
    } catch (err) {
      this.analysisError.set(err instanceof Error ? err.message : 'Analysis failed.');
    }
  }
}
