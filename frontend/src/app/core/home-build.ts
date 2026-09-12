import { Player, ROLES } from '../models/team.models';
import { buildGameRows, GameRow, PlayerLine, playerLines } from '../pages/games/game-rows';
import { MIN_FOR_A_CLAIM } from '../pages/review/loss-patterns.util';
import { Advice, DEFAULT_PATTERN_FILTERS, keepDoing, patternInputs, tournamentMatchIds, workOn } from '../pages/review/win-loss-splits';
import { achievementsOf } from './achievements';
import { compOfTheMonth } from './comp-month';
import { mvpGameFromRow, mvpOf } from './game-mvp';
import { donutSegments } from './home-charts';
import { HomeAdviceLine, HomeHandTrophy, HomeInput, HomeLineupCard, HomeModel, HomeNextSeries, HomeSlide, HomeSpotlight, HomeWelcome } from './home-model';
import { parseLocalDate } from './local-date';
import { welcomeFor } from './home-welcome';
import { lastCrown, mvpRace, podium } from './mvp-race';
import { crownOf, FinishedSeries, finishedSeries, nextOpenSeries, SeriesCrown } from './series-results';
import {
  headline,
  mainChampionOf,
  objectiveControl,
  rankLabelOf,
  recordsToBeat,
  SeasonWindow,
  seasonRows,
  seasonWindow,
  streaks,
  winRateTrend
} from './team-season';

/** How many lines of Work on and Keep doing the home page prints; the rest are on Patterns. */
export const HOME_ADVICE_LINES = 2;

const seatOrder = (p: Pick<Player, 'role' | 'order'>) => ROLES.indexOf(p.role) * 1000 + (p.order ?? 0);
const sameName = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** A series finished inside the season: its tournament's, or ended inside the window when the season is a stretch of days. */
function inSeason(f: FinishedSeries, w: SeasonWindow): boolean {
  if (w.mode === 'all') return true;
  if (w.tournamentId) return f.tournament.id === w.tournamentId;
  return f.endedAt !== null && f.endedAt >= w.from && f.endedAt <= w.to;
}

/** A kick-off with a time of day in it, as the Plan view's date-and-time field writes it. A bare day or free text counts nothing down. */
function kickOffOf(scheduledAt: string | undefined): number | null {
  if (!scheduledAt || !/\d{1,2}:\d{2}/.test(scheduledAt)) return null;
  const at = Date.parse(scheduledAt);
  return Number.isNaN(at) ? null : at;
}

function adviceLines(list: readonly Advice[]): HomeAdviceLine[] {
  // The evidence stays on Patterns: the page prints the sentence and what it was counted over.
  return list.slice(0, HOME_ADVICE_LINES).map((a) => ({ key: a.key, strong: a.strong, rest: a.rest, n: a.n }));
}

function titlesById(crowns: readonly SeriesCrown[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of crowns) if (c.counts && c.playerId) out.set(c.playerId, (out.get(c.playerId) ?? 0) + 1);
  return out;
}

/**
 * The spotlight when no series has crowned anyone: whoever took the most game MVPs this season, ties to
 * the one who took theirs most recently. Only a mark that names a roster player counts.
 */
function gamesSpotlight(rows: readonly GameRow[], roster: readonly Player[]): HomeSpotlight | null {
  const tally = new Map<string, { player: Player; mvps: number; first: number; champion: string; seat: Player['role']; terms: string[] }>();
  let of = 0;
  rows.forEach((row, index) => {
    const mark = mvpOf(mvpGameFromRow(row));
    if (!mark) return;
    of += 1;
    const player = roster.find((p) => sameName(p.name, mark.name));
    if (!player) return;
    const t = tally.get(player.id);
    // Rows arrive newest first, so the first mark seen is the latest one: it keeps the champion.
    if (t) t.mvps += 1;
    else tally.set(player.id, { player, mvps: 1, first: index, champion: mark.champion, seat: mark.seat, terms: mark.why });
  });
  const best = [...tally.values()].sort((a, b) => b.mvps - a.mvps || a.first - b.first)[0];
  if (!best) return null;
  return {
    kind: 'games',
    playerId: best.player.id,
    name: best.player.name,
    ...(best.player.icon ? { icon: best.player.icon } : {}),
    champion: best.champion,
    seat: best.seat,
    mvps: best.mvps,
    of,
    terms: best.terms
  };
}

/**
 * The trophies entered by hand, newest first. One won inside a tournament season belongs to it; otherwise
 * its day decides, and a trophy with no day is never called this season's.
 */
