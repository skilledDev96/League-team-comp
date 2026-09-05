import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { retryDelayMs, riotError } from './riot-errors';
import { combinations, normalizeEmail, parseBearerToken, parseEnrichRequest, parseSynergyRequest } from './parse-request';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { defineSecret } from 'firebase-functions/params';
import { matchComp } from './comp-match';
import { attributeComp } from './comp-attribution';
import { killParticipation, tallyKills } from './fights';
import { ChampionRecord, summarizeMatches } from './match-stats';
import { classifyArchetype, describePlayer } from './insights';
import { CACHE_VERSION, isCacheCurrent, isCacheUsable, parseCompAnalysisRequest } from './analysis-cache';
import { cachedToMatch, planSample } from './enrich-sample';
import {
  CRAWL_QUEUE,
  CrawledMatch,
  FIRST_CURSOR,
  ALL_TIERS,
  BucketUpdate,
  IDS_PER_PLAYER,
  LadderCursor,
  crawlBudgetAt,
  collectSince,
  MatchTally,
  MatchupUpdate,
  Tier,
  ladderPath,
  matchupDocPath,
  mergeMatchups,
  mergeTallies,
  nextCursor,
  sampleLadder,
  planRun,
  statsDocPath,
  tallyMatch
} from './crawler';
import {
  MAX_HISTORY_CANDIDATES,
  MAX_HISTORY_FETCHES,
  MIN_TOGETHER,
  TEAM_HISTORY_QUEUES,
  TeamHistoryRequest,
  gamesTogether,
  parseTeamHistoryRequest,
  sinceSeconds,
  summariseTogether
} from './team-history';
import { buildIndex, indexDocPath, splitIndexId, RawMatchupDoc } from './matchup-index';
import { describeLoss, describeWin, GameObjectives, LossFactor, WinFactor } from './objectives';
import { ChampionTraits, toTraits } from './champion-traits';
import { BUILD_SHA } from './build-info';
import Anthropic from '@anthropic-ai/sdk';
import { ADVICE_SCHEMA, ADVISOR_SYSTEM, buildDraftPrompt, parseAdvice, parseDraftAdviceRequest } from './draft-advice';
import {
  PLAYER_BUDGET_SECONDS,
  RefreshLog,
  StoredComp,
  StoredOverride,
  StoredPlayer,
  analysisRequestFrom,
  mergePlayer,
  refreshOrder
} from './daily-refresh';

initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

const RIOT_API_KEY = defineSecret('RIOT_API_KEY');
/** For the draft advisor. Set with `firebase functions:secrets:set ANTHROPIC_API_KEY`. */
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

type AccessRole = 'admin' | 'contributor' | 'viewer';
type KnownRole = 'Top' | 'Jungle' | 'Mid' | 'ADC' | 'Support';

interface EnrichRequest {
  summonerName: string;
  riotTag?: string;
  region?: string;
  role?: KnownRole;
  mobalyticsSlug?: string;
}

interface SynergyPlayerRequest {
  id: string;
  name: string;
  riotTag?: string;
  region?: string;
}

interface SynergyRequest {
  players: SynergyPlayerRequest[];
}

/**
 * One queue's champion record, so solo and flex can be read apart.
 *
 * The same five fields the merged response carries, scoped to a single ladder.
 * Every field is optional: a player with no games in a queue has an empty pool
 * there, and that absence is itself worth showing rather than filling in from
 * the other queue.
 */
interface QueuePool {
  top3?: string[];
  bans?: string[];
  positions?: { role: KnownRole; games: number }[];
  poolByRole?: Partial<Record<KnownRole, ChampionRecord[]>>;
  bansByRole?: Partial<Record<KnownRole, ChampionRecord[]>>;
  championRecords?: ChampionRecord[];
  /** How much of the recent history this record is built from. */
  sample?: { read: number; available: number; unread: number };
}

interface EnrichResponse {
  playstyle: string;
  strengths: string[];
  weaknesses: string[];
  role?: KnownRole;
  /**
   * Positions played, most often first, with the games behind each.
   *
   * The counts are the point: "Mid 34, Top 12" is a different player from
   * "Mid 24, Top 22", and only the second is a flex worth drafting around.
   */
  positions?: { role: KnownRole; games: number }[];
  /**
   * Their pool in each seat.
   *
   * So a player who has changed role can be read by the seat they now hold
   * rather than by the one their history is about. Often thin, sometimes
   * absent — which is the honest state of knowledge about a fresh swap.
   */
  poolByRole?: Partial<Record<KnownRole, ChampionRecord[]>>;
  /** Who beats them in each seat, for the same reason as poolByRole. */
  bansByRole?: Partial<Record<KnownRole, ChampionRecord[]>>;
  /** Every champion they played, with games and wins — the fallback pool. */
  championRecords?: ChampionRecord[];
  /** How much of the recent history this record is built from. */
  sample?: { read: number; available: number; unread: number };
  /**
   * Champions played in the last two months, newest first, from mastery.
   *
   * Sees far past the match window — the scan reads a hundred games at most,
   * this reads their whole history — at the cost of carrying no position.
   */
  recentChampions?: string[];
  /**
   * Their highest champion masteries, points descending. Mastery is the
   * all-time record a match scan cannot see: a 400k-point Nautilus is a
   * one-trick whatever the last forty games say. The whole list, not a top
   * twelve: a champion in their pool outside the twelve had no badge, which
   * read as missing data rather than a cap (5 Sep 2026). ~170 rows of three
   * numbers is a few kilobytes per player.
   */
  /* (see note above) */   * one-trick whatever the last forty games say.
   */
  mastery?: MasteryRecord[];
  top3?: string[];
  bans?: string[];
  queueStats?: {
    solo?: QueueStats;
    flex?: QueueStats;
    clash?: QueueStats;
  };
  /**
   * The champion side of the record, kept per queue rather than merged away.
   *
   * Everything above — `top3`, `poolByRole`, `bansByRole`, `championRecords`,
   * `positions` — comes from whichever queue won the merge, and flex wins it.
   * Both queues were already being fetched and fully computed; solo's champion
   * data was then discarded, so a scouting row labelled "plays" was showing a
   * player's *flex* pool and nothing said so. They are different pools for most
   * players, and a team meets its opponents in flex but they grind solo.
   *
   * Populated only for the two ranked queues. Clash is a weekend format and its
   * pool says little about how someone drafts.
   */
  byQueue?: {
    solo?: QueuePool;
    flex?: QueuePool;
  };
  iconUrl?: string;
  source: 'template' | 'provider';
  provider: string;
  generatedAt: string;
}

const BOOTSTRAP_ADMIN_EMAILS = new Set(['ruanhart7@gmail.com']);
const DDRAGON_VERSION = '14.24.1';

// Riot's internal championName (Data Dragon id) doesn't always match the display name we store.
const DDRAGON_TO_DISPLAY: Record<string, string> = {
  Belveth: "Bel'Veth",
  Velkoz: "Vel'Koz",
  DrMundo: 'Dr. Mundo',
  MissFortune: 'Miss Fortune',
  JarvanIV: 'Jarvan IV',
  Kaisa: "Kai'Sa",
  Khazix: "Kha'Zix",
  KogMaw: "Kog'Maw",
  Leblanc: 'LeBlanc',
  Nunu: 'Nunu & Willump',
  RekSai: "Rek'Sai",
  Renata: 'Renata Glasc',
  TahmKench: 'Tahm Kench',
  TwistedFate: 'Twisted Fate',
  XinZhao: 'Xin Zhao',
  AurelionSol: 'Aurelion Sol',
  Chogath: "Cho'Gath",
  MonkeyKing: 'Wukong'
};

// Maps our app's short region code to Riot's platform + regional routing values.
const REGION_ROUTING: Record<string, { platform: string; regional: string }> = {
  euw: { platform: 'euw1', regional: 'europe' },
  eune: { platform: 'eun1', regional: 'europe' },
  tr: { platform: 'tr1', regional: 'europe' },
  ru: { platform: 'ru', regional: 'europe' },
  na: { platform: 'na1', regional: 'americas' },
  br: { platform: 'br1', regional: 'americas' },
  lan: { platform: 'la1', regional: 'americas' },
  las: { platform: 'la2', regional: 'americas' },
  oce: { platform: 'oc1', regional: 'sea' },
  kr: { platform: 'kr', regional: 'asia' },
  jp: { platform: 'jp1', regional: 'asia' }
};

const TEAM_POSITION_TO_ROLE: Record<string, KnownRole> = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MIDDLE: 'Mid',
  BOTTOM: 'ADC',
  UTILITY: 'Support'
};

const ROLE_TEMPLATES: Record<KnownRole, Omit<EnrichResponse, 'generatedAt'>> = {
  Top: {
    playstyle: 'Lane-priority bruiser with side-lane threat and TP timing focus.',
    strengths: ['Strong wave control', 'Reliable flank setups', 'Objective setup discipline'],
    weaknesses: ['Can overextend in side lane', 'Needs cleaner herald-to-drake transitions', 'Vulnerable to early camp pressure'],
    source: 'template',
    provider: 'built-in-role-template'
  },
  Jungle: {
    playstyle: 'Tempo-oriented pathing with objective-first decision making.',
    strengths: ['Good route efficiency', 'Consistent objective tracking', 'High impact early skirmishes'],
    weaknesses: ['Can force low-percentage invades', 'Needs cleaner lane-cover timing', 'Occasional vision debt before objectives'],
    source: 'template',
    provider: 'built-in-role-template'
  },
  Mid: {
    playstyle: 'Wave-control mid with roam windows around jungle pressure.',
    strengths: ['Wave management under pressure', 'Strong river skirmish setups', 'Reliable teamfight positioning'],
    weaknesses: ['Roam timing can be late', 'Can overhold flash for picks', 'Needs tighter side-lane reset timing'],
    source: 'template',
    provider: 'built-in-role-template'
  },
  ADC: {
    playstyle: 'Teamfight carry with spacing-first mindset and objective DPS focus.',
    strengths: ['Consistent damage output', 'Good lane trading patterns', 'Strong late-game positioning'],
    weaknesses: ['Can greed one extra wave', 'Needs cleaner trap around fog', 'Relies heavily on front-to-back setup'],
    source: 'template',
    provider: 'built-in-role-template'
  },
  Support: {
    playstyle: 'Vision-control support enabling engage or peel by draft context.',
    strengths: ['Objective vision discipline', 'Strong engage timing reads', 'Good lane matchup adaptation'],
    weaknesses: ['Can overcommit engage without cooldown checks', 'Roam windows occasionally too early', 'Needs faster ward reset cadence'],
    source: 'template',
    provider: 'built-in-role-template'
  }
};

async function getAccessRoleByEmail(email: string): Promise<AccessRole | null> {
  if (BOOTSTRAP_ADMIN_EMAILS.has(email)) {
    return 'admin';
  }

  const db = getFirestore();
  const snap = await db.doc(`access/${email}`).get();
  if (!snap.exists) {
    return null;
  }

  const data = snap.data() as { role?: AccessRole; active?: boolean } | undefined;
  if (!data?.active || !data.role) {
    return null;
  }

  return data.role;
}

function displayChampionName(riotChampionName: string): string {
  return DDRAGON_TO_DISPLAY[riotChampionName] ?? riotChampionName;
}

/** One champion's mastery, as the app shows it. */
interface MasteryRecord {
  champion: string;
  level: number;
  points: number;
}

interface RiotChampionMastery {
  championId: number;
  championLevel?: number;
  championPoints: number;
  /** Epoch ms of their last game on it. What makes "recently played" possible. */
  lastPlayTime?: number;
}

// DDragon numeric champion id -> display name, fetched once and cached for the
// life of the function instance (DDragon is public, no API key needed).
let championIdToNameCache: Map<number, string> | null = null;

