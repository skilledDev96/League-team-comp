import { computed, inject, Injectable, signal } from '@angular/core';
import { SeriesGame, Tournament, TournamentSeries } from '../../models/team.models';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { blockedSet, CompAvailability, compAvailability, PoolPressure, poolPressure } from './draft.util';

/**
 * What the Plan and Draft views both need: which tournament is open, its
 * series and games, and the fearless maths derived from them.
 *
 * Planning and drafting are different jobs and live in different components,
 * but they read the same series — so the shared derivations sit here rather
 * than being computed twice or passed down through inputs.
 */
@Injectable({ providedIn: 'root' })
export class TournamentContextService {
  private readonly data = inject(TeamDataService);
  private readonly ui = inject(UiService);

  readonly roles = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'] as const;

  /** Our team name, used to label the sides of a game. */
  readonly teamName = computed(() => this.data.settings().teamName || 'Us');

  // ---- Selection ---------------------------------------------------------

  private readonly chosenTournamentId = signal<string>('');
  readonly openSeriesId = signal<string>('');

  readonly tournaments = computed(() => this.data.tournaments());

  /** Defaults to the active tournament so the page opens on what matters now. */
  readonly currentTournament = computed<Tournament | null>(() => {
    const all = this.tournaments();
    const chosen = this.chosenTournamentId();
    // A link may ask for the scrims group before the data has arrived; the wish is kept until it has.
    if (chosen === 'scrims') return this.scrimsGroup() ?? all.find((t) => t.active) ?? all[0] ?? null;
    if (chosen) return all.find((t) => t.id === chosen) ?? null;
    // A draft opened by link names its series, and the data may arrive after
    // the link is read: the series' tournament wins until one is chosen (9 Sep 2026).
    const seriesId = this.draftSeriesId();
    const via = seriesId ? this.data.tournamentSeries().find((s) => s.id === seriesId) : undefined;
    const own = via ? all.find((t) => t.id === via.tournamentId) : undefined;
    return own ?? all.find((t) => t.active) ?? all[0] ?? null;
  });

  selectTournament(id: string): void {
    this.chosenTournamentId.set(id);
    this.openSeriesId.set('');
  }

  /** The one group every scrim opponent lives in, once it exists. */
  readonly scrimsGroup = computed(() => this.tournaments().find((t) => t.kind === 'scrims') ?? null);

  /** True on the scrims group: no dates, no best-of, nothing burns. */
  readonly isScrims = computed(() => this.currentTournament()?.kind === 'scrims');

  /** A link may name the group as `scrims` or by id. */
  selectGroup(idOrScrims: string): void {
    this.selectTournament(idOrScrims === 'scrims' ? 'scrims' : idOrScrims);
  }

  /** Whether picks burn across this series: the group's rule, tournaments by default. */
  isFearless(seriesId: string): boolean {
    const series = this.data.tournamentSeries().find((s) => s.id === seriesId);
    const group = series ? this.tournaments().find((t) => t.id === series.tournamentId) : undefined;
    if (!group) return true;
    return group.kind === 'scrims' ? false : group.fearless !== false;
  }

  /** A Bo3 means three games; a scrim block (bestOf 0) has no cap. */
  canAddGame(series: TournamentSeries): boolean {
    return !series.bestOf || this.gamesFor(series.id).length < series.bestOf;
  }

  /**
   * Draft against this series: the first game still open, else a new one,
   * then the draft view (9 Sep 2026; the old Scrims page did the same after
   * making the series first).
   */
  async draftSeries(seriesId: string): Promise<void> {
    const series = this.data.tournamentSeries().find((s) => s.id === seriesId);
    if (!series) return;
    const games = this.gamesFor(seriesId);
    const open = games.find((g) => g.win === undefined);
    const gameId = open?.id ?? (this.canAddGame(series) ? await this.data.createSeriesGame({ seriesId, gameNumber: games.length + 1, ourChampions: [], theirChampions: [] }) : games.at(-1)?.id ?? '');
    this.openDraft(seriesId, gameId);
  }

  readonly seriesList = computed<TournamentSeries[]>(() => {
    const t = this.currentTournament();
    if (!t) return [];
    return this.data.tournamentSeries().filter((s) => s.tournamentId === t.id);
  });

  gamesFor(seriesId: string): SeriesGame[] {
    return this.data
      .seriesGames()
      .filter((g) => g.seriesId === seriesId)
      .sort((a, b) => a.gameNumber - b.gameNumber);
  }

  seriesScore(seriesId: string): { wins: number; losses: number } {
    const games = this.gamesFor(seriesId).filter((g) => g.win !== undefined);
    const wins = games.filter((g) => g.win).length;
    return { wins, losses: games.length - wins };
  }

  // ---- Fearless draft ----------------------------------------------------

