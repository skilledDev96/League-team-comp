export type Role = 'Top' | 'Jungle' | 'Mid' | 'ADC' | 'Support';

export const ROLES: Role[] = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];

export type AccessRole = 'admin' | 'contributor' | 'viewer';

export interface AccessEntry {
  email: string;
  role: AccessRole;
  active: boolean;
}

export interface SummonerProfile {
  region: string;
  opggSlug?: string;
  riotTag?: string;
  mobalyticsSlug?: string;
}

export interface RankedQueueStats {
  queueType: 'RANKED_SOLO_5x5' | 'RANKED_FLEX_SR';
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  winRate: number;
}

export interface QueueMatchStats {
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgKda: number;
  avgCsPerMin: number;
  avgKillParticipation: number;
  avgDamageShare: number;
  avgTankShare: number;
  avgBuildingDamage: number;
  avgVisionScore: number;
  playstyle: string;
  strengths: string[];
  weaknesses: string[];
  top3: string[];
  bans: string[];
}

export interface PlayerQueueStats {
  rank?: RankedQueueStats;
  matches?: QueueMatchStats;
}

export type SynergyQueue = 'RANKED_SOLO_5x5' | 'RANKED_FLEX_SR';

export interface PremadeGroupStats {
  playerIds: string[];
  playerNames: string[];
  queueType: SynergyQueue;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  averageKda: number;
  topChampions: string[];
}

export interface Player {
  id: string;
  name: string;
  role: Role;
  // Additional roles this player can flex into, beyond their main `role`.
  secondaryRoles?: Role[];
  icon?: string;
  playstyle?: string;
  strengths: string[];
  weaknesses: string[];
  top3: string[];
  bans: string[];
  queueStats?: {
    solo?: PlayerQueueStats;
    flex?: PlayerQueueStats;
    clash?: PlayerQueueStats;
  };
  profile?: SummonerProfile;
  order: number;
}

export interface FillIn {
  id: string;
  summoner: string;
  status: string;
  preferredRoles: string[];
  note?: string;
  icon?: string;
  profile?: SummonerProfile;
  order: number;
}

export type CompPicks = Record<Role, string>;

// A short, per-comp game plan by phase — the macro that applies to this draft.
export interface CompGamePlan {
  early?: string;
  mid?: string;
  late?: string;
}

export interface Comp {
  id: string;
  name: string;
  picks: CompPicks;
  category?: string;
  notes?: string;
  gamePlan?: CompGamePlan;
  // Champions to ban when running this comp (counters / hard matchups).
  bans?: string[];
  order: number;
}

export type CompOutcome = 'win' | 'loss';

export interface CompResult {
  id: string;
  compId: string;
  outcome: CompOutcome;
  opponent?: string;
  note?: string;
  playedOn: string;
  order: number;
}

export interface CompRecord {
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  results: CompResult[];
}

export interface PainPoint {
  id: string;
  playerId: string;
  text: string;
  resolved: boolean;
  note?: string;
  order: number;
}

export type LearnPriority = 'high' | 'med' | 'low';
export type LearnStatus = 'learning' | 'ready';

export interface LearnEntry {
  id: string;
  playerId: string;
  champion: string;
  priority: LearnPriority;
  status: LearnStatus;
  order: number;
}

export interface CompPerformance {
  compId: string;
  compName: string;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
}

export interface AnalysisPlayer {
  name: string;
  position: string;
  champion: string;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damage: number;
}

export interface AnalysisGame {
  matchId: string;
  compId: string | null;
  compName: string | null;
  nearCompName?: string | null;
  nearOverlap?: number;
  /** Comps tied at the same overlap; length > 1 means attribution is ambiguous. */
  tiedNames?: string[];
  // Roster members on our team this game (5 = full stack, 3 = off-the-books).
  rosterCount?: number;
  win: boolean;
  side?: 'blue' | 'red';
  enemyChampions?: string[];
  queue: string;
  date: number;
  players: AnalysisPlayer[];
}

/** Stage-by-stage audit of one analysis pass, so silent drops are visible. */
export interface AnalysisFunnel {
  candidates: number;
  servedFromCache: number;
  fetchedFromRiot: number;
  selfHealed: number;
  passedTeamMin: number;
  attributedToComp: number;
  dropped: {
    fetch_failed: number;
    budget_exhausted: number;
    no_roster_in_match: number;
    below_team_min: number;
  };
}

export interface CompAnalysis {
  comps: CompPerformance[];
  games: AnalysisGame[];
  totalTeamGames: number;
  scannedMatches: number;
  newMatches?: number;
  pendingMatches?: number;
  funnel?: AnalysisFunnel;
  /** Git SHA the backend was deployed from, to spot frontend/backend drift. */
  backendSha?: string;
  generatedAt: string;
}

