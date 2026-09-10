#!/usr/bin/env node
/**
 * dev-timeline: a version-3 timeline document, made on this machine, no deploy.
 *
 * Why (10 Sep 2026): Part C of the film room (positions once a minute, our
 * wards at the placer's spot, the position lab) was built while the team was
 * drafting on the live site, so nothing could be deployed and nothing could
 * be written to production Firestore. The functions are the only thing that
 * writes `matchTimeline/{matchId}`, and the deployed one still writes version
 * 2. This script runs the SAME reducer — `buildMatchTimeline` and `gameFacts`
 * from `api/lib`, the built output of `cd api && npm run build` — with the
 * same arguments `getMatchTimeline` in `api/src/index.ts` passes, and writes
 * the document to a file instead. Nothing here writes anywhere but `--out`.
 *
 *   Usage (bash):        RIOT_API_KEY=RGAPI-...  node scripts/dev-timeline.mjs <matchId> [--out file.json]
 *   Usage (PowerShell):  $env:RIOT_API_KEY='RGAPI-...'; node scripts/dev-timeline.mjs <matchId> [--out file.json]
 *   Before: cd api && npm run build          (this imports api/lib, not api/src)
 *   Then:   git checkout -- api/src/build-info.ts   (the build stamps it)
 *   The default output, dev-timeline-<matchId>.json in the working directory, is in .gitignore.
 *
 * What it does, in the api's order:
 *   1. reads the `players` collection (public-read) with the Firebase web SDK
 *      from frontend/node_modules and the public web config in
 *      frontend/src/environments/environment.ts, and turns it into the analysis
 *      request the way `rosterFromPlayers` does (`analysisRequestFrom`, with
 *      no comps and no overrides: the roster is all that is needed);
 *   2. resolves each Riot id through account-v1 exactly as `resolveRoster`
 *      does — the player docs carry no puuid, so this is the api's own road;
 *   3. reads `matchCache/{matchId}` (the seats and the sides come from it,
 *      as in the api), or fetches match-v5 from Riot and shapes it the way
 *      `getCachedMatch` would when the cache has no entry;
 *   4. fetches the match-v5 timeline from the region routing the api uses;
 *   5. runs `buildMatchTimeline` and puts `gameFacts` on the document, so
 *      the facts ride along as they do on a stored one;
 *   6. writes the JSON to --out (default ./dev-timeline-<matchId>.json) and
 *      prints counts only: frames, wards, bytes. Never the key.
 *
 * How the app picks it up: in a dev build, `MatchTimelineService` (builder B,
 * 10 Sep 2026) reads localStorage 'bom-dev-timeline:<matchId>' first, and a
 * document there wins over Firestore. So, on ng serve, open the console and run
 *   localStorage.setItem('bom-dev-timeline:<matchId>', JSON.stringify(<paste the file>))
 * then open the film room for that game. A production build ignores the key.
 *
 * Riot policy: the other team leaves the reducer as a champion in a seat and
 * nothing else; this file adds nothing to that. Do not commit the output.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const requireApi = createRequire(path.join(root, 'api', 'package.json'));
const requireFrontend = createRequire(path.join(root, 'frontend', 'package.json'));

/** Mirrors REGION_ROUTING in api/src/index.ts, which is private there. */
const REGION_ROUTING = {
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

/** Mirrors QUEUE_LABEL in api/src/index.ts (private there); the facts read the label only. */
const QUEUE_LABEL = {
  0: 'Scrim',
  440: 'Flex',
  700: 'Clash',
  400: '5v5 Draft',
  430: '5v5 Blind',
  490: '5v5 Quickplay'
};

/** The built api, or a clear word on how to get it. */
function loadApi() {
  if (!existsSync(path.join(root, 'api', 'lib', 'timeline-features.js'))) {
    throw new Error('api/lib is not built. Run: cd api && npm run build (then git checkout -- api/src/build-info.ts).');
  }
  const timeline = requireApi('./lib/timeline-features.js');
  const facts = requireApi('./lib/game-facts.js');
  const lanes = requireApi('./lib/lane-read.js');
  const fights = requireApi('./lib/fights.js');
  const champions = requireApi('./lib/champion-names.js');
  const refresh = requireApi('./lib/daily-refresh.js');
  const extras = requireApi('./lib/participant-extras.js');
  const cache = requireApi('./lib/analysis-cache.js');
  const errors = requireApi('./lib/riot-errors.js');
  return {
    buildMatchTimeline: timeline.buildMatchTimeline,
    TIMELINE_VERSION: timeline.TIMELINE_VERSION,
    gameFacts: facts.gameFacts,
    readLanes: lanes.readLanes,
    playerFacts: lanes.playerFacts,
    POSITION_ROLE: lanes.POSITION_ROLE,
    tallyKills: fights.tallyKills,
    displayChampionName: champions.displayChampionName,
    analysisRequestFrom: refresh.analysisRequestFrom,
    extractExtras: extras.extractExtras,
    CACHE_VERSION: cache.CACHE_VERSION,
    retryDelayMs: errors.retryDelayMs,
    riotError: errors.riotError
  };
}

/** The public web config, read off environment.ts without compiling it: `key: 'value'` pairs inside the firebase block. */
export function webConfig(text = readFileSync(path.join(root, 'frontend', 'src', 'environments', 'environment.ts'), 'utf8')) {
  const start = text.indexOf('firebase:');
  const end = text.indexOf('functions:', start);
  const block = text.slice(start, end < 0 ? undefined : end);
  const config = {};
  for (const m of block.matchAll(/(\w+):\s*'([^']*)'/g)) config[m[1]] = m[2];
  if (!config.apiKey || !config.projectId) {
    throw new Error('frontend/src/environments/environment.ts has no Firebase apiKey and projectId (local mode): the players cannot be read.');
  }
  return config;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Mirrors riotFetch in api/src/index.ts: the key goes in a header, never a URL, and a 429 waits Riot's window. */
async function riotFetch(url, apiKey, fetchImpl, api, retries = 6) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(url, { headers: { 'X-Riot-Token': apiKey } });
    if (response.status === 429 && attempt < retries) {
      await sleep(api.retryDelayMs(response.headers.get('Retry-After')));
      continue;
    }
    if (!response.ok) throw api.riotError(response.status, url);
    return response.json();
  }
}

