import { AnalysisGame, Player } from '../models/team.models';
import { buildGameRows, GameRow, PlayerLine, playerLines } from '../pages/games/game-rows';
import { MIN_FOR_A_CLAIM } from '../pages/review/loss-patterns.util';
import { Advice, adviceTopics, DEFAULT_PATTERN_FILTERS, keepDoing, patternInputs, tournamentMatchIds, workOn, withoutRemakes } from '../pages/review/win-loss-splits';
import { achievementsOf } from './achievements';
import { compOfTheMonth } from './comp-month';
import { mvpGameFromRow, mvpOf } from './game-mvp';
import { donutSegments } from './home-charts';
import { HomeAdviceLine, HomeHandTrophy, HomeInput, HomeLineupCard, HomeModel, HomeNextSeries, HomeRecords, HomeSlide, HomeSpotlight, HomeWelcome } from './home-model';
import { parseLocalDate } from './local-date';
import { sandboxMatchIds } from './sandbox-series';
import { welcomeFor } from './home-welcome';
import { lastCrown, mvpRace, titlesById } from './mvp-race';
import { nextOpenSeries, seriesCrowns } from './series-results';
import {
  finishedInSeason,
  headline,
  mainChampionOf,
  objectiveControl,
  rankLabelOf,
  rankedRecordOf,
  recordsToBeat,
  sameName,
  SeasonWindow,
  seasonRows,
  seasonWindow,
  seatOrder,
  streaks,
  winRateTrend
} from './team-season';

/** How many lines of Work on and Keep doing the home page prints; the rest are on Patterns. */
export const HOME_ADVICE_LINES = 2;

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

/**
 * The biggest multikill of the season and how many pentakills, over the Riot games whose cache entry
 * carries multikills (13 Sep 2026). A game read before cache v6 has none recorded, which is not the same
 * as none taken, so the coverage travels with the record.
 */
function multikillsOf(games: readonly AnalysisGame[]): Pick<HomeRecords, 'biggestMultikill' | 'multikillCoverage'> {
  const riot = games.filter((g) => g.queue !== 'Scrim');
  const read = riot.filter((g) => g.players.some((p) => p.facts?.largestMultiKill !== undefined));
  let best: HomeRecords['biggestMultikill'] = null;
  let pentas = 0;
  for (const g of read) {
    for (const p of g.players) {
      pentas += p.facts?.pentaKills ?? 0;
      const value = p.facts?.largestMultiKill ?? 0;
      // A tie stays with whoever set it first, as every other record does.
      if (value >= 2 && (!best || value > best.value || (value === best.value && g.date > 0 && g.date < best.date))) {
        best = { value, player: p.name, champion: p.champion, date: g.date, pentas: 0, matchId: g.matchId };
      }
    }
  }
  return { biggestMultikill: best ? { ...best, pentas } : null, multikillCoverage: { read: read.length, of: riot.length } };
}

function lineupOf(starters: readonly Player[], allLines: readonly PlayerLine[], titles: ReadonlyMap<string, number>): HomeLineupCard[] {
  const most = Math.max(0, ...titles.values());
  return starters.map((p) => ({
    playerId: p.id,
    name: p.name,
    role: p.role,
    ...(p.icon ? { icon: p.icon } : {}),
    champion: mainChampionOf(p, allLines),
    rank: rankLabelOf(p),
    ranked: rankedRecordOf(p),
    crowned: most > 0 && titles.get(p.id) === most
  }));
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
 * nowhere, as on Patterns, and a sandbox series (17 Sep 2026) is nowhere at all: not the next series, not
 * finished, not crowned, and none of its games in a count.
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
  const seasonMatchIds = new Set(seasonGames.flatMap((r) => (r.matchId ? [r.matchId] : [])));

  const { finished, crowns, crownBySeries } = seriesCrowns({
    tournaments: i.tournaments,
    series: i.series,
    seriesGames: i.seriesGames,
    analysis: i.analysis,
    scrims: i.scrims,
    players: i.players
  });
  const seasonFinished = finished.filter((f) => finishedInSeason(f, season));
  const seasonCrowns = crowns.filter((c) => finishedInSeason(c.finished, season));
  const seasonTitles = titlesById(seasonCrowns);

  const starters = i.players.filter((p) => !p.sub).sort((a, b) => seatOrder(a) - seatOrder(b));
  const allLines = playerLines(serious);

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
    titlesByPlayerId: seasonTitles,
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
    ...(greeting.solo ? { solo: greeting.solo } : {})
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
  // The analysis folds in every stored replay, a rehearsal's included: those are left out of the advice and the
  // trophies the way the rows already leave them out (17 Sep 2026), and no filter brings them back.
  const sandbox = sandboxMatchIds(i.series, i.seriesGames);
  const teamAnalysis = withoutRemakes(i.analysis).filter((g) => !sandbox.has(g.matchId));
  const inputs = patternInputs(teamAnalysis, i.patternFilters ?? DEFAULT_PATTERN_FILTERS, { practice: i.practice, tournamentIds, roster: i.players });
  const wins = inputs.games.filter((g) => g.win).length;
  // Keep doing leaves out every subject Work on holds, over Work on's whole list and not the lines Home
  // prints of it, so the two columns here agree with the Patterns tab's (14 Sep 2026).
  const workOnList = workOn(inputs.games, 'player', inputs.roster, inputs.source);
  const keepDoingList = keepDoing(inputs.games, 'player', inputs.roster, inputs.source, adviceTopics(workOnList));

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
      last,
      ...(waiting ? { waitingOn: newest.series.opponent } : {}),
      finished: seasonFinished.length
    },
    trend: winRateTrend(seasonGames, seasonFinished),
    compMonth: compOfTheMonth(serious, i.comps, i.now),
    records: { ...recordsToBeat(seasonGames), ...multikillsOf(i.analysis.filter((g) => seasonMatchIds.has(g.matchId))) },
    advice: {
      workOn: adviceLines(workOnList),
      keepDoing: adviceLines(keepDoingList),
      wins,
      losses: inputs.games.length - wins,
      needs: MIN_FOR_A_CLAIM
    },
    lineup: lineupOf(starters, allLines, seasonTitles),
    objectives: objectiveControl(seasonGames),
    trophies: achievementsOf({
      rows: serious,
      analysis: teamAnalysis.filter((g) => !i.practice.has(g.matchId)),
      finished,
      titlesByName,
      longestWinStreak: longest?.length ?? 0,
      window: { from: season.from, to: season.to, mode: season.mode }
    }),
    handTrophies: handTrophiesOf(i, season)
  };
}