async function getChampionIdToName(): Promise<Map<number, string>> {
  if (championIdToNameCache) return championIdToNameCache;
  const versions = (await (
    await fetch('https://ddragon.leagueoflegends.com/api/versions.json')
  ).json()) as string[];
  const version = versions[0] ?? '14.1.1';
  const payload = (await (
    await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`)
  ).json()) as { data: Record<string, { key: string; name: string }> };
  const map = new Map<number, string>();
  for (const champ of Object.values(payload.data)) {
    map.set(Number(champ.key), champ.name);
  }
  championIdToNameCache = map;
  return map;
}

// Top all-time champion-mastery picks for a player, as display names.
/**
 * Champions they have been playing lately, from mastery rather than matches.
 *
 * The match scan sees a hundred games at most and usually far fewer, so a
 * champion last played six weeks ago is invisible to it. Mastery covers their
 * whole history and carries `lastPlayTime` per champion, so sorting on that
 * answers "what have they been on recently" across everything they own — for a
 * single request. It is what op.gg shows under Mastery filtered by recently
 * played.
 *
 * Carries no position data, so it cannot replace a seat-specific pool. A wider
 * net, not a sharper one.
 */
/** Every champion mastery they hold — one request; the three lists below read from it. */
async function fetchMasteryList(puuid: string, platform: string, apiKey: string): Promise<RiotChampionMastery[]> {
  const masteries = await riotFetch<RiotChampionMastery[]>(
    `https://${platform}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}`,
    apiKey
  );
  return Array.isArray(masteries) ? masteries : [];
}

function recentFromMastery(masteries: RiotChampionMastery[], idToName: Map<number, string>, count: number, withinDays = 60): string[] {
  const since = Date.now() - withinDays * 24 * 60 * 60 * 1000;
  return masteries
    .filter((m) => (m.lastPlayTime ?? 0) >= since)
    .sort((a, b) => (b.lastPlayTime ?? 0) - (a.lastPlayTime ?? 0))
    .map((m) => idToName.get(m.championId))
    .filter((name): name is string => Boolean(name))
    .slice(0, count);
}

function topFromMastery(masteries: RiotChampionMastery[], idToName: Map<number, string>, count: number): string[] {
  return [...masteries]
    .sort((a, b) => b.championPoints - a.championPoints)
    .map((m) => idToName.get(m.championId))
    .filter((name): name is string => Boolean(name))
    .slice(0, count);
}

function recordsFromMastery(masteries: RiotChampionMastery[], idToName: Map<number, string>, count: number): MasteryRecord[] {
  return [...masteries]
    .sort((a, b) => b.championPoints - a.championPoints)
    .map((m) => {
      const champion = idToName.get(m.championId);
      return champion ? { champion, level: m.championLevel ?? 0, points: m.championPoints } : null;
    })
    .filter((r): r is MasteryRecord => !!r)
    .slice(0, count);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function riotFetch<T>(url: string, apiKey: string, retries = 6): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { headers: { 'X-Riot-Token': apiKey } });
    // On rate limit, wait the server-provided window and retry a few times.
    if (response.status === 429 && attempt < retries) {
      await sleep(retryDelayMs(response.headers.get('Retry-After')));
      continue;
    }
    if (!response.ok) {
      throw riotError(response.status, url);
    }
    return (await response.json()) as T;
  }
}

interface RiotAccount {
  puuid: string;
  gameName: string;
  tagLine: string;
}

interface RiotSummoner {
  profileIconId: number;
}

interface RiotLeagueEntry {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
}

interface RankedStats {
  queueType: 'RANKED_SOLO_5x5' | 'RANKED_FLEX_SR';
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  winRate: number;
}

interface MatchStats {
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
  /** Games behind the vision average — below `games` while cache v4 backfills. */
  visionSamples?: number;
  /** Games behind the building-damage average, likewise. */
  buildingSamples?: number;
  playstyle: string;
  strengths: string[];
  weaknesses: string[];
  top3: string[];
  bans: string[];
}

interface QueueStats {
  rank?: RankedStats;
  matches?: MatchStats;
}

type SynergyQueueResponse = 'RANKED_SOLO_5x5' | 'RANKED_FLEX_SR';

interface PremadeGroupResponse {
  playerIds: string[];
  playerNames: string[];
  queueType: SynergyQueueResponse;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  averageKda: number;
  topChampions: string[];
}

interface PremadeAccumulator {
  playerIds: string[];
  playerNames: string[];
  queueType: SynergyQueueResponse;
  games: number;
  wins: number;
  kdaTotal: number;
  champions: Map<string, number>;
}

interface RiotMatchParticipant {
  puuid: string;
  championName: string;
  win: boolean;
  teamId: number;
  teamPosition: string;
  kills: number;
  deaths: number;
  assists: number;
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  totalDamageDealtToChampions: number;
  damageDealtToBuildings: number;
  totalDamageTaken: number;
  visionScore: number;
  /** Seconds spent crowd-controlling opponents. */
  timeCCingOthers: number;
}

/** One objective type in a match's team block: who took it first, and how many. */
interface RiotObjective {
  first: boolean;
  kills: number;
}

interface RiotTeam {
  teamId: number;
  win: boolean;
  objectives: {
    champion: RiotObjective;
    tower: RiotObjective;
    dragon: RiotObjective;
    baron: RiotObjective;
    riftHerald: RiotObjective;
    inhibitor: RiotObjective;
    /** Voidgrubs, absent from matches played before they were added. */
    horde?: RiotObjective;
  };
}

interface RiotMatch {
  info: {
    gameDuration: number;
    gameCreation: number;
    queueId: number;
    participants: RiotMatchParticipant[];
    /** Optional only defensively; every real Summoner's Rift match has two. */
    teams?: RiotTeam[];
  };
}

/**
 * How far back enrichment looks per queue.
 *
 * The old sample was twelve, because twelve was twelve Riot calls. Reading
 * the cache first decouples the two: an id list costs one call per hundred,
 * and every id already cached is free.
 *
 * A hundred is Riot's own ceiling for a single ids request — 'Valid values: 0
 * to 100' — so the window is paged: three calls reach three hundred games,
 * which for an active player is a season rather than a fortnight. What paging
 * does *not* change is the Riot budget: misses are capped separately by
 * MAX_ENRICH_FETCHES per run, so a wider window costs Firestore reads and
 * nothing else — and each scout reads the next batch of what is still unread.
 */
const ENRICH_SAMPLE_SIZE = 100;
const ENRICH_SAMPLE_PAGES = 3;

/**
 * Read many cache entries at once.
 *
 * One `getAll` rather than a read per id: the whole point of going to the
 * cache is that it is cheaper than Riot, and forty sequential document reads
 * would give most of that back in latency.
 */
async function readCachedMatches(ids: readonly string[]): Promise<Map<string, CachedMatch | undefined>> {
  const found = new Map<string, CachedMatch | undefined>();
  if (ids.length === 0) return found;

  const db = getFirestore();
  try {
    const snaps = await db.getAll(...ids.map((id) => db.doc(`matchCache/${id}`)));
    for (const snap of snaps) {
      if (snap.exists) found.set(snap.id, snap.data() as CachedMatch);
    }
  } catch {
    // A cache read failing is not a reason to fail enrichment — it just means
    // every id looks uncached, and the Riot budget covers the sample instead.
  }
  return found;
}

