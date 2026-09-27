import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The path guard for the four team-scoped functions (27 Sep 2026, release 2).
 *
 * `admin-triggers.spec.ts` tests who gets through the door; this tests where the work lands. The
 * real `index.ts` is loaded with Firebase, Riot and the reviewer replaced by fakes, and the fake
 * Firestore records every document and collection path a handler touches. The rule of the
 * release, asserted here: a request with no `teamId` reads and writes today's flat root paths,
 * string for string; a request for team `b` reads and writes the same names under `teams/b/`,
 * and touches nothing else except the site's shared data (the match cache, the champion data, the
 * access list, the teams list). A literal left unprefixed anywhere on the way to a write would
 * show up in the recorded paths and fail the prefix check.
 *
 * Riot is faked at the URL: accounts resolve, every id page holds one match that sits in the cache,
 * ranks are gold, and a timeline fetch answers two empty frames. That is enough for a refresh to
 * merge a player, write a rank point, run the analysis, derive a timeline and reach its log; the
 * reviewer answers an empty object so a review is written. Nothing leaves the machine.
 *
 * The seeded timeline is current, so the ordinary cases never fetch one; the stale-timeline cases
 * seed it a version behind, which is the only way `getMatchTimeline`'s read and write and
 * `rosterFromPlayers`' three reads are reached at all.
 *
 * Since release 3 (the same day) a team has a membership list of its own, `teams/{teamId}/access`,
 * and the six token-checked handlers stand behind `admitEditor` or `admitMember` for the team the
 * request names. The `editor` token here is a root contributor who is also listed on team b, so
 * the path cases run as before; the "who may call them" cases at the end take a contributor listed
 * on b alone, a root viewer and a root admin through every one of the six, and the members-index
 * trigger is driven at the end.
 */

type Row = Record<string, unknown>;

const fb = vi.hoisted(() => {
  /** Documents by path; an absent path reads as a missing document. */
  const docs = new Map<string, Row>();
  /** Every document and collection path a handler built a reference to, in order. */
  const touched: string[] = [];
  /** Every write, in order. */
  const writes: { path: string; data: Row; options?: unknown }[] = [];
  /** Every delete, in order. */
  const deleted: string[] = [];
  const verifyIdToken = vi.fn();
  const snapOf = (path: string) => {
    const data = docs.get(path);
    return { id: path.slice(path.lastIndexOf('/') + 1), exists: data !== undefined, data: () => data };
  };
  const doc = (path: string) => {
    touched.push(path);
    return {
      get: async () => snapOf(path),
      set: async (data: Row, options?: { merge?: boolean }) => {
        writes.push({ path, data, options });
        docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...data } : { ...data });
      },
      delete: async () => {
        deleted.push(path);
        docs.delete(path);
      }
    };
  };
  type DocRef = ReturnType<typeof doc>;
  /** A transaction over the same fakes: reads and writes go straight through, so the record is the same. */
  const runTransaction = async <T>(fn: (tx: { get(ref: DocRef): Promise<unknown>; set(ref: DocRef, data: Row): void; delete(ref: DocRef): void }) => Promise<T>) =>
    fn({
      get: (ref) => ref.get(),
      set: (ref, data) => {
        void ref.set(data);
      },
      delete: (ref) => {
        void ref.delete();
      }
    });
  /** A collection query: `where` filters on equality, `select` and `limit` are accepted and ignored. */
  const query = (name: string, filters: { field: string; value: unknown }[]) => ({
    select: () => query(name, filters),
    where: (field: string, _op: string, value: unknown) => query(name, [...filters, { field, value }]),
    limit: () => query(name, filters),
    get: async () => {
      const prefix = name + '/';
      const rows = [...docs.entries()]
        .filter(([path, data]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/') && filters.every((f) => data[f.field] === f.value))
        .map(([path, data]) => ({ id: path.slice(prefix.length), exists: true, data: () => data }));
      return { empty: rows.length === 0, size: rows.length, docs: rows };
    }
  });
  const firestore = {
    doc,
    collection: (name: string) => {
      touched.push(name);
      return query(name, []);
    },
    getAll: async (...refs: { get: () => Promise<unknown> }[]) => Promise.all(refs.map((ref) => ref.get())),
    runTransaction
  };
  return { docs, touched, writes, deleted, verifyIdToken, firestore };
});

