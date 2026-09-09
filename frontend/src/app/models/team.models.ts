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
  /**
   * Games actually behind the vision average. Below `games` while cache v4
   * backfills, and absent entirely on stats enriched before it existed — so
   * read a missing value as "unknown", not as zero.
   */
  visionSamples?: number;
  /** Games behind the building-damage average, likewise. */
  buildingSamples?: number;
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
  /** On the bench. Two players can share a seat; the draft room, the lane read and
   *  the advisor follow the one who is not marked, so the sub never steals the seat. */
  sub?: boolean;
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
  /** ISO time of the last Riot refresh, set by the morning job. */
  refreshedAt?: string;
  /**
   * Saved by hand in Admin. The refresh then keeps only the stats; the text,
   * the pool and the bans are the team's own until someone presses Refresh
   * on the player and saves again.
   */
  curated?: boolean;
  order: number;
}

/** What "Fill from Riot" leaves on a fill-in, so their card can read like a player's (9 Sep 2026). */
export interface FillInRiot {
  playstyle?: string;
  strengths?: string[];
  weaknesses?: string[];
  top3?: string[];
  queueStats?: Player['queueStats'];
  refreshedAt: string;
}

export interface FillIn {
  id: string;
  summoner: string;
  status: string;
  preferredRoles: string[];
  note?: string;
  icon?: string;
  profile?: SummonerProfile;
  riot?: FillInRiot;
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
  /**
   * Id of another comp this one folds into for stats. Near-duplicate drafts
   * are kept as separate comps to play from, but their games count together.
   */
  countsUnder?: string | null;
  // Champions to ban when running this comp (counters / hard matchups).
  bans?: string[];
  /**
   * What the comp is expected to do, on four axes (`core/comp-expectation.ts`).
   * Derived from the champions and written on every save so the review
   * function always has a value; `edited` means a person set it.
   */
  expect?: CompExpectation;
  expectSource?: 'derived' | 'edited';
  order: number;
}

export type ExpectLevel = 'low' | 'mid' | 'high';