/** Mirrors resolveRoster in api/src/index.ts. */
async function resolveRoster(players, apiKey, fetchImpl, api) {
  const firstRegion = players[0]?.region ?? 'euw';
  const routing = REGION_ROUTING[firstRegion] ?? REGION_ROUTING.euw;
  const identities = await Promise.all(
    players.map(async (player) => {
      const tagLine = (player.riotTag || firstRegion.toUpperCase()).replace(/^#/, '');
      const account = await riotFetch(
        `https://${routing.regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(player.name)}/${encodeURIComponent(tagLine)}`,
        apiKey,
        fetchImpl,
        api
      );
      return { ...player, puuid: account.puuid };
    })
  );
  return {
    firstRegion,
    routing,
    identities,
    rosterPuuids: new Set(identities.map((i) => i.puuid)),
    nameByPuuid: new Map(identities.map((i) => [i.puuid, i.name]))
  };
}

/** Mirrors cacheTeam in api/src/index.ts. */
function cacheTeam(team) {
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

/** Mirrors the CachedMatch literal in getCachedMatch (api/src/index.ts), for a match the cache has not seen. Not written anywhere. */
function cachedMatchFrom(raw, api) {
  return {
    cacheVersion: api.CACHE_VERSION,
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
      buildingDamage: p.damageDealtToBuildings ?? 0,
      extras: api.extractExtras(p)
    }))
  };
}

/** Mirrors gameLikeFromMatch in api/src/index.ts: the slice of an analysis game the facts need. */
function gameLikeFromMatch(match, roster, api) {
  const ours = match.participants.filter((p) => roster.rosterPuuids.has(p.puuid));
  const teamId = ours[0]?.teamId ?? 100;
  const durationSec = match.durationSec ?? 0;
  const lanes = api.readLanes(match.participants, teamId, durationSec);
  const fights = api.tallyKills(match.participants, teamId);
  const ourTeam = match.teams?.find((t) => t.teamId === teamId);
  const theirTeam = match.teams?.find((t) => t.teamId !== teamId);
  const objectives = ourTeam && theirTeam ? { ours: ourTeam, theirs: theirTeam } : null;
  return {
    win: ours[0]?.win ?? false,
    durationSec,
    side: teamId === 100 ? 'blue' : 'red',
    queue: QUEUE_LABEL[match.queueId] ?? 'Team',
    players: match.participants
      .filter((p) => p.teamId === teamId)
      .map((p) => ({
        name: roster.nameByPuuid.get(p.puuid) ?? p.championName,
        position: api.POSITION_ROLE[p.teamPosition] ?? p.teamPosition ?? '',
        champion: api.displayChampionName(p.championName),
        deaths: p.deaths,
        ...(lanes.has(p.puuid) && { lane: lanes.get(p.puuid) }),
        ...(p.extras && { facts: api.playerFacts(p, durationSec) }),
        ...(p.visionScore !== undefined && { visionScore: p.visionScore })
      })),
    ...(objectives && { objectives }),
    kills: fights
  };
}