const reviewer = vi.hoisted(() => {
  const create = vi.fn();
  class APIError extends Error {
    status = 500;
  }
  class AuthenticationError extends APIError {}
  class RateLimitError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static AuthenticationError = AuthenticationError;
    static RateLimitError = RateLimitError;
    beta = { messages: { create } };
  }
  return { create, Anthropic };
});

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: fb.verifyIdToken }) }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => fb.firestore,
  FieldValue: { increment: (n: number) => n },
  Timestamp: { fromMillis: (ms: number) => ms }
}));
vi.mock('firebase-functions/v2/https', () => ({ onRequest: (_options: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_options: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (_options: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/v2/options', () => ({ setGlobalOptions: vi.fn() }));
vi.mock('firebase-functions/params', () => ({ defineSecret: () => ({ value: () => 'test-key' }) }));
vi.mock('@anthropic-ai/sdk', () => ({ default: reviewer.Anthropic }));

import { CACHE_VERSION } from './analysis-cache';
import { endOfGameFacts } from './game-facts';
import { TIMELINE_VERSION } from './timeline-features';
import {
  draftAdvice,
  enrichPlayer,
  gameReview,
  getCompAnalysis,
  getOpponentHistory,
  refreshTeamData,
  refreshTeamDataOnce,
  refreshTeams,
  syncTeamMember
} from './index';

type Handler = (req: unknown, res: unknown) => Promise<void>;

/**
 * What stays at the root whatever the team, and nothing else: the shared match cache, the
 * champion data the crawler builds, the key probe's document, the access list and the teams list.
 * `teams` is the collection itself; a team's own documents live under `teams/{id}/` and are not
 * global.
 */
const GLOBAL = ['matchCache', 'meta/championTraits', 'matchupIndex', 'championStats', 'meta/keyHealth', 'access', 'teams'];
const isGlobal = (path: string) => GLOBAL.some((g) => path === g || (g !== 'teams' && path.startsWith(g + '/')));

const google = { sign_in_provider: 'google.com' };
const TOKENS: Record<string, { email?: string; firebase: { sign_in_provider: string } }> = {
  /** A root contributor, listed on team b as a contributor too. */
  editor: { email: 'editor@example.com', firebase: google },
  /** A contributor on team b and nothing else: no root entry. */
  teamOnly: { email: 'teamonly@example.com', firebase: google },
  /** A root viewer, on no team. */
  rootViewer: { email: 'viewer@example.com', firebase: google },
  /** A root admin, on no team list. */
  rootAdmin: { email: 'lead@example.com', firebase: google },
  /** Team b's contributor on a provider the rules do not accept. */
  password: { email: 'teamonly@example.com', firebase: { sign_in_provider: 'password' } }
};

/** The membership lists: the root's and team b's. */
function seedAccess(): void {
  fb.docs.set('access/editor@example.com', { active: true, role: 'contributor' });
  fb.docs.set('access/viewer@example.com', { active: true, role: 'viewer' });
  fb.docs.set('access/lead@example.com', { active: true, role: 'admin' });
  fb.docs.set('teams/b/access/editor@example.com', { email: 'editor@example.com', active: true, role: 'contributor' });
  fb.docs.set('teams/b/access/teamonly@example.com', { email: 'teamonly@example.com', active: true, role: 'contributor' });
}

async function call(handler: unknown, init: { method?: string; token?: string; body?: unknown } = {}) {
  const sent: { status: number; body?: unknown } = { status: 200 };
  const res = {
    status(code: number) {
      sent.status = code;
      return res;
    },
    json(body: unknown) {
      sent.body = body;
      return res;
    },
    send(body: unknown) {
      sent.body = body;
      return res;
    }
  };
  const req = {
    method: init.method ?? 'POST',
    headers: init.token ? { authorization: `Bearer ${init.token}` } : {},
    query: {},
    body: init.body
  };
  await (handler as Handler)(req, res);
  return sent;
}

// ---- The fixtures: one team, one game ----------------------------------------

const MATCH_ID = 'EUW1_7000000001';
const ROSTER = ['Ruan', 'Dan', 'Jay', 'Kai', 'Sam'];
const ROLE = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
const POSITION = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const OURS = ['Ornn', 'LeeSin', 'Ahri', 'Jinx', 'Thresh'];
const THEIRS = ['Darius', 'Graves', 'Syndra', 'Caitlyn', 'Lux'];
const puuidOf = (name: string) => 'puuid-' + name.toLowerCase();

function participant(puuid: string, championName: string, teamId: number, teamPosition: string, win: boolean) {
  return { puuid, championName, win, teamId, teamPosition, kills: 3, deaths: 2, assists: 5, cs: 180, damage: 15000, damageTaken: 20000, ccTime: 30, visionScore: 25, buildingDamage: 2000 };
}

function side(teamId: number, win: boolean) {
  return { teamId, firstBlood: win, firstTower: win, dragons: win ? 3 : 1, barons: win ? 1 : 0, heralds: 1, grubs: 3, towers: win ? 9 : 3, inhibitors: win ? 1 : 0 };
}

/** One Flex game the whole roster won, at the current cache version, as `matchCache/{id}` holds it. */
const cachedMatch = {
  cacheVersion: CACHE_VERSION,
  queueId: 440,
  gameCreation: Date.UTC(2026, 8, 20, 19),
  durationSec: 1800,
  teams: [side(100, true), side(200, false)],
  participants: [
    ...ROSTER.map((name, i) => participant(puuidOf(name), OURS[i], 100, POSITION[i], true)),
    ...THEIRS.map((champion, i) => participant('enemy-' + i, champion, 200, POSITION[i], false))
  ]
};

/** The same game as the analysis stores it, enough for a review. */
const analysisGame = {
  matchId: MATCH_ID,
  compId: 'c1',
  compName: 'Dive',
  nearCompName: 'Dive',
  nearOverlap: 5,
  rosterCount: 5,
  win: true,
  side: 'blue',
  enemyChampions: THEIRS,
  enemies: THEIRS.map((champion, i) => ({ position: ROLE[i], champion })),
  queue: 'Flex',
  date: cachedMatch.gameCreation,
  durationSec: 1800,
  players: ROSTER.map((name, i) => ({ name, position: ROLE[i], champion: OURS[i], kills: 3, deaths: 2, assists: 5, cs: 180, damage: 15000 }))
};

const recording = {
  matchId: MATCH_ID,
  recordedAt: '2026-09-21T20:00:00.000Z',
  recorderVersion: 5,
  durationSec: 1800,
  ourSide: 'blue',
  seats: [],
  samples: [],
  events: [],
  shots: [{ sec: 600, kind: 'death', label: 'Ruan (Top) died in their jungle', seat: 'Top', docId: `${MATCH_ID}__600` }]
};

/** A team's documents, at the root or under a prefix; `p` builds the path. */
function seedTeam(p: (path: string) => string): void {
  ROSTER.forEach((name, i) => fb.docs.set(p(`players/p${i}`), { name, role: ROLE[i], order: i, profile: { region: 'euw', riotTag: 'EUW' } }));
  fb.docs.set(p('comps/c1'), { name: 'Dive', picks: { Top: 'Ornn', Jungle: 'LeeSin', Mid: 'Ahri', ADC: 'Jinx', Support: 'Thresh' } });
  fb.docs.set(p('meta/settings'), { teamName: 'The team', autoReview: true });
  fb.docs.set(p('meta/compAnalysis'), { games: [analysisGame], generatedAt: '2026-09-26T04:30:00.000Z' });
  fb.docs.set(p(`matchTimeline/${MATCH_ID}`), { matchId: MATCH_ID, timelineVersion: TIMELINE_VERSION, facts: endOfGameFacts(analysisGame as never) });
  fb.docs.set(p('seriesGames/g1'), { matchId: MATCH_ID, seriesId: 's1', gameNumber: 1, bans: ['Zed'], ourChampions: OURS, theirChampions: THEIRS });
  fb.docs.set(p('tournamentSeries/s1'), { tournamentId: 't1' });
  fb.docs.set(p('tournaments/t1'), { kind: 'league', fearless: true });
  fb.docs.set(p(`matchNotes/${MATCH_ID}`), { text: 'We waited too long at drake.' });
  fb.docs.set(p(`replayRecordings/${MATCH_ID}`), recording);
  fb.docs.set(p(`replayShots/${MATCH_ID}__600`), { matchId: MATCH_ID, sec: 600, data: 'AAAA', mediaType: 'image/jpeg' });
}

/** The seeded timeline a version behind, so the handler has to fetch and write one. */
function staleTimeline(p: (path: string) => string): void {
  fb.docs.set(p(`matchTimeline/${MATCH_ID}`), { matchId: MATCH_ID, timelineVersion: TIMELINE_VERSION - 1 });
}

const root = (path: string) => path;
const teamB = (path: string) => `teams/b/${path}`;
/** `teams/b/players` back to `players`, so a scoped run can be compared with the root one name for name. */
const unprefixed = (path: string) => path.replace(/^teams\/b\//, '');

const analysisRequest = (teamId?: string) => ({
  players: ROSTER.map((name, i) => ({ id: 'p' + i, name, riotTag: 'EUW', region: 'euw' })),
  comps: [{ id: 'c1', name: 'Dive', champions: OURS }],
  overrides: {},
  ...(teamId !== undefined && { teamId })
});

/** Riot, by URL. */
function riotAnswer(url: string): unknown {
  if (url.includes('/riot/account/v1/accounts/by-riot-id/')) {
    const name = decodeURIComponent(url.split('/by-riot-id/')[1].split('/')[0]);
    return { puuid: puuidOf(name), gameName: name, tagLine: 'EUW' };
  }
  if (url.includes('/lol/summoner/v4/')) return { profileIconId: 7 };
  if (url.includes('/lol/league/v4/')) return [{ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'II', leaguePoints: 40, wins: 60, losses: 50 }];
  if (url.includes('/ids?')) return [MATCH_ID];
  // Two frames and no events: the least `buildMatchTimeline` derives a document from (one frame is nothing).
  if (url.endsWith('/timeline')) {
    return { info: { frameInterval: 60000, participants: [], frames: [{ timestamp: 0, participantFrames: {} }, { timestamp: 60000, participantFrames: {} }] } };
  }
  if (url.includes('champion-mastery')) return [];
  if (url.includes('versions.json')) return ['14.1.1'];
  if (url.includes('champion.json')) return { data: {} };
  return [];
}

const fetchMock = vi.fn();

beforeEach(() => {
  fb.docs.clear();
  fb.touched.length = 0;
  fb.writes.length = 0;
  fb.deleted.length = 0;
  seedAccess();
  fb.docs.set(`matchCache/${MATCH_ID}`, cachedMatch);
  fb.verifyIdToken.mockReset().mockImplementation(async (token: string) => {
    const decoded = TOKENS[token];
    if (!decoded) throw new Error('Firebase ID token has invalid signature.');
    return decoded;
  });
  fetchMock.mockReset().mockImplementation(async (url: string) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => riotAnswer(String(url))
  }));
  vi.stubGlobal('fetch', fetchMock);
  reviewer.create.mockReset().mockImplementation(async () => ({
    model: 'claude-opus-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: '{}' }],
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 }
  }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const writtenPaths = () => fb.writes.map((w) => w.path);
const uniqueTouched = () => [...new Set(fb.touched)];

/** Every recorded path is under the team's prefix or on the global list; the ones that are not are the failure. */
function expectAllScoped(prefix: string): void {
  const strays = uniqueTouched().filter((path) => !path.startsWith(prefix) && !isGlobal(path));
  expect(strays, 'paths outside the team and not global').toEqual([]);
}

/** A root run touched no team's prefix at all: the guard the root cases need, since every path starts with ''. */
function expectRootOnly(): void {
  const prefixed = uniqueTouched().filter((path) => path.startsWith('teams/'));
  expect(prefixed, 'paths under a teams/ prefix on a root run').toEqual([]);
}

/** Runs one handler twice, at the root and for team b, and answers what each touched. */
async function bothScopes(run: (teamId: string | undefined) => Promise<unknown>): Promise<{ root: string[]; team: string[] }> {
  seedTeam(root);
  await run(undefined);
  const rootTouched = uniqueTouched();
  fb.docs.clear();
  fb.touched.length = 0;
  fb.writes.length = 0;
  fb.deleted.length = 0;
  seedAccess();
  fb.docs.set(`matchCache/${MATCH_ID}`, cachedMatch);
  seedTeam(teamB);
  await run('b');
  return { root: rootTouched, team: uniqueTouched() };
}

// ---- getCompAnalysis ----------------------------------------------------------

describe('getCompAnalysis', () => {
  it('without teamId reads the root scrims and writes meta/compAnalysis, echoing default', async () => {
    seedTeam(root);
    const sent = await call(getCompAnalysis, { token: 'editor', body: analysisRequest() });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ teamId: 'default', totalTeamGames: 1 });
    expect(fb.touched).toContain('scrims');
    expect(fb.touched).toContain('matchTimeline');
    expect(writtenPaths()).toEqual(['meta/compAnalysis']);
    expectRootOnly();
    // The stored document is what the app listens to, and it is unchanged in shape: the echo is on the answer only.
    expect(fb.writes[0].data).not.toHaveProperty('teamId');
  });

  it('with teamId b touches only teams/b/ and the global data, and writes teams/b/meta/compAnalysis', async () => {
    seedTeam(teamB);
    const sent = await call(getCompAnalysis, { token: 'editor', body: analysisRequest('b') });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ teamId: 'b', totalTeamGames: 1 });
    expectAllScoped('teams/b/');
    expect(fb.touched).toContain('teams/b/scrims');
    expect(fb.touched).toContain('teams/b/matchTimeline');
    expect(writtenPaths()).toEqual(['teams/b/meta/compAnalysis']);
    expect(fb.touched).toContain(`matchCache/${MATCH_ID}`);
  });

  it('touches the same names for team b as for the root, prefixed', async () => {
    const { root: atRoot, team } = await bothScopes(async (teamId) => call(getCompAnalysis, { token: 'editor', body: analysisRequest(teamId) }));
    expect(new Set(team.map(unprefixed))).toEqual(new Set(atRoot));
    // And the root run's names are today's literals, written out.
    expect(new Set(atRoot)).toEqual(new Set(['access/editor@example.com', 'scrims', `matchCache/${MATCH_ID}`, 'matchTimeline', 'meta/compAnalysis']));
    // The team run read the team's own list beside the root's: the one path under the prefix the root run has no twin of.
    expect(team).toContain('teams/b/access/editor@example.com');
  });

  it('refuses a teamId that is not a team id before touching any data', async () => {
    const sent = await call(getCompAnalysis, { token: 'editor', body: analysisRequest('B') });
    expect(sent).toEqual({ status: 400, body: { error: 'teamId must be a team id.' } });
    expect(fb.writes).toEqual([]);
    // Since release 3 the body is parsed before the door, so not even the access entry is read.
    expect(uniqueTouched()).toEqual([]);
  });
});

// ---- gameReview ----------------------------------------------------------------

describe('gameReview', () => {
  it('without teamId reads the root game, timeline, settings, comp, note, series and recording, and writes gameReviews/{matchId}', async () => {
    seedTeam(root);
    const sent = await call(gameReview, { token: 'editor', body: { matchId: MATCH_ID } });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ matchId: MATCH_ID, teamId: 'default', trigger: 'manual' });
    expect(writtenPaths()).toEqual([`gameReviews/${MATCH_ID}`]);
    expect(fb.writes[0].data).not.toHaveProperty('teamId');
    expectRootOnly();
    expect(new Set(uniqueTouched())).toEqual(
      new Set([
        'access/editor@example.com',
        'meta/compAnalysis',
        `matchTimeline/${MATCH_ID}`,
        `replayRecordings/${MATCH_ID}`,
        `replayShots/${MATCH_ID}__600`,
        'meta/settings',
        'comps/c1',
        `matchNotes/${MATCH_ID}`,
        'meta/championTraits',
        'matchupIndex',
        'seriesGames',
        'tournamentSeries/s1',
        'tournaments/t1',
        `gameReviews/${MATCH_ID}`
      ])
    );
  });

  it('with teamId b touches only teams/b/ and the global data, and writes teams/b/gameReviews/{matchId}', async () => {
    seedTeam(teamB);
    const sent = await call(gameReview, { token: 'editor', body: { matchId: MATCH_ID, teamId: 'b' } });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ matchId: MATCH_ID, teamId: 'b' });
    expectAllScoped('teams/b/');
    expect(writtenPaths()).toEqual([`teams/b/gameReviews/${MATCH_ID}`]);
    for (const global of ['meta/championTraits', 'matchupIndex']) expect(fb.touched).toContain(global);
  });

  it('touches the same names for team b as for the root, prefixed', async () => {
    const { root: atRoot, team } = await bothScopes(async (teamId) => call(gameReview, { token: 'editor', body: { matchId: MATCH_ID, ...(teamId && { teamId }) } }));
    expect(new Set(team.map(unprefixed))).toEqual(new Set(atRoot));
  });

  it('reads the game from the team when the analysis is only at the root, and says so', async () => {
    // Team b has no analysis: its review must not find the root's game.
    seedTeam(root);
    const sent = await call(gameReview, { token: 'editor', body: { matchId: MATCH_ID, teamId: 'b' } });
    expect(sent).toEqual({ status: 400, body: { error: `${MATCH_ID} is not in the analysis. Refresh match data first.` } });
    expect(fb.writes).toEqual([]);
    expect(reviewer.create).not.toHaveBeenCalled();
  });

  it('echoes the team on a declined review too', async () => {
    seedTeam(teamB);
    reviewer.create.mockImplementation(async () => ({ model: 'claude-opus-5', stop_reason: 'refusal', content: [], usage: { input_tokens: 1, output_tokens: 0 } }));
    const sent = await call(gameReview, { token: 'editor', body: { matchId: MATCH_ID, teamId: 'b' } });
    expect(sent).toEqual({ status: 200, body: { declined: true, teamId: 'b' } });
    expect(fb.writes).toEqual([]);
  });

  it('refuses a teamId that is not a team id', async () => {
    const sent = await call(gameReview, { token: 'editor', body: { matchId: MATCH_ID, teamId: 'teams' } });
    expect(sent).toEqual({ status: 400, body: { error: 'teamId must be a team id.' } });
    expect(fb.writes).toEqual([]);
  });

  it("with a stale timeline resolves the roster from the team's players and writes the team's timeline before the review", async () => {
    // The stored timeline is a version behind, so the review has to derive one: that is the one
    // road to `rosterFromPlayers` and `getMatchTimeline`, and both must stay on the team's paths.
    seedTeam(teamB);
    staleTimeline(teamB);
    const sent = await call(gameReview, { token: 'editor', body: { matchId: MATCH_ID, teamId: 'b' } });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ matchId: MATCH_ID, teamId: 'b' });
    expectAllScoped('teams/b/');
    expect(writtenPaths()).toEqual([`teams/b/matchTimeline/${MATCH_ID}`, `teams/b/gameReviews/${MATCH_ID}`]);
    expect(fb.docs.get(`teams/b/matchTimeline/${MATCH_ID}`)).toMatchObject({ matchId: MATCH_ID, timelineVersion: TIMELINE_VERSION });
    for (const name of ['players', 'comps', 'compOverrides']) expect(fb.touched).toContain(`teams/b/${name}`);
    expect(fb.touched).toContain(`matchCache/${MATCH_ID}`);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith(`/matches/${MATCH_ID}/timeline`))).toBe(true);
    // Bom Squad's timeline was neither read nor written.
    expect(fb.touched).not.toContain(`matchTimeline/${MATCH_ID}`);
  });

  it('with a stale timeline at the root reads and writes the root literals, and the same names for team b', async () => {
    const { root: atRoot, team } = await bothScopes(async (teamId) => {
      staleTimeline(teamId ? teamB : root);
      return call(gameReview, { token: 'editor', body: { matchId: MATCH_ID, ...(teamId && { teamId }) } });
    });
    expect(new Set(team.map(unprefixed))).toEqual(new Set(atRoot));
    for (const name of ['players', 'comps', 'compOverrides', `matchTimeline/${MATCH_ID}`]) expect(atRoot).toContain(name);
    expect(writtenPaths()).toEqual([`teams/b/matchTimeline/${MATCH_ID}`, `teams/b/gameReviews/${MATCH_ID}`]);
  });
});

