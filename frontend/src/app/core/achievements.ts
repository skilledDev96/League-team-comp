import { AnalysisGame } from '../models/team.models';
import { GameRow, RowPlayer } from '../pages/games/game-rows';
import { FinishedSeries, winsToTake } from './series-results';

/**
 * The trophy cabinet on the home page (13 Sep 2026).
 *
 * Every trophy is read off what the app already holds: the game rows the Games page lists, the
 * analysis behind the Riot games, the series that are over, and the titles the MVP race counts.
 * Nothing new is stored, so a trophy can never disagree with the page that shows the same games.
 *
 * There are two kinds. An event trophy is earned by the first game or series that did the thing, and
 * says when and against whom. A count has a target and says how far along it is.
 *
 * The other team is a team name here and nothing more. No trophy opens a row's `theirs`; the one
 * figure of theirs read at all is how many towers they took, which belongs to a team, not a person.
 */

export interface AchievementDef {
  id: string;
  title: string;
  /** One line under the title saying what earns it. */
  blurb: string;
  /** A Material Symbols Rounded ligature. */
  icon: string;
  /** The target of a count; absent on a trophy that one game or one series earns. */
  need?: number;
}

/** Shorter than ten minutes is a remake, not a game anybody won (13 Sep 2026). */
const REMAKE_UNDER_SEC = 600;
/** Under twenty-five minutes is a quick close. */
const QUICK_UNDER_SEC = 25 * 60;
/** Four dragons is a soul. */
const SOUL_DRAGONS = 4;
/** Two Barons in one game. */
const DOUBLE_BARONS = 2;
/** Every seat filled from the roster. */
const FULL_STACK = 5;

/**
 * Every trophy, in the order the cabinet draws them: series first, then single games, then the
 * streaks, then the long counts. The ids are fixed, so anything that names a trophy keeps naming
 * the same one.
 */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'series-won', title: 'Series won', blurb: 'Won a tournament series.', icon: 'trophy' },
  { id: 'clean-sweep', title: 'Clean sweep', blurb: 'Won a best-of-three or longer without dropping a game.', icon: 'workspace_premium' },
  { id: 'comeback', title: 'Comeback', blurb: 'Won a game the analysis read as won from behind.', icon: 'trending_up' },
  { id: 'under-25', title: 'Quick close', blurb: 'Won a game in under 25 minutes.', icon: 'timer' },
  { id: 'streak-3', title: 'On a roll', blurb: 'Won three games in a row.', icon: 'bolt', need: 3 },
  { id: 'streak-5', title: 'Heating up', blurb: 'Won five games in a row.', icon: 'local_fire_department', need: 5 },
  { id: 'streak-8', title: 'Unstoppable', blurb: 'Won eight games in a row.', icon: 'whatshot', need: 8 },
  { id: 'soul', title: 'Dragon soul', blurb: 'Took four or more dragons in a game we won.', icon: 'auto_awesome' },
  { id: 'double-baron', title: 'Double Baron', blurb: 'Took two or more Barons in one game.', icon: 'swords' },
  { id: 'no-tower-lost', title: 'Untouched', blurb: 'Won without losing a single tower.', icon: 'shield' },
  { id: 'deathless', title: 'Deathless', blurb: 'One of ours finished a win without dying.', icon: 'favorite' },
  { id: 'quadra', title: 'Quadra kill', blurb: 'One of ours took four kills in a row.', icon: 'filter_4' },
  { id: 'penta', title: 'Pentakill', blurb: 'One of ours took all five.', icon: 'filter_5' },
  { id: 'full-stack-25', title: 'Full stack', blurb: 'Played 25 games with all five from the roster.', icon: 'groups', need: 25 },
  { id: 'century', title: 'Century', blurb: 'Played 100 games.', icon: 'sports_esports', need: 100 },
  { id: 'three-crowns', title: 'Three crowns', blurb: 'One player took three series MVP titles.', icon: 'military_tech', need: 3 }
];

/** A trophy as the cabinet draws it: the definition, whether it is earned, and what earned it. */
export interface Achievement extends AchievementDef {
  unlocked: boolean;
  /** How far along a count is. `have` may pass `need`; capping it is the drawing's business. */
  progress?: { have: number; need: number };
  /** When it was earned, in milliseconds since the epoch; absent when whatever earned it carries no date. */
  earnedAt?: number;
  /** The one of ours who earned it, on a trophy one player earns. */
  by?: string;
  /** The champion they earned it on. */
  champion?: string;
  /** The team it was earned against, when the game or series names one. */
  opponent?: string;
  /** Earned inside the window the home page is reading. Set on an earned trophy only. */
  thisSeason?: boolean;
  /**
   * The games a trophy could be read from, out of the games it would be read from: multikills only
   * reach the analysis from cache v6 (13 Sep 2026), so until the backfill is through a locked Pentakill
   * means none in the games that say, not none at all.
   */
  coverage?: { read: number; of: number };
}

