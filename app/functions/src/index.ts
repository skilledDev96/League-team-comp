import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { defineSecret } from 'firebase-functions/params';

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

interface EnrichResponse {
  playstyle: string;
  strengths: string[];
  weaknesses: string[];
  role?: KnownRole;
  top3?: string[];
  learn?: string;
  bans?: string[];
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

async function riotFetch<T>(url: string, apiKey: string): Promise<T> {
  const response = await fetch(url, { headers: { 'X-Riot-Token': apiKey } });
  if (!response.ok) {
    throw new Error(`Riot API request failed (${response.status}) for ${url}`);
  }
  return (await response.json()) as T;
}

interface RiotAccount {
  puuid: string;
  gameName: string;
  tagLine: string;
}

interface RiotSummoner {
  profileIconId: number;
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
}

interface RiotMatch {
  info: {
    gameDuration: number;
    participants: RiotMatchParticipant[];
  };
}

async function fetchRiotEnrichment(payload: EnrichRequest, apiKey: string): Promise<EnrichResponse> {
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

  const matchIds = await riotFetch<string[]>(
    `https://${routing.regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?start=0&count=15`,
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

    const teamKills = match.info.participants
      .filter((p) => p.teamId === me.teamId)
      .reduce((sum, p) => sum + p.kills, 0);
    if (teamKills > 0) {
      totalKillParticipation += (me.kills + me.assists) / teamKills;
      killParticipationSamples += 1;
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

  const sortedChamps = [...champGames.entries()].sort((a, b) => b[1] - a[1]);
  const top3 = sortedChamps.slice(0, 3).map(([champ]) => displayChampionName(champ));
  const learnChamp = sortedChamps[3]?.[0];
  const learn = learnChamp ? displayChampionName(learnChamp) : undefined;

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

  const roleTemplate = ROLE_TEMPLATES[role];
  const killParticipationPct = Math.round(avgKillParticipation * 100);

  let archetype: string;
  if (avgKillParticipation >= 0.55) {
    archetype = 'Carry';
  } else if (avgCsPerMin >= 7.5 && role !== 'Support') {
    archetype = 'Farm-focused';
  } else if (avgAssists >= avgKills * 1.3 && avgAssists >= 5) {
    archetype = 'Playmaker';
  } else if (avgKda >= 4) {
    archetype = 'Duelist';
  } else {
    archetype = `${role} generalist`;
  }

  return {
    playstyle: `${archetype} — ${roleTemplate.playstyle} (${games} recent games: ${winRate}% WR, ${avgKda.toFixed(1)} KDA, ${killParticipationPct}% kill participation)`,
    strengths: strengths.slice(0, 3),
    weaknesses: weaknesses.slice(0, 3),
    role,
    top3,
    learn,
    bans,
    iconUrl: `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/profileicon/${summoner.profileIconId}.png`,
    source: 'provider',
    provider: 'riot-api',
    generatedAt: new Date().toISOString()
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
