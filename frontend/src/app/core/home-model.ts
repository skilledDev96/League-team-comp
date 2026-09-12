import { AnalysisGame, Comp, Player, Role, Scrim, SeriesGame, Tournament, TournamentSeries } from '../models/team.models';
import { PatternFilters } from '../pages/review/win-loss-splits';
import { Achievement } from './achievements';
import { CompOfTheMonth } from './comp-month';
import { DonutSegment } from './home-charts';
import { LastCrown, PodiumPlace, RaceEntry } from './mvp-race';
import { GameRecord, HeadlineCounters, ObjectiveShare, SeasonMode, SeasonWindow, Streak, TrendMarker, TrendPoint } from './team-season';

/**
 * The home page as one record (13 Sep 2026), built once by `buildHome` the way the film room is built by
 * `buildFilm`: the page computes it from the data service and every part of the page reads its slice.
 *
 * Only our side has names here. The other team is a team name on a series, a marker or a record, and
 * nothing else — no player of theirs, no Riot id, no puuid — which the spec checks by serialising a model
 * built from games that carry their names.
 */

/** Everything the build reads. The page gathers it from `TeamDataService`, the prefs and the clock. */
export interface HomeInput {
  now: number;
  /** The reader's local hour, for the greeting. */
  hour: number;
  mode: SeasonMode;
  /** The reader's seat, `UserPrefs.film.seat`. */
  seat?: Role;
  /** The reader closed "Which seat is yours?". */
  seatDismissed: boolean;
  teamName: string;
  players: readonly Player[];
  comps: readonly Comp[];
  analysis: readonly AnalysisGame[];
  tournaments: readonly Tournament[];
  series: readonly TournamentSeries[];
  seriesGames: readonly SeriesGame[];
  scrims: readonly Scrim[];
  /** Match ids tagged practice on the Games page. */
  practice: ReadonlySet<string>;
  compOverride: (matchId: string) => string;
  /** The Patterns selection the advice is read over; the tab's defaults when absent. */
  patternFilters?: PatternFilters;
}

export interface HomeSlide {
  champion: string;
  /** The starter whose main it is. */
  player: string;
  role: Role;
}

export interface HomeNextSeries {
  seriesId: string;
  opponent: string;
  tournament: string;
  bestOf: number;
  /** The kick-off to count down to; only when the schedule carries a time of day, not a bare date or free text. */
  at: number | null;
  /** The schedule as the page prints it: a formatted day (and time), or the free text as typed. */
  when?: string;
}

export interface HomeWelcome {
  greeting: string;
  needsSeat: boolean;
  player?: { id: string; name: string; role: Role; icon?: string };
  titles: number;
  /** Newest first. */
  form: ('W' | 'L')[];
  /** Their line over the season: absent when they played none of it. */
  line?: { games: number; wins: number; winRate: number; kda: number };
}

/**
 * Who the page puts in the gold frame. `series` is the newest series that crowned somebody for real;
 * `games` stands in when no series has, with whoever took the most game MVPs this season.
 */
export type HomeSpotlight =
  | {
      kind: 'series';
      playerId?: string;
      name: string;
      icon?: string;
      champion: string;
      seat: Role;
      opponent: string;
      result: 'won' | 'lost' | 'drawn';
      at: number | null;
      score: { wins: number; losses: number };
      /** One line a game, as the Series MVP chip's tip reads them. */
      terms: string[];
      read: number;
      of: number;
      /** Series MVP titles this season. */
      titles: number;
    }
  | {
      kind: 'games';
      playerId?: string;
      name: string;
      icon?: string;
      champion: string;
      seat: Role;
      /** Game MVPs this season. */
      mvps: number;
      /** Games this season with a mark at all. */
      of: number;
      terms: string[];
    };

export interface HomeRace {
  entries: RaceEntry[];
  podium: PodiumPlace[];
  /** The newest series that crowned somebody, whatever the season. */
  last: LastCrown | null;
  /** The newest finished series, when it is newer than `last` and crowned nobody yet: "vs X is waiting on replays". */
  waitingOn?: string;
  /** Finished series this season. */
  finished: number;
}

export interface HomeRecord {
  counters: HeadlineCounters;
  segments: DonutSegment[];
  current: { result: 'win' | 'loss'; length: number } | null;
}

export interface HomeTrend {
  points: TrendPoint[];
  markers: TrendMarker[];
  undated: number;
}

export interface HomeRecords {
  mostKills: GameRecord | null;
  fastestWin: GameRecord | null;
  longestWinStreak: Streak | null;
  mostVision: GameRecord | null;
}

export interface HomeAdviceLine {
  key: string;
  strong: string;
  rest: string;
  n: string;
}

export interface HomeAdvice {
  workOn: HomeAdviceLine[];
  keepDoing: HomeAdviceLine[];
  wins: number;
  losses: number;
  /** Games a side needs before a line can be claimed. */
  needs: number;
}

export interface HomeLineupCard {
  playerId: string;
  name: string;
  role: Role;
  icon?: string;
  champion: string | null;
  rank: { label: string; queue: 'Solo' | 'Flex' } | null;
  games: number;
  winRate: number | null;
  /** Holds the most series MVP titles this season. */
  crowned: boolean;
}

export interface HomeObjectives {
  shares: ObjectiveShare[];
  firstBlood: { hit: number; of: number };
  firstTower: { hit: number; of: number };
}

export interface HomeModel {
  teamName: string;
  season: SeasonWindow;
  slides: HomeSlide[];
  record: HomeRecord;
  next: HomeNextSeries | null;
  welcome: HomeWelcome;
  spotlight: HomeSpotlight | null;
  race: HomeRace;
  trend: HomeTrend;
  compMonth: { best: CompOfTheMonth | null; nearest: { name: string; games: number } | null };
  records: HomeRecords;
  advice: HomeAdvice;
  lineup: HomeLineupCard[];
  objectives: HomeObjectives;
  trophies: Achievement[];
}
