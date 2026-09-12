import { Player, Tournament } from '../models/team.models';
import { GameRow, PlayerLine, record } from '../pages/games/game-rows';
import { parseLocalDate } from './local-date';
import { FinishedSeries } from './series-results';

/**
 * How the team's season is going, read for the home page (13 Sep 2026).
 *
 * The home page answers "how are we doing" before anyone opens a page of detail: the record over the
 * season, the form, the share of the map we take, the records to beat and each of our five in a line.
 * Every figure is read off the same `GameRow`s the Games page lists (`buildGameRows`), so the two
 * pages can never count one game two ways.
 *
 * A season is the tournament we are in when there is one, and the last ninety days when there is not.
 * Games tagged practice stay out of it, as they stay out of Patterns. A figure no source carries is
 * missing, never a zero. And the other team is a team name and five champions: nothing here reads a
 * player of theirs, and every record is ours.
 */

export type SeasonMode = 'season' | 'all';

export interface SeasonWindow {
  mode: SeasonMode;
  /** Epoch ms, inclusive; 0 for all time. */
  from: number;
  /** Epoch ms, inclusive. */
  to: number;
  /** The tournament's name, "Last 90 days" or "All time". */
  label: string;
  /** The tournament the season is, when it is one: its undated games still count toward it. */
  tournamentId?: string;
}

/** How far back a season reaches when no tournament is running. */
export const ROLLING_SEASON_DAYS = 90;

const DAY_MS = 86_400_000;

/** The last millisecond of the local day a stored date falls on, or null when it does not parse. */
function endOfDay(value?: string | null): number | null {
  const at = parseLocalDate(value);
  if (at === null) return null;
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
}

/**
 * Both dates parse and hold `now` between them, the end day counted whole. A tournament with an open
 * end does not "contain" a day on its dates alone: that is what the active flag is for.
 */
function runsAt(t: Tournament, now: number): boolean {
  const start = parseLocalDate(t.startDate);
  const end = endOfDay(t.endDate);
  return start !== null && end !== null && start <= now && now <= end;
}

/**
 * The real tournament we are in: one marked active if any is, else one whose dates hold today; the
 * latest start among several, and the first listed when two start together. Never the scrims group.
 */
function currentTournament(tournaments: readonly Tournament[], now: number): Tournament | null {
  const real = tournaments.filter((t) => t.kind !== 'scrims');
  const flagged = real.filter((t) => t.active === true);
  const pool = flagged.length ? flagged : real.filter((t) => runsAt(t, now));
  let best: Tournament | null = null;
  let bestStart = Number.NEGATIVE_INFINITY;
  for (const t of pool) {
    const start = parseLocalDate(t.startDate) ?? Number.NEGATIVE_INFINITY;
    if (!best || start > bestStart) {
      best = t;
      bestStart = start;
    }
  }
  return best;
}

/**
 * The stretch of time the home page reads (13 Sep 2026): the running tournament from its first day
 * to its last, or to today while it is still on; the last ninety days when none is running; or
 * everything. A tournament over but still marked active ends on its end day, so a quiet week after
 * the final does not dilute the season with the games played since.
 */
export function seasonWindow(tournaments: readonly Tournament[], now: number, mode: SeasonMode): SeasonWindow {
  if (mode === 'all') return { mode, from: 0, to: now, label: 'All time' };
  const rolling = now - ROLLING_SEASON_DAYS * DAY_MS;
  const t = currentTournament(tournaments, now);
  if (!t) return { mode, from: rolling, to: now, label: `Last ${ROLLING_SEASON_DAYS} days` };
  const end = endOfDay(t.endDate);
  return {
    mode,
    from: parseLocalDate(t.startDate) ?? rolling,
    to: end !== null && end < now ? end : now,
    label: t.name,
    tournamentId: t.id
  };
}

/**
 * The games a season holds, in the order they came in. Practice-tagged games never count. A game
 * typed in from the draft room for a series with no agreed date has no date at all, and it still
 * belongs to its tournament's season — but to no other window, since nobody can say when it was.
 */
export function seasonRows(
  rows: readonly GameRow[],
  w: SeasonWindow,
  o: { practice: ReadonlySet<string>; seriesTournament: ReadonlyMap<string, string> }
): GameRow[] {
  return rows.filter((r) => {
    if (r.matchId && o.practice.has(r.matchId)) return false;
    if (w.mode === 'all') return true;
    if (r.date > 0) return r.date >= w.from && r.date <= w.to;
    return !!w.tournamentId && !!r.seriesId && o.seriesTournament.get(r.seriesId) === w.tournamentId;
  });
}

export interface HeadlineCounters {
  games: number;
  wins: number;
  losses: number;
  /** Rounded percent; 0 with no games, as `record` has always given it, so read it alongside `games`. */
  winRate: number;
  seriesWon: number;
  seriesPlayed: number;
}

