import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { defineSecret } from 'firebase-functions/params';
import { matchComp } from './comp-match';

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

function normalizeEmail(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase();
}

function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function parseRequest(body: unknown): EnrichRequest {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid payload. Expected a JSON object.');
  }

  const candidate = body as Record<string, unknown>;
  const summonerName = typeof candidate.summonerName === 'string' ? candidate.summonerName.trim() : '';
  if (!summonerName) {
    throw new Error('summonerName is required.');
  }

  const role = typeof candidate.role === 'string' ? candidate.role.trim() : '';
  if (role && !Object.keys(ROLE_TEMPLATES).includes(role)) {
    throw new Error('role must be one of Top, Jungle, Mid, ADC, Support.');
  }

  return {
    summonerName,
    riotTag: typeof candidate.riotTag === 'string' ? candidate.riotTag.trim() : undefined,
    region: typeof candidate.region === 'string' ? candidate.region.trim().toLowerCase() : undefined,
    role: role ? (role as KnownRole) : undefined,
    mobalyticsSlug: typeof candidate.mobalyticsSlug === 'string' ? candidate.mobalyticsSlug.trim() : undefined
  };
}

function parseSynergyRequest(body: unknown): SynergyRequest {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid payload. Expected a JSON object.');
  }
  const candidate = body as { players?: unknown };
  if (!Array.isArray(candidate.players) || candidate.players.length < 2 || candidate.players.length > 5) {
    throw new Error('players must contain between 2 and 5 roster players.');
  }
  const players = candidate.players.map((value) => {
    const player = value as Record<string, unknown>;
    const id = typeof player.id === 'string' ? player.id.trim() : '';
    const name = typeof player.name === 'string' ? player.name.trim() : '';
    if (!id || !name) {
      throw new Error('Each synergy player requires an id and name.');
    }
    return {
      id,
      name,
      riotTag: typeof player.riotTag === 'string' ? player.riotTag.trim() : undefined,
      region: typeof player.region === 'string' ? player.region.trim().toLowerCase() : undefined
    };
  });
  return { players };
}

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
      const retryAfter = Number(response.headers.get('Retry-After')) || 2;
      await sleep((retryAfter + 0.5) * 1000);
      continue;
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Riot API key expired or invalid — ask an admin to refresh it.');
      }
      throw new Error(`Riot API request failed (${response.status}) for ${url}`);
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
  id: string;
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
}