async function fetchRiotQueueEnrichment(
  payload: EnrichRequest,
  apiKey: string,
  statKey: 'solo' | 'flex' | 'clash',
  queueId: number,
  rankedQueueType: 'RANKED_SOLO_5x5' | 'RANKED_FLEX_SR' | null
): Promise<EnrichResponse> {
  const region = payload.region ?? 'euw';
  const routing = REGION_ROUTING[region] ?? REGION_ROUTING['euw'];
  const gameName = payload.summonerName;
  const tagLine = (payload.riotTag || region.toUpperCase()).replace(/^#/, '');

  const account = await riotFetch<RiotAccount>(
    `https://${routing.regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    apiKey
  );

  const summoner = await riotFetch<RiotSummoner>(
    `https://${routing.platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${account.puuid}`,
    apiKey
  );

  // Riot removed the encrypted summoner id from Summoner-V4 responses, which
  // left entries/by-summoner resolving to ".../undefined" and returning 403.
  // The puuid-keyed endpoint is the supported route and needs no summoner id.
  const rankedEntries = await riotFetch<RiotLeagueEntry[]>(
    `https://${routing.platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${account.puuid}`,
    apiKey
  );
  const rankedEntry = rankedQueueType
    ? rankedEntries.find((entry) => entry.queueType === rankedQueueType)
    : undefined;

  // Ask for a wide window: an id page is one call whatever it holds, and most
  // of what comes back may already be in the cache. A short page is the end
  // of their history, so stop there rather than asking for an empty one.
  const matchIds: string[] = [];
  for (let page = 0; page < ENRICH_SAMPLE_PAGES; page += 1) {
    const ids = await riotFetch<string[]>(
      'https://' + routing.regional + '.api.riotgames.com/lol/match/v5/matches/by-puuid/' + account.puuid +
        '/ids?queue=' + queueId + '&start=' + page * ENRICH_SAMPLE_SIZE + '&count=' + ENRICH_SAMPLE_SIZE,
      apiKey
    );
    matchIds.push(...ids);
    if (ids.length < ENRICH_SAMPLE_SIZE) break;
  }

  // Everything the comp analysis has already paid for, read in one batch.
  const plan = planSample(matchIds, await readCachedMatches(matchIds));
  const gathered: CachedMatch[] = [...plan.usable];

  for (const matchId of plan.toFetch) {
    try {
      // Writes through to matchCache, so the next run over this player — and
      // the comp analysis, if it is a team game — gets it for nothing.
      const result = await getCachedMatch(matchId, routing.regional, apiKey, true);
      if (result) gathered.push(result.match);
    } catch {
      // Skip individual match failures (e.g. remake/rate limit) without failing the whole request.
    }
  }

  if (gathered.length === 0) {
    throw new Error('No recent ranked/normal match history found for this Riot ID.');
  }

  const summary = summarizeMatches(gathered.map(cachedToMatch), account.puuid, displayChampionName);
  if (!summary) {
    throw new Error('No recent ranked/normal match history found for this Riot ID.');
  }

  const {
    games,
    winRate,
    avgKills,
    avgDeaths,
    avgAssists,
    avgKda,
    avgCsPerMin,
    avgKillParticipation,
    avgDamageShare,
    avgTankShare,
    avgBuildingDamage,
    avgVisionScore,
    visionSamples,
    buildingSamples
  } = summary;
  const totalWins = summary.wins;

  const top3 = summary.topChampions;
  const detectedRole = summary.mainPosition ? TEAM_POSITION_TO_ROLE[summary.mainPosition] : undefined;

  // Riot labels positions TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY; the app speaks in
  // roles. Anything that does not map is dropped rather than guessed into a seat.
  const positions = summary.positions
    .map((p) => ({ role: TEAM_POSITION_TO_ROLE[p.position], games: p.games }))
    .filter((p): p is { role: KnownRole; games: number } => !!p.role);

  // Their pool per seat, so a player who has changed role can be read by the
  // seat they now hold rather than the one their history happens to be about.
  const poolByRole: Partial<Record<KnownRole, ChampionRecord[]>> = {};
  for (const [position, champions] of Object.entries(summary.championsByPosition)) {
    const role = TEAM_POSITION_TO_ROLE[position];
    if (role) poolByRole[role] = champions;
  }

  // Who beats them in each seat, for the same reason: a ban list from their
  // games at ADC is the wrong list for a player now playing top.
  const bansByRole: Partial<Record<KnownRole, ChampionRecord[]>> = {};
  for (const [position, champions] of Object.entries(summary.banCandidatesByPosition)) {
    const seat = TEAM_POSITION_TO_ROLE[position];
    if (seat) bansByRole[seat] = champions;
  }

  const role = detectedRole ?? payload.role ?? 'Mid';

  // A champion we already play is a pick, not a ban.
  const bans = summary.banCandidates.filter((champ) => !top3.includes(champ)).slice(0, 3);


  const averages = {
    games,
    winRate,
    avgKills,
    avgDeaths,
    avgAssists,
    avgKda,
    avgCsPerMin,
    avgKillParticipation,
    avgDamageShare,
    avgTankShare,
    avgBuildingDamage,
    avgVisionScore
  };
  const { strengths, weaknesses } = describePlayer(averages, top3);
  const archetype = classifyArchetype(averages, role);

  return {
    playstyle: archetype,
    strengths: strengths.slice(0, 3),
    weaknesses: weaknesses.slice(0, 3),
    role,
    positions,
    poolByRole,
    bansByRole,
    championRecords: summary.championRecords,
    sample: { read: gathered.length, available: matchIds.length, unread: plan.skipped },
    top3,
    bans,
    queueStats: {
      [statKey]: {
        rank: rankedEntry && rankedQueueType
          ? {
              queueType: rankedQueueType,
              tier: rankedEntry.tier,
              rank: rankedEntry.rank,
              leaguePoints: rankedEntry.leaguePoints,
              wins: rankedEntry.wins,
              losses: rankedEntry.losses,
              winRate: Math.round((rankedEntry.wins / Math.max(rankedEntry.wins + rankedEntry.losses, 1)) * 100)
            }
          : undefined,
        matches: {
        games,
        wins: totalWins,
        losses: games - totalWins,
        winRate,
        avgKills,
        avgDeaths,
        avgAssists,
        avgKda,
        avgCsPerMin,
        avgKillParticipation,
        avgDamageShare,
        avgTankShare,
        avgBuildingDamage,
        avgVisionScore,
        visionSamples,
        buildingSamples,
        playstyle: archetype,
        strengths: strengths.slice(0, 3),
        weaknesses: weaknesses.slice(0, 3),
        top3,
          bans
        }
      }
    },
    iconUrl: `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${summoner.profileIconId}.jpg`,
    source: 'provider',
    provider: 'riot-api',
    generatedAt: new Date().toISOString()
  };
}

async function fetchRiotEnrichment(payload: EnrichRequest, apiKey: string): Promise<EnrichResponse> {
  const [solo, flex, clash] = await Promise.allSettled([
    fetchRiotQueueEnrichment(payload, apiKey, 'solo', 420, 'RANKED_SOLO_5x5'),
    fetchRiotQueueEnrichment(payload, apiKey, 'flex', 440, 'RANKED_FLEX_SR'),
    fetchRiotQueueEnrichment(payload, apiKey, 'clash', 700, null)
  ]);

  const soloStats = solo.status === 'fulfilled' ? solo.value : undefined;
  const flexStats = flex.status === 'fulfilled' ? flex.value : undefined;
  const clashStats = clash.status === 'fulfilled' ? clash.value : undefined;
  const primary = flexStats ?? soloStats ?? clashStats;

  if (!primary) {
    const reason = [solo, flex, clash]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => (result.reason instanceof Error ? result.reason.message : 'queue request failed'))
      .join('; ');
    throw new Error(reason || 'No ranked data found for this Riot ID.');
  }

  // Champion pool: prefer all-time champion mastery (a truer "pool" than the
  // last dozen games). Falls back to recent most-played if mastery is
  // unavailable (new champ not yet in the cached DDragon version, API hiccup…).
  let masteryPool: string[] = [];
  let recentPool: string[] = [];
  let masteryRecords: MasteryRecord[] = [];
  try {
    const region = payload.region ?? 'euw';
    const routing = REGION_ROUTING[region] ?? REGION_ROUTING['euw'];
    const gameName = payload.summonerName;
    const tagLine = (payload.riotTag || region.toUpperCase()).replace(/^#/, '');
    const account = await riotFetch<RiotAccount>(
      `https://${routing.regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      apiKey
    );
    // One mastery request serves all three lists: the all-time pool, what
    // they have touched lately, and the mastery figures the table shows.
    const masteries = await fetchMasteryList(account.puuid, routing.platform, apiKey);
    const idToName = await getChampionIdToName();
    masteryPool = topFromMastery(masteries, idToName, 5);
    // Everything they have touched in the last two months, newest first. One
    // request, and it sees far past the hundred-game match window — a champion
    // played six weeks ago is invisible to the scan but obvious here.
    recentPool = recentFromMastery(masteries, idToName, 8);
    masteryRecords = recordsFromMastery(masteries, idToName, Number.MAX_SAFE_INTEGER);
  } catch {
    // Keep the recent most-played pool from `primary`.
  }

  return {
    ...primary,
    /**
     * Recent play first, mastery only as a fallback.
     *
     * This used to prefer mastery, which is an all-time total and so answers
     * "what have they ever played" — a support who spent a season on ADC still
     * reads as Kai'Sa, Jinx, Miss Fortune years later. For drafting, what they
     * have been playing lately is the question, and it was already computed.
     * The bans depend on this too: they are ban candidates *not* in the pool,
     * so a stale pool quietly suggests banning champions the player mains.
     *
     * Mastery still covers the case the match scan cannot: a player with no
     * recent games in the queues we look at.
     */
    top3: primary.top3?.length ? primary.top3 : masteryPool,
    recentChampions: recentPool,
    mastery: masteryRecords,
    queueStats: {
      solo: soloStats?.queueStats?.solo,
      flex: flexStats?.queueStats?.flex,
      clash: clashStats?.queueStats?.clash
    },
    // Both queues were already computed in full; only one survived the merge.
    // Carrying both costs nothing but the bytes and is the difference between
    // "what they play" and "what they play in the queue we happened to prefer".
    byQueue: {
      solo: queuePool(soloStats),
      flex: queuePool(flexStats)
    }
  };
}

/**
 * Lift one queue's champion data out of its enrichment result.
 *
 * Returns nothing at all when the queue produced no champion data, so an
 * unranked-in-flex player shows an empty row rather than a row of zeroes that
 * looks like a record.
 */
function queuePool(stats: EnrichResponse | undefined): QueuePool | undefined {
  if (!stats) return undefined;
  const pool: QueuePool = {
    top3: stats.top3,
    bans: stats.bans,
    positions: stats.positions,
    poolByRole: stats.poolByRole,
    bansByRole: stats.bansByRole,
    championRecords: stats.championRecords,
    sample: stats.sample
  };
  const hasAnything =
    pool.top3?.length ||
    pool.championRecords?.length ||
    pool.positions?.length ||
    Object.keys(pool.poolByRole ?? {}).length;
  return hasAnything ? pool : undefined;
}

function fallbackByRole(role: KnownRole | undefined, reason: string): EnrichResponse {
  const template = ROLE_TEMPLATES[role ?? 'Mid'];
  return {
    ...template,
    provider: `template-fallback: ${reason}`,
    generatedAt: new Date().toISOString()
  };
}

async function enrichPlayerProfile(payload: EnrichRequest, apiKey: string | undefined): Promise<EnrichResponse> {
  if (!apiKey) {
    return fallbackByRole(payload.role, 'RIOT_API_KEY not configured');
  }
  try {
    return await fetchRiotEnrichment(payload, apiKey);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown error';
    return fallbackByRole(payload.role, reason);
  }
}

export const enrichPlayer = onRequest({ cors: true, secrets: [RIOT_API_KEY], timeoutSeconds: 300 }, async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    const idToken = parseBearerToken(req.headers.authorization);
    if (!idToken) {
      res.status(401).json({ error: 'Missing Authorization: Bearer <ID_TOKEN> header.' });
      return;
    }

    const auth = getAuth();
    const decoded = await auth.verifyIdToken(idToken);
    const email = normalizeEmail(decoded.email);
    if (!email) {
      res.status(401).json({ error: 'Authenticated user has no email claim.' });
      return;
    }

    const role = await getAccessRoleByEmail(email);
    if (role !== 'admin' && role !== 'contributor') {
      res.status(403).json({ error: 'Insufficient role. Admin or contributor required.' });
      return;
    }

    const payload = parseEnrichRequest(req.body);
    const enriched = await enrichPlayerProfile(payload, RIOT_API_KEY.value());
    res.status(200).json(enriched);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    res.status(400).json({ error: message });
  }
});

async function getSynergyGroups(payload: SynergyRequest, apiKey: string): Promise<PremadeGroupResponse[]> {
  const firstRegion = payload.players[0].region ?? 'euw';
  const routing = REGION_ROUTING[firstRegion] ?? REGION_ROUTING.euw;
  const identities = await Promise.all(payload.players.map(async (player) => {
    const tagLine = (player.riotTag || firstRegion.toUpperCase()).replace(/^#/, '');
    const account = await riotFetch<RiotAccount>(
      `https://${routing.regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(player.name)}/${encodeURIComponent(tagLine)}`,
      apiKey
    );
    return { ...player, puuid: account.puuid };
  }));
  const byPuuid = new Map(identities.map((player) => [player.puuid, player]));
  const matchIdsByQueue = new Map<SynergyQueueResponse, Set<string>>();

  for (const [queueType, queueId] of [['RANKED_FLEX_SR', 440], ['RANKED_SOLO_5x5', 420] ] as const) {
    const ids = new Set<string>();
    for (const player of identities) {
      const matchIds = await riotFetch<string[]>(
        `https://${routing.regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${player.puuid}/ids?queue=${queueId}&start=0&count=20`,
        apiKey
      );
      matchIds.forEach((matchId) => ids.add(matchId));
    }
    matchIdsByQueue.set(queueType, ids);
  }

  const groups = new Map<string, PremadeAccumulator>();
  for (const [queueType, matchIds] of matchIdsByQueue) {
    for (const matchId of matchIds) {
      let match: RiotMatch;
      try {
        match = await riotFetch<RiotMatch>(
          `https://${routing.regional}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
          apiKey
        );
      } catch {
        continue;
      }
      const rosterParticipants = match.info.participants.filter((participant) => byPuuid.has(participant.puuid));
      const teamGroups = new Map<number, RiotMatchParticipant[]>();
      for (const participant of rosterParticipants) {
        const members = teamGroups.get(participant.teamId) ?? [];
        members.push(participant);
        teamGroups.set(participant.teamId, members);
      }
      for (const members of teamGroups.values()) {
        if (members.length < 2) continue;
        for (let size = 2; size <= members.length; size += 1) {
          for (const subset of combinations(members, size)) {
            const playerIds = subset.map((member) => byPuuid.get(member.puuid)!.id).sort();
            const key = `${queueType}:${playerIds.join('|')}`;
            const accumulator = groups.get(key) ?? {
              playerIds,
              playerNames: playerIds.map((id) => identities.find((player) => player.id === id)!.name),
              queueType,
              games: 0,
              wins: 0,
              kdaTotal: 0,
              champions: new Map<string, number>()
            };
            accumulator.games += 1;
            if (subset[0].win) accumulator.wins += 1;
            for (const member of subset) {
              accumulator.kdaTotal += member.deaths > 0 ? (member.kills + member.assists) / member.deaths : member.kills + member.assists;
              accumulator.champions.set(member.championName, (accumulator.champions.get(member.championName) ?? 0) + 1);
            }
            groups.set(key, accumulator);
          }
        }
      }
    }
  }
  return [...groups.values()]
    .filter((group) => group.games > 0)
    .map((group) => ({
      playerIds: group.playerIds,
      playerNames: group.playerNames,
      queueType: group.queueType,
      games: group.games,
      wins: group.wins,
      losses: group.games - group.wins,
      winRate: Math.round((group.wins / group.games) * 100),
      averageKda: group.kdaTotal / group.games / group.playerIds.length,
      topChampions: [...group.champions.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([champion]) => displayChampionName(champion))
    }))
    .sort((a, b) => b.games - a.games);
}

export const getTeamSynergy = onRequest({ cors: true, secrets: [RIOT_API_KEY], timeoutSeconds: 300 }, async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }
  try {
    const idToken = parseBearerToken(req.headers.authorization);
    if (!idToken) {
      res.status(401).json({ error: 'Missing Authorization: Bearer <ID_TOKEN> header.' });
      return;
    }
    const decoded = await getAuth().verifyIdToken(idToken);
    const email = normalizeEmail(decoded.email);
    const role = await getAccessRoleByEmail(email);
    if (!role) {
      res.status(403).json({ error: 'Insufficient role. Viewer access required.' });
      return;
    }
    const payload = parseSynergyRequest(req.body);
    const groups = await getSynergyGroups(payload, RIOT_API_KEY.value());
    res.status(200).json({ groups, generatedAt: new Date().toISOString(), provider: 'riot-api' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    res.status(400).json({ error: message });
  }
});

// ---- Opponent team history (their five together, lately) ---------------------

/**
 * The games their five queued together in the last N days. Match ids come one
 * call per player per team queue with Riot's startTime; details go through
 * the match cache like everything else, so a re-run costs only what is new.
 */
export const getOpponentHistory = onRequest({ cors: true, secrets: [RIOT_API_KEY], timeoutSeconds: 300 }, async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }
  try {
    const idToken = parseBearerToken(req.headers.authorization);
    if (!idToken) {
      res.status(401).json({ error: 'Missing Authorization: Bearer <ID_TOKEN> header.' });
      return;
    }
    const decoded = await getAuth().verifyIdToken(idToken);
    const email = normalizeEmail(decoded.email);
    const role = await getAccessRoleByEmail(email);
    if (!role) {
      res.status(403).json({ error: 'Insufficient role. Viewer access required.' });
      return;
    }
    const payload = parseTeamHistoryRequest(req.body);
    const result = await computeOpponentHistory(payload, RIOT_API_KEY.value());
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    res.status(400).json({ error: message });
  }
});

async function computeOpponentHistory(payload: TeamHistoryRequest, apiKey: string) {
  const firstRegion = payload.players[0]?.region ?? 'euw';
  const routing = REGION_ROUTING[firstRegion] ?? REGION_ROUTING.euw;

  // One name that Riot does not know must not sink the other four: a typo in
  // a pasted roster is common and the rest of the team is still worth reading.
  const unresolved: string[] = [];
  const identities = (
    await Promise.all(
      payload.players.map(async (player) => {
        const tagLine = (player.riotTag || firstRegion.toUpperCase()).replace(/^#/, '');
        try {
          const account = await riotFetch<RiotAccount>(
            'https://' + routing.regional + '.api.riotgames.com/riot/account/v1/accounts/by-riot-id/' +
              encodeURIComponent(player.name) + '/' + encodeURIComponent(tagLine),
            apiKey
          );
          return { ...player, puuid: account.puuid };
        } catch {
          unresolved.push(player.name + '#' + tagLine);
          return null;
        }
      })
    )
  ).filter((i): i is SynergyPlayerRequest & { puuid: string } => i !== null);

  const minTogether = Math.min(MIN_TOGETHER, identities.length);
  if (identities.length < 2) {
    throw new Error('Riot could not find enough of them: ' + unresolved.join(', '));
  }
  const nameByPuuid = new Map(identities.map((i) => [i.puuid, i.name]));
  const since = sinceSeconds(payload.days);

  const counts = new Map<string, number>();
  for (const queueId of TEAM_HISTORY_QUEUES) {
    for (const player of identities) {
      let ids: string[] = [];
      try {
        ids = await riotFetch<string[]>(
          'https://' + routing.regional + '.api.riotgames.com/lol/match/v5/matches/by-puuid/' + player.puuid +
            '/ids?queue=' + queueId + '&startTime=' + since + '&start=0&count=100',
          apiKey
        );
      } catch {
        continue; // a rate-limited page costs this player this queue, not the run
      }
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const candidates = [...counts.entries()]
    .filter(([, n]) => n >= minTogether)
    .map(([id]) => id)
    .sort()
    .reverse()
    .slice(0, MAX_HISTORY_CANDIDATES);

  let fetched = 0;
  let pending = 0;
  const matches: { id: string; match: CachedMatch }[] = [];
  for (const id of candidates) {
    const result = await getCachedMatch(id, routing.regional, apiKey, fetched < MAX_HISTORY_FETCHES);
    if (!result) {
      pending += 1;
      continue;
    }
    if (!result.fromCache) fetched += 1;
    matches.push({ id, match: result.match });
  }

  const games = gamesTogether(matches, nameByPuuid, minTogether);
  return {
    days: payload.days,
    since: new Date(since * 1000).toISOString(),
    players: identities.map((i) => i.name),
    unresolved,
    games,
    summary: summariseTogether(games, identities.length),
    pending,
    generatedAt: new Date().toISOString()
  };
}

// ---- Comp analysis (real win rates from full-5-stack team games) ----------

// Queues the team actually plays as a full 5-stack: Ranked Flex and weekend
// Clash. Keeping this tight matters — every extra queue multiplies the match-id
// scan calls, and rate-limited scans silently drop a player from a game's count.
const TEAM_QUEUES = [440, 700];
// Match-id pagination: how deep to look per player/queue (pages of 100).
const MATCH_ID_PAGE_SIZE = 100;
const MAX_MATCH_ID_PAGES = 4;
// Per-run budget of *new* (uncached) matches to fetch, so one run stays under
// the rate limit and function timeout. Re-run Refresh to fetch the next batch;
// already-cached matches are always processed regardless of this budget.
const MAX_NEW_FETCHES = 40;
// A played comp is credited to a defined comp when at least this many champs overlap.
const COMP_MATCH_THRESHOLD = 3;

interface CompInput {
  id: string;
  name: string;
  champions: string[];
  /** Id of the comp this one folds into, for near-duplicates kept as separate drafts. */
  countsUnder?: string | null;
}

interface CompAnalysisRequest {
  players: SynergyPlayerRequest[];
  comps: CompInput[];
  /** matchId -> compId, for games a person has placed by hand. */
  overrides: Record<string, string>;
}

interface CompPerformanceResponse {
  compId: string;
  compName: string;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
}

interface AnalysisPlayerResponse {
  name: string;
  position: string;
  champion: string;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damage: number;
  /**
   * Share of the team's kills this player was in on, 0-1. Computed from cached
   * kills and assists rather than Riot's `challenges.killParticipation`, which
   * is absent on older matches — so this works on every game.
   */
  killParticipation?: number;
  /** Damage taken. Absent until the match is re-cached at schema v3. */
  damageTaken?: number;
  /** Seconds spent crowd-controlling opponents. Absent below cache v3. */
  ccTime?: number;
  /**
   * Absent below cache v4. Stored so player enrichment can read its sample
   * from here rather than spending a Riot call per match; anything averaging
   * it must count its own sample, because missing is not zero.
   */
  visionScore?: number;
  /** Absent below cache v4, and for the same reason. */
  buildingDamage?: number;
}

interface AnalysisGameResponse {
  matchId: string;
  compId: string | null;
  compName: string | null;
  // Closest defined comp even when below the match threshold, for off-book hints.
  nearCompName: string | null;
  nearOverlap: number;
  /** Comps tied at the same overlap; length > 1 means attribution is ambiguous. */
  tiedNames?: string[];
  // Roster members on our team this game (5 = full stack, 4 = a sub was in).
  rosterCount: number;
  win: boolean;
  side: 'blue' | 'red';
  enemyChampions: string[];
  /** The enemy five with their roles, sorted, for a lane-by-lane comparison. */
  enemies?: { position: string; champion: string }[];
  queue: string;
  date: number;
  players: AnalysisPlayerResponse[];
  /** Objective split. Absent while a match is still on a pre-v2 cache entry. */
  objectives?: GameObjectives;
  /** Seconds; pairs with `objectives` and shares its absence. */
  durationSec?: number;
  /** Set when a person placed this game rather than the matcher. */
  attribution?: 'manual' | 'alias';
  /** Why this game was lost. Empty for a win, and for a loss with no story. */
  lossFactors?: LossFactor[];
  /** Why this game was won. Empty for a loss, and for a win with no story. */
  winFactors?: WinFactor[];
  /** The fight scoreline: our kills against theirs. */
  kills?: { ours: number; theirs: number };
}

/**
 * Our side and theirs, or null for a cached match written before objectives
 * were stored — those heal on their next refresh rather than being re-fetched
 * eagerly, so the review page fills in over a few passes.
 */
function gameObjectives(match: CachedMatch, rosterTeamId: number): GameObjectives | null {
  const ours = match.teams?.find((t) => t.teamId === rosterTeamId);
  const theirs = match.teams?.find((t) => t.teamId !== rosterTeamId);
  return ours && theirs ? { ours, theirs } : null;
}

// Human labels for match queues (a few extras in case a cached match has them).
const QUEUE_LABEL: Record<number, string> = {
  // Custom games are queue 0, which is exactly what a scrim is.
  0: 'Scrim',
  440: 'Flex',
  700: 'Clash',
  400: '5v5 Draft',
  430: '5v5 Blind',
  490: '5v5 Quickplay'
};

// A finished match never changes, so we cache the fields we need in Firestore
// and only fetch a match from Riot the first time we see it.
interface CachedParticipant {
  puuid: string;
  championName: string;
  win: boolean;
  teamId: number;
  teamPosition: string;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damage: number;
  /** Damage taken. Absent below cache v3; the UI shows a dash rather than a zero. */
  damageTaken?: number;
  /** Seconds spent crowd-controlling opponents. Absent below cache v3. */
  ccTime?: number;
}

/** One side's objective haul, cached so a loss can be explained without a re-fetch. */
interface CachedTeam {
  teamId: number;
  firstBlood: boolean;
  firstTower: boolean;
  dragons: number;
  barons: number;
  heralds: number;
  grubs: number;
  towers: number;
  inhibitors: number;
}

interface CachedMatch {
  /** Schema stamp. Absent means a legacy entry written before versioning. */
  cacheVersion?: number;
  queueId: number;
  gameCreation: number;
  participants: CachedParticipant[];
  /** Seconds. Separates an early collapse from a long game that got away. */
  durationSec?: number;
  /** Both sides, by teamId (100 blue, 200 red). Absent on v1 entries. */
  teams?: CachedTeam[];
}

/** Riot reports every objective the same way, so read them the same way. */
function cacheTeam(team: RiotTeam): CachedTeam {
  const o = team.objectives;
  return {
    teamId: team.teamId,
    firstBlood: o.champion?.first ?? false,
    firstTower: o.tower?.first ?? false,
    dragons: o.dragon?.kills ?? 0,
    barons: o.baron?.kills ?? 0,
    heralds: o.riftHerald?.kills ?? 0,
    grubs: o.horde?.kills ?? 0,
    towers: o.tower?.kills ?? 0,
    inhibitors: o.inhibitor?.kills ?? 0
  };
}

async function getCachedMatch(
  matchId: string,
  regional: string,
  apiKey: string,
  allowFetch: boolean
): Promise<{ match: CachedMatch; fromCache: boolean; healed: boolean } | null> {
  const ref = getFirestore().doc(`matchCache/${matchId}`);
  const snap = await ref.get();
  let healed = false;
  if (snap.exists) {
    const cached = snap.data() as CachedMatch;
    healed = true; // an entry existed; if we fall through we are repairing it
    if (isCacheCurrent(cached)) {
      return { match: cached, fromCache: true, healed: false };
    }
    // Out of date: re-fetch it if there is budget (counts like a new match), so
    // the fields added since it was written fill in.
    if (!allowFetch) {
      // Out of budget this run. Serve the stale entry anyway if it is sound —
      // it still carries the roster and the result, and dropping it would take
      // the game out of every win rate to gain nothing this run. It is picked
      // up by a later run instead.
      return isCacheUsable(cached) ? { match: cached, fromCache: true, healed: false } : null;
    }
  } else if (!allowFetch) {
    return null;
  }
  const raw = await riotFetch<RiotMatch>(
    `https://${regional}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
    apiKey
  );
  const match: CachedMatch = {
    cacheVersion: CACHE_VERSION,
    queueId: raw.info.queueId,
    gameCreation: raw.info.gameCreation,
    durationSec: raw.info.gameDuration,
    teams: (raw.info.teams ?? []).map(cacheTeam),
    participants: raw.info.participants.map((p) => ({
      puuid: p.puuid,
      championName: p.championName,
      win: p.win,
      teamId: p.teamId,
      teamPosition: p.teamPosition,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      cs: p.totalMinionsKilled + p.neutralMinionsKilled,
      damage: p.totalDamageDealtToChampions,
      damageTaken: p.totalDamageTaken ?? 0,
      ccTime: p.timeCCingOthers ?? 0,
      visionScore: p.visionScore ?? 0,
      buildingDamage: p.damageDealtToBuildings ?? 0
    }))
  };
  await ref.set(match);
  return { match, fromCache: false, healed };
}

/**
 * Firestore rejects undefined values outright, which fails the whole write. The
 * frontend already strips before persisting; do the same here so one optional
 * field can never cost a full analysis run.
 */
function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefinedDeep(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefinedDeep(v);
    }
    return out as T;
  }
  return value;
}