/** The counters across the top of the page: games and series, counted the way the Games page and Prep count them. */
export function headline(rows: readonly GameRow[], finished: readonly FinishedSeries[]): HeadlineCounters {
  return { ...record(rows), seriesWon: finished.filter((f) => f.result === 'won').length, seriesPlayed: finished.length };
}

export interface Streak {
  length: number;
  /** The date of the run's first game, epoch ms. */
  from: number;
  /** The date of the run's last game, epoch ms. */
  to: number;
}

/** Dated games oldest first. A stable sort of a copy: whatever order the list arrived in, ties keep it. */
function chronological(rows: readonly GameRow[]): GameRow[] {
  return rows.filter((r) => r.date > 0).sort((a, b) => a.date - b.date);
}

/**
 * The run we are on and the longest run of wins. Only dated games can be put in order, so an undated
 * one sits in neither. The longest run, when two are as long, is the more recent: it is the one the
 * team remembers and the one worth chasing.
 */
export function streaks(rows: readonly GameRow[]): { current: { result: 'win' | 'loss'; length: number } | null; longestWin: Streak | null } {
  const games = chronological(rows);
  let current: { result: 'win' | 'loss'; length: number } | null = null;
  if (games.length) {
    const last = games[games.length - 1].win;
    let length = 0;
    for (let i = games.length - 1; i >= 0 && games[i].win === last; i--) length += 1;
    current = { result: last ? 'win' : 'loss', length };
  }
  let longestWin: Streak | null = null;
  let start = -1;
  for (let i = 0; i < games.length; i++) {
    if (!games[i].win) {
      start = -1;
      continue;
    }
    if (start < 0) start = i;
    const length = i - start + 1;
    // At least as long takes it, so a tie goes to the later run.
    if (!longestWin || length >= longestWin.length) longestWin = { length, from: games[start].date, to: games[i].date };
  }
  return { current, longestWin };
}

/** How many games the rolling win rate on the form chart reads back over. */
export const TREND_WINDOW = 10;

export interface TrendPoint {
  /** Position in the dated games, oldest first. */
  i: number;
  date: number;
  win: boolean;
  /** Rounded win percent over this game and the ones before it, at most the window. */
  rate: number;
  rowId: string;
}

export interface TrendMarker {
  /** The point the series' last game sits on. */
  i: number;
  opponent: string;
  result: 'won' | 'lost' | 'drawn';
}

/**
 * The form chart: a rolling win rate over the dated games, with a flag where each finished series
 * ended. The first few points read over fewer games than the window, as they must. Undated games are
 * counted rather than placed, so the chart can say how many it left out instead of guessing a spot.
 */
export function winRateTrend(
  rows: readonly GameRow[],
  finished: readonly FinishedSeries[],
  window = TREND_WINDOW
): { points: TrendPoint[]; markers: TrendMarker[]; undated: number } {
  const games = chronological(rows);
  const span = Number.isFinite(window) ? Math.max(1, Math.floor(window)) : TREND_WINDOW;
  let wins = 0;
  const points: TrendPoint[] = games.map((g, i) => {
    if (g.win) wins += 1;
    if (i >= span && games[i - span].win) wins -= 1;
    const n = Math.min(span, i + 1);
    return { i, date: g.date, win: g.win, rate: Math.round((wins / n) * 100), rowId: g.id };
  });
  const markers: TrendMarker[] = [];
  for (const f of finished) {
    let at = -1;
    for (let i = games.length - 1; i >= 0; i--) {
      if (games[i].seriesId === f.series.id) {
        at = i;
        break;
      }
    }
    if (at >= 0) markers.push({ i: at, opponent: f.series.opponent, result: f.result });
  }
  return { points, markers, undated: rows.length - games.length };
}

export interface ObjectiveShare {
  key: 'dragons' | 'barons' | 'heralds' | 'grubs' | 'towers' | 'inhibitors';
  ours: number;
  theirs: number;
  /** Our share of what both sides took, 0-1; null when neither side took one. */
  share: number | null;
  /** Games that carried this count on both sides. */
  games: number;
}

const OBJECTIVE_KEYS: readonly ObjectiveShare['key'][] = ['dragons', 'barons', 'heralds', 'grubs', 'towers', 'inhibitors'];

/**
 * How much of the map we take. The counts are totals over every game that carries them, so a replay
 * adds its dragons like a Riot game does, and a game whose stored counts lack one key is left out of
 * that key alone. The firsts are Riot's only: a replay file always stores first blood and first tower
 * as false, and counting those would read as a team that never draws first blood in a scrim.
 */