interface RiotMatch {
  info: {
    gameDuration: number;
    gameCreation: number;
    queueId: number;
    participants: RiotMatchParticipant[];
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

  const rankedEntries = await riotFetch<RiotLeagueEntry[]>(
    `https://${routing.platform}.api.riotgames.com/lol/league/v4/entries/by-summoner/${encodeURIComponent(summoner.id)}`,
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

  const champGames = new Map<string, number>();
  const champWins = new Map<string, number>();
  const roleCounts = new Map<string, number>();
  const banCandidateCounts = new Map<string, number>();
  let totalWins = 0;
  let totalKills = 0;
  let totalDeaths = 0;
  let totalAssists = 0;
  let totalCsPerMin = 0;
  let totalKillParticipation = 0;
  let killParticipationSamples = 0;
  let totalDamageShare = 0;
  let damageShareSamples = 0;
  let totalTankShare = 0;
  let tankShareSamples = 0;
  let totalBuildingDamage = 0;
  let totalVisionScore = 0;

  for (const match of matches) {
    const me = match.info.participants.find((p) => p.puuid === account.puuid);
    if (!me) continue;

    const champ = me.championName;
    champGames.set(champ, (champGames.get(champ) ?? 0) + 1);
    if (me.win) {
      champWins.set(champ, (champWins.get(champ) ?? 0) + 1);
      totalWins += 1;
    }
    if (me.teamPosition) {
      roleCounts.set(me.teamPosition, (roleCounts.get(me.teamPosition) ?? 0) + 1);
    }

    totalKills += me.kills;
    totalDeaths += me.deaths;
    totalAssists += me.assists;
    const minutes = Math.max(match.info.gameDuration / 60, 1);
    totalCsPerMin += (me.totalMinionsKilled + me.neutralMinionsKilled) / minutes;
    totalBuildingDamage += me.damageDealtToBuildings ?? 0;
    totalVisionScore += me.visionScore ?? 0;

    const teammates = match.info.participants.filter((p) => p.teamId === me.teamId);
    const teamKills = teammates.reduce((sum, p) => sum + p.kills, 0);
    if (teamKills > 0) {
      totalKillParticipation += (me.kills + me.assists) / teamKills;
      killParticipationSamples += 1;
    }

    const teamDamage = teammates.reduce((sum, p) => sum + (p.totalDamageDealtToChampions ?? 0), 0);
    if (teamDamage > 0) {
      totalDamageShare += (me.totalDamageDealtToChampions ?? 0) / teamDamage;
      damageShareSamples += 1;
    }

    const teamTaken = teammates.reduce((sum, p) => sum + (p.totalDamageTaken ?? 0), 0);
    if (teamTaken > 0) {
      totalTankShare += (me.totalDamageTaken ?? 0) / teamTaken;
      tankShareSamples += 1;
    }

    if (!me.win && me.teamPosition) {
      const opponent = match.info.participants.find(
        (p) => p.teamId !== me.teamId && p.teamPosition === me.teamPosition
      );
      if (opponent) {
        banCandidateCounts.set(opponent.championName, (banCandidateCounts.get(opponent.championName) ?? 0) + 1);
      }
    }
  }

  const games = matches.length;
  const winRate = Math.round((totalWins / games) * 100);
  const avgKills = totalKills / games;
  const avgDeaths = totalDeaths / games;
  const avgAssists = totalAssists / games;
  const avgCsPerMin = totalCsPerMin / games;
  const avgKda = avgDeaths > 0 ? (avgKills + avgAssists) / avgDeaths : avgKills + avgAssists;
  const avgKillParticipation = killParticipationSamples > 0 ? totalKillParticipation / killParticipationSamples : 0;
  const avgDamageShare = damageShareSamples > 0 ? totalDamageShare / damageShareSamples : 0;
  const avgTankShare = tankShareSamples > 0 ? totalTankShare / tankShareSamples : 0;
  const avgBuildingDamage = totalBuildingDamage / games;
  const avgVisionScore = totalVisionScore / games;

  const sortedChamps = [...champGames.entries()].sort((a, b) => b[1] - a[1]);
  // Champion pool: the player's most-played (comfort) champions from recent
  // ranked/flex games. Up to 5 so the pool reflects their real spread of picks.
  const top3 = sortedChamps.slice(0, 5).map(([champ]) => displayChampionName(champ));

  const topRoleEntry = [...roleCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const detectedRole = topRoleEntry ? TEAM_POSITION_TO_ROLE[topRoleEntry[0]] : undefined;
  const role = detectedRole ?? payload.role ?? 'Mid';

  const bans = [...banCandidateCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([champ]) => displayChampionName(champ))
    .filter((champ) => !top3.includes(champ))
    .slice(0, 3);

  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (winRate >= 50) {
    strengths.push(`Positive win rate over last ${games} games (${winRate}%)`);
  } else {
    weaknesses.push(`Below 50% win rate over last ${games} games (${winRate}%)`);
  }

  if (avgKda >= 3) {
    strengths.push(`Strong average KDA (${avgKda.toFixed(1)})`);
  } else {
    weaknesses.push(`Average KDA needs work (${avgKda.toFixed(1)})`);
  }

  if (avgCsPerMin >= 6.5) {
    strengths.push(`Efficient farming (${avgCsPerMin.toFixed(1)} CS/min)`);
  } else {
    weaknesses.push(`Farming pace below target (${avgCsPerMin.toFixed(1)} CS/min)`);
  }

  if (top3.length > 0) {
    strengths.push(`Consistent champion pool led by ${top3[0]}`);
  }
  if (avgDeaths >= 5) {
    weaknesses.push(`High average deaths (${avgDeaths.toFixed(1)}) — focus on positioning`);
  }

  // Classify a GPI-style archetype from real match aggregates (ordered by specificity).
  let archetype: string;
  if (role === 'Support' || (avgVisionScore >= 40 && avgDamageShare < 0.18)) {
    archetype = 'Utility';
  } else if (avgTankShare >= 0.28 && avgDamageShare < 0.22) {
    archetype = 'Tank / Frontline';
  } else if (avgBuildingDamage >= 2200 && avgKillParticipation < 0.5) {
    archetype = 'Split Pusher';
  } else if (avgDamageShare >= 0.28 && avgKillParticipation >= 0.5) {
    archetype = 'Carry';
  } else if (avgCsPerMin >= 7.5) {
    archetype = 'Farm-focused';
  } else if (avgAssists >= avgKills * 1.3 && avgAssists >= 5) {
    archetype = 'Playmaker';
  } else if (avgKda >= 4) {
    archetype = 'Duelist';
  } else {
    archetype = `${role} Generalist`;
  }

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

    const payload = parseRequest(req.body);
    const enriched = await enrichPlayerProfile(payload, RIOT_API_KEY.value());
    res.status(200).json(enriched);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    res.status(400).json({ error: message });
  }
});

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const result: T[][] = [];
  for (let index = 0; index <= items.length - size; index += 1) {
    for (const rest of combinations(items.slice(index + 1), size - 1)) {
      result.push([items[index], ...rest]);
    }
  }
  return result;
}

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
}