export type PlayPhase = 'Early' | 'Mid' | 'Late';
export type TokenSide = 'ally' | 'enemy';

export interface PlayToken {
  id: string;
  side: TokenSide;
  role?: Role;
  champion: string;
  // Position as a percentage of the board (0-100), so it stays responsive.
  x: number;
  y: number;
}

export type ArrowKind = 'dive' | 'rotate' | 'ward';

export interface PlayArrow {
  id: string;
  kind: ArrowKind;
  // Endpoints as a percentage of the board (0-100).
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type MarkerKind = 'minion' | 'dragon' | 'grubs' | 'herald' | 'baron' | 'ward';

export interface PlayMarker {
  id: string;
  kind: MarkerKind;
  // Position as a percentage of the board (0-100).
  x: number;
  y: number;
  // Optional game-clock timing, e.g. "14:00".
  time?: string;
}

export interface Play {
  id: string;
  compId: string;
  title: string;
  phase: PlayPhase;
  // Legacy single note; kept for reading old plays. New plays use noteItems.
  notes?: string;
  noteItems?: string[];
  tokens: PlayToken[];
  arrows?: PlayArrow[];
  markers?: PlayMarker[];
  order: number;
}

export interface TeamIdentity {
  visionDriven: boolean;
  objectiveFocused: boolean;
  primaryPlaystyle: string[];
  jungleTempo: string;
  damageProfile: string;
  midRole: string;
  lateGameFrontline: string;
}

export interface ResourceLink {
  label: string;
  url: string;
}

export type ResourceLinks = Record<string, ResourceLink[]>;

export interface Settings {
  teamName: string;
}

export interface TeamData {
  settings: Settings;
  players: Player[];
  fillIns: FillIn[];
  comps: Comp[];
  compResults: CompResult[];
  plays: Play[];
  painPoints: PainPoint[];
  learnEntries: LearnEntry[];
  compAnalysis?: CompAnalysis;
  teamIdentity: TeamIdentity;
  resourceLinks: ResourceLinks;
  tournaments: Tournament[];
  tournamentSeries: TournamentSeries[];
  seriesGames: SeriesGame[];
  matchNotes: MatchNote[];
}

/** Result of the scheduled Riot API key probe (Firestore `meta/keyHealth`). */
export interface KeyHealth {
  ok: boolean;
  status: number;
  /** Reported app rate limit, e.g. "20:1,100:120". Informational only — an
   *  approved Personal key can share a Development key's limits. */
  appRateLimit: string;
  message: string;
  checkedAt: string;
}

// ---- Tournaments ---------------------------------------------------------

/**
 * A tournament we're competing in. Repeatable — the Oryx Fearless League runs
 * two splits a year and this won't be the only one we enter.
 */
export interface Tournament {
  id: string;
  name: string;
  organiser?: string;
  /** e.g. "First Division" / "Second Division". */
  division?: string;
  /** e.g. "Bo3 Fearless — Swiss stage". */
  format?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
  /** Only one tournament is normally "current"; drives default page focus. */
  active?: boolean;
  /** Riot matchIds tagged as prep for this tournament (scrims, practice). */
  prepMatchIds?: string[];
  order: number;
}

/**
 * One weekly match-up against an opponent. Scheduling itself happens on Discord
 * per the rulebook — this just records what was agreed so it isn't lost.
 */
export interface TournamentSeries {
  id: string;
  tournamentId: string;
  opponent: string;
  /** Agreed kick-off, once settled externally. Free text or ISO. */
  scheduledAt?: string;
  /** 3 for a Bo3 Swiss series, 5 for playoffs. */
  bestOf: number;
  /** Game 1 side, decided by the pre-series 1v1. */
  side?: 'blue' | 'red';
  /** Whether we won the side-selection 1v1. */
  wonSideSelection?: boolean;
  /** Scouting notes for this opponent. */
  notes?: string;
  /** Target bans for this opponent, kept separate from per-comp bans. */
  bans?: string[];
  status?: 'scheduled' | 'played';
  order: number;
}

/**
 * A single game inside a series. Both teams' champions matter: under Fearless
 * Draft a champion used by *either* side is removed for the rest of the series.
 */
export interface SeriesGame {
  id: string;
  seriesId: string;
  gameNumber: number;
  ourChampions: string[];
  theirChampions: string[];
  win?: boolean;
  /** Set when reconciled against Riot match history after the fact. */
  matchId?: string;
  order: number;
}

/**
 * A retrospective note about one played match, keyed by Riot's match id.
 *
 * Analysis games are recomputed from Riot on every refresh, so notes cannot
 * live on the game itself — they are stored separately and looked up by id.
 */
export interface MatchNote {
  /** Same value as `matchId`, so a match has exactly one note document. */
  id: string;
  matchId: string;
  text: string;
  order: number;
}
