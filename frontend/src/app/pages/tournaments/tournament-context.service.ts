import { computed, inject, Injectable, signal } from '@angular/core';
import { SeriesGame, Tournament, TournamentSeries } from '../../models/team.models';
import { TeamDataService } from '../../services/team-data.service';
import { isSandboxSeries } from '../../core/sandbox-series';
import { endedLast, isActiveTournament, isEndedTournament, lastEndedTournament } from '../../core/tournament-ended';
import { compSeatOptions } from '../../core/comp-seats';
import { blockedSet, CompAvailability, compAvailability, CompChampions, playedGames, PoolPressure, poolPressure, uniqueChampions } from './draft.util';
import { isNoBan } from './draft-sequence';

/**
 * A side's picks as champions for the burned lists. A ban nobody saw (`NO_BAN`, 17 Sep 2026) lives in the bans, but
 * nothing that burns may ever count it as a champion, wherever a stray one lands.
 */
const champions = (list: readonly string[] | undefined): string[] => (list ?? []).filter((c) => !isNoBan(c));

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

  readonly roles = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'] as const;

  /** Our team name, used to label the sides of a game. */
  readonly teamName = computed(() => this.data.settings().teamName || 'Us');

  // ---- Selection ---------------------------------------------------------

  private readonly chosenTournamentId = signal<string>('');
  readonly openSeriesId = signal<string>('');

  readonly tournaments = computed(() => this.data.tournaments());

  /**
   * Which group the page lands on when nobody has chosen one: the active tournament, so it opens on what
   * matters now.
   *
   * An ended split never leads (21 Sep 2026), whatever its `active` flag says — that is the whole point of
   * ending one. With nothing marked current, a tournament still being played comes before the scrims group,
   * which is where the scrims are and has never been anybody's landing group. With every real split ended
   * the one ended most recently is shown rather than nothing: the page has to draw something, and the split
   * just finished is the one to read back. Choosing an ended group by hand still opens it.
   *
   * The scrims group is never reached by any of those clauses (21 Sep 2026, review fix). Nothing ever ends
   * it, so a clause reading merely "not ended" matched it ahead of the split just finished, and ending the
   * only real tournament landed the page on the scrim blocks — which the rule above says it must never do.
   * `all[0]` is the last resort for a team that has no real tournament at all.
   */
  private landingGroup(all: readonly Tournament[]): Tournament | null {
    return (
      all.find(isActiveTournament) ??
      all.find((t) => t.kind !== 'scrims' && !isEndedTournament(t)) ??
      lastEndedTournament(all) ??
      all[0] ??
      null
    );
  }

  /** Defaults to the active tournament so the page opens on what matters now. */
  readonly currentTournament = computed<Tournament | null>(() => {
    const all = this.tournaments();
    const chosen = this.chosenTournamentId();
    // A link may ask for the scrims group before the data has arrived; the wish is kept until it has.
    if (chosen === 'scrims') return this.scrimsGroup() ?? this.landingGroup(all);
    if (chosen) return all.find((t) => t.id === chosen) ?? null;
    // A draft opened by link names its series, and the data may arrive after
    // the link is read: the series' tournament wins until one is chosen (9 Sep 2026).
    const seriesId = this.draftSeriesId();
    const via = seriesId ? this.data.tournamentSeries().find((s) => s.id === seriesId) : undefined;
    const own = via ? all.find((t) => t.id === via.tournamentId) : undefined;
    return own ?? this.landingGroup(all);
  });

  /**
   * The groups as Prep & Draft's group row lists them: the live ones first, the ended ones after
   * (21 Sep 2026). A separate signal from `tournaments`, which is the stored order and is what the draft
   * room reads — nothing in that room may move.
   */
  readonly groupList = computed(() => endedLast(this.tournaments()));

  /** True when the group showing is a split somebody has ended. */
  readonly isEnded = computed(() => isEndedTournament(this.currentTournament()));

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

  /**
   * The group's series in their stored order, with a sandbox series after every real one (17 Sep 2026): a rehearsal
   * such as "vs test" has no business among the draft room's series pills and the Plan cards ahead of the matches
   * actually coming up. The sort is stable, so everything else keeps the order it was typed in.
   */
  readonly seriesList = computed<TournamentSeries[]>(() => {
    const t = this.currentTournament();
    if (!t) return [];
    return this.data
      .tournamentSeries()
      .filter((s) => s.tournamentId === t.id)
      .sort((a, b) => Number(isSandboxSeries(a)) - Number(isSandboxSeries(b)));
  });

  gamesFor(seriesId: string): SeriesGame[] {
    return this.data
      .seriesGames()
      .filter((g) => g.seriesId === seriesId)
      .sort((a, b) => a.gameNumber - b.gameNumber);
  }

  /** The games of a series that were played — a result or a replay — for every count a head shows. */
  playedGamesFor(seriesId: string): SeriesGame[] {
    return playedGames(this.gamesFor(seriesId));
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
    // Once each by the one champion key: a game saved from a replay writes "MonkeyKing" where a
    // typed one writes "Wukong", and a Set of the raw strings counted that champion twice.
    const used: string[] = [];
    for (const game of this.gamesFor(seriesId)) {
      used.push(...champions(game.ourChampions), ...champions(game.theirChampions));
    }
    return uniqueChampions(used);
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
      used.push(...champions(game.ourChampions), ...champions(game.theirChampions));
    }
    return uniqueChampions(used);
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
      our.push(...champions(game.ourChampions));
      their.push(...champions(game.theirChampions));
    }
    return { our: uniqueChampions(our), their: uniqueChampions(their) };
  }

  /**
   * Our comps as the availability maths reads them: every seat's champions, the priority first, and
   * the priority five beside them (20 Sep 2026).
   *
   * `champions` is unchanged — still one champion a seat, still the first choice — so nothing that
   * reads it changes meaning. `seats` is what makes a fallback count: a seat lives while any of its
   * champions is open. Both come from `core/comp-seats`, the one module that knows a comp has two
   * seat fields, so this never touches `fallbacks` itself and inherits its invariant, its dedupe and
   * its cap.
   */
  compChampions(): CompChampions[] {
    const ranked = this.data.compAnalysis()?.comps ?? [];
    return this.data.comps().map((comp) => {
      const record = ranked.find((r) => r.compId === comp.id);
      const seats = compSeatOptions(comp);
      return {
        id: comp.id,
        name: comp.name,
        category: comp.category,
        winRate: record?.winRate,
        games: record?.games,
        champions: this.roles.map((role) => seats[role][0]?.champion ?? ''),
        seats: this.roles.map((role) => ({ role, champions: seats[role].map((option) => option.champion) }))
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