function handTrophiesOf(i: HomeInput, season: SeasonWindow): HomeHandTrophy[] {
  const names = new Map(i.tournaments.map((t) => [t.id, t.name]));
  return [...(i.trophies ?? [])]
    .map((t) => {
      const at = parseLocalDate(t.date);
      const where = (t.tournamentId && names.get(t.tournamentId)) || t.event?.trim() || '';
      const inWindow = season.mode === 'all' || (season.tournamentId ? t.tournamentId === season.tournamentId : at !== null && at >= season.from && at <= season.to);
      const trophy: HomeHandTrophy = {
        id: t.id,
        title: t.title,
        ...(t.placement ? { placement: t.placement } : {}),
        ...(where ? { where } : {}),
        at,
        ...(t.champion ? { champion: t.champion } : {}),
        ...(t.note ? { note: t.note } : {}),
        thisSeason: inWindow
      };
      return { trophy, order: t.order };
    })
    .sort((a, b) => (b.trophy.at ?? Number.NEGATIVE_INFINITY) - (a.trophy.at ?? Number.NEGATIVE_INFINITY) || a.order - b.order)
    .map((x) => x.trophy);
}

function lineupOf(starters: readonly Player[], seasonLines: readonly PlayerLine[], allLines: readonly PlayerLine[], titles: ReadonlyMap<string, number>): HomeLineupCard[] {
  const most = Math.max(0, ...titles.values());
  return starters.map((p) => {
    const line = seasonLines.find((l) => sameName(l.name, p.name));
    return {
      playerId: p.id,
      name: p.name,
      role: p.role,
      ...(p.icon ? { icon: p.icon } : {}),
      champion: mainChampionOf(p, allLines),
      rank: rankLabelOf(p),
      games: line?.games ?? 0,
      winRate: line ? line.winRate : null,
      crowned: most > 0 && titles.get(p.id) === most
    };
  });
}

/**
 * The home page from the team's data (13 Sep 2026). Pure: the clock, the hour, the seat and the season
 * switch come in, so the page recomputes it whenever any of them moves and the specs pin every one.
 *
 * Two readings of time run through it. The season (the running tournament, else ninety days, else
 * everything) scopes the counters, the race, the form, the records, the objectives and the lineup's
 * rates. The spotlight and the race's foot name the newest crowned series whatever the season, because a
 * split that has only just begun has not crowned anybody and the last MVP is still the last MVP. The
 * trophy cabinet reads everything and marks what fell inside the season. Practice-tagged games count
 * nowhere, as on Patterns.
 */