/** Stage-by-stage audit of one analysis pass, so silent drops are visible. */
interface AnalysisFunnel {
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

interface CompAnalysisResponse {
  comps: CompPerformanceResponse[];
  games: AnalysisGameResponse[];
  totalTeamGames: number;
  scannedMatches: number;
  newMatches: number;
  pendingMatches: number;
  funnel?: AnalysisFunnel;
  /** Git SHA the backend was deployed from, to spot frontend/backend drift. */
  backendSha?: string;
  generatedAt: string;
}

async function computeCompAnalysis(
  payload: CompAnalysisRequest,
  apiKey: string
): Promise<CompAnalysisResponse> {
  const firstRegion = payload.players[0]?.region ?? 'euw';
  const routing = REGION_ROUTING[firstRegion] ?? REGION_ROUTING.euw;

  const identities = await Promise.all(
    payload.players.map(async (player) => {
      const tagLine = (player.riotTag || firstRegion.toUpperCase()).replace(/^#/, '');
      const account = await riotFetch<RiotAccount>(
        `https://${routing.regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(player.name)}/${encodeURIComponent(tagLine)}`,
        apiKey
      );
      return { ...player, puuid: account.puuid };
    })
  );
  const rosterPuuids = new Set(identities.map((i) => i.puuid));
  const nameByPuuid = new Map(identities.map((i) => [i.puuid, i.name]));

  // Scrims, imported from replay files by the browser. Custom games never enter
  // the Riot API, so this is the only way they reach the analysis — and they are
  // where the team actually practises for the tournament.
  //
  // Converted to a match rather than analysed separately: that way a scrim goes
  // through the same comp attribution, the same thresholds and the same factor
  // logic as a Riot game, and everything downstream picks it up without knowing
  // scrims exist. The alternative was a second copy of objectives.ts in the
  // browser, drifting from this one.
  const puuidByRiotId = new Map(
    identities.map((i) => [
      `${i.name}#${(i.riotTag ?? '').replace(/^#/, '')}`.toLowerCase(),
      i.puuid
    ])
  );
  const scrimMatches = new Map<string, CachedMatch>();
  try {
    const snap = await getFirestore().collection('scrims').get();
    for (const doc of snap.docs) {
      const scrim = { id: doc.id, ...(doc.data() as Omit<StoredScrim, 'id'>) };
      const asMatch = scrimAsMatch(scrim, puuidByRiotId);
      if (asMatch) scrimMatches.set(scrim.id, asMatch);
    }
  } catch {
    // A failed scrim read must not cost the whole analysis: the Riot games are
    // the bulk of it and stand perfectly well on their own.
  }
  // A game counts as "ours" when at least this many roster members are on the
  // same team — 4, so 4-of-5 stacks (a sub or one player absent) still count,
  // not just clean 5-premades. Games with a sub are flagged via rosterCount.
  const teamMin = Math.min(4, identities.length);

  // Count how many roster members share each match id — a stack shows up in each
  // member's history, so we only pull detail for matches with enough overlap.
  const matchIdCounts = new Map<string, number>();
  for (const queueId of TEAM_QUEUES) {
    for (const player of identities) {
      for (let page = 0; page < MAX_MATCH_ID_PAGES; page += 1) {
        let ids: string[];
        try {
          ids = await riotFetch<string[]>(
            `https://${routing.regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${player.puuid}/ids?queue=${queueId}&start=${page * MATCH_ID_PAGE_SIZE}&count=${MATCH_ID_PAGE_SIZE}`,
            apiKey
          );
        } catch {
          break; // Stop paging this player/queue on error (e.g. rate limit).
        }
        for (const id of ids) {
          matchIdCounts.set(id, (matchIdCounts.get(id) ?? 0) + 1);
        }
        if (ids.length < MATCH_ID_PAGE_SIZE) break; // No more history.
      }
    }
  }
  // Candidates: at least `teamMin` roster present, most recent first.
  const candidateIds: string[] = [
    // Scrims first: they cost no Riot call, so they can never be squeezed out
    // by the per-run fetch budget the way a new Riot match can.
    ...scrimMatches.keys(),
    ...[...matchIdCounts.entries()]
      .filter(([, count]) => count >= teamMin)
      .map(([id]) => id)
      .sort()
      .reverse()
  ];

  const perComp = new Map<string, { compId: string; compName: string; games: number; wins: number }>();
  const games: AnalysisGameResponse[] = [];
  // Permanent audit trail of the analysis pass. A silent drop (like the corrupt
  // match cache) shows up here as a non-zero reason instead of a missing game.
  const funnel: AnalysisFunnel = {
    candidates: 0,
    servedFromCache: 0,
    fetchedFromRiot: 0,
    selfHealed: 0,
    passedTeamMin: 0,
    attributedToComp: 0,
    dropped: { fetch_failed: 0, budget_exhausted: 0, no_roster_in_match: 0, below_team_min: 0 }
  };
  let totalTeamGames = 0;
  let scannedMatches = 0;
  let newMatches = 0;
  let pendingMatches = 0;

  // Riot's position labels vary; normalise them and keep a role order for display.
  const roleOrder: Record<string, number> = { Top: 0, Jungle: 1, Mid: 2, ADC: 3, Support: 4 };

  funnel.candidates = candidateIds.length;

  for (const matchId of candidateIds) {
    let match: CachedMatch;
    try {
      // Only fetch new matches while we're under the per-run budget; cached ones
      // are always processed. Anything skipped is reported as pending.
      // A scrim is already in hand — no cache entry to read, no Riot call to
      // spend, and no budget to check.
      const scrim = scrimMatches.get(matchId);
      const result = scrim
        ? { match: scrim, fromCache: true, healed: false }
        : await getCachedMatch(matchId, routing.regional, apiKey, newMatches < MAX_NEW_FETCHES);
      if (!result) {
        pendingMatches += 1;
        funnel.dropped.budget_exhausted += 1;
        continue;
      }
      match = result.match;
      if (result.fromCache) {
        funnel.servedFromCache += 1;
      } else {
        newMatches += 1;
        funnel.fetchedFromRiot += 1;
        if (result.healed) funnel.selfHealed += 1;
      }
    } catch {
      pendingMatches += 1;
      funnel.dropped.fetch_failed += 1;
      continue;
    }
    scannedMatches += 1;
    const rosterParticipants = match.participants.filter((p) => rosterPuuids.has(p.puuid));
    const byTeam = new Map<number, CachedParticipant[]>();
    for (const participant of rosterParticipants) {
      const members = byTeam.get(participant.teamId) ?? [];
      members.push(participant);
      byTeam.set(participant.teamId, members);
    }
    // The team with the most roster members on it is "our" side this game.
    let teamParts: CachedParticipant[] | null = null;
    for (const members of byTeam.values()) {
      if (!teamParts || members.length > teamParts.length) teamParts = members;
    }
    const rosterCount = teamParts?.length ?? 0;
    // A cached match that survived the heal but still shows nobody is the exact
    // silent-drop signature of the old corrupt-cache bug — count it distinctly.
    if (rosterParticipants.length === 0) {
      funnel.dropped.no_roster_in_match += 1;
      continue;
    }
    if (!teamParts || rosterCount < teamMin) {
      funnel.dropped.below_team_min += 1;
      continue;
    }
    funnel.passedTeamMin += 1;

    totalTeamGames += 1;
    const win = teamParts[0].win;
    const rosterTeamId = teamParts[0].teamId;
    const side: 'blue' | 'red' = rosterTeamId === 100 ? 'blue' : 'red';
    const objectives = gameObjectives(match, rosterTeamId);
    const durationSec = match.durationSec ?? 0;
    // Read from participants we already cache, so this needed no re-fetch and
    // applies to every game rather than only the freshly cached ones.
    const fights = tallyKills(match.participants, rosterTeamId);
    const enemyParts = match.participants.filter((p) => p.teamId !== rosterTeamId);
    const enemyChampions = enemyParts.map((p) => displayChampionName(p.championName));
    // The same five again, carrying their role, so the review page can line a
    // draft up against ours lane by lane. Kept beside `enemyChampions` rather
    // than replacing it: the ban suggestions and the tournament planner read
    // that flat list and do not care who played what.
    const enemies = enemyParts
      .map((p) => ({
        position: TEAM_POSITION_TO_ROLE[p.teamPosition] ?? p.teamPosition ?? '',
        champion: displayChampionName(p.championName)
      }))
      .sort((a, b) => (roleOrder[a.position] ?? 9) - (roleOrder[b.position] ?? 9));
    const players: AnalysisPlayerResponse[] = teamParts
      .map((p) => ({
        name: nameByPuuid.get(p.puuid) ?? 'Unknown',
        position: TEAM_POSITION_TO_ROLE[p.teamPosition] ?? p.teamPosition ?? '',
        champion: displayChampionName(p.championName),
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        cs: p.cs,
        damage: p.damage,
        // Conditional spread throughout — Firestore rejects undefined values,
        // and these are absent until the match is re-cached at schema v3.
        ...(killParticipation(p.kills, p.assists, fights.ours) !== null && {
          killParticipation: killParticipation(p.kills, p.assists, fights.ours) as number
        }),
        ...(p.damageTaken !== undefined && { damageTaken: p.damageTaken }),
        ...(p.ccTime !== undefined && { ccTime: p.ccTime })
      }))
      .sort((a, b) => (roleOrder[a.position] ?? 9) - (roleOrder[b.position] ?? 9));

    const compMatch = matchComp(
      players.map((p) => p.champion),
      payload.comps,
      COMP_MATCH_THRESHOLD
    );
    // The matcher reads champions; this applies what people have said about
    // comps folding together and about individual games.
    const attributed = attributeComp(compMatch, matchId, payload.overrides, payload.comps);

    if (attributed.compId) {
      funnel.attributedToComp += 1;
      const acc = perComp.get(attributed.compId) ?? {
        compId: attributed.compId,
        compName: attributed.compName ?? '',
        games: 0,
        wins: 0
      };
      acc.games += 1;
      if (win) acc.wins += 1;
      perComp.set(attributed.compId, acc);
    }
    games.push({
      matchId,
      compId: attributed.compId,
      compName: attributed.compName,
      // Only worth saying when a person is responsible for it; 'auto' is the
      // default everywhere and would just be noise on every game.
      ...(attributed.source !== 'auto' && { attribution: attributed.source }),
      nearCompName: compMatch.nearName,
      nearOverlap: compMatch.overlap,
      // Conditional spread, not `: undefined` — Firestore rejects undefined values.
      ...(compMatch.tiedNames.length > 1 && { tiedNames: compMatch.tiedNames }),
      rosterCount,
      win,
      side,
      enemyChampions,
      enemies,
      queue: QUEUE_LABEL[match.queueId] ?? 'Team',
      date: match.gameCreation,
      players,
      // Conditional spread throughout — Firestore rejects undefined values.
      ...(objectives && {
        objectives,
        durationSec,
        lossFactors: win ? [] : describeLoss(objectives, durationSec, fights),
        winFactors: win ? describeWin(objectives, durationSec, fights) : [],
        kills: fights
      })
    });
  }

  const comps = [...perComp.values()]
    .map((a) => ({
      compId: a.compId,
      compName: a.compName,
      games: a.games,
      wins: a.wins,
      losses: a.games - a.wins,
      winRate: a.games ? Math.round((a.wins / a.games) * 100) : 0
    }))
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate);

  games.sort((a, b) => b.date - a.date);

  return {
    comps,
    games,
    totalTeamGames,
    scannedMatches,
    newMatches,
    pendingMatches,
    funnel,
    backendSha: BUILD_SHA,
    generatedAt: new Date().toISOString()
  };
}

export const getCompAnalysis = onRequest(
  { cors: true, secrets: [RIOT_API_KEY], timeoutSeconds: 300 },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }
    try {
      const idToken = parseBearerToken(req.headers.authorization);
      if (!idToken) {
        res.status(401).json({ error: 'Missing Authorization: Bearer <ID_TOKEN> header.' });
        return;
      }
      const decoded = await getAuth().verifyIdToken(idToken);
      const email = normalizeEmail(decoded.email);
      const role = await getAccessRoleByEmail(email);
      if (role !== 'admin' && role !== 'contributor') {
        res.status(403).json({ error: 'Editor access required to refresh comp analysis.' });
        return;
      }
      const payload = parseCompAnalysisRequest(req.body);
      const analysis = await computeCompAnalysis(payload, RIOT_API_KEY.value());
      // Cache the result so viewers see it without re-running the analysis.
      await getFirestore().doc('meta/compAnalysis').set(stripUndefinedDeep(analysis));
      res.status(200).json(analysis);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error.';
      res.status(400).json({ error: message });
    }
  }
);

