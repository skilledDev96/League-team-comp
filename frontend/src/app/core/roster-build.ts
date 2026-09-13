import { ChampionRecord, FillIn, LearnPriority, Player, Role, ROLES } from '../models/team.models';
import { buildGameRows, GameRow, PlayerLine, playerLines } from '../pages/games/game-rows';
import { sameChampion } from './champion-key';
import { mvpRace } from './mvp-race';
import { rateBand } from './opponent-view';
import { RosterCard, RosterGroup, RosterInput, RosterModel, RosterPoolEntry } from './roster-model';
import { seriesCrowns } from './series-results';
import { finishedInSeason, formOf, lastPlayedOf, mainChampionOf, rankLabelOf, rankedRecordOf, sameName, SeasonMode, seasonRows, seasonWindow, seatOrder } from './team-season';

/** How many of the newest results a card's form strip shows. */
export const ROSTER_FORM_GAMES = 5;
/** The Roster reads every game, as Home opens on All time; `buildRoster` still takes a mode. */
export const ROSTER_SCOPE: SeasonMode = 'all';

const PRIORITY_ORDER: Record<LearnPriority, number> = { high: 0, med: 1, low: 2 };

const bandOf = (games: number, wins: number) => (games > 0 ? rateBand({ games, wins } as ChampionRecord) : '');

/** A fill-in drawn as a player, so the poster and the sheet read one shape (moved from the Cards view). */
export function fillInAsPlayer(f: FillIn): Player {
  const [first, ...rest] = f.preferredRoles.filter((r): r is Role => (ROLES as readonly string[]).includes(r));
  return {
    id: `fill-${f.id}`,
    name: f.summoner,
    role: first ?? 'Top',
    ...(rest.length ? { secondaryRoles: rest } : {}),
    ...(f.icon ? { icon: f.icon } : {}),
    ...(f.riot?.playstyle ? { playstyle: f.riot.playstyle } : {}),
    strengths: f.riot?.strengths ?? [],
    weaknesses: f.riot?.weaknesses ?? [],
    top3: f.riot?.top3 ?? [],
    bans: [],
    ...(f.riot?.queueStats ? { queueStats: f.riot.queueStats } : {}),
    ...(f.profile ? { profile: f.profile } : {}),
    order: f.order
  };
}

/**
 * A replay spells a name the way the client did, which can differ from the roster in case or spacing.
 * Every row's side of ours is rewritten to the roster's own spelling first, so a player's lines, form
 * and pool all count the same games.
 */
function rosterNamed(rows: readonly GameRow[], players: readonly Player[]): GameRow[] {
  return rows.map((r) => ({
    ...r,
    ours: r.ours.map((p) => {
      if (!p.player) return p;
      const player = players.find((x) => sameName(x.name, p.player));
      return player && player.name !== p.player ? { ...p, player: player.name } : p;
    })
  }));
}

/**
 * The pool as the poster reads it: every champion they played for the team, most games first with the
 * record, then whatever the roster wrote down for them that they have not played, with no record.
 * A Riot id and a display name for one champion are one entry.
 */
export function poolOf(p: Pick<Player, 'top3'>, line: PlayerLine | undefined): RosterPoolEntry[] {
  const declared = p.top3 ?? [];
  const played: RosterPoolEntry[] = (line?.champions ?? [])
    .filter((c) => c.champion)
    .map((c) => ({
      champion: c.champion,
      games: c.games,
      wins: c.wins,
      winRate: c.games ? Math.round((c.wins / c.games) * 100) : null,
      band: bandOf(c.games, c.wins),
      declared: declared.some((d) => sameChampion(d, c.champion))
    }));
  const unplayed: RosterPoolEntry[] = declared
    .filter((d) => d && !played.some((e) => sameChampion(e.champion, d)))
    .map((d) => ({ champion: d, games: 0, wins: 0, winRate: null, band: '', declared: true }));
  return [...played, ...unplayed];
}

/** Every card in the page's order: the A team, the bench, the fill-ins. */
export function rosterCards(m: RosterModel): RosterCard[] {
  return [...m.starters, ...m.bench, ...m.fillIns];
}

export function cardById(m: RosterModel, id: string): RosterCard | undefined {
  return rosterCards(m).find((c) => c.id === id);
}

export function cardByName(m: RosterModel, name: string): RosterCard | undefined {
  return rosterCards(m).find((c) => sameName(c.name, name));
}

/**
 * The Roster from the team's data (13 Sep 2026). Pure: the clock and the scope come in.
 *
 * The games are the Games page's own rows with practice left out, over the scope (all time unless told
 * otherwise). The crown is Home's: series MVP titles that count, from the series that finished inside
 * the scope, the most titles wearing it and a tie sharing it. Fill-ins never played for the team, so
 * theirs is the Riot read the admin page stored.
 */
