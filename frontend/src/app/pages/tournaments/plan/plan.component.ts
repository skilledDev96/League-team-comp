import { ChampionFilterService } from '../../../services/champion-filter.service';
import { ChampionFilterComponent } from '../../../shared/champion-filter.component';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AnalysisGame, ChampionRecord, OpponentPlayer, Role, SeriesGame, TournamentSeries } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { ChampionDataService } from '../../../services/champion-data.service';
import { NgModelNameDirective } from '../../../shared/ng-model-name.directive';
import { TeamDataService } from '../../../services/team-data.service';
import { UiService } from '../../../services/ui.service';
import { noteLines } from '../../../core/note-lines';
import { parseRiotIds } from '../../../core/riot-id';
import { seatChampions } from '../../../core/replay-parse';
import { DRAFT_LENGTH } from '../draft-sequence';
import { nextSeriesId } from '../series-order';
import { readReplay, ReplayRead, REPLAY_REQUIREMENTS } from '../../../core/replay-import';
import { ToastService } from '../../../services/toast.service';
import { rosterIds, scrimSide } from '../../games/game-rows';
import { ReplayImportService } from '../../../services/replay-import.service';
import { ScrimsMigrationService } from '../../../services/scrims-migration.service';
import {
  appendToRoster,
  banCandidates,
  bench,
  compactNumber,
  countersAreForSeat,
  countersFor,
  gameClock,
  masteryLabel,
  masteryOf,
  orderedRoster as sortRoster,
  poolFor,
  poolIsForSeat,
  queueRows,
  rateBand,
  rateOf,
  recentForSeat,
  recentHidden,
  reseatOpponent,
  scoutedAgo,
  setSubstitute,
  starters,
  bestRank,
  topPlays
} from '../../../core/opponent-view';
import { OpponentHistoryService } from '../../../services/opponent-history.service';
import { ChampionChipComponent } from '../../../shared/champion-chip.component';
import { ChampionPickerComponent } from '../../../shared/champion-picker.component';
import { MatchNoteButtonComponent } from '../../../shared/match-note-button.component';
import { MatchNoteComponent } from '../../../shared/match-note.component';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { OpponentScoutService } from '../../../services/opponent-scout.service';
import { playedElsewhere } from '../../../core/opponent-roles';
import { TournamentContextService } from '../tournament-context.service';
import { GameMvp, MvpGame, mvpGameFromScrim, mvpOf, SeriesMvp, SeriesMvpGame, seriesMvpOf } from '../../../core/game-mvp';
import { MvpChipComponent } from '../../../shared/mvp-chip.component';
import { DetailToggleComponent } from '../../../shared/detail-toggle.component';
import { UserPrefsService } from '../../../services/user-prefs.service';

/**
 * Planning a tournament: the schedule, each series, and the prep around it.
 * Read at leisure — the half used mid-draft lives in the Draft view.
 */