/** What the cabinet is read from, all of it already held by the home page. */
export interface AchievementSources {
  /** Every game, newest first, as `buildGameRows` returns them. */
  rows: readonly GameRow[];
  /** The analysis games, for the reasons a win was won. */
  analysis: readonly AnalysisGame[];
  /** The series that are over, as `finishedSeries` returns them. */
  finished: readonly FinishedSeries[];
  /** Series MVP titles that count, by the roster name that holds them. */
  titlesByName: ReadonlyMap<string, number>;
  /** The longest run of wins, as the home page counts it. */
  longestWinStreak: number;
  /** The season being read, or everything. */
  window: { from: number; to: number; mode: 'season' | 'all' };
}

type Reading = Pick<Achievement, 'unlocked' | 'progress' | 'earnedAt' | 'by' | 'champion' | 'opponent' | 'coverage'>;

const LOCKED: Reading = { unlocked: false };

/** A usable date, or nothing: zero is how a row says it does not know when it was played. */
function dated(at: number | null | undefined): number | undefined {
  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : undefined;
}

const isRemake = (r: GameRow) => r.durationSec !== undefined && r.durationSec > 0 && r.durationSec < REMAKE_UNDER_SEC;

/**
 * The earliest of the items that carries a date, else the first of them. An item nobody dated still
 * earns the trophy; it just cannot say when.
 */
function earliest<T>(items: readonly T[], dateOf: (item: T) => number | null | undefined): T | undefined {
  let best: T | undefined;
  let bestAt = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const at = dated(dateOf(item));
    if (at !== undefined && at < bestAt) {
      best = item;
      bestAt = at;
    }
  }
  return best ?? items[0];
}

function earned(at: number | null | undefined, opponent?: string, by?: string, champion?: string): Reading {
  const when = dated(at);
  return {
    unlocked: true,
    ...(when !== undefined ? { earnedAt: when } : {}),
    ...(opponent ? { opponent } : {}),
    ...(by ? { by } : {}),
    ...(champion ? { champion } : {})
  };
}

function firstGame(rows: readonly GameRow[], test: (r: GameRow) => boolean): Reading {
  const first = earliest(rows.filter(test), (r) => r.date);
  return first ? earned(first.date, first.opponent) : LOCKED;
}

function firstSeries(finished: readonly FinishedSeries[], test: (f: FinishedSeries) => boolean): Reading {
  const first = earliest(finished.filter(test), (f) => f.endedAt);
  return first ? earned(first.endedAt, first.series.opponent) : LOCKED;
}

/** A count against its target. The date and the name only travel once the target is reached. */
function counted(have: number, need: number, at?: number, by?: string): Reading {
  const unlocked = have >= need;
  return {
    unlocked,
    progress: { have, need },
    ...(unlocked && at !== undefined ? { earnedAt: at } : {}),
    ...(unlocked && by ? { by } : {})
  };
}

/**
 * Oldest first. The rows arrive newest first, so reversing them before the stable sort turns two
 * games on the same second round with the rest; an undated game sorts to the oldest end, which is
 * where the Games page puts it too.
 */
function oldestFirst(rows: readonly GameRow[]): GameRow[] {
  return [...rows].reverse().sort((a, b) => a.date - b.date);
}

/** The date of the game that brought a count to its target, or nothing when it never got there. */
function dateOfNth(chronological: readonly GameRow[], test: (r: GameRow) => boolean, need: number): number | undefined {
  let n = 0;
  for (const r of chronological) {
    if (!test(r)) continue;
    n += 1;
    if (n === need) return dated(r.date);
  }
  return undefined;
}

/** The date of the win that first made a run of `need`, or nothing when the rows hold no such run. */
function dateOfStreak(chronological: readonly GameRow[], need: number): number | undefined {
  let run = 0;
  for (const r of chronological) {
    run = r.win ? run + 1 : 0;
    if (run === need) return dated(r.date);
  }
  return undefined;
}

/**
 * The one of ours who finished a win without dying: a named seat before an unnamed one. A seat with
 * no figures is not a seat with no deaths, so a game typed in from the draft room never qualifies.
 */
function deathlessSeat(r: GameRow): RowPlayer | undefined {
  if (!r.win || isRemake(r)) return undefined;
  const clean = r.ours.filter((p) => p.stats !== undefined && p.stats.deaths === 0);
  return clean.find((p) => p.player) ?? clean[0];
}

/** Whoever holds the most titles, ties to the name that sorts first; no name while nobody holds one. */
function titleLeader(titlesByName: ReadonlyMap<string, number>): { titles: number; name?: string } {
  let titles = 0;
  let name: string | undefined;
  for (const [who, count] of titlesByName) {
    if (count > titles || (count === titles && name !== undefined && who.localeCompare(name) < 0)) {
      titles = count;
      name = who;
    }
  }
  return { titles, ...(name !== undefined ? { name } : {}) };
}