export function buildRoster(i: RosterInput): RosterModel {
  const rows = rosterNamed(
    buildGameRows({
      analysis: [...i.analysis],
      comps: [...i.comps],
      compOverride: i.compOverride,
      players: [...i.players],
      starters: i.players.filter((p) => !p.sub),
      tournaments: [...i.tournaments],
      series: [...i.series],
      seriesGames: [...i.seriesGames],
      scrims: [...i.scrims]
    }),
    i.players
  );
  const season = seasonWindow(i.tournaments, i.now, i.mode);
  const seriesTournament = new Map(i.series.map((s) => [s.id, s.tournamentId]));
  const scoped = seasonRows(rows, season, { practice: i.practice, seriesTournament });
  const lines = playerLines(scoped);

  const { crowns } = seriesCrowns({
    tournaments: i.tournaments,
    series: i.series,
    seriesGames: i.seriesGames,
    analysis: i.analysis,
    scrims: i.scrims,
    players: i.players
  });
  const race = mvpRace(
    crowns.filter((c) => finishedInSeason(c.finished, season)),
    i.players
  );
  const mostTitles = Math.max(0, ...race.map((e) => e.titles));

  const card = (p: Player, group: RosterGroup, fill?: FillIn): RosterCard => {
    const line = fill ? undefined : lines.find((l) => sameName(l.name, p.name));
    const entry = fill ? undefined : race.find((e) => e.playerId === p.id);
    const games = line?.games ?? 0;
    const wins = line?.wins ?? 0;
    const pains = fill ? [] : i.painPoints.filter((x) => x.playerId === p.id).sort((a, b) => a.order - b.order);
    const titles = entry?.titles ?? 0;
    return {
      id: p.id,
      group,
      ...(fill ? { fillInId: fill.id, fillInStatus: fill.status } : { playerId: p.id }),
      name: p.name,
      role: p.role,
      secondaryRoles: p.secondaryRoles ?? [],
      ...(p.icon ? { icon: p.icon } : {}),
      ...(p.playstyle ? { playstyle: p.playstyle } : {}),
      ...(p.profile ? { profile: p.profile } : {}),
      champion: mainChampionOf(p, lines),
      rank: rankLabelOf(p),
      ranked: rankedRecordOf(p),
      games,
      wins,
      winRate: games ? Math.round((wins / games) * 100) : null,
      band: bandOf(games, wins),
      ...(line && line.statGames > 0
        ? {
            stats: {
              statGames: line.statGames,
              kda: line.kda,
              ...(line.csPerMin !== undefined ? { csPerMin: line.csPerMin } : {}),
              ...(line.killParticipation !== undefined ? { killParticipation: line.killParticipation } : {}),
              ...(line.visionPerGame !== undefined ? { visionPerGame: line.visionPerGame } : {})
            }
          }
        : {}),
      form: fill ? [] : formOf(scoped, p.name, ROSTER_FORM_GAMES),
      lastPlayed: fill ? null : lastPlayedOf(scoped, p.name),
      titles,
      provisional: entry?.provisional ?? 0,
      crowned: mostTitles > 0 && titles === mostTitles,
      ...(entry?.lastTitle ? { lastTitle: { opponent: entry.lastTitle.opponent, champion: entry.lastTitle.champion, at: entry.lastTitle.at } } : {}),
      pool: poolOf(p, line),
      strengths: p.strengths ?? [],
      weaknesses: p.weaknesses ?? [],
      bans: p.bans ?? [],
      working: pains.filter((x) => !x.resolved).map((x) => ({ id: x.id, text: x.text })),
      resolved: pains.filter((x) => x.resolved).length,
      learning: fill
        ? []
        : i.learnEntries
            .filter((x) => x.playerId === p.id)
            .sort((a, b) => Number(a.status === 'ready') - Number(b.status === 'ready') || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.order - b.order)
            .map((x) => ({ id: x.id, champion: x.champion, priority: x.priority, ready: x.status === 'ready' }))
    };
  };

  const bySeat = (list: readonly Player[]) => [...list].sort((a, b) => seatOrder(a) - seatOrder(b));
  return {
    season,
    games: scoped.length,
    mostTitles,
    starters: bySeat(i.players.filter((p) => !p.sub)).map((p) => card(p, 'starters')),
    bench: bySeat(i.players.filter((p) => !!p.sub)).map((p) => card(p, 'bench')),
    fillIns: [...i.fillIns].sort((a, b) => a.order - b.order).map((f) => card(fillInAsPlayer(f), 'fillIns', f))
  };
}
