import { AnalysisGame, Player, Scrim, SeriesGame, Tournament, TournamentSeries } from '../models/team.models';
import { nextSeriesId } from '../pages/tournaments/series-order';
import { MvpGame, SeriesMvp, seriesMvpOfGames } from './game-mvp';
import { parseLocalDate } from './local-date';

/**
 * How a series stands, which series are over, and who a finished one crowns (13 Sep 2026).
 *
 * Built for the home page's MVP race, which needs the one answer Prep & Draft never had to give: when
 * is a series finished? Prep reads "played" as any result recorded, which is right for choosing the
 * card to open and wrong for handing out a title — a Bo3 at 1–0 is not over.
 *
 * Only real tournament series count here. A scrim block (`bestOf: 0`, or anything in the scrims group)
 * is open-ended practice with no result of its own, so it never finishes and never crowns anyone.
 */

export interface SeriesScore {
  wins: number;
  losses: number;
  /** Games with a result recorded. */
  played: number;
}

/** Games with a result, the way `TournamentContextService.seriesScore` has always counted them. */
export function seriesScoreOf(games: readonly Pick<SeriesGame, 'win'>[]): SeriesScore {
  let wins = 0;
  let losses = 0;
  for (const g of games) {
    if (g.win === true) wins += 1;
    else if (g.win === false) losses += 1;
  }
  return { wins, losses, played: wins + losses };
}

/** Wins that take a best-of: 1 of 1, 2 of 3, 3 of 5. Nothing for an open-ended block. */
export function winsToTake(bestOf: number): number {
  return bestOf > 0 ? Math.floor(bestOf / 2) + 1 : 0;
}

/** Decided by the majority, or every game of the best-of has a result. A scrim block never is. */
export function isDecided(bestOf: number, score: SeriesScore): boolean {
  if (bestOf <= 0) return false;
  return Math.max(score.wins, score.losses) >= winsToTake(bestOf) || score.played >= bestOf;
}

export interface FinishedSeries {
  series: TournamentSeries;
  tournament: Tournament;
  /** Its games in game order. */
  games: SeriesGame[];
  score: SeriesScore;
  result: 'won' | 'lost' | 'drawn';
  /**
   * Not decided by its own results, but a later series of the same tournament has results — so the
   * series was played and somebody never recorded the rest. It still counts, and says so.
   */
  incomplete: boolean;
  /** The newest date among its games (the replay, else the Riot game), else its scheduled day; null when neither is known. */
  endedAt: number | null;
}

export interface SeriesSources {
  tournaments: readonly Tournament[];
  series: readonly TournamentSeries[];
  seriesGames: readonly SeriesGame[];
}

/** Real tournaments first by their start date, then stored order; series in their stored order inside each. */
function scheduleOrder(tournaments: readonly Tournament[], series: readonly TournamentSeries[]): { tournament: Tournament; series: TournamentSeries }[] {
  const real = tournaments
    .filter((t) => t.kind !== 'scrims')
    .map((t) => ({ t, start: parseLocalDate(t.startDate) }))
    .sort((a, b) => (a.start ?? Number.POSITIVE_INFINITY) - (b.start ?? Number.POSITIVE_INFINITY) || a.t.order - b.t.order)
    .map((x) => x.t);
  const out: { tournament: Tournament; series: TournamentSeries }[] = [];
  for (const tournament of real) {
    for (const s of series.filter((x) => x.tournamentId === tournament.id).sort((a, b) => a.order - b.order)) {
      if (s.bestOf >= 1) out.push({ tournament, series: s });
    }
  }
  return out;
}

/**
 * Every finished real-tournament series, oldest first in schedule order: decided, or left incomplete
 * behind a later series that has results.
 */