// ---- The morning refresh ---------------------------------------------------
//
// Every roster member re-read from Riot and the comp analysis re-run before
// anyone is awake, so the pages open on last night's games rather than on
// whatever someone last clicked Refresh for. The same two jobs the app runs
// by hand — the merge and the request are shared with the frontend's shape in
// `daily-refresh.ts` — with a time budget, because a scheduled function has
// nine minutes and a player costs about one.

async function runTeamRefresh(apiKey: string | undefined, trigger: RefreshLog['trigger']): Promise<RefreshLog> {
  const db = getFirestore();
  const startedAt = Date.now();
  const ranAt = new Date(startedAt).toISOString();

  const [playersSnap, compsSnap, overridesSnap] = await Promise.all([
    db.collection('players').get(),
    db.collection('comps').get(),
    db.collection('compOverrides').get()
  ]);
  const players = playersSnap.docs.map((d) => ({ ...(d.data() as Omit<StoredPlayer, 'id'>), id: d.id }));
  const comps = compsSnap.docs.map((d) => ({ ...(d.data() as Omit<StoredComp, 'id'>), id: d.id }));
  const overrides = overridesSnap.docs.map((d) => d.data() as StoredOverride);

  const log: RefreshLog = {
    ranAt,
    finishedAt: ranAt,
    trigger,
    playersUpdated: [],
    playersFailed: [],
    playersSkipped: [],
    analysis: { ok: false }
  };

  // Players first: enrichment warms the shared match cache, so the analysis
  // that follows spends fewer of its own Riot calls. Oldest refresh first, and
  // whoever does not fit the budget goes first tomorrow.
  for (const player of refreshOrder(players)) {
    const elapsed = (Date.now() - startedAt) / 1000;
    if (elapsed > PLAYER_BUDGET_SECONDS) {
      log.playersSkipped.push(player.name);
      continue;
    }
    try {
      const enriched = await enrichPlayerProfile(
        {
          summonerName: player.name,
          riotTag: player.profile?.riotTag,
          region: player.profile?.region,
          role: player.role,
          mobalyticsSlug: player.profile?.mobalyticsSlug
        },
        apiKey
      );
      // Re-read before merging. A run takes minutes and an editor may have
      // saved this player meanwhile; merging into the copy read at the start
      // wrote that save away, which is how a pool edit "reverted on refresh".
      const freshSnap = await db.doc(`players/${player.id}`).get();
      const fresh: StoredPlayer = freshSnap.exists
        ? { ...(freshSnap.data() as Omit<StoredPlayer, 'id'>), id: player.id }
        : player;
      const merged = mergePlayer(fresh, enriched, new Date().toISOString());
      if (!merged) {
        log.playersFailed.push(player.name);
        continue;
      }
      const { id, ...doc } = merged;
      await db.doc(`players/${id}`).set(stripUndefinedDeep(doc), { merge: true });
      log.playersUpdated.push(player.name);
    } catch (error) {
      console.error(`Morning refresh: ${player.name} failed`, error);
      log.playersFailed.push(player.name);
    }
  }

  try {
    const request = analysisRequestFrom(players, comps, overrides);
    if (request.players.length < 5) {
      throw new Error(`Only ${request.players.length} roster players; the analysis needs five.`);
    }
    const analysis = await computeCompAnalysis(request, apiKey ?? '');
    await db.doc('meta/compAnalysis').set(stripUndefinedDeep(analysis));
    log.analysis = {
      ok: true,
      games: analysis.totalTeamGames,
      newMatches: analysis.newMatches,
      pending: analysis.pendingMatches
    };
  } catch (error) {
    log.analysis = { ok: false, error: error instanceof Error ? error.message : 'Analysis failed.' };
    console.error('Morning refresh: analysis failed', error);
  }

  log.finishedAt = new Date().toISOString();
  await db.doc('meta/refreshLog').set(stripUndefinedDeep(log));
  return log;
}