  /**
   * Every champion burned in this series so far. Under Fearless Draft a champion
   * used by *either* team is gone for the rest of the series, so both sides count.
   */
  usedChampions(seriesId: string): string[] {
    if (!this.isFearless(seriesId)) return [];
    const used: string[] = [];
    for (const game of this.gamesFor(seriesId)) {
      used.push(...(game.ourChampions ?? []), ...(game.theirChampions ?? []));
    }
    return [...new Set(used.filter(Boolean))];
  }

  usedCount(seriesId: string): number {
    return this.usedChampions(seriesId).length;
  }

  /** Champions burned by games *before* this one — the fearless carry-over. */
  burnedBefore(seriesId: string, gameNumber: number): string[] {
    if (!this.isFearless(seriesId)) return [];
    const used: string[] = [];
    for (const game of this.gamesFor(seriesId)) {
      if (game.gameNumber >= gameNumber) continue;
      used.push(...(game.ourChampions ?? []), ...(game.theirChampions ?? []));
    }
    return [...new Set(used.filter(Boolean))];
  }

  /**
   * The same carry-over split by who spent it. A champion is burned whoever
   * used it, but a drafter reads the two lists differently: ours are comps we
   * can no longer play, theirs are threats we no longer face.
   */
  burnedBeforeBySide(seriesId: string, gameNumber: number): { our: string[]; their: string[] } {
    if (!this.isFearless(seriesId)) return { our: [], their: [] };
    const our: string[] = [];
    const their: string[] = [];
    for (const game of this.gamesFor(seriesId)) {
      if (game.gameNumber >= gameNumber) continue;
      our.push(...(game.ourChampions ?? []));
      their.push(...(game.theirChampions ?? []));
    }
    return { our: [...new Set(our.filter(Boolean))], their: [...new Set(their.filter(Boolean))] };
  }

  /** Our comps reduced to their five champions, for the availability maths. */
  compChampions() {
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
  compAvailability(seriesId: string): CompAvailability[] {
    return compAvailability(this.compChampions(), blockedSet(this.usedChampions(seriesId)));
  }

  playableComps(seriesId: string): CompAvailability[] {
    return this.compAvailability(seriesId).filter((c) => c.playable);
  }

  /** Broken comps, least-damaged first — those are the easiest to patch. */
  brokenComps(seriesId: string): CompAvailability[] {
    return this.compAvailability(seriesId).filter((c) => !c.playable);
  }

  /** Roster champion pools thinning out as the series burns champions. */
  poolPressure(seriesId: string): PoolPressure[] {
    return poolPressure(
      this.data.players().map((p) => ({ name: p.name, pool: p.top3 ?? [] })),
      blockedSet(this.usedChampions(seriesId))
    );
  }

  // ---- Moving between the two views ---------------------------------------

  /**
   * Which half of the page is showing.
   *
   * Held here rather than in the shell so either view can send you to the
   * other. Editing an opponent roster used to mean leaving the draft, finding
   * edit mode, opening the series, scrolling, and opening a second panel — a
   * five-step trip to a thing the draft room links to directly.
   */
  readonly view = signal<'plan' | 'draft'>('plan');

  /** A series whose prep panel should be revealed on the plan view. */
  readonly prepRequest = signal<string>('');

  // ---- The draft in the address bar ----------------------------------------
  //
  // Which series and game the draft view shows, held here rather than on the
  // draft component so the shell can write them into the query string. That
  // is what makes the draft shareable: a teammate opening the same link lands
  // on the same game, and the board is already live over the snapshot
  // listener, so they see every ban and pick as it is confirmed.

  /** What the draft view was asked to show — by a click, or by a shared link. */
  readonly draftSeriesId = signal<string>('');
  readonly draftGameId = signal<string>('');

  /** What the draft view is actually showing, after its own fallbacks. */
  readonly shownSeriesId = signal<string>('');
  readonly shownGameId = signal<string>('');

  /** Open a specific game on the draft view, as a shared link does. */
  openDraft(seriesId: string, gameId: string): void {
    // A series from another tournament (a scrim block, say) brings its tournament along.
    const series = seriesId ? this.data.tournamentSeries().find((s) => s.id === seriesId) : undefined;
    if (series && series.tournamentId !== this.currentTournament()?.id) this.chosenTournamentId.set(series.tournamentId);
    this.draftSeriesId.set(seriesId);
    this.draftGameId.set(gameId);
    this.view.set('draft');
  }

  /** Go to this opponent's prep, wherever you are now. */
  openPrep(seriesId: string): void {
    // A series from another tournament brings its tournament along, as openDraft does — the home page's
    // Scout them pill can name any series, and the plan only opens panels in the tournament it shows.
    const series = seriesId ? this.data.tournamentSeries().find((s) => s.id === seriesId) : undefined;
    if (series && series.tournamentId !== this.currentTournament()?.id) this.chosenTournamentId.set(series.tournamentId);
    this.view.set('plan');
    this.prepRequest.set(seriesId);
  }
}