/**
 * The whole run, with its doors open for a dry run: `fetchImpl` stands in for
 * Riot and `readers` for Firestore (`players()` the docs with their ids,
 * `match(id)` the cached match or null). Returns the document it wrote.
 */
export async function run({ matchId, out, apiKey, fetchImpl = globalThis.fetch, readers, log = console.log }) {
  const api = loadApi();
  const players = await readers.players();
  const request = api.analysisRequestFrom(players, [], []);
  if (!request.players.length) throw new Error('The players collection has nobody with a name; there is no roster to resolve.');
  const roster = await resolveRoster(request.players, apiKey, fetchImpl, api);

  let match = await readers.match(matchId);
  let matchFrom = 'matchCache';
  if (!match) {
    const raw = await riotFetch(`https://${roster.routing.regional}.api.riotgames.com/lol/match/v5/matches/${matchId}`, apiKey, fetchImpl, api);
    match = cachedMatchFrom(raw, api);
    matchFrom = 'Riot (not in matchCache)';
  }

  const raw = await riotFetch(`https://${roster.routing.regional}.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`, apiKey, fetchImpl, api);
  const timeline = api.buildMatchTimeline(matchId, raw, match, roster.rosterPuuids, roster.nameByPuuid, new Date().toISOString());
  if (!timeline) throw new Error(`Nothing to read for ${matchId}: under two frames, or none of ours in the game.`);
  // The facts ride on the same document, as they do on a stored one.
  timeline.facts = api.gameFacts(timeline, gameLikeFromMatch(match, roster, api));

  // JSON.stringify drops undefined fields the way stripUndefinedDeep does before a Firestore write.
  const json = JSON.stringify(timeline);
  writeFileSync(out, json);

  const frames = timeline.positions?.minutes.length ?? 0;
  const wards = timeline.wards?.length ?? 0;
  const killed = timeline.wards?.filter((w) => w.killedSec !== undefined).length ?? 0;
  log(`Wrote ${out}`);
  log(`  version ${timeline.timelineVersion}, ${frames} frames, ${wards} wards (${killed} with a kill matched), ${timeline.bytes} bytes as the api measures it, ${json.length} on disk with the facts; match from ${matchFrom}.`);
  log(`  In a dev build (ng serve), open the console and run:`);
  log(`    localStorage.setItem('bom-dev-timeline:${matchId}', JSON.stringify(<paste the file's contents>))`);
  log(`  then open the film room for the game. Every placed position on it is approximate by a minute.`);
  return timeline;
}

/** Read-only Firestore through the web SDK in frontend/node_modules, with the public web config. */
function openFirestore() {
  const { initializeApp, deleteApp } = requireFrontend('firebase/app');
  const { getFirestore, collection, doc, getDoc, getDocs } = requireFrontend('firebase/firestore');
  const app = initializeApp(webConfig(), 'dev-timeline');
  const db = getFirestore(app);
  return {
    readers: {
      players: async () => (await getDocs(collection(db, 'players'))).docs.map((d) => ({ ...d.data(), id: d.id })),
      match: async (id) => {
        const snap = await getDoc(doc(db, 'matchCache', id));
        return snap.exists() ? snap.data() : null;
      }
    },
    close: () => deleteApp(app)
  };
}

function argValue(args, name) {
  const joined = args.find((a) => a.startsWith(`--${name}=`));
  if (joined) return joined.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? '') : '';
}

async function main() {
  const args = process.argv.slice(2);
  const outArg = argValue(args, 'out');
  const matchId = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
  if (!matchId) {
    console.error('Usage: RIOT_API_KEY=RGAPI-... node scripts/dev-timeline.mjs <matchId> [--out file.json]');
    process.exitCode = 1;
    return;
  }
  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) {
    console.error('RIOT_API_KEY is not set. Put the key in the environment; it is never printed or written.');
    process.exitCode = 1;
    return;
  }
  const out = path.resolve(outArg || `dev-timeline-${matchId}.json`);
  const firestore = openFirestore();
  try {
    await run({ matchId, out, apiKey, readers: firestore.readers });
  } finally {
    await firestore.close();
  }
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
const same = process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self;
if (same) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
