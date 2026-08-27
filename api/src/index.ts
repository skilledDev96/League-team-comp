import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { retryDelayMs, riotError } from './riot-errors';
import { combinations, normalizeEmail, parseBearerToken, parseEnrichRequest, parseSynergyRequest } from './parse-request';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { defineSecret } from 'firebase-functions/params';
import { matchComp } from './comp-match';
import { attributeComp } from './comp-attribution';
import { killParticipation, tallyKills } from './fights';
import { summarizeMatches } from './match-stats';
import { classifyArchetype, describePlayer } from './insights';
import { CACHE_VERSION, isCacheCurrent, isCacheUsable, parseCompAnalysisRequest } from './analysis-cache';
import { describeLoss, describeWin, GameObjectives, LossFactor, WinFactor } from './objectives';
import { BUILD_SHA } from './build-info';

initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

const RIOT_API_KEY = defineSecret('RIOT_API_KEY');

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

interface EnrichResponse {
  playstyle: string;
  strengths: string[];
  weaknesses: string[];
  role?: KnownRole;
  top3?: string[];
  bans?: string[];
  queueStats?: {
    solo?: QueueStats;
    flex?: QueueStats;
    clash?: QueueStats;
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

interface RiotChampionMastery {
  championId: number;
  championPoints: number;
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
async function fetchTopMasteryChampions(
  puuid: string,
  platform: string,
  apiKey: string,
  count: number
): Promise<string[]> {
  const masteries = await riotFetch<RiotChampionMastery[]>(
    `https://${platform}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=${count + 3}`,
    apiKey
  );
  const idToName = await getChampionIdToName();
  return masteries
    .map((m) => idToName.get(m.championId))
    .filter((name): name is string => Boolean(name))
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

  const matchIds = await riotFetch<string[]>(
    `https://${routing.regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?queue=${queueId}&start=0&count=15`,
    apiKey
  );

  const matches: RiotMatch[] = [];
  for (const matchId of matchIds.slice(0, 12)) {
    try {
      const match = await riotFetch<RiotMatch>(
        `https://${routing.regional}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
        apiKey
      );
      matches.push(match);
    } catch {
      // Skip individual match failures (e.g. remake/rate limit) without failing the whole request.
    }
  }

  if (matches.length === 0) {
    throw new Error('No recent ranked/normal match history found for this Riot ID.');
  }

  const summary = summarizeMatches(matches, account.puuid, displayChampionName);
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
    avgVisionScore
  } = summary;
  const totalWins = summary.wins;

  const top3 = summary.topChampions;
  const detectedRole = summary.mainPosition ? TEAM_POSITION_TO_ROLE[summary.mainPosition] : undefined;
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
  try {
    const region = payload.region ?? 'euw';
    const routing = REGION_ROUTING[region] ?? REGION_ROUTING['euw'];
    const gameName = payload.summonerName;
    const tagLine = (payload.riotTag || region.toUpperCase()).replace(/^#/, '');
    const account = await riotFetch<RiotAccount>(
      `https://${routing.regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      apiKey
    );
    masteryPool = await fetchTopMasteryChampions(account.puuid, routing.platform, apiKey, 5);
  } catch {
    // Keep the recent most-played pool from `primary`.
  }

  return {
    ...primary,
    top3: masteryPool.length ? masteryPool : primary.top3,
    queueStats: {
      solo: soloStats?.queueStats?.solo,
      flex: flexStats?.queueStats?.flex,
      clash: clashStats?.queueStats?.clash
    }
  };
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

export const enrichPlayer = onRequest({ cors: true, secrets: [RIOT_API_KEY] }, async (req, res) => {
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

export const getTeamSynergy = onRequest({ cors: true, secrets: [RIOT_API_KEY] }, async (req, res) => {
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
      ccTime: p.timeCCingOthers ?? 0
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
  const candidateIds: string[] = [...matchIdCounts.entries()]
    .filter(([, count]) => count >= teamMin)
    .map(([id]) => id)
    .sort()
    .reverse();

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
      const result = await getCachedMatch(matchId, routing.regional, apiKey, newMatches < MAX_NEW_FETCHES);
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