export function buildHome(i: HomeInput): HomeModel {
  const rows = buildGameRows({
    analysis: [...i.analysis],
    comps: [...i.comps],
    compOverride: i.compOverride,
    players: [...i.players],
    starters: i.players.filter((p) => !p.sub),
    tournaments: [...i.tournaments],
    series: [...i.series],
    seriesGames: [...i.seriesGames],
    scrims: [...i.scrims]
  });
  const serious = rows.filter((r) => !(r.matchId && i.practice.has(r.matchId)));
  const season = seasonWindow(i.tournaments, i.now, i.mode);
  const seriesTournament = new Map(i.series.map((s) => [s.id, s.tournamentId]));
  const seasonGames = seasonRows(rows, season, { practice: i.practice, seriesTournament });

  const analysisById = new Map(i.analysis.map((g) => [g.matchId, g]));
  const scrimById = new Map(i.scrims.map((s) => [s.id, s]));
  const finished = finishedSeries({ tournaments: i.tournaments, series: i.series, seriesGames: i.seriesGames, analysisById, scrimById });
  const seasonFinished = finished.filter((f) => inSeason(f, season));
  const crownBySeries = new Map<string, SeriesCrown | null>(finished.map((f) => [f.series.id, crownOf(f, analysisById, scrimById, i.players)]));
  const crowns = [...crownBySeries.values()].filter((c): c is SeriesCrown => !!c);
  const seasonCrowns = crowns.filter((c) => inSeason(c.finished, season));
  const seasonTitles = titlesById(seasonCrowns);

  const starters = i.players.filter((p) => !p.sub).sort((a, b) => seatOrder(a) - seatOrder(b));
  const allLines = playerLines(serious);
  const seasonLines = playerLines(seasonGames);

  const slides: HomeSlide[] = starters.flatMap((p) => {
    const champion = mainChampionOf(p, allLines);
    return champion ? [{ champion, player: p.name, role: p.role }] : [];
  });

  const counters = headline(seasonGames, seasonFinished);

  const upcoming = nextOpenSeries({ tournaments: i.tournaments, series: i.series, seriesGames: i.seriesGames });
  const next: HomeNextSeries | null = upcoming
    ? {
        seriesId: upcoming.id,
        opponent: upcoming.opponent,
        tournament: i.tournaments.find((t) => t.id === upcoming.tournamentId)?.name ?? '',
        bestOf: upcoming.bestOf,
        at: kickOffOf(upcoming.scheduledAt),
        ...(upcoming.scheduledAt?.trim() ? { when: upcoming.scheduledAt.trim() } : {})
      }
    : null;

  const greeting = welcomeFor({
    seat: i.seat,
    starters,
    lines: seasonLines,
    titlesByPlayerId: seasonTitles,
    rows: serious,
    hour: i.hour,
    dismissed: i.seatDismissed
  });
  const welcome: HomeWelcome = {
    greeting: greeting.greeting,
    needsSeat: greeting.needsSeat,
    ...(greeting.player
      ? { player: { id: greeting.player.id, name: greeting.player.name, role: greeting.player.role, ...(greeting.player.icon ? { icon: greeting.player.icon } : {}) } }
      : {}),
    titles: greeting.titles,
    form: greeting.form,
    ...(greeting.line ? { line: { games: greeting.line.games, wins: greeting.line.wins, winRate: greeting.line.winRate, kda: greeting.line.kda } } : {})
  };

  const last = lastCrown(crowns);
  let spotlight: HomeSpotlight | null = null;
  if (last) {
    const crown = crownBySeries.get(last.seriesId)!;
    const player = i.players.find((p) => p.id === last.playerId);
    spotlight = {
      kind: 'series',
      ...(last.playerId ? { playerId: last.playerId } : {}),
      name: player?.name ?? last.name ?? last.seat,
      ...(player?.icon ? { icon: player.icon } : {}),
      champion: last.champion,
      seat: last.seat,
      opponent: last.opponent,
      result: last.result,
      at: last.at,
      score: { wins: crown.finished.score.wins, losses: crown.finished.score.losses },
      terms: crown.mvp.why,
      read: crown.mvp.read,
      of: crown.mvp.of,
      titles: last.playerId ? (seasonTitles.get(last.playerId) ?? 0) : 0
    };
  } else {
    spotlight = gamesSpotlight(seasonGames, i.players);
  }

  // The newest finished series, when nobody has been crowned for it yet because its figures are thin or missing.
  const newest = finished[finished.length - 1];
  const newestCrown = newest ? crownBySeries.get(newest.series.id) : undefined;
  const waiting = newest && newest.series.id !== last?.seriesId && (!newestCrown || newestCrown.why === 'thin');
  const entries = mvpRace(seasonCrowns, i.players);

  const tournamentIds = tournamentMatchIds(i.tournaments, i.series, i.seriesGames);
  const inputs = patternInputs(i.analysis, i.patternFilters ?? DEFAULT_PATTERN_FILTERS, { practice: i.practice, tournamentIds, roster: i.players });
  const wins = inputs.games.filter((g) => g.win).length;

  const longest = streaks(serious).longestWin;
  const titlesByName = new Map<string, number>();
  for (const [id, n] of titlesById(crowns)) {
    const name = i.players.find((p) => p.id === id)?.name;
    if (name) titlesByName.set(name, n);
  }

  const bannerChampion = i.banner?.champion?.trim();
  return {
    teamName: i.teamName,
    motto: i.motto?.trim() ?? '',
    banner: bannerChampion ? { champion: bannerChampion, ...(i.banner?.skin && i.banner.skin > 0 ? { skin: Math.floor(i.banner.skin) } : {}) } : null,
    season,
    slides,
    record: {
      counters,
      segments: donutSegments([
        { key: 'wins', value: counters.wins },
        { key: 'losses', value: counters.losses }
      ]),
      current: streaks(seasonGames).current
    },
    next,
    welcome,
    spotlight,
    race: {
      entries,
      podium: podium(entries),
      last,
      ...(waiting ? { waitingOn: newest.series.opponent } : {}),
      finished: seasonFinished.length
    },
    trend: winRateTrend(seasonGames, seasonFinished),
    compMonth: compOfTheMonth(serious, i.comps, i.now),
    records: recordsToBeat(seasonGames),
    advice: {
      workOn: adviceLines(workOn(inputs.games, 'player', inputs.roster, inputs.source)),
      keepDoing: adviceLines(keepDoing(inputs.games, 'player', inputs.roster, inputs.source)),
      wins,
      losses: inputs.games.length - wins,
      needs: MIN_FOR_A_CLAIM
    },
    lineup: lineupOf(starters, seasonLines, allLines, seasonTitles),
    objectives: objectiveControl(seasonGames),
    trophies: achievementsOf({
      rows: serious,
      analysis: i.analysis.filter((g) => !i.practice.has(g.matchId)),
      finished,
      titlesByName,
      longestWinStreak: longest?.length ?? 0,
      window: { from: season.from, to: season.to, mode: season.mode }
    }),
    handTrophies: handTrophiesOf(i, season)
  };
}