interface CompAnalysisRequest {
  players: SynergyPlayerRequest[];
  comps: CompInput[];
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
}

interface AnalysisGameResponse {
  matchId: string;
  compId: string | null;
  compName: string | null;
  // Closest defined comp even when below the match threshold, for off-book hints.
  nearCompName: string | null;
  nearOverlap: number;
  // Roster members on our team this game (5 = full stack, 4 = a sub was in).
  rosterCount: number;
  win: boolean;
  side: 'blue' | 'red';
  enemyChampions: string[];
  queue: string;
  date: number;
  players: AnalysisPlayerResponse[];
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
}

interface CachedMatch {
  queueId: number;
  gameCreation: number;
  participants: CachedParticipant[];
}

async function getCachedMatch(
  matchId: string,
  regional: string,
  apiKey: string,
  allowFetch: boolean
): Promise<{ match: CachedMatch; fromCache: boolean } | null> {
  const ref = getFirestore().doc(`matchCache/${matchId}`);
  const snap = await ref.get();
  if (snap.exists) {
    return { match: snap.data() as CachedMatch, fromCache: true };
  }
  if (!allowFetch) {
    return null;
  }
  const raw = await riotFetch<RiotMatch>(
    `https://${regional}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
    apiKey
  );
  const match: CachedMatch = {
    queueId: raw.info.queueId,
    gameCreation: raw.info.gameCreation,
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
      damage: p.totalDamageDealtToChampions
    }))
  };
  await ref.set(match);
  return { match, fromCache: false };
}

interface CompAnalysisResponse {
  comps: CompPerformanceResponse[];
  games: AnalysisGameResponse[];
  totalTeamGames: number;
  scannedMatches: number;
  newMatches: number;
  pendingMatches: number;
  generatedAt: string;
}

function parseCompAnalysisRequest(body: unknown): CompAnalysisRequest {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid payload. Expected a JSON object.');
  }
  const candidate = body as { players?: unknown; comps?: unknown };
  if (!Array.isArray(candidate.players) || candidate.players.length < 5 || candidate.players.length > 10) {
    throw new Error('players must contain between 5 and 10 roster members.');
  }
  const players = candidate.players.map((value) => {
    const player = value as Record<string, unknown>;
    const id = typeof player.id === 'string' ? player.id.trim() : '';
    const name = typeof player.name === 'string' ? player.name.trim() : '';
    if (!id || !name) {
      throw new Error('Each roster player requires an id and name.');
    }
    return {
      id,
      name,
      riotTag: typeof player.riotTag === 'string' ? player.riotTag.trim() : undefined,
      region: typeof player.region === 'string' ? player.region.trim().toLowerCase() : undefined
    };
  });
  const comps = Array.isArray(candidate.comps)
    ? candidate.comps.map((value) => {
        const comp = value as Record<string, unknown>;
        return {
          id: typeof comp.id === 'string' ? comp.id : '',
          name: typeof comp.name === 'string' ? comp.name : 'Comp',
          champions: Array.isArray(comp.champions)
            ? comp.champions.filter((c): c is string => typeof c === 'string')
            : []
        };
      })
    : [];
  return { players, comps };
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
  const candidateIds = [...matchIdCounts.entries()]
    .filter(([, count]) => count >= teamMin)
    .map(([id]) => id)
    .sort()
    .reverse();

  const perComp = new Map<string, { compId: string; compName: string; games: number; wins: number }>();
  const games: AnalysisGameResponse[] = [];
  let totalTeamGames = 0;
  let scannedMatches = 0;
  let newMatches = 0;
  let pendingMatches = 0;

  // Riot's position labels vary; normalise them and keep a role order for display.
  const roleOrder: Record<string, number> = { Top: 0, Jungle: 1, Mid: 2, ADC: 3, Support: 4 };

  for (const matchId of candidateIds) {
    let match: CachedMatch;
    try {
      // Only fetch new matches while we're under the per-run budget; cached ones
      // are always processed. Anything skipped is reported as pending.
      const result = await getCachedMatch(matchId, routing.regional, apiKey, newMatches < MAX_NEW_FETCHES);
      if (!result) {
        pendingMatches += 1;
        continue;
      }
      match = result.match;
      if (!result.fromCache) newMatches += 1;
    } catch {
      pendingMatches += 1;
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
    if (!teamParts || rosterCount < teamMin) continue;

    totalTeamGames += 1;
    const win = teamParts[0].win;
    const rosterTeamId = teamParts[0].teamId;
    const side: 'blue' | 'red' = rosterTeamId === 100 ? 'blue' : 'red';
    const enemyChampions = match.participants
      .filter((p) => p.teamId !== rosterTeamId)
      .map((p) => displayChampionName(p.championName));
    const players: AnalysisPlayerResponse[] = teamParts
      .map((p) => ({
        name: nameByPuuid.get(p.puuid) ?? 'Unknown',
        position: TEAM_POSITION_TO_ROLE[p.teamPosition] ?? p.teamPosition ?? '',
        champion: displayChampionName(p.championName),
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        cs: p.cs,
        damage: p.damage
      }))
      .sort((a, b) => (roleOrder[a.position] ?? 9) - (roleOrder[b.position] ?? 9));

    const compMatch = matchComp(
      players.map((p) => p.champion),
      payload.comps,
      COMP_MATCH_THRESHOLD
    );
    if (compMatch.compId) {
      const acc = perComp.get(compMatch.compId) ?? {
        compId: compMatch.compId,
        compName: compMatch.compName ?? '',
        games: 0,
        wins: 0
      };
      acc.games += 1;
      if (win) acc.wins += 1;
      perComp.set(compMatch.compId, acc);
    }
    games.push({
      matchId,
      compId: compMatch.compId,
      compName: compMatch.compName,
      nearCompName: compMatch.nearName,
      nearOverlap: compMatch.overlap,
      rosterCount,
      win,
      side,
      enemyChampions,
      queue: QUEUE_LABEL[match.queueId] ?? 'Team',
      date: match.gameCreation,
      players
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
      await getFirestore().doc('meta/compAnalysis').set(analysis);
      res.status(200).json(analysis);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error.';
      res.status(400).json({ error: message });
    }
  }
);