export function finishedSeries(
  i: SeriesSources & { analysisById: ReadonlyMap<string, Pick<AnalysisGame, 'date'>>; scrimById: ReadonlyMap<string, Pick<Scrim, 'playedOn'>> }
): FinishedSeries[] {
  const ordered = scheduleOrder(i.tournaments, i.series).map(({ tournament, series }) => {
    const games = i.seriesGames.filter((g) => g.seriesId === series.id).sort((a, b) => a.gameNumber - b.gameNumber);
    return { tournament, series, games, score: seriesScoreOf(games) };
  });
  const out: FinishedSeries[] = [];
  ordered.forEach((row, index) => {
    const decided = isDecided(row.series.bestOf, row.score);
    const laterPlayed = ordered.slice(index + 1).some((later) => later.tournament.id === row.tournament.id && later.score.played > 0);
    const incomplete = !decided && row.score.played > 0 && laterPlayed;
    if (!decided && !incomplete) return;
    const dates = row.games
      .map((g) => {
        if (!g.matchId) return null;
        const scrim = i.scrimById.get(g.matchId);
        const fromScrim = scrim ? Date.parse(scrim.playedOn) : NaN;
        if (!Number.isNaN(fromScrim)) return fromScrim;
        return i.analysisById.get(g.matchId)?.date ?? null;
      })
      .filter((d): d is number => typeof d === 'number' && d > 0);
    const { wins, losses } = row.score;
    out.push({
      ...row,
      result: wins > losses ? 'won' : losses > wins ? 'lost' : 'drawn',
      incomplete,
      endedAt: dates.length ? Math.max(...dates) : parseLocalDate(row.series.scheduledAt)
    });
  });
  return out;
}

/**
 * The next opponent: the first series of a real tournament with no result yet, and nothing once every
 * one has one. The rule `NextUpComponent` has used since 12 Sep 2026, lifted so Home asks the same.
 */
export function nextOpenSeries(i: SeriesSources): TournamentSeries | null {
  const scrimGroups = new Set(i.tournaments.filter((t) => t.kind === 'scrims').map((t) => t.id));
  const list = i.series.filter((s) => !scrimGroups.has(s.tournamentId));
  if (!list.length) return null;
  const played = (id: string) => seriesScoreOf(i.seriesGames.filter((g) => g.seriesId === id)).played > 0;
  const series = list.find((s) => s.id === nextSeriesId(list, played));
  return series && !played(series.id) ? series : null;
}

/** A crown needs figures from more than half of the series' recorded games. */
export const CROWN_MIN_READ_SHARE = 0.5;

export interface SeriesCrown {
  finished: FinishedSeries;
  mvp: SeriesMvp;
  /** The roster member the mark names, when it names one we have. */
  playerId?: string;
  /** Whether it counts as a title in the race. A mark that does not is shown as provisional. */
  counts: boolean;
  /**
   * Why it does not count: two people shared the seat (`no-name`), the name is not on the roster
   * (`not-roster`, e.g. a fill-in or a renamed Riot id), or too few games carry figures (`thin`).
   */
  why?: 'no-name' | 'not-roster' | 'thin';
}

/** Who a finished series crowns, and whether it counts. Nothing when no game of it carries figures. */
export function crownOf(
  finished: FinishedSeries,
  analysisById: ReadonlyMap<string, MvpGame>,
  scrimById: ReadonlyMap<string, Scrim>,
  roster: readonly Pick<Player, 'id' | 'name'>[]
): SeriesCrown | null {
  // Only games with a result: a game 3 created in the draft room and never played is not a game the mark missed.
  const mvp = seriesMvpOfGames(finished.games.filter((g) => g.win !== undefined), analysisById, scrimById);
  if (!mvp) return null;
  const player = mvp.name ? roster.find((p) => p.name.trim().toLowerCase() === mvp.name!.trim().toLowerCase()) : undefined;
  const thin = mvp.of > 0 ? mvp.read / mvp.of <= CROWN_MIN_READ_SHARE : true;
  const why: SeriesCrown['why'] = !mvp.name ? 'no-name' : !player ? 'not-roster' : thin ? 'thin' : undefined;
  return { finished, mvp, ...(player ? { playerId: player.id } : {}), counts: !why, ...(why ? { why } : {}) };
}