/**
 * Daily, before anyone is up. The key probe runs at 08:00 and reports a dead
 * key either way; this runs first because a refresh with a dead key fails
 * loudly into the log on its own.
 */
export const refreshTeamData = onSchedule(
  { schedule: 'every day 06:30', timeZone: 'Europe/Amsterdam', secrets: [RIOT_API_KEY], timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const log = await runTeamRefresh(RIOT_API_KEY.value(), 'schedule');
    console.log(
      `Morning refresh: ${log.playersUpdated.length} players updated, ${log.playersFailed.length} failed, ` +
        `${log.playersSkipped.length} skipped; analysis ${log.analysis.ok ? 'ok' : 'failed'}.`
    );
  }
);

/**
 * The same run on demand, for an editor. Runs server-side to completion, so
 * closing the tab does not stop it — which is the difference from the app's
 * own Refresh all, and the reason both exist.
 */
export const refreshTeamDataOnce = onRequest(
  { cors: true, secrets: [RIOT_API_KEY], timeoutSeconds: 540, memory: '512MiB' },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }
    try {
      const idToken = parseBearerToken(req.headers.authorization);
      if (!idToken) {
        res.status(401).json({ error: 'Missing Authorization: Bearer <ID_TOKEN> header.' });
        return;
      }
      const decoded = await getAuth().verifyIdToken(idToken);
      const email = normalizeEmail(decoded.email);
      const role = await getAccessRoleByEmail(email);
      if (role !== 'admin' && role !== 'contributor') {
        res.status(403).json({ error: 'Editor access required to refresh team data.' });
        return;
      }
      const log = await runTeamRefresh(RIOT_API_KEY.value(), 'manual');
      res.status(200).json(log);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error.';
      res.status(400).json({ error: message });
    }
  }
);

// ---- The draft advisor -------------------------------------------------------
//
// One question at a time, with the clock running: given everything the draft
// room knows, what do we take and why. The model only ranks the candidates
// the app sends — it cannot name a banned, burned or off-seat champion, and
// `parseAdvice` drops anything it tries. The data is the app's own; nothing
// is fetched from Riot to answer.

/** The model behind the advice. Opus for the judgement; medium effort for the clock. */
const ADVISOR_MODEL = 'claude-opus-5';

export const draftAdvice = onRequest(
  { cors: true, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120 },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }
    try {
      const idToken = parseBearerToken(req.headers.authorization);
      if (!idToken) {
        res.status(401).json({ error: 'Missing Authorization: Bearer <ID_TOKEN> header.' });
        return;
      }
      const decoded = await getAuth().verifyIdToken(idToken);
      const email = normalizeEmail(decoded.email);
      const role = await getAccessRoleByEmail(email);
      // Editors only: each answer costs money, and only an editor can act on it.
      if (role !== 'admin' && role !== 'contributor') {
        res.status(403).json({ error: 'Editor access required to ask the draft advisor.' });
        return;
      }

      const apiKey = ANTHROPIC_API_KEY.value();
      if (!apiKey) {
        res.status(503).json({
          error:
            'The draft advisor is not configured: set the ANTHROPIC_API_KEY secret ' +
            '(firebase functions:secrets:set ANTHROPIC_API_KEY) and redeploy the functions.'
        });
        return;
      }

      const request = parseDraftAdviceRequest(req.body);
      const client = new Anthropic({ apiKey });
      const started = Date.now();
      const response = await client.beta.messages.create({
        model: ADVISOR_MODEL,
        max_tokens: 2500,
        // A refused request is re-run on a fallback model inside the same
        // call, so the drafter never sees a blank answer for a game of League.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // Stable system text first so it caches; the draft itself changes on
        // every step and goes last.
        system: [{ type: 'text', text: ADVISOR_SYSTEM, cache_control: { type: 'ephemeral' } }],
        // Low effort: a draft has a thirty-second clock. Measured on a real
        // request on 5 Sep 2026, medium took 20s and low 13s for the same call;
        // the reasoning here is weighing a page of evidence, not solving anything.
        output_config: { effort: 'low', format: { type: 'json_schema', schema: ADVICE_SCHEMA } },
        messages: [{ role: 'user', content: buildDraftPrompt(request) }]
      });

      if (response.stop_reason === 'refusal') {
        res.status(200).json({
          summary: 'The advisor declined to answer this one.',
          picks: [],
          bans: [],
          watch: [],
          model: response.model
        });
        return;
      }
      const text = response.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('The advisor answered in a shape the app could not read.');
      }
      const advice = parseAdvice(parsed, request.candidates);
      res.status(200).json({
        ...advice,
        model: response.model,
        tookMs: Date.now() - started,
        usage: {
          input: response.usage.input_tokens,
          cachedInput: response.usage.cache_read_input_tokens ?? 0,
          output: response.usage.output_tokens
        }
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        res.status(503).json({ error: 'The ANTHROPIC_API_KEY secret is not valid — create a new key in the Anthropic console and set it again.' });
        return;
      }
      if (error instanceof Anthropic.RateLimitError) {
        res.status(429).json({ error: 'The advisor is rate limited right now — try again in a few seconds.' });
        return;
      }
      if (error instanceof Anthropic.APIError) {
        res.status(502).json({ error: `The advisor could not answer (${error.status}): ${error.message}` });
        return;
      }
      const message = error instanceof Error ? error.message : 'Unexpected error.';
      res.status(400).json({ error: message });
    }
  }
);