@Component({
  selector: 'app-tournament-plan',
  imports: [
    ChampionFilterComponent,
    FormsModule,
    RouterLink,
    ChampionChipComponent,
    ChampionPickerComponent,
    MatchNoteComponent,
    MatchNoteButtonComponent,
    TooltipDirective,
    DetailToggleComponent,
    NgModelNameDirective,
    MvpChipComponent
  ],
  templateUrl: './plan.component.html'
})
export class TournamentPlanComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly auth = inject(AuthService);
  protected readonly ui = inject(UiService);
  protected readonly filter = inject(ChampionFilterService);
  private readonly history = inject(OpponentHistoryService);
  protected readonly champData = inject(ChampionDataService);

  private readonly ctx = inject(TournamentContextService);

  // Shared with the other view; re-exposed so the template reads the same.
  protected readonly roles = this.ctx.roles;
  protected readonly teamName = this.ctx.teamName;
  protected readonly tournaments = this.ctx.tournaments;
  protected readonly currentTournament = this.ctx.currentTournament;
  protected readonly seriesList = this.ctx.seriesList;

  /** Per series, the scouted opponents whose pool has the champion being asked about. */
  protected readonly holders = computed(() =>
    this.seriesList()
      .map((series) => ({
        series,
        players: (series.opponentPlayers ?? []).filter((p) =>
          this.filter.passes(queueRows(p).flatMap((row) => row.pool.map((rec) => rec.champion)))
        )
      }))
      .filter((h) => h.players.length)
  );
  protected readonly selectTournament = (id: string) => this.ctx.selectTournament(id);
  protected readonly gamesFor = (id: string) => this.ctx.gamesFor(id);
  protected readonly seriesScore = (id: string) => this.ctx.seriesScore(id);
  protected readonly usedChampions = (id: string) => this.ctx.usedChampions(id);
  protected readonly usedCount = (id: string) => this.ctx.usedCount(id);
  protected readonly compAvailability = (id: string) => this.ctx.compAvailability(id);
  protected readonly isScrims = this.ctx.isScrims;
  protected readonly canAddGame = (series: TournamentSeries) => this.ctx.canAddGame(series);
  protected readonly draftSeries = (id: string) => void this.ctx.draftSeries(id);
  protected readonly replays = inject(ReplayImportService);
  protected readonly migration = inject(ScrimsMigrationService);

  /** Notes, bans or a roster saved: the mark on the row. */
  protected hasPrep(series: TournamentSeries): boolean {
    return !!(series.notes?.trim() || series.bans?.length || series.opponentPlayers?.length);
  }

  // ---- Who carried the series (11 Sep 2026) --------------------------------
  //
  // The same line the game row and the film's card read, averaged over the
  // games of the series that carry figures. A custom never reaches Riot, so
  // most of these come off the replay dropped on the series; a game with no
  // replay and no Riot match behind it has nothing to read and is left out
  // rather than counted as a quiet game.

  private readonly analysisById = computed(() => new Map((this.data.compAnalysis()?.games ?? []).map((g) => [g.matchId, g])));
  private readonly scrimById = computed(() => new Map(this.data.scrims().map((s) => [s.id, s])));

  /**
   * The figures behind one game of a series, whichever source has them: Riot's analysis when the
   * match reached it, otherwise the imported replay. Nothing when no `.rofl` has been dropped on
   * the game yet, which for a tournament custom is the normal state until somebody imports it.
   */
  private mvpGameOf(game: SeriesGame): MvpGame | null {
    if (!game.matchId) return null;
    const riot = this.analysisById().get(game.matchId);
    if (riot) return riot;
    const scrim = this.scrimById().get(game.matchId);
    return scrim ? mvpGameFromScrim(scrim, game.ourSide) : null;
  }

  /** Who carried one game of a series — the same mark the Games row draws, on the game it is about. */
  protected gameMvp(game: SeriesGame): GameMvp | null {
    return mvpOf(this.mvpGameOf(game));
  }

  /**
   * Why a game carries no mark (12 Sep 2026).
   *
   * A game drops out of the series average for four different reasons, and until now all four
   * looked identical: nothing. The lead hit the case where two games of a Bo3 had replays, had
   * sides, and still did not count — and there was nothing on the page to read. A silence with
   * four possible causes is not a state a reader can act on.
   *
   * Empty when the game HAS a mark, and empty for a game nobody has imported a replay for yet —
   * that one is obvious from the Import replay control sitting right there.
   */
  protected mvpGapReason(game: SeriesGame): string {
    if (this.gameMvp(game)) return '';
    if (!game.matchId) return '';
    const analysis = this.analysisById().get(game.matchId);
    const scrim = this.scrimById().get(game.matchId);
    if (!analysis && !scrim) return 'No figures: this game is linked to a replay whose record is missing. Re-import the .rofl.';
    if (!analysis && scrim && !(scrim.ourSide ?? game.ourSide)) return 'No figures: which side we were on was never recorded, so we cannot tell which five were ours.';
    if (!this.mvpGameOf(game)) return 'No figures: the replay carries no players on our side.';
    return 'No figures: the replay recorded no seat for anyone, so no line can be read from it.';
  }

  private readonly seriesMvps = computed(() => {
    const map = new Map<string, SeriesMvp | null>();
    for (const series of this.seriesList()) {
      const all = this.gamesFor(series.id);
      const games: SeriesMvpGame[] = [];
      for (const g of all) {
        const game = this.mvpGameOf(g);
        if (game) games.push({ label: `Game ${g.gameNumber}`, game });
      }
      // The series' own length goes in, so the mark can say "1 of 3" rather than quietly
      // averaging one game and calling it the series (12 Sep 2026).
      map.set(series.id, seriesMvpOf(games, all.length));
    }
    return map;
  });

  /** Who carried this series, or nothing when no game of it carries figures yet. */
  protected seriesMvp(id: string): SeriesMvp | null {
    return this.seriesMvps().get(id) ?? null;
  }

  // ---- Replays dropped on the page or on a series (9 Sep 2026) --------------------
  //
  // The page's own drop zone asks who it was against; a series' zone already
  // knows. Both go through ReplayImportService, which writes the scrim and
  // the game.

  protected readonly dragTarget = signal<string>('');
  protected readonly pendingFiles = signal<File[] | null>(null);
  protected readonly pendingOpponent = signal('');
  protected readonly pendingNewName = signal('');
  protected readonly NEW_TEAM = '__new';
  protected readonly seriesNote = signal<Record<string, string>>({});

  protected readonly knownOpponents = computed(() => this.seriesList().map((s) => s.opponent).filter(Boolean));

  protected onPageDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragTarget.set('__page');
  }

  protected onPageDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragTarget.set('');
    this.holdFiles(event.dataTransfer?.files ?? null);
  }

  protected holdFiles(files: FileList | null): void {
    const list = Array.from(files ?? []).filter((f) => /\.rofl$/i.test(f.name));
    if (list.length) this.pendingFiles.set(list);
  }

  protected async importPending(): Promise<void> {
    const files = this.pendingFiles();
    const group = this.currentTournament();
    if (!files || !group) return;
    this.pendingFiles.set(null);
    const selected = this.pendingOpponent();
    const name = (selected === this.NEW_TEAM ? this.pendingNewName() : selected).trim();
    await this.replays.importLoose(group, files, name);
    this.pendingOpponent.set('');
    this.pendingNewName.set('');
  }

  protected onSeriesDragOver(event: DragEvent, series: TournamentSeries): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragTarget.set(series.id);
  }

  protected onSeriesDrop(event: DragEvent, series: TournamentSeries): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragTarget.set('');
    void this.importAgainst(series, event.dataTransfer?.files ?? null);
  }

  protected async importAgainst(series: TournamentSeries, files: FileList | File[] | null): Promise<void> {
    const list = files ? Array.from(files as ArrayLike<File>) : [];
    if (!list.length) return;
    const report = await this.replays.importAgainst(series, list);
    this.seriesNote.update((n) => ({ ...n, [series.id]: report }));
  }

  /**
   * A replay nobody could side. The champions came out of the file; which five were ours did not.
   *
   * The `win === undefined` clause went on 12 Sep 2026. It was written for migrated replays that
   * had neither a side nor a result, but it also silenced the question for a game somebody had
   * since typed a result on — and that game is excluded from the series MVP with no way to fix it,
   * because the draft room's own "Which side are we on?" modal needs `freshBoard`, which requires
   * empty champion lists. A replay import has champions. So neither surface asked, and the mark
   * quietly averaged fewer games than the series had.
   */
  protected sideUnknown(game: SeriesGame): boolean {
    return !!game.matchId && !game.ourSide;
  }

  /**
   * What the series mark averaged, and — when it is fewer games than the series has — why.
   *
   * "1 of 3" says the count. It does not say that two of those games have a replay sitting right
   * there and are only missing a side, which is one press to fix (12 Sep 2026, the lead asking
   * what the count meant).
   */
  protected seriesMvpNote(series: TournamentSeries): string {
    const mvp = this.seriesMvp(series.id);
    if (!mvp) return '';
    const missed = this.gamesFor(series.id).filter((g) => !this.mvpGameOf(g));
    if (!missed.length) return mvp.line;
    const noSide = missed.filter((g) => !!g.matchId && !g.ourSide).length;
    const noReplay = missed.filter((g) => !g.matchId).length;
    const why: string[] = [];
    if (noSide) why.push(`${noSide} ${noSide === 1 ? 'has a replay but no side recorded' : 'have replays but no side recorded'} — set the side and ${noSide === 1 ? 'it counts' : 'they count'}`);
    if (noReplay) why.push(`${noReplay} ${noReplay === 1 ? 'has' : 'have'} no replay imported yet`);
    return why.length ? `${mvp.line} ${why.join('; ')}.` : mvp.line;
  }

  protected setSideFromReplay(game: SeriesGame, side: 'blue' | 'red'): void {
    const scrim = this.data.scrims().find((s) => s.id === game.matchId);
    if (!scrim) return;
    void this.replays.sideGame(game, scrim, side);
  }

  /** The replay's record and the game go together; the Games page loses the row too. */
  protected removeReplay(game: SeriesGame): void {
    if (!game.matchId) return;
    if (!confirm(`Delete the replay behind game ${game.gameNumber}? Its scoreboard leaves the Games page as well.`)) return;
    void this.data.deleteScrim(game.matchId);
    void this.data.deleteSeriesGame(game.id);
  }

  /**
   * How much of a series to draw (12 Sep 2026). Starter is their five on a line each, the
   * ban board and the games; Full adds the roster table, the bench and the team's games one
   * by one. **Edit mode always draws the table** — scouting writes seats, subs and target
   * bans, and every control for that lives in the table's cells, so a compact line in edit
   * mode would be a page with the work taken out of it.
   */
  private readonly userPrefs = inject(UserPrefsService);
  protected readonly full = computed(() => this.userPrefs.depthOf('prep') === 'full');
  protected readonly compactRoster = computed(() => !this.full() && !this.auth.editing());
  protected readonly topPlays = topPlays;
  protected readonly bestRank = bestRank;

  /**
   * Which series the page lands on: the first with no result recorded yet, and the last one
   * when every series has been played. Nothing opened before, so a reader arriving the day
   * before a match met a column of closed cards and had to remember which one was theirs.
   *
   * Read from the games rather than from `status`, which is only ever written as
   * 'scheduled' — sorting on it would have been a control that quietly does nothing.
   */
  protected readonly nextSeriesId = computed(() =>
    nextSeriesId(this.seriesList(), (id) => {
      const score = this.seriesScore(id);
      return !!score && score.wins + score.losses > 0;
    })
  );

  /** null until someone presses one: the next series is open, and any press wins after that. */
  protected readonly openSeriesId = signal<string | null>(null);

  // ---- Reaching the prep panel -------------------------------------------
  //
  // It sat five steps deep: leave the draft, find edit mode, open the series,
  // scroll, open a second panel. The draft room now links straight to it, and
  // the panel remembers being open so the trip is not repeated on every visit.

  /** Series whose prep panel is open. Remembered, so it stays where you left it. */
  private readonly openPrepIds = signal<ReadonlySet<string>>(new Set());

  protected isPrepPanelOpen(id: string): boolean {
    return this.openPrepIds().has(id);
  }

  /**
   * Open the series, open its scouting panel, and go there.
   *
   * The scroll is the part that was missing: opening two panels several
   * screens below the button looks, from where the button is, exactly like
   * nothing happening.
   */
  protected openPrepPanel(id: string): void {
    // Scouting is an editing job — pasting a roster, setting target bans,
    // writing notes — and the controls for all three only render in edit mode.
    // Sending someone to a panel where every control is missing is the same
    // failure as not sending them at all. The draft view does this too.
    if (this.auth.canEdit() && !this.auth.editMode()) {
      this.auth.editMode.set(true);
      this.toast.show('Edit mode on', { text: 'Scouting writes their roster, bans and notes. Press Done editing when you are finished.', kind: 'info', timeout: 5000 });
    }

    this.openSeriesId.set(id);
    this.openPrepIds.set(new Set([...this.openPrepIds(), id]));
    this.scrollToPrep(id);
  }

  /**
   * Put a scouting panel on screen once it exists.
   *
   * Polled rather than deferred once: the panel is inside a series that has
   * only just been told to open, so at call time it is not in the document
   * yet and a single lookup finds nothing. Gives up after two seconds.
   */
  private scrollToPrep(id: string): void {
    const started = Date.now();
    const find = setInterval(() => {
      const el = document.querySelector(`[data-prep="${id}"]`);
      if (el) {
        // Instant, not smooth: smooth scrolling needs animation frames and
        // silently does nothing wherever they are throttled.
        el.scrollIntoView({ block: 'center', behavior: 'auto' });
        clearInterval(find);
      } else if (Date.now() - started > 2000) {
        clearInterval(find);
      }
    }, 60);
    this.destroyRef.onDestroy(() => clearInterval(find));
  }

  protected togglePrepPanel(id: string): void {
    const next = new Set(this.openPrepIds());
    next.has(id) ? next.delete(id) : next.add(id);
    this.openPrepIds.set(next);
  }

  constructor() {
    // Follow a request from the draft view: open the series, open its prep,
    // and put it on screen. Polled for the element because it does not exist
    // until the two panels above have rendered.
    effect(() => {
      const wanted = this.ctx.prepRequest();
      if (!wanted) return;

      // Same three steps the Scout button takes; the request just comes from
      // the other view.
      this.ctx.prepRequest.set('');
      this.openPrepPanel(wanted);
    });
  }

  private readonly destroyRef = inject(DestroyRef);

  protected toggleSeries(id: string): void {
    this.openSeriesId.set(this.isSeriesOpen(id) ? '' : id);
  }

  protected isSeriesOpen(id: string): boolean {
    const open = this.openSeriesId();
    return open === null ? id === this.nextSeriesId() : open === id;
  }


  // ---- Notes with links -------------------------------------------------

  /**
   * Notes split into lines, so newlines typed into the textarea survive (HTML
   * would otherwise collapse them) and "- " / "* " lines render as bullets.
   * Each line is further split into link/text segments by `noteParts`.
   */
  // Shared with the scrims page, which renders opponent notes the same way.
  // One implementation, so a fix to link detection lands in both.
  protected readonly noteLines = noteLines;


  // ---- Series editing ---------------------------------------------------

  protected readonly newOpponent = signal('');
  protected readonly newScheduledAt = signal('');
  protected readonly saving = signal(false);

  protected async addSeries(): Promise<void> {
    const t = this.currentTournament();
    const opponent = this.newOpponent().trim();
    if (!t || !opponent || this.saving()) return;
    this.saving.set(true);
    try {
      const scrims = t.kind === 'scrims';
      await this.data.createSeries({
        tournamentId: t.id,
        opponent,
        scheduledAt: scrims ? undefined : this.newScheduledAt().trim() || undefined,
        bestOf: scrims ? 0 : this.newBestOf(),
        status: 'scheduled'
      });
      this.newOpponent.set('');
      this.newScheduledAt.set('');
    } finally {
      this.saving.set(false);
    }
  }

  protected readonly bestOfOptions: (1 | 3 | 5)[] = [1, 3, 5];
  protected readonly newBestOf = signal<1 | 3 | 5>(3);
  protected readonly replayRequirements = REPLAY_REQUIREMENTS;
  private readonly toast = inject(ToastService);

  /** Six names and no bench marked: As a team cannot pick the five. */
  protected sixOnTable(players: OpponentPlayer[] | undefined): boolean {
    return starters(players ?? []).length > 5;
  }

  protected patchSeries(series: TournamentSeries, patch: Partial<TournamentSeries>): void {
    void this.data.updateSeries({ ...series, ...patch });
  }

  protected seriesBansValue(series: TournamentSeries): string {
    return (series.bans ?? []).join(', ');
  }

  protected saveSeriesBans(series: TournamentSeries, value: string): void {
    const bans = value
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);
    this.patchSeries(series, { bans: bans.length ? bans : undefined });
  }

  protected removeSeries(series: TournamentSeries): void {
    const ok = confirm('Delete the series against ' + series.opponent + '? Its games go too.');
    if (!ok) return;
    for (const game of this.gamesFor(series.id)) {
      void this.data.deleteSeriesGame(game.id);
    }
    void this.data.deleteSeries(series.id);
  }

  // ---- Games ------------------------------------------------------------

  protected async addGame(series: TournamentSeries): Promise<void> {
    const existing = this.gamesFor(series.id);
    if (!this.ctx.canAddGame(series)) return;
    await this.data.createSeriesGame({
      seriesId: series.id,
      gameNumber: existing.length + 1,
      ourChampions: [],
      theirChampions: []
    });
  }

  protected champsValue(list: string[] | undefined): string {
    return (list ?? []).join(', ');
  }

  protected saveGameChamps(game: SeriesGame, side: 'our' | 'their', value: string): void {
    const champs = value
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    void this.data.updateSeriesGame({
      ...game,
      ...(side === 'our' ? { ourChampions: champs } : { theirChampions: champs })
    });
  }

  protected setGameChamps(game: SeriesGame, side: 'our' | 'their', champs: string[]): void {
    void this.data.updateSeriesGame({
      ...game,
      ...(side === 'our' ? { ourChampions: champs } : { theirChampions: champs })
    });
  }

  protected setSeriesBans(series: TournamentSeries, bans: string[]): void {
    this.patchSeries(series, { bans: bans.length ? bans : undefined });
  }

  /** The champions a ban would actually hurt, across their five. */
  protected readonly banCandidates = banCandidates;

  protected isTargetBan(series: TournamentSeries, champion: string): boolean {
    return (series.bans ?? []).some((b) => b.toLowerCase() === champion.toLowerCase());
  }

  /** One click from the ban board to the target-ban list, without duplicates. */
  /** A board card toggles: one click adds the target ban, the next removes it. */
  protected toggleTargetBan(series: TournamentSeries, champion: string): void {
    const bans = series.bans ?? [];
    this.setSeriesBans(
      series,
      this.isTargetBan(series, champion) ? bans.filter((b) => !(b.replace(/[^a-z0-9]/gi, '').toLowerCase() === champion.replace(/[^a-z0-9]/gi, '').toLowerCase())) : [...bans, champion]
    );
  }

  // ---- Their roster -------------------------------------------------------
  //
  // The league rulebook already makes every team publish an op.gg multi-link,
  // so pasting one is the whole setup. Only the text of that URL is read — the
  // site is never requested, because fetching it would be scraping a source
  // outside Riot's endpoints and the stated penalty is losing the API key.

  protected readonly scout = inject(OpponentScoutService);
  protected readonly rosterPaste = signal('');

  /**
   * Series whose paste box is showing.
   *
   * Step one is one-time setup. Once five players are in, a full-width
   * textarea asking for the link again is the largest thing in a panel whose
   * job is now to show what was scouted, so it folds away behind a line of
   * text until somebody actually wants to replace the roster.
   */
  protected readonly pasteOpenFor = signal<string>('');

  protected togglePaste(id: string): void {
    this.pasteOpenFor.set(this.pasteOpenFor() === id ? '' : id);
  }

  protected applyRoster(series: TournamentSeries): void {
    const roster = this.scout.fromPaste(this.rosterPaste(), series.opponentPlayers ?? []);
    if (!roster.length) return; // Nothing readable; leave what is there.
    this.rosterPaste.set('');
    this.patchSeries(series, { opponentPlayers: roster });
  }

  /** A single Name#TAG or op.gg link to add to a roster already in place. */
  protected readonly playerPaste = signal('');

  /** Add a sub or a missed name without replacing the five already there. */
  protected addPlayer(series: TournamentSeries): void {
    const existing = series.opponentPlayers ?? [];
    const roster = appendToRoster(parseRiotIds(this.playerPaste()), existing);
    if (roster.length === existing.length) return;
    this.playerPaste.set('');
    this.patchSeries(series, { opponentPlayers: roster });
  }

  /**
   * Move one of their players to a different seat.
   *
   * Set by hand, never inferred. A team that has just swapped roles looks
   * identical to a roster pasted in the wrong order, and their match history
   * describes where they used to play — so the only reliable source is
   * somebody who has watched them.
   *
   * Swaps rather than overwrites: five players hold five seats, so giving one
   * away has to hand the old seat to whoever had the new one.
   */
  protected setOpponentRole(series: TournamentSeries, player: OpponentPlayer, role: Role): void {
    const roster = reseatOpponent(series.opponentPlayers ?? [], player, role);
    if (roster) this.patchSeries(series, { opponentPlayers: roster });
  }

