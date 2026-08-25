import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AnalysisGame, Comp, Role, SeriesGame, Tournament, TournamentSeries } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { ChampionDataService } from '../../services/champion-data.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { ChampionChipComponent } from '../../shared/champion-chip.component';
import { ChampionPickerComponent } from '../../shared/champion-picker.component';
import { MatchNoteButtonComponent } from '../../shared/match-note-button.component';
import { MatchNoteComponent } from '../../shared/match-note.component';
import { blockedSet, CompAvailability, compAvailability, PoolPressure, poolPressure } from './draft.util';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { NgModelNameDirective } from '../../shared/ng-model-name.directive';

/** A comp measured against the champions already burned in a fearless series. */


@Component({
  selector: 'app-tournaments',
  imports: [FormsModule, RouterLink, ChampionChipComponent, ChampionPickerComponent, MatchNoteComponent, MatchNoteButtonComponent, TooltipDirective, NgModelNameDirective],
  templateUrl: './tournaments.component.html'
})
export class TournamentsComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly auth = inject(AuthService);
  protected readonly ui = inject(UiService);
  protected readonly champData = inject(ChampionDataService);

  /** Our team name, used to label the sides of a game. */
  protected readonly teamName = computed(() => this.data.settings().teamName || 'Us');

  protected readonly roles = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'] as const;

  // ---- Selection --------------------------------------------------------

  private readonly chosenTournamentId = signal<string>('');

  protected readonly tournaments = computed(() => this.data.tournaments());

  /** Defaults to the active tournament so the page opens on what matters now. */
  protected readonly currentTournament = computed<Tournament | null>(() => {
    const all = this.tournaments();
    const chosen = this.chosenTournamentId();
    if (chosen) return all.find((t) => t.id === chosen) ?? null;
    return all.find((t) => t.active) ?? all[0] ?? null;
  });

  protected selectTournament(id: string): void {
    this.chosenTournamentId.set(id);
    this.openSeriesId.set('');
  }

  protected readonly seriesList = computed<TournamentSeries[]>(() => {
    const t = this.currentTournament();
    if (!t) return [];
    return this.data.tournamentSeries().filter((s) => s.tournamentId === t.id);
  });

  protected readonly openSeriesId = signal<string>('');

  protected toggleSeries(id: string): void {
    this.openSeriesId.set(this.openSeriesId() === id ? '' : id);
  }

  protected isSeriesOpen(id: string): boolean {
    return this.openSeriesId() === id;
  }

  protected gamesFor(seriesId: string): SeriesGame[] {
    return this.data
      .seriesGames()
      .filter((g) => g.seriesId === seriesId)
      .sort((a, b) => a.gameNumber - b.gameNumber);
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

  // ---- Fearless draft ---------------------------------------------------

  private norm(name: string): string {
    return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Every champion burned in this series so far. Under Fearless Draft a champion
   * used by *either* team is gone for the rest of the series, so both sides count.
   */
  protected usedChampions(seriesId: string): string[] {
    const used: string[] = [];
    for (const game of this.gamesFor(seriesId)) {
      used.push(...(game.ourChampions ?? []), ...(game.theirChampions ?? []));
    }
    return [...new Set(used.filter(Boolean))];
  }

  protected usedCount(seriesId: string): number {
    return this.usedChampions(seriesId).length;
  }

  /** Our comps reduced to their five champions, for the availability maths. */
  private compChampions() {
    const ranked = this.data.compAnalysis()?.comps ?? [];
    return this.data.comps().map((comp) => {
      const record = ranked.find((r) => r.compId === comp.id);
      return {
        id: comp.id,
        name: comp.name,
        category: comp.category,
        winRate: record?.winRate,
        games: record?.games,
        champions: this.roles.map((role) => this.ui.parseCompLine(comp.picks[role] ?? '').champion)
      };
    });
  }

  /** Which of our defined comps survive into the next game of this series. */
  protected compAvailability(seriesId: string): CompAvailability[] {
    return compAvailability(this.compChampions(), blockedSet(this.usedChampions(seriesId)));
  }

  protected playableComps(seriesId: string): CompAvailability[] {
    return this.compAvailability(seriesId).filter((c) => c.playable);
  }

  /** Broken comps, least-damaged first — those are the easiest to patch. */
  protected brokenComps(seriesId: string): CompAvailability[] {
    return this.compAvailability(seriesId).filter((c) => !c.playable);
  }

  /** Roster champion pools thinning out as the series burns champions. */
  protected poolPressure(seriesId: string): PoolPressure[] {
    return poolPressure(
      this.data.players().map((p) => ({ name: p.name, pool: p.top3 ?? [] })),
      blockedSet(this.usedChampions(seriesId))
    );
  }

  // ---- Page view ---------------------------------------------------------
  //
  // Planning and drafting are different jobs: one is read at leisure, the other
  // mid-draft with the clock running. They get their own views rather than the
  // board being buried three levels down inside a series.

  protected readonly view = signal<'plan' | 'draft'>('plan');
  private readonly pickedSeriesId = signal<string>('');
  private readonly pickedGameId = signal<string>('');

  /** The series being drafted: whatever was picked, else the first live one. */
  protected draftSeries(): TournamentSeries | undefined {
    const list = this.seriesList();
    return (
      list.find((s) => s.id === this.pickedSeriesId()) ??
      list.find((s) => this.gamesFor(s.id).some((g) => g.win === undefined)) ??
      list[0]
    );
  }

  protected draftGame(): SeriesGame | undefined {
    const series = this.draftSeries();
    if (!series) return undefined;
    const games = this.gamesFor(series.id);
    return games.find((g) => g.id === this.pickedGameId()) ?? games.find((g) => g.win === undefined) ?? games.at(-1);
  }

  protected selectDraftSeries(seriesId: string): void {
    this.pickedSeriesId.set(seriesId);
    this.pickedGameId.set('');
  }

  protected selectDraftGame(gameId: string): void {
    this.pickedGameId.set(gameId);
  }

  /** Bo3 means three games; there is nothing to draft beyond that. */
  protected canAddDraftGame(series: TournamentSeries): boolean {
    return this.gamesFor(series.id).length < series.bestOf;
  }

  protected nextGameNumber(series: TournamentSeries): number {
    return this.gamesFor(series.id).length + 1;
  }

  /**
   * Add the next game and open it, so a series can be drafted from this view
   * without going back to Plan to create the game first.
   */
  protected async addDraftGame(series: TournamentSeries): Promise<void> {
    await this.addGame(series);
    const added = this.gamesFor(series.id).at(-1);
    this.pickedGameId.set(added?.id ?? '');
  }

  /** Comps and pools open on click, so the detail is there when it is wanted. */
  private readonly openComps = signal<ReadonlySet<string>>(new Set());
  private readonly openPools = signal<ReadonlySet<string>>(new Set());

  protected isCompOpen(compId: string): boolean {
    return this.openComps().has(compId);
  }

  protected toggleComp(compId: string): void {
    this.openComps.update((ids) => this.flip(ids, compId));
  }

  protected isPoolOpen(name: string): boolean {
    return this.openPools().has(name);
  }

  protected togglePool(name: string): void {
    this.openPools.update((ids) => this.flip(ids, name));
  }

  private flip(ids: ReadonlySet<string>, key: string): ReadonlySet<string> {
    const next = new Set(ids);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    return next;
  }

  /** A comp's picks by role, for the expanded row. */
  protected compLineup(compId: string): { role: Role; champion: string }[] {
    const comp = this.data.comps().find((c) => c.id === compId);
    if (!comp) return [];
    return this.roles.map((role) => ({
      role,
      champion: this.ui.parseCompLine(comp.picks[role] ?? '').champion
    }));
  }

  /** Drop the last game of the series; removing an earlier one would renumber. */
  protected removeDraftGame(game: SeriesGame): void {
    this.pickedGameId.set('');
    void this.data.deleteSeriesGame(game.id);
  }

  protected isLastGame(game: SeriesGame): boolean {
    return this.gamesFor(game.seriesId).at(-1)?.id === game.id;
  }

  protected isDraftGame(game: SeriesGame): boolean {
    return this.draftGame()?.id === game.id;
  }

  // ---- Live draft --------------------------------------------------------
  //
  // Mid-draft the board keeps moving: bans land, the enemy takes something. The
  // series view answers "what survives into the next game"; this answers "what
  // survives right now", which is the question being asked at the table.

  /** Champions burned by games *before* this one — the fearless carry-over. */
  private burnedBefore(seriesId: string, gameNumber: number): string[] {
    const used: string[] = [];
    for (const game of this.gamesFor(seriesId)) {
      if (game.gameNumber >= gameNumber) continue;
      used.push(...(game.ourChampions ?? []), ...(game.theirChampions ?? []));
    }
    return [...new Set(used.filter(Boolean))];
  }

  /**
   * Everything we cannot draft into a comp this game. Our own picks are left
   * out: two of Engage already on the board means Engage is live, not blocked.
   */
  private draftBlocked(game: SeriesGame): Set<string> {
    return blockedSet(
      this.burnedBefore(game.seriesId, game.gameNumber),
      game.bans,
      game.theirChampions
    );
  }

  protected draftComps(game: SeriesGame): CompAvailability[] {
    return compAvailability(this.compChampions(), this.draftBlocked(game));
  }

  protected draftPlayable(game: SeriesGame): CompAvailability[] {
    return this.draftComps(game).filter((c) => c.playable);
  }

  protected draftBroken(game: SeriesGame): CompAvailability[] {
    return this.draftComps(game).filter((c) => !c.playable);
  }

  /**
   * Pool left per player. Our own picks *do* count here — once a champion is on
   * the board nobody else can have it, so it is gone from everyone's options.
   */
  protected draftPools(game: SeriesGame): PoolPressure[] {
    const blocked = blockedSet(
      this.burnedBefore(game.seriesId, game.gameNumber),
      game.bans,
      game.theirChampions,
      game.ourChampions
    );
    return poolPressure(
      this.data.players().map((p) => ({ name: p.name, pool: p.top3 ?? [] })),
      blocked
    );
  }

  protected burnedBeforeCount(game: SeriesGame): number {
    return this.burnedBefore(game.seriesId, game.gameNumber).length;
  }

  protected setGameBans(game: SeriesGame, bans: string[]): void {
    void this.data.updateSeriesGame({ ...game, bans: bans.length ? bans : undefined });
  }

  /** The game being drafted or played: the first without a result yet. */
  protected isLiveGame(game: SeriesGame): boolean {
    const games = this.gamesFor(game.seriesId);
    return games.find((g) => g.win === undefined)?.id === game.id;
  }

  // ---- Series score -----------------------------------------------------

  protected seriesScore(seriesId: string): { wins: number; losses: number } {
    const games = this.gamesFor(seriesId).filter((g) => g.win !== undefined);
    const wins = games.filter((g) => g.win).length;
    return { wins, losses: games.length - wins };
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
