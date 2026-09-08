/**
 * Every game we played, from three places, as one kind of row.
 *
 * Riot gives us flex and Clash through the comp analysis; scrims arrive as
 * replay files; tournament games are typed in from the draft room and Riot
 * cannot see them at all. Each source knows different things — a scrim has
 * every stat, a tournament game only the ten champions and the result — and
 * the row says which, rather than showing a zero where a number is unknown.
 *
 * Pure: the page hands in the data and its filters and reads back rows,
 * records and player lines. Built 8 Sep 2026 to replace the comp-first
 * Analysis page, which answered "how did this comp do" — the Comps page
 * already does — and never "how are we doing".
 */
import { AnalysisGame, Player, Scrim, ScrimPlayer, SeriesGame, TeamObjectives, TournamentSeries } from '../../models/team.models';

export type GameSource = 'tournament' | 'scrim' | 'riot';

export interface RowStats {
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damage: number;
  damageTaken?: number;
  gold?: number;
  vision?: number;
  killParticipation?: number;
}

export interface RowPlayer {
  /** Seat in lane order; empty when the source did not say. */
  role: string;
  champion: string;
  /** Our roster member's name; null for the other side or an unknown teammate. */
  player: string | null;
  stats?: RowStats;
}

export type Objectives = TeamObjectives;

export interface GameRow {
  id: string;
  source: GameSource;
  /** "Flex", "Clash", "Scrim", "Bo3 game 2" — the small tag on the row. */
  label: string;
  /** Epoch ms. */
  date: number;
  win: boolean;
  side?: 'blue' | 'red';
  durationSec?: number;
  opponent?: string;
  ours: RowPlayer[];
  theirs: RowPlayer[];
  kills?: { ours: number; theirs: number };
  objectives?: { ours: Objectives; theirs: Objectives };
  /** Comp the game counts under, after overrides; absent when off the books. */
  compId?: string;
  compName?: string;
  /** Riot match id, for the note and the comp override — Riot rows only. */
  matchId?: string;
  /** How many of the roster were on our side; Riot rows only. */
  rosterCount?: number;
  /** Where to read the game in full. */
  link?: { path: string; query?: Record<string, string> };
}

const SEATS = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
const POSITION_ROLE: Record<string, string> = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };
const seatIndex = (role: string) => {
  const i = SEATS.indexOf(role);
  return i < 0 ? SEATS.length : i;
};
const bySeat = (a: RowPlayer, b: RowPlayer) => seatIndex(a.role) - seatIndex(b.role);