export interface CompExpectation {
  early: ExpectLevel;
  scaling: ExpectLevel;
  objectives: ExpectLevel;
  teamfight: ExpectLevel;
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

/** One seat against theirs. Mirrors `api/src/lane-read.ts`. */
export interface LaneRead {
  position: string;
  theirChampion: string;
  verdict: 'won' | 'even' | 'lost' | 'unknown';
  csAt10Diff?: number;
  goldPerMinDiff?: number;
  damagePerMinDiff?: number;
  visionPerMinDiff?: number;
  levelLead?: number;
  earlyLaneAdvantage?: boolean;
  laneAdvantage?: boolean;
}

/** What a player did that a plan can act on. Mirrors `api/src/lane-read.ts`. */
export interface PlayerFacts {
  goldPerMin?: number;
  visionPerMin?: number;
  controlWards?: number;
  wardTakedowns?: number;
  soloKills?: number;
  hasTeleport?: boolean;
  tpTakedowns?: number;
  timeDeadSec?: number;
  csAt10?: number;
  plates?: number;
  dragonTakedowns?: number;
  baronTakedowns?: number;
  killsNearEnemyTurret?: number;
  damageShare?: number;
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
  /** Share of the team's kills this player was in on, 0-1. */
  killParticipation?: number;
  /** Damage taken. Absent until the match is re-cached at schema v3. */
  damageTaken?: number;
  /** Seconds spent crowd-controlling opponents. Absent below cache v3. */
  ccTime?: number;
  /** Vision score. Absent below cache v4. */
  visionScore?: number;
  buildingDamage?: number;
  /** This seat against theirs. Absent below cache v5 and on replays. */
  lane?: LaneRead;
  /** Absent below cache v5. */
  facts?: PlayerFacts;
}

/** One side's objective haul in a game. Mirrors `api/src/objectives.ts`. */
export interface TeamObjectives {
  firstBlood: boolean;
  firstTower: boolean;
  dragons: number;
  barons: number;
  heralds: number;
  grubs: number;
  towers: number;
  inhibitors: number;
}

export interface GameObjectives {
  ours: TeamObjectives;
  theirs: TeamObjectives;
}

export type LossCode =
  | 'lost_fights'
  | 'early_game'
  | 'dragon_control'
  | 'baron_control'
  | 'map_control'
  | 'threw_lead';

/** One reason a game was lost, with the numbers behind it. */
export interface LossFactor {
  code: LossCode;
  label: string;
  detail: string;
}

export type WinCode =
  | 'won_fights'
  | 'early_lead'
  | 'dragon_control'
  | 'baron_control'
  | 'map_control'
  | 'closed_fast'
  | 'comeback';

/** One reason a game was won. Mirrors `LossFactor`; see `api/src/objectives.ts`. */
export interface WinFactor {
  code: WinCode;
  label: string;
  detail: string;
}

/** Either side of the same shape, for code that handles wins and losses alike. */
export type OutcomeFactor = LossFactor | WinFactor;

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
  /** Absent until the match is re-cached at schema v2; the review page says so. */
  objectives?: GameObjectives;
  durationSec?: number;
  /** Empty for a win, and for a loss with no objective story to tell. */
  lossFactors?: LossFactor[];
  /** Empty for a loss, and for a win with no objective story to tell. */
  winFactors?: WinFactor[];
  /** The fight scoreline: our kills against theirs. */
  kills?: { ours: number; theirs: number };
  /** Where lane reads came from: Riot's per-minute figures, or nothing (a replay). */
  laneData?: 'riot' | 'none';
  /** 'riot' when a derived timeline document exists, 'none' for a replay, absent while waiting on the backfill. */
  timelineData?: 'riot' | 'none';
  /**
   * The enemy five with their roles, sorted, for a lane-by-lane comparison.
   * Absent until the analysis is re-run; `enemyChampions` is the flat list the
   * ban suggestions and the tournament planner still read.
   */
  enemies?: { position: string; champion: string }[];
  /**
   * Set when a person placed this game rather than the champion matcher —
   * `manual` for an override on this match, `alias` for a comp's `countsUnder`.
   * Absent means the matcher's own answer.
   */
  attribution?: 'manual' | 'alias';
  /** The cache schema the match was read from; absent on entries written before stamping. */
  cacheVersion?: number;
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
  /** The last commit that touched api/ when the functions were built. */
  apiSha?: string;
  generatedAt: string;
  /** Size of the document as JSON; one Firestore document, 1 MiB cap. */
  payloadBytes?: number;
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

/** What one account has seen, at `userPrefs/{email}`. */
export interface UserPrefs {
  /** The welcome modal's old flag; still written when the welcome tour finishes. */
  tourSeen?: boolean;
  /** Tour id → the version seen. Bumping a tour's version shows it again. */
  toursSeen?: Record<string, number>;
  /** The film room (9 Sep 2026): which seat is mine, and where I am in each film. */
  film?: FilmPrefs;
}

// ---- The film room ----------------------------------------------------------
//
// A review walked as chapters the team calls before they are revealed
// (9 Sep 2026). Progress is per person at `userPrefs/{email}.film`; the
// commitment and the notes are the team's, one document per game, written
// by editors.

export interface FilmPrefs {
  /** The seat "Your seat" opens on. */
  seat?: Role;
  /** By match id. */
  films?: Record<string, FilmProgress>;
}

export interface FilmProgress {
  /** ISO time the card was reached. */
  done?: string;
  /** Left by the Call it back chapter, removed 9 Sep 2026: old documents carry it, nothing writes or reads it. */
  tally?: { called: number; of: number };
  /** Every call made in the film, by key ("title", "seat:Jungle", …): the option index chosen. */
  calls?: Record<string, number>;
  /** A viewer's own pick when they cannot write the team's commitment. */
  choice?: FilmChoice;
  /** ISO time the "Before you play" card should ask again; absent when switched off or spent. */
  nextAskAt?: string;
  /** How many times it has asked: 0, 1, 2 → +1, +3, +7 days. */
  asked?: number;
}

export type FilmChoice = 'a' | 'b' | 'commit';

/** The team's pick on the first work-on, at `filmCommitments/{matchId}`. */
export interface FilmCommitment {
  matchId: string;
  /** The first work-on's text, as it read when the pick was made. */
  text: string;
  /** The two choices the sentence offered, when it did. */
  options?: [string, string];
  /** Email key → what that person picked. The team's choice is the majority, ties to 'a'. */
  by: Record<string, FilmChoice>;
}

export interface FilmNote {
  text: string;
  /** Email key of who wrote it. */
  by: string;
  /** ISO time. */
  at: string;
}

/** The team's notes on a film, at `filmNotes/{matchId}`, keyed "m:<moment index>", "d:<minute>:<seat>" or "w:<work-on index>". */
export interface FilmNotes {
  matchId: string;
  notes: Record<string, FilmNote>;
}

export interface Settings {
  teamName: string;
  /**
   * Ask the advisor by itself the moment a draft step becomes ours. Off by
   * default: the team asked for it to be removed, then for a switch (8 Sep
   * 2026) — "Ask what to pick" always works either way.
   */
  autoAdvisor?: boolean;
  /**
   * Review new prep Flex and Clash games each morning, a few at a time,
   * with the model. Off by default: each review is a paid call.
   */
  autoReview?: boolean;
}

/**
 * One save of a series game, in words — what changed, by whom, when, and the
 * board it left behind. Written by `TeamDataService.updateSeriesGame` from
 * `core/draft-diff.ts`, read on Admin → Diagnostics. Collection `draftEvents`.
 */
export interface DraftEvent {
  id: string;
  /** ISO. */
  at: string;
  by: string;
  seriesId: string;
  gameId: string;
  gameNumber: number;
  stepBefore: number;
  stepAfter: number;
  changes: string[];
  kinds: string[];
  board: {
    ourSide?: 'blue' | 'red';
    bans: string[];
    ourChampions: string[];
    theirChampions: string[];
  };
}

/**
 * A team we scrim against, and everything we know about them.
 *
 * Scrims arrive one replay at a time with only an opponent name typed on them,
 * so "who have we played" was answerable but "what do we know about them" was
 * not — the notes, target bans and scouted roster that a tournament series
 * carries had nowhere to live for a practice partner. This is that home. One
 * per opponent, keyed by a slug of the name so every scrim against the same
 * team folds into the same record without any linking step.
 *
 * Deliberately the same three things a series holds, so the panel is the same
 * panel and a team scouted for a scrim is already scouted if they show up in
 * the bracket.
 */
export interface ScrimOpponent {
  /** Slug of the opponent name, so the same team always lands on one record. */
  id: string;
  /** Display name, as typed on the scrims — the first spelling seen wins. */
  name: string;
  /** Free-text scouting notes; lines and links render as on a series. */
  notes?: string;
  /** Target bans against this team, kept separate from per-comp bans. */
  bans?: string[];
  /** Their five, once someone has pasted the roster. */
  opponentPlayers?: OpponentPlayer[];
  /** Their games together lately. Absent until fetched. */
  teamHistory?: OpponentTeamHistory;
  order: number;
}

/**
 * Our own five, read the way we read an opponent (9 Sep 2026): the same scout
 * over Name#TAG, stored once at `meta/selfScout` and rewritten per scout. The
 * rows are `OpponentPlayer` on purpose, so the same table renders them.
 */
export interface SelfScout {
  players: OpponentPlayer[];
  /** ISO time the last scout finished writing. */
  scoutedAt: string;
}

export interface TeamData {
  settings: Settings;
  players: Player[];
  fillIns: FillIn[];
  comps: Comp[];
  compResults: CompResult[];
  /** Imported from replay files; optional, since older data has none. */
  scrims?: Scrim[];
  /** Notes, bans and rosters for the teams those scrims were against. */
  scrimOpponents?: ScrimOpponent[];
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
  compOverrides: CompOverride[];
  practiceGames: PracticeGame[];
  selfScout?: SelfScout;
}

/** What the draft advisor answered. Mirrors `api/src/draft-advice.ts`. */
export interface DraftAdvice {
  summary: string;
  picks: { champion: string; seat: Role | null; why: string; confidence: 'high' | 'medium' | 'low' }[];
  bans: { champion: string; why: string }[];
  /** What to watch for in their next moves. */
  watch: string[];
  model?: string;
  tookMs?: number;
}

/** An answer as stored on a `SeriesGame`. */
export interface SavedDraftAdvice extends DraftAdvice {
  step: number;
  action: 'pick' | 'ban';
  askedAt: string;
}

/** What the last morning refresh did (Firestore `meta/refreshLog`). Mirrors `api/src/daily-refresh.ts`. */
export interface RefreshLog {
  ranAt: string;
  finishedAt: string;
  trigger: 'schedule' | 'manual';
  playersUpdated: string[];
  playersFailed: string[];
  playersSkipped: string[];
  analysis: { ok: boolean; games?: number; newMatches?: number; pending?: number; error?: string };
  /** The timeline step: derived documents written, and prep games still waiting. */
  timelines?: { fetched: number; failed: number; pending: number; skipped?: 'time' | 'analysis' };
  /** The review step: which games the model reviewed and what it cost. */
  reviews?: { attempted: string[]; written: string[]; failed: string[]; costUsd: number; skipped?: 'off' | 'noKey' | 'time' | 'analysis' };
}

// ---- Game reviews -----------------------------------------------------------
//
// Mirrors `api/src/game-review.ts`. One document per game at
// `gameReviews/{matchId}`, written by the review function only; the app
// listens. No email, no puuid, nothing about a person on the other team.

export type ReviewTheme = 'draft' | 'lanes' | 'fights' | 'objectives' | 'vision' | 'tempo' | 'macro';
/** Every theme, in the order the api lists them; mirrors `REVIEW_THEMES` in `api/src/game-review.ts`. */
export const REVIEW_THEMES: readonly ReviewTheme[] = ['draft', 'lanes', 'fights', 'objectives', 'vision', 'tempo', 'macro'];

export interface ReviewPoint {
  text: string;
  evidence: string;
  minute: number | null;
  /** Team points from review version 2, and a player's further points from version 3. */
  theme?: ReviewTheme;
}

/** One step of the walk through the game, from review version 3. */
export interface ReviewMoment {
  minute: number;
  text: string;
  swing: 'us' | 'them' | 'even';
}

export interface GameReview {
  matchId: string;
  reviewedAt: string;
  reviewVersion: number;
  tier: 'timeline' | 'endOfGame';
  trigger: 'manual' | 'auto';
  models: { team: string; players: string };
  compId: string | null;
  compName: string | null;
  expect?: CompExpectation;
  team: {
    /** How the game was decided, in at most eight words; absent before review version 2. */
    headline?: string;
    summary: string;
    workOn: ReviewPoint[];
    keepDoing: ReviewPoint[];
    compVerdict: 'as drafted' | 'off plan' | 'unclear';
    compWhy: string;
    /** Three to six, in time order; absent before review version 3. */
    moments?: ReviewMoment[];
  };
  players: {
    name: string;
    seat: Role;
    champion: string;
    strength: ReviewPoint;
    workOn: ReviewPoint;
    /** Up to three further things to work on; absent before review version 3. */
    more?: ReviewPoint[];
  }[];
  usage: { team: { input: number; cachedInput: number; output: number }; players: { input: number; cachedInput: number; output: number }; costUsd: number; tookMs: number };
}

// ---- Match timelines --------------------------------------------------------
//
// Mirrors `api/src/timeline-features.ts`. One document per Riot game at
// `matchTimeline/{matchId}`, derived from Match-V5's timeline: a figure a
// minute, the events that matter, nothing raw. Frames are sixty seconds
// apart, so anything read off a position is approximate.

export type MapZone = 'ourBase' | 'theirBase' | 'top' | 'mid' | 'bot' | 'river' | 'ourJungle' | 'theirJungle';
export type TimelineSide = 'us' | 'them';
export type LaneName = 'top' | 'mid' | 'bot';

export interface TimelineMark {
  minute: number;
  side: TimelineSide;
}

export interface TimelineLaneDiff {
  gold: number;
  xp: number;
  cs: number;
}

export interface TimelineLane {
  seat: Role;
  name?: string;
  champion: string;
  theirChampion: string;
  at5?: TimelineLaneDiff;
  at10?: TimelineLaneDiff;
  at15?: TimelineLaneDiff;
  flippedAt?: number;
}

export interface TimelineObjective {
  minute: number;
  type: 'dragon' | 'herald' | 'grubs' | 'baron' | 'elder' | 'atakhan';
  subType?: string;
  side: TimelineSide;
  ourInvolved: Role[];
  ourNear: Role[];
}

export interface TimelineDeath {
  sec: number;
  minute: number;
  seat: Role;
  zone: MapZone;
  theirSide: boolean;
  killers: number;
  executed: boolean;
  warded: boolean;
  /** Who was where, from timeline version 2 (9 Sep 2026); absent before it. Approximate by a minute. */
  theirJungleIn?: boolean;
  ourJungleDist?: number;
  ourJungleZone?: MapZone;
  theirJungleDistBefore?: number;
  alliesNear?: number;
  objectiveNear?: boolean;
}

export interface MatchTimeline {
  matchId: string;
  timelineVersion: number;
  builtAt: string;
  ourSide: 'blue' | 'red';
  durationSec: number;
  frameSec: number;
  goldDiff: number[];
  curve: {
    at10?: number;
    at15?: number;
    at20?: number;
    at25?: number;
    leadAt: Partial<Record<'10' | '15' | '20' | '25', TimelineSide | 'even'>>;
    biggestLead: { gold: number; minute: number };
    biggestDeficit: { gold: number; minute: number };
  };
  lanes: TimelineLane[];
  firsts: {
    blood?: TimelineMark;
    tower?: TimelineMark & { lane: LaneName };
    dragon?: TimelineMark;
    grubs?: TimelineMark;
    herald?: TimelineMark;
  };
  objectives: TimelineObjective[];
  plates: { ours: Record<LaneName, number>; theirs: Record<LaneName, number> };
  deaths: TimelineDeath[];
  theirDeaths: { sec: number; minute: number; zone: MapZone; ourInvolved?: Role[] }[];
  vision: { seat: Role; placed: number[]; killed: number[] }[];
  spend: { seat: Role; firstItemMinute?: number; secondItemMinute?: number; backs: number[] }[];
  /** Damage to champions dealt and taken per five minutes, our five only; absent before version 2. */
  damage?: { seat: Role; dealt: number[]; taken: number[] }[];
  /** The facts read off the figures, stored beside them; mirrors `api/src/game-facts.ts`. */
  facts?: GameFacts;
  bytes: number;
}

export type CurveShape = 'led throughout' | 'trailed throughout' | 'came back' | 'threw' | 'swung' | 'even' | 'unknown';

export type DeathHow = 'executed' | 'solo' | 'gank' | 'fight';
/** What would have stopped a death: our jungler's pathing, a ward, a call about their jungler, or not standing alone on their side. */
export type DeathCould = 'jungle' | 'ward' | 'call' | 'position';

/** One death of ours and the verdict on it, from facts version 2. Mirrors `api/src/game-facts.ts`. */
export interface DeathVerdict {
  minute: number;
  seat: Role;
  name?: string;
  zone: MapZone;
  how: DeathHow;
  could: DeathCould[];
  line: string;
}

export interface LedgerSummary {
  deaths: number;
  ganks: number;
  dark: number;
  inReach: number;
  alone: number;
}

/** How a game went, in sentences and the figures behind them. Mirrors `api/src/game-facts.ts`. */
export interface GameFacts {
  factsVersion: number;
  tier: 'timeline' | 'endOfGame';
  result: 'win' | 'loss';
  durationMin: number;
  side?: 'blue' | 'red';
  curve: {
    at10?: number;
    at15?: number;
    at20?: number;
    at25?: number;
    peakLead?: { gold: number; minute: number };
    worstDeficit?: { gold: number; minute: number };
    shape: CurveShape;
  };
  lanes: {
    seat: Role;
    name?: string;
    champion: string;
    theirChampion: string;
    verdict: 'won' | 'even' | 'lost' | 'unknown';
    goldAt10?: number;
    csAt10?: number;
    xpAt10?: number;
    flippedAt?: number;
    line: string;
  }[];
  firsts: MatchTimeline['firsts'];
  objectives: {
    minute: number;
    type: TimelineObjective['type'];
    subType?: string;
    side: TimelineSide;
    ourNearCount: number;
    ourInvolved: Role[];
    setup: 'taken' | 'contested' | 'uncontested' | 'traded';
    line: string;
  }[];
  deathClusters: { fromMinute: number; toMinute: number; zone: MapZone; ours: number; theirs: number; seats: Role[]; line: string }[];
  soloDeaths: { minute: number; seat: Role; zone: MapZone; warded: boolean; theirSide: boolean; line: string }[];
  vision: { seat: Role; name?: string; placedPer5: number[]; darkDeaths: number; line: string }[];
  spend: { seat: Role; firstItemMinute?: number; backs: number }[];
  /** The death ledger; absent on the replay tier and on facts before version 2. */
  ledger?: DeathVerdict[];
  ledgerSummary?: LedgerSummary;
  /** Our jungler on our kills; absent before facts version 2. */
  presence?: { kills: number; ofKills: number; before15: number; ofBefore15: number; line: string };
  lines: string[];
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
  /**
   * A group on the Prep & Draft page (9 Sep 2026). `tournament` (the
   * default) is a real competition; `scrims` is the one group every scrim
   * opponent lives in — not a tournament, just where the scrims are.
   */
  kind?: 'tournament' | 'scrims';
  /** Whether picks burn across the series. Tournaments default to true; the scrims group is false. */
  fearless?: boolean;
  order: number;
}

/**
 * One player on the other team, scouted from their public Riot ID.
 *
 * Only what a draft needs: what they play and what beats them. Deliberately not
 * a `Player` — nothing here is edited by the person it describes, none of it is
 * ours to keep beyond the fixture, and Riot's policy is explicit that a product
 * "cannot de-anonymize players who cannot reasonably be identified from visible
 * information". These are identified by a Riot ID somebody typed in, taken from
 * a roster their own league publishes.
 */
/**
 * One champion for one player: how often, and how it went.
 *
 * The names alone said what they play. The record says how it has gone, which
 * is the difference between listing a pool and reading one — a champion at 2
 * wins from 9 games is a very different pick to ban than one at 7 from 9.
 */
export interface ChampionRecord {
  champion: string;
  games: number;
  wins: number;
}

/** One champion's mastery: the all-time signal a match scan cannot see. */
export interface MasteryRecord {
  champion: string;
  level: number;
  points: number;
}

/**
 * One ranked queue's champion record for a scouted opponent.
 *
 * Mirrors the shape the merged fields already use, scoped to a single ladder so
 * solo and flex can be shown as separate rows instead of one of them being
 * silently discarded.
 */
export interface OpponentQueuePool {
  top3?: string[];
  bans?: string[];
  positions?: { role: Role; games: number }[];
  poolByRole?: Partial<Record<Role, ChampionRecord[]>>;
  bansByRole?: Partial<Record<Role, ChampionRecord[]>>;
  championRecords?: ChampionRecord[];
  /**
   * How much of their recent history this record is built from: games read
   * against games Riot listed, and how many are still unread. One scout reads
   * a batch; the next reads the next batch, so "unread" is an invitation.
   */
  sample?: { read: number; available: number; unread: number };
}

export interface OpponentPlayer {
  /** The seat we expect them in. Their pool is shown when that seat is picking. */
  role: Role;
  /**
   * Their substitute, set by hand. A six-player roster has two people on one
   * seat and nothing in the data says which is the starter; this does.
   */
  sub?: boolean;
  /** Riot game name, without the tag. */
  name: string;
  /** Riot tag line, without the hash. */
  riotTag?: string;
  region?: string;
  /** Most-played champions, newest scout first. Absent until scouted. */
  top3?: string[];
  /** Champions that beat them in lane — ban candidates that are actually theirs. */
  bans?: string[];
  /** A sentence on how they play, from the same enrichment our own roster uses. */
  playstyle?: string;
  /**
   * Whichever rank was found, solo preferred. Kept for rows scouted before the
   * two were told apart, so an existing roster does not go blank.
   */
  rank?: string;
  /**
   * Ranked solo/duo and flex, separately.
   *
   * They are different ladders and routinely differ by a tier or more — and it
   * is flex a team plays together, so reading a flex rank as "their solo rank"
   * flatters or maligns the player. Showing one unlabelled number could not say
   * which it was.
   */
  soloRank?: string;
  flexRank?: string;
  /**
   * The two positions they actually play, most often first, with the games.
   *
   * The counts carry the meaning: "Mid 34, Top 12" is a main with a fallback,
   * "Mid 24, Top 22" is a genuine flex, and only the second changes how you
   * draft against them. Two, because a draft cannot act on a long tail.
   */
  positions?: { role: Role; games: number }[];
  /**
   * What they play in each seat.
   *
   * The seat they hold is set by hand and can differ from the one their
   * history is about, so the row reads this first and falls back to the
   * overall pool — saying which it got, because a career ADC seated at top
   * still lists ADCs and that is true rather than useful.
   */
  poolByRole?: Partial<Record<Role, ChampionRecord[]>>;
  /** Who beats them in each seat, read the same way as poolByRole. */
  bansByRole?: Partial<Record<Role, ChampionRecord[]>>;
  /** Every champion they played, with games and wins — the fallback pool. */
  championRecords?: ChampionRecord[];
  /**
   * Champions played in the last two months, newest first.
   *
   * From mastery rather than the match scan, so it sees their whole history
   * instead of a hundred-game window — which is how a champion picked up six
   * weeks ago shows up at all. Carries no position, so it widens the net
   * rather than sharpening it.
   */
  recentChampions?: string[];
  /** Their top masteries, points descending, from the same scout. */
  mastery?: MasteryRecord[];
  /** Their summoner icon, from the same scout. */
  icon?: string;
  /**
   * The champion record for each ranked queue, read apart.
   *
   * The fields above (`top3`, `poolByRole`, `bansByRole`, `championRecords`)
   * come from whichever queue the backend merge preferred, and it prefers flex
   * — so a row labelled "plays" was showing a flex pool with nothing saying so.
   * They are genuinely different pools: a team meets its opponents in flex, but
   * most players grind solo, and the champions differ.
   *
   * Absent on rosters scouted before this existed, and absent per queue when a
   * player has no games there. Both cases fall back to the merged fields, so an
   * old roster keeps working and never goes blank.
   */
  byQueue?: {
    solo?: OpponentQueuePool;
    flex?: OpponentQueuePool;
  };
  /** Ranked season record, e.g. "425W 439L (49%)". */
  soloRecord?: string;
  flexRecord?: string;
  /** ISO timestamp of the last successful scout, so staleness is visible. */
  scoutedAt?: string;
  /** Why the last scout failed, when it did. Shown rather than swallowed. */
  scoutError?: string;
}

/**
 * One weekly match-up against an opponent. Scheduling itself happens on Discord
 * per the rulebook — this just records what was agreed so it isn't lost.
 */
/** One of their picks in a game together; `player` is null for a teammate outside the five. */
/** What one player did in the game; absent when the cache entry predates the numbers. */
export interface TogetherPickStats {
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damage: number;
  damageTaken?: number;
  vision?: number;
}

export interface TogetherPick {
  role: Role | '';
  champion: string;
  player: string | null;
  stats?: TogetherPickStats;
}

/** The objectives one side took. Mirrors `api/src/team-history.ts`. */
export interface ObjectiveLine {
  dragons: number;
  barons: number;
  heralds: number;
  grubs: number;
  towers: number;
  inhibitors: number;
  firstBlood: boolean;
  firstTower: boolean;
}

export interface TogetherGame {
  matchId: string;
  /** ISO. */
  date: string;
  queue: string;
  durationSec?: number;
  win: boolean;
  side: 'blue' | 'red';
  /** How many of the five were on this side. */
  together: number;
  picks: TogetherPick[];
  enemies: TogetherPick[];
  /** The scoreline, their side first. Absent when the history was fetched before the numbers were kept. */
  kills?: { team: number; enemy: number };
  /** Objectives, their side first. Absent likewise. */
  objectives?: { team: ObjectiveLine; enemy: ObjectiveLine };
}

export interface TogetherPickStat {
  champion: string;
  role: Role | '';
  games: number;
  wins: number;
  winRate: number;
}

export interface TogetherSummary {
  games: number;
  wins: number;
  losses: number;
  fullStacks: number;
  picks: TogetherPickStat[];
}

/**
 * What their five did as a team lately, from `getOpponentHistory`. Stored on
 * the series or scrim opponent so the whole team reads one fetch.
 */
export interface OpponentTeamHistory {
  fetchedAt: string;
  days: number;
  games: TogetherGame[];
  summary: TogetherSummary;
  /** Candidates left unread by one run's Riot budget; a refresh reads on. */
  pending: number;
  /** Names Riot did not know, so a typo is visible rather than silent. */
  unresolved: string[];
}

export interface TournamentSeries {
  id: string;
  tournamentId: string;
  opponent: string;
  /** Agreed kick-off, once settled externally. Free text or ISO. */
  scheduledAt?: string;
  /** 3 for a Bo3 Swiss series, 5 for playoffs; 0 for a scrim block, which has no cap. */
  bestOf: number;
  /** Game 1 side, decided by the pre-series 1v1. */
  side?: 'blue' | 'red';
  /** Whether we won the side-selection 1v1. */
  wonSideSelection?: boolean;
  /** Scouting notes for this opponent. */
  notes?: string;
  /** Target bans for this opponent, kept separate from per-comp bans. */
  bans?: string[];
  /**
   * Their five, once someone has pasted the roster.
   *
   * Kept on the series rather than as players in their own right: an opponent
   * is a fixture, not a member of anything, and a roster that outlives the
   * match it was scouted for goes stale without anyone noticing.
   */
  opponentPlayers?: OpponentPlayer[];
  /** Their games together lately. Absent until fetched. */
  teamHistory?: OpponentTeamHistory;
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
  /** Every champion banned in this game, both sides — order is not meaningful. */
  bans?: string[];
  /**
   * Which side we are on, which decides whether we ban and pick first. Set
   * before the draft — by the 1v1 for game 1, by the previous loser after.
   * Absent means it has not been chosen yet.
   */
  ourSide?: 'blue' | 'red';
  /**
   * How far through the twenty-step draft this game is. Absent on games saved
   * before the sequence existed, which open at the start rather than appearing
   * finished — see `stepAt`.
   */
  draftStep?: number;
  /**
   * The champion held for confirmation right now, so a teammate watching the
   * draft from a shared link sees what is being considered before it lands.
   * Cleared on confirm, cancel, undo and reset; absent means nothing held.
   */
  holding?: string;
  /**
   * The advisor's last answer for this game, kept so it survives a reload and
   * reaches a teammate on the shared link. `step` is the draft step it was
   * asked at; the room marks it stale once the board moves past that.
   */
  advice?: SavedDraftAdvice;
  /**
   * Picks in the order they were confirmed, both teams, so Undo takes back
   * the most recent pick. Seats are keyed by role, so "the highest filled
   * seat" was the wrong guess more often than not (5 Sep 2026).
   */
  pickLog?: string[];
  win?: boolean;
  /**
   * The replay imported against this game — a stored scrim's id. Customs
   * never reach the Riot API, so the replay file is the only record; the
   * Games page reads that scrim's numbers under this game (8 Sep 2026).
   */
  matchId?: string;
  order: number;
}

/**
 * A retrospective note about one played match, keyed by Riot's match id.
 *
 * Analysis games are recomputed from Riot on every refresh, so notes cannot
 * live on the game itself — they are stored separately and looked up by id.
 */
/**
 * A game placed under a comp by hand, overriding the champion matcher.
 *
 * Keyed by match so a game has exactly one, the same shape as [MatchNote].
 * Used for off-book games that really were a known comp with a swap, and for
 * the occasional game the matcher reads wrongly.
 */
export interface CompOverride {
  /** Same value as `matchId`, so a match has exactly one override document. */
  id: string;
  matchId: string;
  compId: string;
  order: number;
}

export interface MatchNote {
  /** Same value as `matchId`, so a match has exactly one note document. */
  id: string;
  matchId: string;
  text: string;
  order: number;
}

/**
 * A game the team was messing around in. Tagged by hand on the Games page;
 * Patterns leaves it out unless asked (8 Sep 2026). Absent means serious —
 * the tag exists only for the exceptions.
 */
export interface PracticeGame {
  /** Same value as `matchId`, so a match has exactly one tag document. */
  id: string;
  matchId: string;
  practice: true;
  order: number;
}

/**
 * What a champion is, assembled server-side from CommunityDragon and stored as
 * one document. Mirrors `api/src/champion-traits.ts`.
 */
export type DamageType = 'physical' | 'magic' | 'mixed' | 'unknown';

export interface ChampionTraits {
  /** Data Dragon id, e.g. "MonkeyKing" — the key everything joins on. */
  id: string;
  name: string;
  damage: DamageType;
  attack: 'melee' | 'ranged' | 'unknown';
  roles: string[];
  cc: number;
  mobility: number;
  durability: number;
  utility: number;
}

/** The stored map, refreshed weekly by `refreshChampionTraits`. */
export interface ChampionTraitMap {
  traits: Record<string, ChampionTraits>;
  updatedAt: string;
  source: string;
}

/**
 * One player's line in a scrim scoreboard, read from a replay file.
 *
 * Mirrors what `.rofl` actually carries rather than what the Riot API returns —
 * they overlap but are not the same shape, and pretending otherwise would mean
 * inventing fields the file does not have.
 */
export interface ScrimPlayer {
  /** Riot game name, without the tag. */
  name: string;
  tag: string;
  /** Riot's internal champion name — "MonkeyKing", not "Wukong". */
  champion: string;
  /** 100 blue, 200 red. */
  team: number;
  win: boolean;
  position: string;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  damage: number;
  damageToBuildings: number;
  damageTaken: number;
  visionScore: number;
  cs: number;
}

/**
 * A scrim, imported from a replay file.
 *
 * Custom games never enter the Riot API, so this is the only way any of them
 * reach the app — and scrims are where the team actually practises. Kept apart
 * from tournament series on purpose: a scrim has no bracket, no best-of and no
 * fearless burn, and filing one as a series meant inventing all three.
 */
export interface Scrim {
  /** The match id from the replay filename — the only stable identity it has. */
  id: string;
  /**
   * When it was played, as an ISO date.
   *
   * From the file's modified time, which is a few minutes after the game ended:
   * the replay carries how long the game ran but never when it started.
   */
  playedOn: string;
  durationSec: number;
  blueWon: boolean;
  surrendered?: boolean;
  /** Which side we were on, once someone has said. */
  ourSide?: 'blue' | 'red';
  /** Free text, since a scrim opponent is not a registered anything. */
  opponent?: string;
  note?: string;
  players: ScrimPlayer[];
  /**
   * Objectives per side, so a scrim can be read the way a match is.
   *
   * `firstBlood` and `firstTower` are always false: the replay stats block does
   * not record them and nothing implies them, so two of the eight objective
   * factors simply cannot fire for a scrim. A real gap rather than a default.
   */
  objectives?: { blue: TeamObjectives; red: TeamObjectives };
  order: number;
}
