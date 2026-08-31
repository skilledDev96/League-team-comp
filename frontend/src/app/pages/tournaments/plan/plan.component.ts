import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AnalysisGame, ChampionRecord, OpponentPlayer, Role, SeriesGame, TournamentSeries } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { ChampionDataService } from '../../../services/champion-data.service';
import { NgModelNameDirective } from '../../../shared/ng-model-name.directive';
import { TeamDataService } from '../../../services/team-data.service';
import { UiService } from '../../../services/ui.service';
import { ChampionChipComponent } from '../../../shared/champion-chip.component';
import { ChampionPickerComponent } from '../../../shared/champion-picker.component';
import { MatchNoteButtonComponent } from '../../../shared/match-note-button.component';
import { MatchNoteComponent } from '../../../shared/match-note.component';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { OpponentScoutService } from '../../../services/opponent-scout.service';
import { playedElsewhere } from '../../../core/opponent-roles';
import { TournamentContextService } from '../tournament-context.service';

/**
 * Planning a tournament: the schedule, each series, and the prep around it.
 * Read at leisure — the half used mid-draft lives in the Draft view.
 */
@Component({
  selector: 'app-tournament-plan',
  imports: [
    FormsModule,
    RouterLink,
    ChampionChipComponent,
    ChampionPickerComponent,
    MatchNoteComponent,
    MatchNoteButtonComponent,
    TooltipDirective,
    NgModelNameDirective
  ],
  templateUrl: './plan.component.html'
})
export class TournamentPlanComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly auth = inject(AuthService);
  protected readonly ui = inject(UiService);
  protected readonly champData = inject(ChampionDataService);

  private readonly ctx = inject(TournamentContextService);

  // Shared with the other view; re-exposed so the template reads the same.
  protected readonly roles = this.ctx.roles;
  protected readonly teamName = this.ctx.teamName;
  protected readonly tournaments = this.ctx.tournaments;
  protected readonly currentTournament = this.ctx.currentTournament;
  protected readonly seriesList = this.ctx.seriesList;
  protected readonly selectTournament = (id: string) => this.ctx.selectTournament(id);
  protected readonly gamesFor = (id: string) => this.ctx.gamesFor(id);
  protected readonly seriesScore = (id: string) => this.ctx.seriesScore(id);
  protected readonly usedChampions = (id: string) => this.ctx.usedChampions(id);
  protected readonly usedCount = (id: string) => this.ctx.usedCount(id);
  protected readonly compAvailability = (id: string) => this.ctx.compAvailability(id);
  protected readonly playableComps = (id: string) => this.ctx.playableComps(id);
  protected readonly brokenComps = (id: string) => this.ctx.brokenComps(id);
  protected readonly poolPressure = (id: string) => this.ctx.poolPressure(id);

  protected readonly openSeriesId = signal<string>('');

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
    if (this.auth.canEdit()) this.auth.editMode.set(true);

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
    this.openSeriesId.set(this.openSeriesId() === id ? '' : id);
  }

  protected isSeriesOpen(id: string): boolean {
    return this.openSeriesId() === id;
  }


  // ---- Notes with links -------------------------------------------------

  /**
   * Notes split into lines, so newlines typed into the textarea survive (HTML
   * would otherwise collapse them) and "- " / "* " lines render as bullets.
   * Each line is further split into link/text segments by `noteParts`.
   */
  protected noteLines(
    text: string | undefined
  ): { bullet: boolean; parts: { text: string; href: string | null }[] }[] {
    if (!text) return [];
    return text.split(/\r?\n/).map((line) => {
      const bullet = /^\s*[-*]\s+/.test(line);
      const content = bullet ? line.replace(/^\s*[-*]\s+/, '') : line;
      return { bullet, parts: this.noteParts(content) };
    });
  }

  /**
   * Split one line into plain and link segments so pasted URLs render as real
   * links. Deliberately returns data for the template to bind rather than HTML:
   * nothing bypasses Angular's escaping, and only http/https matches, so a
   * "javascript:" string stays inert text.
   */
  protected noteParts(text: string | undefined): { text: string; href: string | null }[] {
    if (!text) return [];
    const parts: { text: string; href: string | null }[] = [];
    const pattern = /https?:\/\/[^\s<>"']+/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > last) {
        parts.push({ text: text.slice(last, match.index), href: null });
      }
      // Trailing punctuation usually belongs to the sentence, not the URL.
      const url = match[0].replace(/[.,;:)\]]+$/, '');
      parts.push({ text: url, href: url });
      last = match.index + url.length;
    }
    if (last < text.length) {
      parts.push({ text: text.slice(last), href: null });
    }
    return parts;
  }


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
      await this.data.createSeries({
        tournamentId: t.id,
        opponent,
        scheduledAt: this.newScheduledAt().trim() || undefined,
        bestOf: 3,
        status: 'scheduled'
      });
      this.newOpponent.set('');
      this.newScheduledAt.set('');
    } finally {
      this.saving.set(false);
    }
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
    if (existing.length >= series.bestOf) return;
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
    const roster = [...(series.opponentPlayers ?? [])];

    // Found by identity, never by index. The rows are sorted by seat for
    // display, so the position in the list on screen is not the position in
    // the stored array — passing the row index moved a *different* player, and
    // two of them ended up in the same seat with a seat left empty.
    const index = roster.findIndex((p) => p.name === player.name && p.riotTag === player.riotTag);
    const current = roster[index];
    if (!current || current.role === role) return;

    // Five players hold five seats, so taking one has to hand the old seat to
    // whoever had it.
    const holder = roster.findIndex((p, i) => i !== index && p.role === role);
    if (holder >= 0) roster[holder] = { ...roster[holder], role: current.role };
    roster[index] = { ...current, role };

    this.patchSeries(series, { opponentPlayers: roster });
  }

  /**
   * Their five, in seat order rather than the order the link was pasted in.
   *
   * Once seats are set by hand the paste order means nothing, and a roster
   * read top-to-support is the one shape everybody already knows how to scan.
   */
  protected orderedRoster(series: TournamentSeries): OpponentPlayer[] {
    return [...(series.opponentPlayers ?? [])].sort(
      (a, b) => this.roles.indexOf(a.role) - this.roles.indexOf(b.role)
    );
  }

  /**
   * What they play in the seat they hold, falling back to everything.
   *
   * A player moved to a new lane still has a pool full of their old one, so
   * the seat-specific list is the honest answer where it exists — even at two
   * or three champions. Where it does not, the overall pool is shown with the
   * swap warning beside it rather than pretending.
   */
  protected poolFor(player: OpponentPlayer): ChampionRecord[] {
    const seat = player.role ? player.poolByRole?.[player.role] : undefined;
    if (seat?.length) return seat.slice(0, 5);

    // Rosters scouted before records existed carry names only; show those
    // rather than nothing, with no numbers to go with them.
    const overall = player.championRecords?.length
      ? player.championRecords
      : (player.top3 ?? []).map((champion) => ({ champion, games: 0, wins: 0 }));
    return overall.slice(0, 5);
  }

  /** Who beats them in the seat they hold, falling back to their history. */
  protected countersFor(player: OpponentPlayer): ChampionRecord[] {
    const seat = player.role ? player.bansByRole?.[player.role] : undefined;
    if (seat?.length) return seat.slice(0, 4);
    return (player.bans ?? []).slice(0, 4).map((champion) => ({ champion, games: 0, wins: 0 }));
  }

  protected countersAreForSeat(player: OpponentPlayer): boolean {
    return !!(player.role && player.bansByRole?.[player.role]?.length);
  }

  /** Whether the pool shown is the seat they hold, or their history at large. */
  protected poolIsForSeat(player: OpponentPlayer): boolean {
    return !!(player.role && player.poolByRole?.[player.role]?.length);
  }

  /** A win rate, or nothing when the record is too thin to carry one. */
  protected rateOf(r: ChampionRecord): number | null {
    return r.games > 0 ? Math.round((r.wins / r.games) * 100) : null;
  }

  /** Colour band for a champion win rate, matching the draft panel. */
  protected rateBand(r: ChampionRecord): string {
    const rate = this.rateOf(r);
    if (rate === null) return '';
    if (rate >= 65) return 'is-good';
    if (rate > 50) return 'is-ok';
    if (rate === 50) return 'is-even';
    return 'is-poor';
  }

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
    const stamps = (series.opponentPlayers ?? [])
      .map((p) => p.scoutedAt)
      .filter((at): at is string => !!at)
      .sort();
    if (!stamps.length) return '';

    const days = Math.floor((Date.now() - Date.parse(stamps[stamps.length - 1])) / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  }

  protected setGameResult(game: SeriesGame, win: boolean | undefined): void {
    void this.data.updateSeriesGame({ ...game, win });
  }

  protected removeGame(game: SeriesGame): void {
    void this.data.deleteSeriesGame(game.id);
  }

  // ---- Reconcile against Riot match history -----------------------------
  //
  // Champions are typed in live during champ select; afterwards the real match
  // shows up in the analysis data and can be linked to confirm the entry.

  protected readonly reconcilingGameId = signal<string>('');

  protected toggleReconcile(game: SeriesGame): void {
    this.reconcilingGameId.set(this.reconcilingGameId() === game.id ? '' : game.id);
  }

  protected isReconciling(game: SeriesGame): boolean {
    return this.reconcilingGameId() === game.id;
  }

  /** Analysed games not already linked to a series game, newest first. */
  protected reconcileCandidates(): AnalysisGame[] {
    const linked = new Set(
      this.data.seriesGames().map((g) => g.matchId).filter((id): id is string => Boolean(id))
    );
    return (this.data.compAnalysis()?.games ?? [])
      .filter((g) => !linked.has(g.matchId))
      .slice(0, 12);
  }

  protected candidateLabel(game: AnalysisGame): string {
    const when = new Date(game.date).toLocaleDateString();
    return (game.win ? 'W' : 'L') + ' · ' + when + ' · ' + (game.compName ?? game.queue);
  }

  protected candidateChampions(game: AnalysisGame): string[] {
    return game.players.map((p) => p.champion);
  }

  /** Link a real match to this series game, filling both sides from it. */
  protected linkMatch(game: SeriesGame, match: AnalysisGame): void {
    void this.data.updateSeriesGame({
      ...game,
      ourChampions: match.players.map((p) => p.champion),
      theirChampions: match.enemyChampions ?? [],
      win: match.win,
      matchId: match.matchId
    });
    this.reconcilingGameId.set('');
  }

  /**
   * Undo everything linking filled in — champions and result, not just the id.
   * Leaving them behind reads as hand-entered data and quietly keeps the wrong
   * champions in the fearless burn. Bans are ours, so they stay.
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