/**
 * The cabinet: one achievement per entry of `ACHIEVEMENTS`, in that order (13 Sep 2026).
 *
 * An event trophy is dated by the earliest game or series that earned it, and names the team it was
 * earned against; a series is dated by when it ended. A count is earned by its own figure and dated
 * by the game that reached the target, walking the rows oldest first. The streaks are the one mix:
 * the streak the home page counted decides whether they are earned, and the rows only date them, so
 * a streak the rows cannot place is earned with no date rather than refused. Three crowns carries no
 * date at all, because the titles arrive as counts.
 *
 * `thisSeason` says an earned trophy was earned inside the window. Reading everything, every earned
 * trophy is; reading a season, one with no date cannot claim it.
 */
export function achievementsOf(i: AchievementSources): Achievement[] {
  const { rows, finished } = i;
  const chronological = oldestFirst(rows);
  // A comeback is found on the analysis and told through its row: the row knows the opponent.
  const rowByMatch = new Map<string, GameRow>();
  for (const r of rows) {
    if (r.matchId && !rowByMatch.get(r.matchId)?.opponent) rowByMatch.set(r.matchId, r);
  }

  const read = (def: AchievementDef): Reading => {
    const need = def.need ?? 1;
    switch (def.id) {
      case 'series-won':
        return firstSeries(finished, (f) => f.result === 'won');
      case 'clean-sweep':
        return firstSeries(finished, (f) => f.series.bestOf >= 3 && f.score.losses === 0 && f.score.wins >= winsToTake(f.series.bestOf));
      case 'comeback': {
        const dateOf = (g: AnalysisGame) => dated(g.date) ?? dated(rowByMatch.get(g.matchId)?.date);
        const first = earliest(
          i.analysis.filter((g) => g.win && (g.winFactors ?? []).some((f) => f.code === 'comeback')),
          dateOf
        );
        return first ? earned(dateOf(first), rowByMatch.get(first.matchId)?.opponent) : LOCKED;
      }
      case 'under-25':
        return firstGame(rows, (r) => r.win && r.durationSec !== undefined && r.durationSec >= REMAKE_UNDER_SEC && r.durationSec < QUICK_UNDER_SEC);
      case 'streak-3':
      case 'streak-5':
      case 'streak-8':
        return counted(i.longestWinStreak, need, dateOfStreak(chronological, need));
      case 'soul':
        return firstGame(rows, (r) => r.win && r.objectives !== undefined && r.objectives.ours.dragons >= SOUL_DRAGONS);
      case 'double-baron':
        return firstGame(rows, (r) => r.objectives !== undefined && r.objectives.ours.barons >= DOUBLE_BARONS);
      case 'no-tower-lost':
        return firstGame(rows, (r) => r.win && !isRemake(r) && r.objectives !== undefined && r.objectives.theirs.towers === 0);
      case 'deathless': {
        const first = earliest(rows.filter((r) => deathlessSeat(r) !== undefined), (r) => r.date);
        const seat = first ? deathlessSeat(first) : undefined;
        return first && seat ? earned(first.date, first.opponent, seat.player ?? undefined, seat.champion) : LOCKED;
      }
      case 'quadra':
      case 'penta': {
        const field = def.id === 'penta' ? 'pentaKills' : 'quadraKills';
        const riot = i.analysis.filter((g) => g.queue !== 'Scrim');
        const coverage = { read: riot.filter((g) => g.players.some((p) => p.facts?.largestMultiKill !== undefined)).length, of: riot.length };
        const dateOf = (g: AnalysisGame) => dated(g.date) ?? dated(rowByMatch.get(g.matchId)?.date);
        const first = earliest(
          riot.filter((g) => g.players.some((p) => (p.facts?.[field] ?? 0) > 0)),
          dateOf
        );
        const who = first?.players.find((p) => (p.facts?.[field] ?? 0) > 0);
        return first && who ? { ...earned(dateOf(first), rowByMatch.get(first.matchId)?.opponent, who.name, who.champion), coverage } : { ...LOCKED, coverage };
      }
      case 'full-stack-25': {
        const fullStack = (r: GameRow) => r.rosterCount === FULL_STACK;
        return counted(rows.filter(fullStack).length, need, dateOfNth(chronological, fullStack, need));
      }
      case 'century':
        return counted(rows.length, need, dateOfNth(chronological, () => true, need));
      case 'three-crowns': {
        const leader = titleLeader(i.titlesByName);
        return counted(leader.titles, need, undefined, leader.name);
      }
      default:
        return LOCKED;
    }
  };

  const { from, to, mode } = i.window;
  return ACHIEVEMENTS.map((def) => {
    const reading = read(def);
    const thisSeason = mode === 'all' || (reading.earnedAt !== undefined && reading.earnedAt >= from && reading.earnedAt <= to);
    return { ...def, ...reading, ...(reading.unlocked ? { thisSeason } : {}) };
  });
}
