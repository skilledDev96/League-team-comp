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
  /**
   * Id of another comp this one folds into for stats. Near-duplicate drafts
   * are kept as separate comps to play from, but their games count together.
   */
  countsUnder?: string | null;
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
  /** Share of the team's kills this player was in on, 0-1. */
  killParticipation?: number;
  /** Damage taken. Absent until the match is re-cached at schema v3. */
  damageTaken?: number;
  /** Seconds spent crowd-controlling opponents. Absent below cache v3. */
  ccTime?: number;
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

/** What the last morning refresh did (Firestore `meta/refreshLog`). Mirrors `api/src/daily-refresh.ts`. */
export interface RefreshLog {
  ranAt: string;
  finishedAt: string;
  trigger: 'schedule' | 'manual';
  playersUpdated: string[];
  playersFailed: string[];
  playersSkipped: string[];
  analysis: { ok: boolean; games?: number; newMatches?: number; pending?: number; error?: string };
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
export interface TogetherPick {
  role: Role | '';
  champion: string;
  player: string | null;
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