export function rosterIds(players: readonly Player[]): Set<string> {
  const ids = new Set<string>();
  for (const p of players) {
    const tag = p.profile?.riotTag?.replace(/^#/, '') ?? '';
    if (p.name) ids.add(`${p.name}#${tag}`.toLowerCase());
  }
  return ids;
}

// ---- Riot: the comp analysis --------------------------------------------

export function fromAnalysis(g: AnalysisGame, comp: { id: string; name: string } | null): GameRow {
  const ours: RowPlayer[] = g.players
    .map((p) => ({
      role: POSITION_ROLE[p.position] ?? p.position,
      champion: p.champion,
      player: p.name,
      stats: {
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        cs: p.cs,
        damage: p.damage,
        ...(p.damageTaken !== undefined ? { damageTaken: p.damageTaken } : {}),
        ...(p.killParticipation !== undefined ? { killParticipation: p.killParticipation } : {}),
        ...(p.visionScore !== undefined ? { vision: p.visionScore } : {})
      }
    }))
    .sort(bySeat);
  const theirs: RowPlayer[] = (
    g.enemies?.map((e) => ({ role: POSITION_ROLE[e.position] ?? e.position, champion: e.champion, player: null })) ??
    (g.enemyChampions ?? []).map((c) => ({ role: '', champion: c, player: null }))
  ).sort(bySeat);
  const row: GameRow = {
    id: `riot-${g.matchId}`,
    // A custom game Riot did hand us (queue 0, tagged Scrim by the backend) is a
    // scrim wherever it came from; the tiles and the source filter treat it so.
    source: g.queue === 'Scrim' ? 'scrim' : 'riot',
    label: g.queue || 'Riot',
    date: g.date,
    win: g.win,
    ...(g.side ? { side: g.side } : {}),
    ...(g.durationSec ? { durationSec: g.durationSec } : {}),
    ours,
    theirs,
    ...(g.kills ? { kills: { ours: g.kills.ours, theirs: g.kills.theirs } } : {}),
    ...(g.objectives ? { objectives: { ours: g.objectives.ours, theirs: g.objectives.theirs } } : {}),
    ...(comp ? { compId: comp.id, compName: comp.name } : {}),
    matchId: g.matchId,
    ...(g.rosterCount !== undefined ? { rosterCount: g.rosterCount } : {})
  };
  return row;
}

// ---- Scrims: replay files -------------------------------------------------

export function scrimSide(scrim: Scrim, ours: Set<string>): 'blue' | 'red' | null {
  if (scrim.ourSide) return scrim.ourSide;
  const mine = (team: number) =>
    scrim.players.filter((p) => p.team === team && ours.has(`${p.name}#${p.tag}`.toLowerCase())).length;
  const blue = mine(100);
  const red = mine(200);
  if (blue === red) return null;
  return blue > red ? 'blue' : 'red';
}

function scrimPlayer(p: ScrimPlayer, ours: Set<string>, mine: boolean): RowPlayer {
  const isRoster = mine && ours.has(`${p.name}#${p.tag}`.toLowerCase());
  return {
    role: POSITION_ROLE[p.position] ?? p.position,
    champion: p.champion,
    player: isRoster ? p.name : null,
    stats: {
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      cs: p.cs,
      damage: p.damage,
      damageTaken: p.damageTaken,
      gold: p.gold,
      vision: p.visionScore
    }
  };
}

/** A scrim whose side nobody has said, and the roster cannot tell, is left out: its result is unknown. */
export function fromScrim(scrim: Scrim, ours: Set<string>): GameRow | null {
  const side = scrimSide(scrim, ours);
  if (!side) return null;
  const team = side === 'blue' ? 100 : 200;
  const win = side === 'blue' ? scrim.blueWon : !scrim.blueWon;
  const ourPlayers = scrim.players.filter((p) => p.team === team).map((p) => scrimPlayer(p, ours, true)).sort(bySeat);
  const theirPlayers = scrim.players.filter((p) => p.team !== team).map((p) => scrimPlayer(p, ours, false)).sort(bySeat);
  const sum = (list: RowPlayer[]) => list.reduce((n, p) => n + (p.stats?.kills ?? 0), 0);
  const obj = scrim.objectives;
  return {
    id: `scrim-${scrim.id}`,
    source: 'scrim',
    label: scrim.surrendered ? 'Scrim · ff' : 'Scrim',
    date: Date.parse(scrim.playedOn) || 0,
    win,
    side,
    durationSec: scrim.durationSec,
    ...(scrim.opponent ? { opponent: scrim.opponent } : {}),
    ours: ourPlayers,
    theirs: theirPlayers,
    kills: { ours: sum(ourPlayers), theirs: sum(theirPlayers) },
    ...(obj ? { objectives: { ours: side === 'blue' ? obj.blue : obj.red, theirs: side === 'blue' ? obj.red : obj.blue } } : {}),
    link: { path: '/scrims' }
  };
}

// ---- Tournament games: typed in, no numbers ------------------------------

/**
 * A tournament game. With a replay imported against it (`matchId` naming a
 * stored scrim) the row carries that replay's numbers; without one it is the
 * ten champions and the result, and our seats are named from the roster so
 * the player table still counts the game.
 */
export function fromSeriesGame(
  game: SeriesGame,
  series: TournamentSeries | undefined,
  seatNames: Readonly<Record<string, string>> = {},
  replay?: Scrim,
  ours: Set<string> = new Set()
): GameRow | null {
  if (game.win === undefined) return null;
  const when = series?.scheduledAt ? Date.parse(series.scheduledAt) : NaN;
  const base = {
    id: `series-${game.id}`,
    source: 'tournament' as const,
    label: `Bo${series?.bestOf ?? 3} game ${game.gameNumber}`,
    ...(series?.opponent ? { opponent: series.opponent } : {}),
    link: { path: '/tournaments', query: { view: 'draft', series: game.seriesId, game: game.id } }
  };
  const played = replay ? fromScrim(replay, ours) : null;
  if (played) {
    return {
      ...played,
      ...base,
      // The series decides the result and the side; the replay only agrees.
      win: game.win,
      ...(game.ourSide ? { side: game.ourSide } : {}),
      date: played.date || (Number.isNaN(when) ? 0 : when),
      matchId: replay!.id
    };
  }
  const seats = (list: string[] | undefined, named: boolean): RowPlayer[] =>
    (list ?? [])
      .map((c, i) => ({ role: SEATS[i] ?? '', champion: c, player: named ? (seatNames[SEATS[i] ?? ''] ?? null) : null }))
      .filter((p) => p.champion);
  return {
    ...base,
    date: Number.isNaN(when) ? 0 : when,
    win: game.win,
    ...(game.ourSide ? { side: game.ourSide } : {}),
    ours: seats(game.ourChampions, true),
    theirs: seats(game.theirChampions, false)
  };
}

// ---- Filters and records ---------------------------------------------------

export interface RowFilter {
  source: GameSource | 'all';
  /** Days back from `now`; 0 means everything. */
  days: number;
  result: 'all' | 'win' | 'loss';
  opponent: string;
  /** Champion filter: a row passes when any of the ten matches. */
  champion?: (champions: string[]) => boolean;
}

export function filterRows(rows: readonly GameRow[], f: RowFilter, now = Date.now()): GameRow[] {
  const since = f.days > 0 ? now - f.days * 86_400_000 : 0;
  return rows.filter((r) => {
    if (f.source !== 'all' && r.source !== f.source) return false;
    if (since && r.date && r.date < since) return false;
    if (f.result === 'win' && !r.win) return false;
    if (f.result === 'loss' && r.win) return false;
    if (f.opponent && (r.opponent ?? '').toLowerCase() !== f.opponent.toLowerCase()) return false;
    if (f.champion && !f.champion([...r.ours, ...r.theirs].map((p) => p.champion))) return false;
    return true;
  });
}

export interface WinRecord {
  games: number;
  wins: number;
  losses: number;
  winRate: number;
}

export function record(rows: readonly GameRow[]): WinRecord {
  const wins = rows.filter((r) => r.win).length;
  return { games: rows.length, wins, losses: rows.length - wins, winRate: rows.length ? Math.round((wins / rows.length) * 100) : 0 };
}

/** Mean game length over the rows that know theirs, in seconds; 0 with none. */
export function meanLength(rows: readonly GameRow[]): number {
  const known = rows.filter((r) => r.durationSec);
  if (!known.length) return 0;
  return Math.round(known.reduce((n, r) => n + (r.durationSec ?? 0), 0) / known.length);
}

export interface PlayerLine {
  name: string;
  /** The seat they played most; rows sort Top to Support on it. */
  role: string;
  games: number;
  wins: number;
  winRate: number;
  /** Games that carried numbers; the KDA, CS and shares are over these only. */
  statGames: number;
  kills: number;
  deaths: number;
  assists: number;
  /** (kills + assists) / deaths, deaths floored at 1. */
  kda: number;
  /** CS per minute over the games that know both; absent with none. */
  csPerMin?: number;
  /** Mean share of the team's damage, 0-1; absent with none. */
  damageShare?: number;
  /** Mean kill participation, 0-1, over the games that carry it; absent with none. */
  killParticipation?: number;
  /** Mean vision score over the games that carry it; absent with none. */
  visionPerGame?: number;
  /** Champions played, most often first. */
  champions: { champion: string; games: number; wins: number }[];
}

/**
 * Each roster member over the rows. A game counts as played whenever the
 * seat is named, numbers or not — a tournament game typed in from the draft
 * room still says who played what — and every average counts only the games
 * that had the number.
 */
export function playerLines(rows: readonly GameRow[]): PlayerLine[] {
  const acc = new Map<
    string,
    PlayerLine & { csSum: number; csMin: number; shareSum: number; shareN: number; kpSum: number; kpN: number; visionSum: number; visionN: number; seats: Map<string, number>; champs: Map<string, { games: number; wins: number }> }
  >();
  for (const r of rows) {
    const teamDamage = r.ours.reduce((n, p) => n + (p.stats?.damage ?? 0), 0);
    const teamKills = r.ours.reduce((n, p) => n + (p.stats?.kills ?? 0), 0);
    for (const p of r.ours) {
      if (!p.player) continue;
      const a =
        acc.get(p.player) ??
        {
          name: p.player, role: '', games: 0, wins: 0, winRate: 0, statGames: 0, kills: 0, deaths: 0, assists: 0, kda: 0, champions: [],
          csSum: 0, csMin: 0, shareSum: 0, shareN: 0, kpSum: 0, kpN: 0, visionSum: 0, visionN: 0, seats: new Map(), champs: new Map()
        };
      a.games += 1;
      if (r.win) a.wins += 1;
      if (p.role) a.seats.set(p.role, (a.seats.get(p.role) ?? 0) + 1);
      const c = a.champs.get(p.champion) ?? { games: 0, wins: 0 };
      c.games += 1;
      if (r.win) c.wins += 1;
      a.champs.set(p.champion, c);
      acc.set(p.player, a);
      if (!p.stats) continue;
      a.statGames += 1;
      a.kills += p.stats.kills;
      a.deaths += p.stats.deaths;
      a.assists += p.stats.assists;
      if (p.stats.cs && r.durationSec) {
        a.csSum += p.stats.cs;
        a.csMin += r.durationSec / 60;
      }
      if (teamDamage > 0) {
        a.shareSum += p.stats.damage / teamDamage;
        a.shareN += 1;
      }
      // Kill participation from the row's own kills when the source did not
      // compute it — a replay never does, so tournament games showed a dash.
      const kp = p.stats.killParticipation ?? (teamKills > 0 ? Math.min(1, (p.stats.kills + p.stats.assists) / teamKills) : undefined);
      if (kp !== undefined) {
        a.kpSum += kp;
        a.kpN += 1;
      }
      if (p.stats.vision !== undefined) {
        a.visionSum += p.stats.vision;
        a.visionN += 1;
      }
    }
  }
  return [...acc.values()]
    .map(({ csSum, csMin, shareSum, shareN, kpSum, kpN, visionSum, visionN, seats, champs, ...line }) => ({
      ...line,
      role: [...seats.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '',
      winRate: Math.round((line.wins / line.games) * 100),
      kda: Math.round(((line.kills + line.assists) / Math.max(1, line.deaths)) * 10) / 10,
      ...(csMin > 0 ? { csPerMin: Math.round((csSum / csMin) * 10) / 10 } : {}),
      ...(shareN > 0 ? { damageShare: shareSum / shareN } : {}),
      ...(kpN > 0 ? { killParticipation: kpSum / kpN } : {}),
      ...(visionN > 0 ? { visionPerGame: Math.round((visionSum / visionN) * 10) / 10 } : {}),
      champions: [...champs.entries()]
        .map(([champion, c]) => ({ champion, ...c }))
        .sort((x, y) => y.games - x.games || y.wins - x.wins)
    }))
    // Top to Support, the way the team reads itself; a player with no seat last.
    .sort((x, y) => seatIndex(x.role) - seatIndex(y.role) || y.games - x.games || x.name.localeCompare(y.name));
}

export interface ChampionLine {
  champion: string;
  games: number;
  wins: number;
  winRate: number;
}

/** Their champions we met at least twice, worst for us first. */
export function toughest(rows: readonly GameRow[], min = 2, take = 6): ChampionLine[] {
  const acc = new Map<string, ChampionLine>();
  for (const r of rows) {
    for (const p of r.theirs) {
      const a = acc.get(p.champion) ?? { champion: p.champion, games: 0, wins: 0, winRate: 0 };
      a.games += 1;
      if (r.win) a.wins += 1;
      acc.set(p.champion, a);
    }
  }
  return [...acc.values()]
    .filter((c) => c.games >= min)
    .map((c) => ({ ...c, winRate: Math.round((c.wins / c.games) * 100) }))
    .sort((a, b) => a.winRate - b.winRate || b.games - a.games)
    .slice(0, take);
}

/**
 * Why a row cannot be reviewed, or null when it can. A tournament game typed
 * in from the draft room has no numbers until its replay is imported; a
 * replay-backed game can be reviewed, on the end-of-game tier.
 */
export function reviewBlockReason(row: { source: GameSource; matchId?: string }): string | null {
  if (!row.matchId) return 'Typed in from the draft room: import its replay on the Plan view first, then it can be reviewed.';
  return null;
}