// ---- refreshTeamDataOnce ---------------------------------------------------------

describe('refreshTeamDataOnce', () => {
  it('with no body runs the root: players merged, ranks recorded, analysis written, log at meta/refreshLog', async () => {
    seedTeam(root);
    const sent = await call(refreshTeamDataOnce, { token: 'editor' });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ trigger: 'manual', teamId: 'default', playersUpdated: ROSTER, ranksRecorded: 5, analysis: { ok: true, games: 1 } });
    const written = writtenPaths();
    for (let i = 0; i < ROSTER.length; i += 1) {
      expect(written).toContain(`players/p${i}`);
      expect(written).toContain(`rankHistory/p${i}`);
    }
    expect(written).toContain('meta/compAnalysis');
    expect(written[written.length - 1]).toBe('meta/refreshLog');
    expect(fb.docs.get('meta/refreshLog')).toMatchObject({ teamId: 'default' });
    expectRootOnly();
  });

  it('with { teamId: b } touches only teams/b/ and the global data, and writes teams/b/meta/refreshLog', async () => {
    seedTeam(teamB);
    const sent = await call(refreshTeamDataOnce, { token: 'editor', body: { teamId: 'b' } });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ trigger: 'manual', teamId: 'b', playersUpdated: ROSTER, analysis: { ok: true, games: 1 } });
    expectAllScoped('teams/b/');
    const written = writtenPaths();
    for (let i = 0; i < ROSTER.length; i += 1) {
      expect(written).toContain(`teams/b/players/p${i}`);
      expect(written).toContain(`teams/b/rankHistory/p${i}`);
    }
    expect(written).toContain('teams/b/meta/compAnalysis');
    expect(written[written.length - 1]).toBe('teams/b/meta/refreshLog');
    expect(written).not.toContain('meta/refreshLog');
    // The match cache is written at the root for every team.
    expect(fb.touched).toContain(`matchCache/${MATCH_ID}`);
  });

  it('touches the same names for team b as for the root, prefixed', async () => {
    const { root: atRoot, team } = await bothScopes(async (teamId) => call(refreshTeamDataOnce, { token: 'editor', body: teamId ? { teamId } : undefined }));
    expect(new Set(team.map(unprefixed))).toEqual(new Set(atRoot));
    // The root run's names are today's literals, written out: the players, the analysis, the
    // timelines, and, with autoReview on and the game's timeline current, one morning review.
    expect(new Set(atRoot)).toEqual(
      new Set([
        'access/editor@example.com',
        'players',
        'comps',
        'compOverrides',
        `matchCache/${MATCH_ID}`,
        ...ROSTER.map((_, i) => `players/p${i}`),
        ...ROSTER.map((_, i) => `rankHistory/p${i}`),
        'scrims',
        'matchTimeline',
        'meta/compAnalysis',
        'practiceGames',
        `matchTimeline/${MATCH_ID}`,
        'meta/settings',
        'gameReviews',
        `replayRecordings/${MATCH_ID}`,
        `replayShots/${MATCH_ID}__600`,
        'comps/c1',
        `matchNotes/${MATCH_ID}`,
        'meta/championTraits',
        'matchupIndex',
        'seriesGames',
        'tournamentSeries/s1',
        'tournaments/t1',
        `gameReviews/${MATCH_ID}`,
        'meta/refreshLog'
      ])
    );
    // The morning review it wrote went under the prefix too.
    expect(writtenPaths()).toContain(`teams/b/gameReviews/${MATCH_ID}`);
  });

  it('refuses a teamId that is not a team id without running anything', async () => {
    const sent = await call(refreshTeamDataOnce, { token: 'editor', body: { teamId: 'B' } });
    expect(sent).toEqual({ status: 400, body: { error: 'teamId must be a team id.' } });
    expect(fb.writes).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with a stale timeline backfills it under the team's prefix, and the morning review then reads it there", async () => {
    seedTeam(teamB);
    staleTimeline(teamB);
    const sent = await call(refreshTeamDataOnce, { token: 'editor', body: { teamId: 'b' } });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ teamId: 'b', timelines: { fetched: 1, failed: 0 }, reviews: { written: [MATCH_ID] } });
    expectAllScoped('teams/b/');
    const written = writtenPaths();
    expect(written).toContain(`teams/b/matchTimeline/${MATCH_ID}`);
    expect(written.indexOf(`teams/b/matchTimeline/${MATCH_ID}`)).toBeLessThan(written.indexOf(`teams/b/gameReviews/${MATCH_ID}`));
    expect(fb.docs.get(`teams/b/matchTimeline/${MATCH_ID}`)).toMatchObject({ timelineVersion: TIMELINE_VERSION });
    expect(fb.touched).not.toContain(`matchTimeline/${MATCH_ID}`);
    expect(fb.touched).toContain(`matchCache/${MATCH_ID}`);
  });

  it('with a stale timeline at the root writes the root literal, and the same names for team b', async () => {
    const { root: atRoot, team } = await bothScopes(async (teamId) => {
      staleTimeline(teamId ? teamB : root);
      return call(refreshTeamDataOnce, { token: 'editor', body: teamId ? { teamId } : undefined });
    });
    expect(new Set(team.map(unprefixed))).toEqual(new Set(atRoot));
    expect(atRoot).toContain(`matchTimeline/${MATCH_ID}`);
    expect(writtenPaths()).toContain(`teams/b/matchTimeline/${MATCH_ID}`);
  });
});