// ---- Riot API key health ------------------------------------------------

/** What the last key health probe found, mirrored to Firestore for the app. */
interface KeyHealth {
  ok: boolean;
  status: number;
  /** Reported app rate limit, e.g. "20:1,100:120". Informational only. */
  appRateLimit: string;
  message: string;
  checkedAt: string;
}

// Note: an approved Personal key can carry the same rate limits as a Development
// key, so the limit does NOT identify the tier. We report validity, not tier.
async function probeRiotKey(apiKey: string | undefined): Promise<KeyHealth> {
  const checkedAt = new Date().toISOString();
  if (!apiKey) {
    return {
      ok: false,
      status: 0,
      appRateLimit: '',
      message: 'RIOT_API_KEY is not configured.',
      checkedAt
    };
  }
  try {
    const response = await fetch('https://euw1.api.riotgames.com/lol/status/v4/platform-data', {
      headers: { 'X-Riot-Token': apiKey }
    });
    const appRateLimit = response.headers.get('x-app-rate-limit') ?? '';
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        status: response.status,
        appRateLimit,
        message: 'Riot API key expired or invalid — an admin needs to refresh it.',
        checkedAt
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        appRateLimit,
        message: `Unexpected response from Riot (${response.status}).`,
        checkedAt
      };
    }
    return {
      ok: true,
      status: response.status,
      appRateLimit,
      message: 'Key is valid.',
      checkedAt
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      appRateLimit: '',
      message: error instanceof Error ? error.message : 'Key probe failed.',
      checkedAt
    };
  }
}

async function writeKeyHealth(health: KeyHealth): Promise<void> {
  await getFirestore().doc('meta/keyHealth').set(health);
}

/**
 * Daily probe so an expired key surfaces on its own instead of being discovered
 * when someone opens Match Analysis and finds it empty.
 */
export const checkRiotKey = onSchedule(
  { schedule: 'every day 08:00', timeZone: 'Europe/Amsterdam', secrets: [RIOT_API_KEY] },
  async () => {
    const health = await probeRiotKey(RIOT_API_KEY.value());
    await writeKeyHealth(health);
    if (!health.ok) {
      console.error(`Riot key health: ${health.message}`);
    }
  }
);

/** On-demand probe, so the app can check without waiting for the daily run. */
export const riotKeyHealth = onRequest(
  { cors: true, secrets: [RIOT_API_KEY] },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    const health = await probeRiotKey(RIOT_API_KEY.value());
    await writeKeyHealth(health);
    // The commit the running backend was built from. Pages deploys the frontend
    // by itself and the functions do not, so without this there is no way to
    // ask an unauthenticated question as basic as "did my deploy land?".
    res.status(200).json({ ...health, backendSha: BUILD_SHA });
  }
);

// ---- Champion traits ------------------------------------------------------
//
// Riot's champion list has class tags but no damage type. The file that does
// carry it is one request per champion — fine on a weekly schedule, absurd from
// a browser on every page load. So it is assembled here and stored as a single
// small document the client reads like any other.
//
// CommunityDragon is a CDN over unpacked game files: no key, no rate limit, and
// nothing here touches the Riot API or its budget.

const CDRAGON_BASE =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1';

/** Kept low deliberately: this is someone else's CDN and there is no hurry. */
const TRAIT_FETCH_CONCURRENCY = 8;

interface CdragonSummaryEntry {
  id: number;
  alias?: string;
}

async function fetchChampionTraits(): Promise<Record<string, ChampionTraits>> {
  const summary = (await (await fetch(`${CDRAGON_BASE}/champion-summary.json`)).json()) as
    | CdragonSummaryEntry[]
    | undefined;

  // id -1 is the "None" placeholder the client uses for an empty slot, and the
  // Jade_* aliases are another mode's variants of champions already listed —
  // 63 of them, none pickable on Summoner's Rift. Dropping them here is 63
  // fewer requests to someone else's CDN for entries nothing can ever read.
  const ids = (summary ?? [])
    .filter((c) => c.id > 0 && !c.alias?.startsWith('Jade_'))
    .map((c) => c.id);
  const traits: Record<string, ChampionTraits> = {};

  for (let i = 0; i < ids.length; i += TRAIT_FETCH_CONCURRENCY) {
    const batch = ids.slice(i, i + TRAIT_FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (id) => {
        try {
          const raw = await (await fetch(`${CDRAGON_BASE}/champions/${id}.json`)).json();
          return toTraits(raw);
        } catch {
          // One champion missing is a gap in a tooltip, not a reason to throw
          // the whole refresh away and leave the stored map stale.
          return null;
        }
      })
    );
    for (const entry of results) {
      if (entry) traits[entry.id] = entry;
    }
  }

  return traits;
}

async function writeChampionTraits(): Promise<number> {
  const traits = await fetchChampionTraits();
  // A partial fetch would quietly delete champions from the stored map, so a
  // run that came back with almost nothing is treated as a failed run.
  if (Object.keys(traits).length < 100) {
    throw new Error(`Champion traits fetch returned only ${Object.keys(traits).length} entries.`);
  }
  await getFirestore()
    .doc('meta/championTraits')
    .set({ traits, updatedAt: new Date().toISOString(), source: 'communitydragon' });
  return Object.keys(traits).length;
}

/** Weekly: these change on patch days, and a patch is never more than that. */
export const refreshChampionTraits = onSchedule(
  { schedule: 'every monday 06:00', timeZone: 'Europe/Amsterdam', timeoutSeconds: 300 },
  async () => {
    const count = await writeChampionTraits();
    console.log(`Champion traits refreshed: ${count} champions.`);
  }
);

/** Manual trigger, so the map can be filled without waiting for Monday. */
export const syncChampionTraits = onRequest(
  { cors: true, timeoutSeconds: 300 },
  async (req, res) => {
    try {
      const count = await writeChampionTraits();
      res.json({ ok: true, champions: count });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Sync failed.' });
    }
  }
);

// ---------------------------------------------------------------------------
// Champion win rates by rank, collected two minutes at a time.
//
// A proof of concept for a Production key application, and useful on its own:
// the draft room currently cannot quote an external win rate at all, because
// 159 games do not support one. See `crawler.ts` for the reasoning and the
// approved-use-case clause this is built against.
// ---------------------------------------------------------------------------

/** The one region we collect. Their meta is ours; other regions would dilute it. */
const CRAWL_REGION = 'euw';

interface CrawlState {
  /**
   * Off until switched on by hand.
   *
   * Deploying this must not start a perpetual job against the Riot key. The
   * crawler shares its rate limit with every interactive refresh on the site,
   * and on a Personal key the approved use is a proof of concept, not a
   * pipeline left running — so starting it is a decision, taken once, with
   * somebody watching.
   */
  enabled?: boolean;
  cursor: LadderCursor;
  /** Players we know of, with the rank of the page they came from. */
  pool: { puuid: string; tier: Tier }[];
  /** Match ids waiting to be fetched, with the tier to file them under. */
  pending: { id: string; tier: Tier }[];
  matchesTallied: number;
  lastRunAt: string;
  lastNote: string;
}

const CRAWL_STATE_DOC = 'crawlState/championStats';
/**
 * How long a seen-marker has to live.
 *
 * It only has to outlast its own patch, because the counters it protects are
 * bucketed per patch and a duplicate counted into a later bucket is a new
 * game as far as that bucket is concerned. Three weeks covers a two-week
 * patch with room either side. Without a TTL this collection grows by about
 * 33,000 documents a day and never stops.
 */
const SEEN_TTL_DAYS = 21;
/** Caps on the two queues, so the state document cannot grow without bound. */
const MAX_POOL = 4000;
const MAX_PENDING = 4000;

function emptyCrawlState(): CrawlState {
  return {
    // Written explicitly, never left undefined. A state document that omits
    // the one field it exists to hold is a switch with no switch on it.
    enabled: false,
    cursor: FIRST_CURSOR,
    pool: [],
    pending: [],
    matchesTallied: 0,
    lastRunAt: '',
    lastNote: 'not started'
  };
}

/**
 * One page of a ranked ladder, as players we can crawl.
 *
 * Riot has been moving every endpoint from summoner ids to puuids, and this one
 * has carried both at different times, so take whichever is present rather than
 * assuming. An entry with neither is skipped: resolving it would cost a request
 * each, which is the budget this whole design exists to protect.
 */
async function fetchLadderPage(
  cursor: LadderCursor,
  apiKey: string
): Promise<{ puuid: string; tier: Tier }[]> {
  const routing = REGION_ROUTING[CRAWL_REGION];
  const body = await riotFetch<unknown>(
    `https://${routing.platform}.api.riotgames.com${ladderPath(cursor)}`,
    apiKey
  );

  // /entries answers with a bare array; the apex ladders wrap theirs in a
  // league object. Both carry a puuid per entry, which is the only field used.
  const entries = Array.isArray(body) ? body : (body as { entries?: unknown[] })?.entries;

  // An apex ladder arrives whole, so it is cut to a page's worth before seeding.
  return sampleLadder(Array.isArray(entries) ? entries : [], cursor)
    .map((e) => (e as { puuid?: string })?.puuid)
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .map((puuid) => ({ puuid, tier: cursor.tier }));
}

/**
 * Add a match's champions to its patch-and-tier bucket.
 *
 * `FieldValue.increment` rather than read-modify-write: the counters are the
 * only thing this crawler produces, and a lost update is a game that silently
 * never happened.
 */
/**
 * Write a whole run's counters, one document per bucket.
 *
 * Two things had to be right here and neither was obvious.
 *
 * The counters are a **nested map**, not dotted keys: `set()` does not read a
 * dotted key as a field path — only `update()` does — so
 * `{'champions.Ahri.games': …}` wrote a literal field *named*
 * "champions.Ahri.games" and no `champions` map ever existed.
 *
 * And it takes the run's tallies together rather than one at a time. Fifty
 * matches used to mean a hundred counter writes into the same two or three
 * documents; Firestore bills every one of them.
 */
/**
 * Write a run's lane matchups, one document per lane.
 *
 * Split by lane rather than one document per patch: three thousand pairings
 * in a single map would sit near Firestore's per-document index ceiling, and
 * a lane is the natural cut because nothing ever reads across lanes.
 *
 * winsA is from the alphabetically-first champion's side, so both orderings
 * of a pairing land in one cell instead of two half-filled ones.
 */
/**
 * A scrim as stored by the browser importer.
 *
 * Written client-side from a replay file, because custom games never enter
 * the Riot API. Only the fields the analysis reads are declared here.
 */
interface StoredScrim {
  id: string;
  playedOn?: string;
  durationSec?: number;
  blueWon?: boolean;
  objectives?: { blue: CachedTeam; red: CachedTeam };
  players?: {
    name?: string; tag?: string; champion?: string; team?: number; win?: boolean;
    position?: string; kills?: number; deaths?: number; assists?: number;
    cs?: number; damage?: number; damageTaken?: number; ccTime?: number;
  }[];
}

/** Scrims are queueId 0 the way custom games are, and label as such. */
const SCRIM_QUEUE_ID = 0;

/**
 * Turn a stored scrim into the shape the analysis already consumes.
 *
 * The alternative was computing comp attribution and win/loss factors in the
 * browser, which would mean a second copy of objectives.ts drifting from this
 * one. Converting instead means a scrim goes through exactly the same
 * attribution, the same thresholds and the same factor logic as a Riot match,
 * and everything downstream — comp records, the Review page — picks it up
 * without knowing scrims exist.
 *
 * Roster players are matched by Riot ID and given their real puuid, which is
 * how the rest of the pipeline recognises them. Everyone else gets a synthetic
 * id: it only has to be stable and not collide with a roster member.
 */
