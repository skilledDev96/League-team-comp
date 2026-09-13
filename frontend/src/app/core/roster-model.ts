import {
  AnalysisGame,
  Comp,
  FillIn,
  LearnEntry,
  LearnPriority,
  PainPoint,
  Player,
  Role,
  Scrim,
  SeriesGame,
  SummonerProfile,
  Tournament,
  TournamentSeries
} from '../models/team.models';
import { RankedRecord, SeasonMode, SeasonWindow } from './team-season';

/**
 * The Roster page as one record (13 Sep 2026, the lead: "keep the theme of the home page rolling"),
 * built once by `buildRoster` in the page's shell and read by all four views: the team poster, the
 * table, the scouting cards and the scout report.
 *
 * Every card is one of ours: a starter, a sub or a fill-in. Nothing here names the other side.
 */

export interface RosterInput {
  now: number;
  mode: SeasonMode;
  players: readonly Player[];
  fillIns: readonly FillIn[];
  painPoints: readonly PainPoint[];
  learnEntries: readonly LearnEntry[];
  comps: readonly Comp[];
  analysis: readonly AnalysisGame[];
  tournaments: readonly Tournament[];
  series: readonly TournamentSeries[];
  seriesGames: readonly SeriesGame[];
  scrims: readonly Scrim[];
  /** Match ids tagged practice on the Games page. */
  practice: ReadonlySet<string>;
  compOverride: (matchId: string) => string;
}

export type RosterGroup = 'starters' | 'bench' | 'fillIns';

export interface RosterPoolEntry {
  champion: string;
  games: number;
  wins: number;
  /** Rounded percent; null with no games. */
  winRate: number | null;
  /** `rateBand`'s class; empty with no games. */
  band: string;
  /** In the pool the team wrote down for them. */
  declared: boolean;
}

export interface RosterCard {
  /** The player's id, or `fill-<id>` for a fill-in. */
  id: string;
  group: RosterGroup;
  playerId?: string;
  fillInId?: string;
  fillInStatus?: string;
  name: string;
  role: Role;
  secondaryRoles: Role[];
  icon?: string;
  playstyle?: string;
  profile?: SummonerProfile;
  /** The splash behind them: what they play most for the team, else what Riot or the roster says. */
  champion: string | null;
  rank: { label: string; queue: 'Solo' | 'Flex' } | null;
  /** Their own ranked record in the queue of `rank`, which the ring shows (13 Sep 2026); `games` and `form` stay the team's. */
  ranked: RankedRecord | null;
  games: number;
  wins: number;
  /** Rounded percent over the team games read; null with none. */
  winRate: number | null;
  band: string;
  /** Present when at least one of their games carried figures. */
  stats?: { statGames: number; kda: number; csPerMin?: number; killParticipation?: number; visionPerGame?: number };
  /** Newest first, at most five. */
  form: ('W' | 'L')[];
  /** Series MVP titles that count. */
  titles: number;
  /** Marks on them too thin to count yet. */
  provisional: number;
  /** Holds the most titles (ties share it). */
  crowned: boolean;
  /** Their newest title: the other team as a name, which is all the app keeps of them. */
  lastTitle?: { opponent: string; champion: string; at: number | null };
  /** What they played for the team, most first, then the pool written down that they have not played. */
  pool: RosterPoolEntry[];
  strengths: string[];
  weaknesses: string[];
  bans: string[];
  /** Open pain points, in their order. */
  working: { id: string; text: string }[];
  resolved: number;
  learning: { id: string; champion: string; priority: LearnPriority; ready: boolean }[];
}

export interface RosterModel {
  season: SeasonWindow;
  /** The team games read, practice left out. */
  games: number;
  mostTitles: number;
  starters: RosterCard[];
  bench: RosterCard[];
  fillIns: RosterCard[];
}