// ---- refreshTeamData -----------------------------------------------------------------

describe('refreshTeamData, the 06:30 schedule', () => {
  it("runs the root, string for string, and touches no team's prefix", async () => {
    // The rule of the release: Bom Squad's morning is what it was before. `runTeamRefresh` now takes
    // the paths as an argument, and this is what pins the argument the schedule hands it.
    seedTeam(root);
    await (refreshTeamData as unknown as () => Promise<void>)();
    const written = writtenPaths();
    for (let i = 0; i < ROSTER.length; i += 1) expect(written).toContain(`players/p${i}`);
    expect(written).toContain('meta/compAnalysis');
    expect(written).toContain(`gameReviews/${MATCH_ID}`);
    expect(written[written.length - 1]).toBe('meta/refreshLog');
    expect(fb.docs.get('meta/refreshLog')).toMatchObject({ teamId: 'default', trigger: 'schedule', playersUpdated: ROSTER });
    expectRootOnly();
    expect(fb.touched).not.toContain('teams');
  });
});

// ---- refreshTeams ------------------------------------------------------------------

const tick = () => (refreshTeams as unknown as () => Promise<void>)();

describe('refreshTeams', () => {
  it('with no teams reads the list and touches nothing else', async () => {
    await tick();
    expect(uniqueTouched()).toEqual(['teams']);
    expect(fb.writes).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('with two teams never refreshed runs exactly one, under its own prefix, and takes its turn before the run', async () => {
    fb.docs.set('teams/a', { name: 'Team A', refresh: 'on' });
    fb.docs.set('teams/b', { name: 'Team B', refresh: 'on' });
    seedTeam(teamB);
    seedTeam((path) => `teams/a/${path}`);
    await tick();
    const logs = writtenPaths().filter((path) => path.endsWith('meta/refreshLog'));
    expect(logs).toEqual(['teams/a/meta/refreshLog']);
    expect(fb.docs.get('teams/a/meta/refreshLog')).toMatchObject({ teamId: 'a', trigger: 'schedule' });
    expect(writtenPaths().some((path) => path.startsWith('teams/b/'))).toBe(false);
    expect(writtenPaths()).not.toContain('meta/refreshLog');
    // The first write of the tick is the team's own document taking the turn, merged, so the name survives.
    expect(fb.writes[0]).toMatchObject({ path: 'teams/a', options: { merge: true } });
    expect(fb.docs.get('teams/a')).toMatchObject({ name: 'Team A', refresh: 'on' });
    expect(typeof fb.docs.get('teams/a')?.refreshStartedAt).toBe('string');
    expect(fb.docs.get('teams/b')).not.toHaveProperty('refreshStartedAt');
    // The team's own document and the other team's log are the tick's; nothing else outside the run.
    const strays = uniqueTouched().filter((path) => !path.startsWith('teams/a/') && !isGlobal(path) && path !== 'teams/a' && path !== 'teams/b/meta/refreshLog');
    expect(strays).toEqual([]);
  });

  it('does not pick a team again whose run started today and never wrote its log', async () => {
    // Team a's 07:00 run was killed by the timeout: the document says today, the log still says last week.
    fb.docs.set('teams/a', { refresh: 'on', refreshStartedAt: new Date().toISOString() });
    fb.docs.set('teams/a/meta/refreshLog', { ranAt: '2026-09-20T05:00:00.000Z' });
    fb.docs.set('teams/b', { refresh: 'on' });
    fb.docs.set('teams/b/meta/refreshLog', { ranAt: '2026-09-26T05:15:00.000Z' });
    seedTeam(teamB);
    await tick();
    const logs = writtenPaths().filter((path) => path.endsWith('meta/refreshLog'));
    expect(logs).toEqual(['teams/b/meta/refreshLog']);
    expect(writtenPaths()).not.toContain('teams/a');
    // With b done too, the next tick has nothing: a's turn was today's, dead or not.
    fb.writes.length = 0;
    await tick();
    expect(fb.writes).toEqual([]);
  });

  it('skips a document whose id is not a team id before reading its log, so a stray document cannot fail the tick', async () => {
    // A hand-made `teams/Team B` in the console: `teamPaths` would throw on it inside the Promise.all
    // and the whole tick with it, so the handler must not build its paths at all.
    fb.docs.set('teams/Team B', { refresh: 'on' });
    fb.docs.set('teams/b', { refresh: 'on' });
    seedTeam(teamB);
    await tick();
    expect(uniqueTouched()).not.toContain('teams/Team B/meta/refreshLog');
    expect(writtenPaths().filter((path) => path.endsWith('meta/refreshLog'))).toEqual(['teams/b/meta/refreshLog']);
    expect(fb.docs.get('teams/b/meta/refreshLog')).toMatchObject({ teamId: 'b' });
  });

  it('skips a team already run today and one switched off, and takes the one refreshed longest ago', async () => {
    fb.docs.set('teams/a', { refresh: 'on' });
    fb.docs.set('teams/a/meta/refreshLog', { ranAt: new Date().toISOString() });
    fb.docs.set('teams/b', { refresh: 'on' });
    fb.docs.set('teams/b/meta/refreshLog', { ranAt: '2026-09-20T05:15:00.000Z' });
    fb.docs.set('teams/c', { refresh: 'off' });
    fb.docs.set('teams/c/meta/refreshLog', { ranAt: '2026-09-01T05:15:00.000Z' });
    seedTeam(teamB);
    await tick();
    const logs = writtenPaths().filter((path) => path.endsWith('meta/refreshLog'));
    expect(logs).toEqual(['teams/b/meta/refreshLog']);
    expect(fb.docs.get('teams/b/meta/refreshLog')).toMatchObject({ teamId: 'b', trigger: 'schedule', playersUpdated: ROSTER });
  });

  it('with every team run today returns without a write', async () => {
    fb.docs.set('teams/a', { refresh: 'on' });
    fb.docs.set('teams/a/meta/refreshLog', { ranAt: new Date().toISOString() });
    await tick();
    expect(fb.writes).toEqual([]);
    expect(uniqueTouched()).toEqual(['teams', 'teams/a/meta/refreshLog']);
  });

  it('never writes the root log', async () => {
    fb.docs.set('teams/b', { refresh: 'on' });
    seedTeam(teamB);
    await tick();
    expect(writtenPaths()).not.toContain('meta/refreshLog');
    expect(fb.docs.has('meta/refreshLog')).toBe(false);
  });
});

// ---- Who may call them (release 3, 27 Sep 2026) ---------------------------------------------------

/**
 * The six token-checked handlers, each behind `admitEditor` or `admitMember` for the team its body
 * names. A handler that forgot the door, or asked the root list for a team request, would pass
 * `admin-auth.spec.ts` and still answer the wrong person, so every one is driven here with a
 * contributor listed on team b alone, a root viewer and a root admin, and a refused request is
 * checked to reach none of the work: no write, no Riot call, no model call.
 */
type Least = 'member' | 'editor';

/** A body for each handler, at the root when `teamId` is undefined. */
const BODIES: Record<string, (teamId?: string) => unknown> = {
  enrichPlayer: (teamId) => ({ summonerName: 'Ruan', riotTag: 'EUW', region: 'euw', role: 'Top', ...(teamId !== undefined && { teamId }) }),
  getOpponentHistory: (teamId) => ({
    players: [
      { id: 'a', name: 'Ruan', riotTag: 'EUW', region: 'euw' },
      { id: 'b', name: 'Dan', riotTag: 'EUW', region: 'euw' }
    ],
    ...(teamId !== undefined && { teamId })
  }),
  getCompAnalysis: (teamId) => analysisRequest(teamId),
  refreshTeamDataOnce: (teamId) => (teamId !== undefined ? { teamId } : undefined),
  draftAdvice: (teamId) => ({ action: 'pick', candidates: ['Ornn'], ...(teamId !== undefined && { teamId }) }),
  gameReview: (teamId) => ({ matchId: MATCH_ID, ...(teamId !== undefined && { teamId }) })
};

const DOORS: Array<[string, unknown, Least]> = [
  ['enrichPlayer', enrichPlayer, 'editor'],
  ['getOpponentHistory', getOpponentHistory, 'member'],
  ['getCompAnalysis', getCompAnalysis, 'editor'],
  ['refreshTeamDataOnce', refreshTeamDataOnce, 'editor'],
  ['draftAdvice', draftAdvice, 'editor'],
  ['gameReview', gameReview, 'editor']
];

/** Whether a handler did any of its work, as opposed to only checking who asked. */
const didWork = () => fb.writes.length > 0 || fetchMock.mock.calls.length > 0 || reviewer.create.mock.calls.length > 0;

const REFUSED = (least: Least) => ({ error: expect.stringMatching(least === 'editor' ? /^Editor access required to / : /^Member access required to /) });

describe.each(DOORS)('%s, the door', (name, handler, least) => {
  const body = BODIES[name];

  it('lets a contributor listed on team b alone work for team b, reading both lists and nothing else outside the prefix', async () => {
    seedTeam(teamB);
    const sent = await call(handler, { token: 'teamOnly', body: body('b') });
    expect(sent.status).toBe(200);
    expect(fb.touched).toContain('access/teamonly@example.com');
    expect(fb.touched).toContain('teams/b/access/teamonly@example.com');
    expectAllScoped('teams/b/');
  });

  it('refuses that contributor on the root with 403 and does none of the work', async () => {
    seedTeam(root);
    const sent = await call(handler, { token: 'teamOnly', body: body() });
    expect(sent).toEqual({ status: 403, body: REFUSED(least) });
    expect(uniqueTouched()).toEqual(['access/teamonly@example.com']);
    expect(didWork()).toBe(false);
  });

  it('refuses that contributor on another team with 403 and does none of the work', async () => {
    seedTeam((path) => `teams/c/${path}`);
    const sent = await call(handler, { token: 'teamOnly', body: body('c') });
    expect(sent).toEqual({ status: 403, body: REFUSED(least) });
    expect(uniqueTouched()).toEqual(['access/teamonly@example.com', 'teams/c/access/teamonly@example.com']);
    expect(didWork()).toBe(false);
  });

  it(least === 'editor' ? 'refuses a root viewer as an editor' : 'lets a root viewer in as a member', async () => {
    seedTeam(root);
    const sent = await call(handler, { token: 'rootViewer', body: body() });
    if (least === 'editor') {
      expect(sent).toEqual({ status: 403, body: REFUSED(least) });
      expect(didWork()).toBe(false);
    } else {
      expect(sent.status).toBe(200);
    }
  });

  it('refuses a root viewer on team b, where they are not listed', async () => {
    seedTeam(teamB);
    const sent = await call(handler, { token: 'rootViewer', body: body('b') });
    expect(sent).toEqual({ status: 403, body: REFUSED(least) });
    expect(didWork()).toBe(false);
  });

  it("lets a root admin work for team b without an entry on b's list, which is not read", async () => {
    seedTeam(teamB);
    const sent = await call(handler, { token: 'rootAdmin', body: body('b') });
    expect(sent.status).toBe(200);
    expect(fb.touched).toContain('access/lead@example.com');
    expect(fb.touched).not.toContain('teams/b/access/lead@example.com');
    expectAllScoped('teams/b/');
  });

  it('refuses a request with no token with 401, before verifying anything', async () => {
    seedTeam(teamB);
    const sent = await call(handler, { body: body('b') });
    expect(sent).toEqual({ status: 401, body: { error: 'Missing Authorization: Bearer <ID_TOKEN> header.' } });
    expect(fb.verifyIdToken).not.toHaveBeenCalled();
    expect(uniqueTouched()).toEqual([]);
    expect(didWork()).toBe(false);
  });

  it('refuses a token that does not verify with 401', async () => {
    seedTeam(teamB);
    const sent = await call(handler, { token: 'forged', body: body('b') });
    expect(sent.status).toBe(401);
    expect(uniqueTouched()).toEqual([]);
    expect(didWork()).toBe(false);
  });

  it("refuses team b's contributor on a provider the rules do not accept, before any list is read", async () => {
    seedTeam(teamB);
    const sent = await call(handler, { token: 'password', body: body('b') });
    expect(sent).toEqual({ status: 403, body: { error: expect.stringMatching(/^Sign in with Google to /) } });
    expect(uniqueTouched()).toEqual([]);
    expect(didWork()).toBe(false);
  });

  it('refuses a teamId that is not a team id with 400 before the token is looked at', async () => {
    const sent = await call(handler, { token: 'teamOnly', body: body('B') });
    expect(sent).toEqual({ status: 400, body: { error: 'teamId must be a team id.' } });
    expect(fb.verifyIdToken).not.toHaveBeenCalled();
    expect(uniqueTouched()).toEqual([]);
    expect(didWork()).toBe(false);
  });

  it('answers the CORS preflight with 204 and refuses GET with 405', async () => {
    expect(await call(handler, { method: 'OPTIONS' })).toEqual({ status: 204, body: '' });
    expect(await call(handler, { method: 'GET', token: 'teamOnly', body: body('b') })).toEqual({ status: 405, body: { error: 'Method not allowed. Use POST.' } });
    expect(uniqueTouched()).toEqual([]);
  });
});

// ---- syncTeamMember, the members index ----------------------------------------------------------

type Trigger = (event: { params: { teamId: string; email: string }; document: string; data?: unknown }) => Promise<void>;

/** Fires the trigger for one entry as Firestore would after a write to it; the entry itself is whatever `fb.docs` holds. */
const fire = (teamId: string, email: string) =>
  (syncTeamMember as unknown as Trigger)({ params: { teamId, email }, document: `teams/${teamId}/access/${email}`, data: undefined });

describe('syncTeamMember', () => {
  const X = 'x@example.com';

  it('writes members/{email} with the team when an active entry is created, the whole document and not a merge', async () => {
    fb.docs.set(`teams/b/access/${X}`, { email: X, active: true, role: 'contributor' });
    await fire('b', X);
    expect(fb.writes).toEqual([{ path: `members/${X}`, data: { teams: { b: 'contributor' } }, options: undefined }]);
    expect(fb.deleted).toEqual([]);
    expect(uniqueTouched()).toEqual([`teams/b/access/${X}`, `members/${X}`]);
  });

  it('adds a second team beside the first and follows a role change', async () => {
    fb.docs.set(`members/${X}`, { teams: { a: 'viewer' } });
    fb.docs.set(`teams/b/access/${X}`, { email: X, active: true, role: 'admin' });
    await fire('b', X);
    expect(fb.docs.get(`members/${X}`)).toEqual({ teams: { a: 'viewer', b: 'admin' } });
    fb.docs.set(`teams/b/access/${X}`, { email: X, active: true, role: 'viewer' });
    await fire('b', X);
    expect(fb.docs.get(`members/${X}`)).toEqual({ teams: { a: 'viewer', b: 'viewer' } });
  });

  it('drops the team when the entry is switched off, keeping the others', async () => {
    fb.docs.set(`members/${X}`, { teams: { a: 'viewer', b: 'admin' } });
    fb.docs.set(`teams/b/access/${X}`, { email: X, active: false, role: 'admin' });
    await fire('b', X);
    expect(fb.docs.get(`members/${X}`)).toEqual({ teams: { a: 'viewer' } });
    expect(fb.deleted).toEqual([]);
  });

  it('deletes the document when the last team goes, rather than writing an empty map', async () => {
    fb.docs.set(`members/${X}`, { teams: { b: 'contributor' } });
    // The entry is gone: the app deleted it, or the whole team with it.
    await fire('b', X);
    expect(fb.deleted).toEqual([`members/${X}`]);
    expect(fb.docs.has(`members/${X}`)).toBe(false);
    expect(fb.writes).toEqual([]);
  });

  it('reads the entry as it now stands rather than trusting the event, so a late delivery cannot undo a newer write', async () => {
    fb.docs.set(`teams/b/access/${X}`, { email: X, active: true, role: 'contributor' });
    await (syncTeamMember as unknown as Trigger)({
      params: { teamId: 'b', email: X },
      document: `teams/b/access/${X}`,
      // A stale delete event for the same entry.
      data: { before: { exists: true, data: () => ({ active: true, role: 'contributor' }) }, after: { exists: false, data: () => undefined } }
    });
    expect(fb.docs.get(`members/${X}`)).toEqual({ teams: { b: 'contributor' } });
  });

  it('does nothing for a deleted entry of a person with no index', async () => {
    await fire('b', X);
    expect(fb.deleted).toEqual([`members/${X}`]);
    expect(fb.writes).toEqual([]);
  });

  it('skips a document id that is not a team id or an email that is not lower-case and trimmed, touching nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const [teamId, email] of [
      ['Team B', X],
      ['default', X],
      ['teams', X],
      ['b', 'X@Example.com'],
      ['b', ' x@example.com'],
      ['b', '']
    ]) {
      fb.docs.set(`teams/${teamId}/access/${email}`, { active: true, role: 'admin' });
      await fire(teamId, email);
    }
    expect(uniqueTouched()).toEqual([]);
    expect(fb.writes).toEqual([]);
    expect(fb.deleted).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(6);
  });

  it("never touches the root access list: Bom Squad's members are not in the index", async () => {
    fb.docs.set(`teams/b/access/${X}`, { email: X, active: true, role: 'contributor' });
    await fire('b', X);
    expect(fb.touched.some((path) => path.startsWith('access/'))).toBe(false);
  });
});