function scrimAsMatch(
  scrim: StoredScrim,
  puuidByRiotId: ReadonlyMap<string, string>
): CachedMatch | null {
  const rows = scrim.players ?? [];
  if (rows.length !== 10 || !scrim.objectives) return null;

  const participants: CachedParticipant[] = rows.map((p, index) => {
    const key = `${p.name ?? ''}#${p.tag ?? ''}`.toLowerCase();
    return {
      puuid: puuidByRiotId.get(key) ?? `scrim:${scrim.id}:${index}`,
      championName: p.champion ?? '',
      win: !!p.win,
      teamId: p.team ?? 100,
      teamPosition: p.position ?? '',
      kills: p.kills ?? 0,
      deaths: p.deaths ?? 0,
      assists: p.assists ?? 0,
      cs: p.cs ?? 0,
      damage: p.damage ?? 0,
      damageTaken: p.damageTaken ?? 0,
      ccTime: p.ccTime ?? 0
    };
  });

  return {
    cacheVersion: CACHE_VERSION,
    queueId: SCRIM_QUEUE_ID,
    // The replay never records when the game started, so the importer stores
    // the file time. A few minutes late, and the only date there is.
    gameCreation: Date.parse(scrim.playedOn ?? '') || Date.now(),
    durationSec: scrim.durationSec ?? 0,
    teams: [
      { ...scrim.objectives.blue, teamId: 100 },
      { ...scrim.objectives.red, teamId: 200 }
    ],
    participants
  };
}

async function applyMatchups(updates: readonly MatchupUpdate[]): Promise<void> {
  if (!updates.length) return;
  const db = getFirestore();
  await Promise.all(
    updates.map((update) => {
      const pairs: Record<string, { games: FieldValue; winsA: FieldValue }> = {};
      for (const [key, tally] of update.pairs) {
        pairs[key] = {
          games: FieldValue.increment(tally.games),
          winsA: FieldValue.increment(tally.winsA)
        };
      }
      return db.doc(matchupDocPath(update.patch, update.lane)).set(
        { patch: update.patch, lane: update.lane, pairs },
        { merge: true }
      );
    })
  );
}

async function applyBuckets(buckets: readonly BucketUpdate[]): Promise<void> {
  const db = getFirestore();
  await Promise.all(
    buckets.map((bucket) => {
      const champions: Record<string, { games: FieldValue; wins: FieldValue }> = {};
      for (const [champion, counts] of bucket.champions) {
        // Champion names carry apostrophes and spaces (Kai'Sa, Dr. Mundo); a
        // dot would split the path, so keys are letters and digits only.
        const key = champion.replace(/[^A-Za-z0-9]/g, '');
        champions[key] = {
          games: FieldValue.increment(counts.games),
          wins: FieldValue.increment(counts.wins)
        };
      }
      return db.doc(statsDocPath(bucket.patch, bucket.tier)).set(
        {
          patch: bucket.patch,
          tier: bucket.tier,
          matches: FieldValue.increment(bucket.matches),
          champions
        },
        { merge: true }
      );
    })
  );
}

/**
 * One crawl tick.
 *
 * Deliberately not transactional across the whole run: a run that fails halfway
 * has still banked the matches it tallied, and the seen-marker means the next
 * run does not recount them. Losing a few queued ids costs one request each.
 */
async function crawlTick(apiKey: string | undefined): Promise<string> {
  if (!apiKey) return 'no key configured';

  const db = getFirestore();
  const stateRef = db.doc(CRAWL_STATE_DOC);
  const snap = await stateRef.get();
  const state: CrawlState = snap.exists
    ? { ...emptyCrawlState(), ...(snap.data() as Partial<CrawlState>) }
    : emptyCrawlState();

  if (!state.enabled) {
    // Write the document on first sight even though nothing else runs. The
    // switch has to exist somewhere a person can flip it, and expecting anyone
    // to hand-create a collection, a document id and a typed boolean in the
    // Firestore console is a worse first step than one wasted write.
    if (!snap.exists || typeof (snap.data() as CrawlState).enabled !== 'boolean') {
      await stateRef.set({ enabled: false }, { merge: true });
    }
    return 'disabled — set crawlState/championStats.enabled to true to start';
  }

  const plan = planRun(state.pending.length, state.pool.length, crawlBudgetAt(new Date()));
  const routing = REGION_ROUTING[CRAWL_REGION];
  let tallied = 0;
  let skipped = 0;

  // 1. Players, when we are short of them.
  for (let i = 0; i < plan.ladderPages; i += 1) {
    try {
      const page = await fetchLadderPage(state.cursor, apiKey);
      state.pool = [...state.pool, ...page].slice(-MAX_POOL);
    } catch {
      // A bad page should not stall the walk; move past it.
    }
    state.cursor = nextCursor(state.cursor);
  }

  // 2. Match ids, when the queue is running dry.
  for (let i = 0; i < plan.idLookups && state.pool.length > 0; i += 1) {
    const player = state.pool.shift()!;
    try {
      const ids = await riotFetch<string[]>(
        `https://${routing.regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${player.puuid}/ids?queue=${CRAWL_QUEUE}&startTime=${collectSince()}&start=0&count=${IDS_PER_PLAYER}`,
        apiKey
      );
      const fresh = (Array.isArray(ids) ? ids : []).map((id) => ({ id, tier: player.tier }));
      state.pending = [...state.pending, ...fresh].slice(0, MAX_PENDING);
    } catch {
      // Drop this player rather than retrying; there are millions more.
    }
  }

  // 3. Matches, which is the only stage that produces data.
  //
  // The budget counts *Riot* requests, so an id already seen does not spend
  // one — it costs a Firestore read and moves on. Counting skips against the
  // budget meant a run could return having used a fraction of its rate-limit
  // allowance, and the more matches we collect the more often that happens,
  // because duplicates rise as the crawl deepens. `reads` caps the Firestore
  // side so a queue full of duplicates cannot spin the whole timeout away.
  const collected: MatchTally[] = [];
  let fetches = 0;
  let reads = 0;
  const maxReads = plan.matchFetches * 8;
  while (fetches < plan.matchFetches && reads < maxReads && state.pending.length > 0) {
    const next = state.pending.shift()!;
    const seenRef = db.doc(`crawlSeen/${next.id}`);
    reads += 1;
    try {
      // A five-stack appears in five players' histories; without this marker
      // its champions would be counted five times over.
      if ((await seenRef.get()).exists) {
        skipped += 1;
        continue;
      }
      const raw = await riotFetch<CrawledMatch>(
        `https://${routing.regional}.api.riotgames.com/lol/match/v5/matches/${next.id}`,
        apiKey
      );
      fetches += 1;
      const tally = tallyMatch(raw, next.tier);
      if (tally) {
        // Held, not written. The whole run folds into one document per bucket
        // at the end; see applyBuckets.
        collected.push(tally);
        tallied += 1;
      }
      // Marked either way: a remake stays a remake, and re-fetching one to
      // reject it again is a wasted request every run forever. `expireAt` is
      // what the TTL policy deletes on — a marker only has to outlive its own
      // patch, since the counters it protects are bucketed per patch.
      await seenRef.set({
        patch: tally?.patch ?? 'skipped',
        expireAt: Timestamp.fromMillis(Date.now() + SEEN_TTL_DAYS * 24 * 60 * 60 * 1000)
      });
    } catch {
      // Leave it unmarked so a later run can retry it.
    }
  }

  // One document per bucket for the whole run, rather than three per match.
  await applyBuckets(mergeTallies(collected));
  await applyMatchups(mergeMatchups(collected));

  state.matchesTallied += tallied;
  state.lastRunAt = new Date().toISOString();
  state.lastNote = `+${tallied} tallied, ${skipped} already seen, ${state.pending.length} queued, ${state.pool.length} players`;
  await stateRef.set(state);
  return state.lastNote;
}

/**
 * Runs on a schedule rather than on demand, because the point is the slow
 * accumulation. Two minutes matches the rate-limit window, so each run gets a
 * fresh allowance and never borrows from the next.
 */
export const crawlChampionStats = onSchedule(
  { schedule: 'every 2 minutes', secrets: [RIOT_API_KEY], timeoutSeconds: 110 },
  async () => {
    const note = await crawlTick(RIOT_API_KEY.value());
    console.log(`crawlChampionStats: ${note}`);
  }
);

/**
 * Manual tick, for watching one run without waiting for the schedule.
 *
 * `?enable=true` / `?enable=false` moves the switch as well, because setting a
 * typed boolean in the Firestore console is fiddly enough to get wrong twice —
 * the string "true" looks identical to the boolean in the list view and reads
 * as enabled while being neither. Starting collection is still a deliberate
 * act; it just no longer needs the console.
 *
 * The reply always states the flag, so "is it running" is never a guess.
 */
export const crawlOnce = onRequest(
  { cors: true, secrets: [RIOT_API_KEY], timeoutSeconds: 120 },
  async (req, res) => {
    try {
      const wanted = String(req.query.enable ?? '').toLowerCase();
      if (wanted === 'true' || wanted === 'false') {
        await getFirestore()
          .doc(CRAWL_STATE_DOC)
          .set({ enabled: wanted === 'true' }, { merge: true });
      }
      const note = await crawlTick(RIOT_API_KEY.value());
      const after = (await getFirestore().doc(CRAWL_STATE_DOC).get()).data() as CrawlState | undefined;
      res.json({ ok: true, enabled: after?.enabled === true, note, tallied: after?.matchesTallied ?? 0 });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'crawl failed' });
    }
  }
);

/**
 * Publish the readable matchup index from the raw tallies.
 *
 * Separate from collection on purpose. The crawler writes with
 * `FieldValue.increment` and never reads a matchup document, which is what lets
 * it fold fifty matches into five writes; the index needs the whole document,
 * which is a different and much rarer operation. Running it on its own schedule
 * keeps a megabyte-sized read off the two-minute collection tick.
 *
 * Every raw document is re-indexed, not just the current patch. Old patches
 * stop changing, so most of the work is redundant — but it is fifty reads and
 * fifty writes a day against a collection that bills per operation, and the
 * alternative is tracking which buckets moved, which is bookkeeping that can
 * drift out of step with the truth. `splitIndexId` rejects anything that is not
 * one of the five lanes, so a stray document cannot be indexed as a matchup.
 */
async function rollupMatchupIndex(): Promise<string> {
  const db = getFirestore();
  const snap = await db.collection('matchupStats').get();
  const builtAt = new Date().toISOString();

  let documents = 0;
  let seen = 0;
  let published = 0;

  for (const doc of snap.docs) {
    const parts = splitIndexId(doc.id);
    if (!parts) continue;

    const index = buildIndex(doc.data() as RawMatchupDoc, parts.patch, parts.lane, builtAt);
    // Overwritten whole rather than merged: a pairing that drops below the
    // floor after a correction should disappear from the index, and a merge
    // would leave it behind for good.
    await db.doc(indexDocPath(parts.patch, parts.lane)).set(index);

    documents += 1;
    seen += index.pairsSeen;
    published += index.pairsPublished;
  }

  return `${documents} lane buckets indexed, ${published} of ${seen} pairings published`;
}

/**
 * Daily. The index only has to be as fresh as the advice that reads it, and a
 * pairing crossing the floor is not news that needs to arrive within minutes.
 */
export const buildMatchupIndex = onSchedule(
  { schedule: 'every 24 hours', timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const note = await rollupMatchupIndex();
    console.log(`buildMatchupIndex: ${note}`);
  }
);

/** Manual trigger, so the index can be built the moment it is first deployed. */
export const buildMatchupIndexOnce = onRequest(
  { cors: true, timeoutSeconds: 540, memory: '512MiB' },
  async (_req, res) => {
    try {
      res.json({ ok: true, note: await rollupMatchupIndex() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'rollup failed' });
    }
  }
);