// ---- As a team: their games together lately ---------------------------

  /** Held on the service, so the button reads busy from any page. */
  protected readonly historyBusy = this.history.busy;
  protected readonly historyError = signal('');

  protected async fetchHistory(series: TournamentSeries): Promise<void> {
    this.historyError.set('');
    try {
      const teamHistory = await this.history.load(starters(series.opponentPlayers ?? []), { key: series.id, label: series.opponent });
      this.patchSeries(series, { teamHistory });
    } catch (error) {
      this.historyError.set(error instanceof Error ? error.message : 'Their match history could not be loaded.');
    }
  }

  protected setOpponentSub(series: TournamentSeries, player: OpponentPlayer, sub: boolean): void {
    const roster = setSubstitute(series.opponentPlayers ?? [], player, sub);
    if (roster) this.patchSeries(series, { opponentPlayers: roster });
  }

  /**
   * Their five, in seat order rather than the order the link was pasted in.
   *
   * Once seats are set by hand the paste order means nothing, and a roster
   * read top-to-support is the one shape everybody already knows how to scan.
   */
  protected orderedRoster(series: TournamentSeries): OpponentPlayer[] {
    return starters(series.opponentPlayers ?? []);
  }

  protected bench(series: TournamentSeries): OpponentPlayer[] {
    return bench(series.opponentPlayers ?? []);
  }

  /**
   * What they play in the seat they hold, falling back to everything.
   *
   * A player moved to a new lane still has a pool full of their old one, so
   * the seat-specific list is the honest answer where it exists — even at two
   * or three champions. Where it does not, the overall pool is shown with the
   * swap warning beside it rather than pretending.
   */
  // Pure table helpers, shared with the scrims page — see core/opponent-view.
  protected readonly poolFor = poolFor;
  protected readonly masteryOf = masteryOf;
  protected readonly masteryLabel = masteryLabel;
  protected readonly queueRows = queueRows;
  protected readonly recentForSeat = recentForSeat;
  protected readonly gameClock = gameClock;
  protected readonly compactNumber = compactNumber;

  /** Players whose Lately row is showing every lane, not just their seat's. */
  private readonly recentOpen = signal<ReadonlySet<string>>(new Set());

  protected isRecentOpen(opp: OpponentPlayer): boolean {
    return this.recentOpen().has(opp.name);
  }

  protected toggleRecent(opp: OpponentPlayer): void {
    this.recentOpen.update((set) => {
      const next = new Set(set);
      if (next.has(opp.name)) next.delete(opp.name);
      else next.add(opp.name);
      return next;
    });
  }

  /** The seat's champions, or all of them once the +N has been opened. */
  protected recentShown(opp: OpponentPlayer): string[] {
    return this.isRecentOpen(opp) ? (opp.recentChampions ?? []) : recentForSeat(opp);
  }
  protected readonly recentHidden = recentHidden;

  protected readonly countersFor = countersFor;

  protected readonly countersAreForSeat = countersAreForSeat;
  protected readonly poolIsForSeat = poolIsForSeat;
  protected readonly rateOf = rateOf;
  protected readonly rateBand = rateBand;

  /** The seat their scouted history is about, when it is not the seat they hold. */
  protected playedElsewhere(player: OpponentPlayer) {
    return playedElsewhere(player);
  }

  protected async scoutOpponents(series: TournamentSeries): Promise<void> {
    await this.scout.scoutSeries(series);
  }

  /**
   * When the roster was last read, in words.
   *
   * Shown because scouting goes stale silently: a champion pool from three
   * weeks ago describes a player who has since moved on, and nothing about the
   * row would say so.
   */
  protected scoutedAt(series: TournamentSeries): string {
    return scoutedAgo(series.opponentPlayers ?? []);
  }

  protected setGameResult(game: SeriesGame, win: boolean | undefined): void {
    void this.data.updateSeriesGame({ ...game, win });
  }

  /**
   * Delete a game — asking first when there is anything in it.
   *
   * An empty game placeholder goes without a question, because there is
   * nothing to lose. A game with picks, bans or a result is the record of a
   * draft somebody sat through, and one mis-click on a row of small buttons
   * should not erase it silently.
   */
  protected removeGame(game: SeriesGame): void {
    const hasContent =
      (game.ourChampions ?? []).some(Boolean) ||
      (game.theirChampions ?? []).some(Boolean) ||
      (game.bans ?? []).length > 0 ||
      game.win !== undefined;
    if (hasContent) {
      const what = game.win === undefined ? 'its draft' : 'its draft and result';
      if (!confirm(`Delete game ${game.gameNumber}? ${what[0].toUpperCase() + what.slice(1)} will be lost.`)) return;
    }
    void this.data.deleteSeriesGame(game.id);
  }

  // ---- Import a replay against a game -----------------------------------
  //
  // Tournament games are customs, and customs never reach the Riot API, so
  // "fill from match history" could never find one (8 Sep 2026). The replay
  // file is the only record: it fills both sides in seat order, the side, the
  // result, and is kept as a scrim under the opponent's name so the numbers
  // reach the Games page and the Scrims page alike.

  protected readonly replayNote = signal<Record<string, string>>({});

  /** A parsed replay waiting for someone to say which side was ours. */
  protected readonly replayPending = signal<Record<string, Extract<ReplayRead, { ok: true }> & { fileName: string }>>({});

  protected async importReplay(game: SeriesGame, series: TournamentSeries, files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (!file) return;
    const note = (text: string) => this.replayNote.update((s) => ({ ...s, [game.id]: text }));
    note(`Reading ${file.name}…`);
    const read = readReplay(file.name, await file.arrayBuffer(), { opponent: series.opponent, lastModified: file.lastModified, order: this.data.scrims().length + 1 });
    if (!read.ok) {
      note(read.line);
      return;
    }
    const side = game.ourSide ?? scrimSide(read.scrim, rosterIds(this.data.players()));
    if (!side) {
      // Kept for the one-file path on a game row; the service does the same for a batch.
      // Nobody of ours by name in the file and no side on the draft: ask,
      // rather than send the person off to set it and come back.
      this.replayPending.update((s) => ({ ...s, [game.id]: { ...read, fileName: file.name } }));
      note('Could not tell which side was ours from the names in the file.');
      return;
    }
    await this.finishReplay(game, series, { ...read, fileName: file.name }, side);
  }

  protected async finishReplay(game: SeriesGame, series: TournamentSeries, read: Extract<ReplayRead, { ok: true }> & { fileName: string }, side: 'blue' | 'red'): Promise<void> {
    this.replayPending.update((s) => {
      const next = { ...s };
      delete next[game.id];
      return next;
    });
    const team = side === 'blue' ? 100 : 200;
    await this.data.saveScrim({ ...read.scrim, opponent: series.opponent, ourSide: side });
    await this.data.updateSeriesGame({
      ...game,
      ourChampions: seatChampions(read.replay.players, team),
      theirChampions: seatChampions(read.replay.players, team === 100 ? 200 : 100),
      ourSide: side,
      win: side === 'blue' ? read.replay.blueWon : !read.replay.blueWon,
      matchId: read.id,
      // A replay is a played game: the draft room shows it finished, not at Ban 1.
      draftStep: DRAFT_LENGTH
    });
    this.replayNote.update((s) => ({ ...s, [game.id]: `Filled from ${read.fileName}.` }));
  }

  protected candidateLabel(game: AnalysisGame): string {
    const when = new Date(game.date).toLocaleDateString();
    return (game.win ? 'W' : 'L') + ' · ' + when + ' · ' + (game.compName ?? game.queue);
  }

  protected candidateChampions(game: AnalysisGame): string[] {
    return game.players.map((p) => p.champion);
  }

  /**
   * Undo everything the replay filled in — champions and result, not just the
   * id. Leaving them behind reads as hand-entered data and quietly keeps the
   * wrong champions in the fearless burn. Bans are ours, so they stay. The
   * scrim record stays too; it is a real game whoever it is filed against.
   */
  protected unlinkMatch(game: SeriesGame): void {
    const next = { ...game, ourChampions: [], theirChampions: [] };
    delete next.matchId;
    delete next.win;
    void this.data.updateSeriesGame(next);
  }

  // ---- Prep games -------------------------------------------------------
  //
  // Scrims and practice tagged to this tournament, so prep is isolated from the
  // general match history.

  protected readonly showPrep = signal(false);

  protected prepMatchIds(): string[] {
    return this.currentTournament()?.prepMatchIds ?? [];
  }

  protected isPrep(matchId: string): boolean {
    return this.prepMatchIds().includes(matchId);
  }

  protected togglePrep(matchId: string): void {
    const t = this.currentTournament();
    if (!t) return;
    const current = t.prepMatchIds ?? [];
    const next = current.includes(matchId)
      ? current.filter((id) => id !== matchId)
      : [...current, matchId];
    void this.data.updateTournament({ ...t, prepMatchIds: next.length ? next : undefined });
  }

  /** Recent analysed games, for tagging as prep. */
  protected recentGames(): AnalysisGame[] {
    return (this.data.compAnalysis()?.games ?? []).slice(0, 20);
  }

  /** Only the games tagged as prep for this tournament. */
  protected prepGames(): AnalysisGame[] {
    const ids = new Set(this.prepMatchIds());
    return (this.data.compAnalysis()?.games ?? []).filter((g) => ids.has(g.matchId));
  }

  protected prepRecord(): { wins: number; losses: number } {
    const games = this.prepGames();
    const wins = games.filter((g) => g.win).length;
    return { wins, losses: games.length - wins };
  }
}