export function objectiveControl(rows: readonly GameRow[]): {
  shares: ObjectiveShare[];
  firstBlood: { hit: number; of: number };
  firstTower: { hit: number; of: number };
} {
  const carried = rows.flatMap((r) => (r.objectives ? [{ source: r.source, objectives: r.objectives }] : []));
  const shares = OBJECTIVE_KEYS.map((key): ObjectiveShare => {
    let ours = 0;
    let theirs = 0;
    let games = 0;
    for (const { objectives } of carried) {
      const a = objectives.ours[key];
      const b = objectives.theirs[key];
      if (typeof a !== 'number' || typeof b !== 'number') continue;
      ours += a;
      theirs += b;
      games += 1;
    }
    return { key, ours, theirs, share: ours + theirs > 0 ? ours / (ours + theirs) : null, games };
  });
  const riot = carried.filter((c) => c.source === 'riot');
  return {
    shares,
    firstBlood: { hit: riot.filter((c) => c.objectives.ours.firstBlood === true).length, of: riot.length },
    firstTower: { hit: riot.filter((c) => c.objectives.ours.firstTower === true).length, of: riot.length }
  };
}

export interface GameRecord {
  /** Kills, seconds or vision score, by the record. */
  value: number;
  rowId: string;
  date: number;
  label: string;
  opponent?: string;
  /** Our roster member who set it; absent on a team record. */
  player?: string;
  champion?: string;
}

/** Ten minutes: anything shorter is a remake or a surrender vote, never a record. */
export const MIN_GAME_SEC = 600;

/** For a tie: the earlier date set the record first, and an unknown date cannot claim to have. */
const firstSet = (date: number) => (date > 0 ? date : Number.POSITIVE_INFINITY);

function beats(value: number, date: number, best: GameRecord | null, higher: boolean): boolean {
  if (!best) return true;
  if (value !== best.value) return higher ? value > best.value : value < best.value;
  return firstSet(date) < firstSet(best.date);
}

/**
 * The records to beat, all ours (13 Sep 2026): the most kills and the most vision one of the roster
 * put up in a game, the fastest win, and the longest run of wins. A seat nobody on the roster held
 * does not set a record, a figure a game did not carry is not a zero that loses one, and a tie stays
 * with whoever set it first. The other side's seats are never read.
 */
export function recordsToBeat(rows: readonly GameRow[]): {
  mostKills: GameRecord | null;
  fastestWin: GameRecord | null;
  longestWinStreak: Streak | null;
  mostVision: GameRecord | null;
} {
  let mostKills: GameRecord | null = null;
  let mostVision: GameRecord | null = null;
  let fastestWin: GameRecord | null = null;
  for (const r of rows) {
    const game = { rowId: r.id, date: r.date, label: r.label, ...(r.opponent ? { opponent: r.opponent } : {}) };
    for (const p of r.ours) {
      if (!p.player || !p.stats) continue;
      const who = { player: p.player, ...(p.champion ? { champion: p.champion } : {}) };
      if (typeof p.stats.kills === 'number' && beats(p.stats.kills, r.date, mostKills, true)) {
        mostKills = { value: p.stats.kills, ...game, ...who };
      }
      const vision = p.stats.vision;
      if (typeof vision === 'number' && beats(vision, r.date, mostVision, true)) {
        mostVision = { value: vision, ...game, ...who };
      }
    }
    const length = r.durationSec;
    if (r.win && typeof length === 'number' && length >= MIN_GAME_SEC && beats(length, r.date, fastestWin, false)) {
      fastestWin = { value: length, ...game };
    }
  }
  return { mostKills, fastestWin, longestWinStreak: streaks(rows).longestWin, mostVision };
}

/**
 * The champion a roster card puts behind a player: what they played most for the team in the games
 * read, else what Riot says they play most in flex, then in solo queue, else the pool the team wrote
 * down for them. Nothing when none of those knows.
 */
export function mainChampionOf(p: Player, lines: readonly PlayerLine[]): string | null {
  const name = (p.name ?? '').trim().toLowerCase();
  const line = name ? lines.find((l) => l.name.trim().toLowerCase() === name) : undefined;
  // `champions` is most often first.
  return (
    line?.champions.find((c) => c.champion)?.champion ||
    p.queueStats?.flex?.matches?.top3?.[0] ||
    p.queueStats?.solo?.matches?.top3?.[0] ||
    p.top3?.[0] ||
    null
  );
}

const APEX_TIERS = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

/**
 * The one rank a roster card prints, with the queue it is from: solo first, as it is the ladder a
 * player is measured on, else flex. Riot's "GOLD" and "II" read as "Gold II"; the three apex tiers
 * have no division, so they read as the tier alone.
 */
export function rankLabelOf(p: Player): { label: string; queue: 'Solo' | 'Flex' } | null {
  const solo = p.queueStats?.solo?.rank;
  const flex = p.queueStats?.flex?.rank;
  const pick = solo?.tier ? { rank: solo, queue: 'Solo' as const } : flex?.tier ? { rank: flex, queue: 'Flex' as const } : null;
  if (!pick) return null;
  const tier = pick.rank.tier.trim().toUpperCase();
  const title = tier.charAt(0) + tier.slice(1).toLowerCase();
  const division = APEX_TIERS.has(tier) ? '' : (pick.rank.rank ?? '').trim();
  return { label: division ? `${title} ${division}` : title, queue: pick.queue };
}
