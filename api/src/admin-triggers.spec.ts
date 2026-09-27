import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The three admin-only manual triggers, as exported from `index.ts` (27 Sep 2026).
 *
 * `admin-auth.spec.ts` tests the door; this tests that each handler actually stands behind it. A
 * handler that forgot to call `admitAdmin` would pass every test of the helper and still answer
 * anyone, so these load the real module with Firebase replaced by fakes — `onRequest` hands back
 * the bare handler — and check that a refused request reaches none of the work: no crawler switch
 * moved, no CommunityDragon fetch, no matchup bucket read.
 */

const fb = vi.hoisted(() => {
  /** Documents by path; an absent path reads as a missing document. */
  const docs = new Map<string, Record<string, unknown>>();
  const verifyIdToken = vi.fn();
  const docGet = vi.fn(async (path: string) => {
    const data = docs.get(path);
    return { exists: data !== undefined, data: () => data };
  });
  const docSet = vi.fn(async (_path: string, _data: unknown, _options?: unknown) => undefined);
  const collectionGet = vi.fn(async (_name: string) => ({ docs: [] as unknown[] }));
  const firestore = {
    doc: (path: string) => ({
      get: () => docGet(path),
      set: (data: unknown, options?: unknown) => docSet(path, data, options)
    }),
    collection: (name: string) => ({ get: () => collectionGet(name) })
  };
  return { docs, verifyIdToken, docGet, docSet, collectionGet, firestore };
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
vi.mock('firebase-functions/v2/options', () => ({ setGlobalOptions: vi.fn() }));
vi.mock('firebase-functions/params', () => ({ defineSecret: () => ({ value: () => 'test-riot-key' }) }));

import { buildMatchupIndexOnce, crawlOnce, riotKeyHealth, syncChampionTraits } from './index';

type Handler = (req: unknown, res: unknown) => Promise<void>;

const CRAWL_STATE = 'crawlState/championStats';

/** Tokens by name, as verifyIdToken would decode them; anything else fails verification. */
const TOKENS: Record<string, { email?: string; firebase: { sign_in_provider: string } }> = {
  admin: { email: 'lead@example.com', firebase: { sign_in_provider: 'google.com' } },
  bootstrap: { email: 'ruanhart7@gmail.com', firebase: { sign_in_provider: 'google.com' } },
  editor: { email: 'editor@example.com', firebase: { sign_in_provider: 'google.com' } },
  e2e: { email: 'e2e@bomsquad.test', firebase: { sign_in_provider: 'custom' } },
  passwordAdmin: { email: 'lead@example.com', firebase: { sign_in_provider: 'password' } }
};

async function call(handler: unknown, init: { method?: string; token?: string; query?: Record<string, string> } = {}) {
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
    query: init.query ?? {},
    body: {}
  };
  await (handler as Handler)(req, res);
  return sent;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fb.docs.clear();
  fb.docs.set('access/lead@example.com', { active: true, role: 'admin' });
  fb.docs.set('access/editor@example.com', { active: true, role: 'contributor' });
  fb.docs.set('access/e2e@bomsquad.test', { active: true, role: 'viewer' });
  fb.docs.set(CRAWL_STATE, { enabled: false });
  fb.verifyIdToken.mockReset().mockImplementation(async (token: string) => {
    const decoded = TOKENS[token];
    if (!decoded) throw new Error('Firebase ID token has invalid signature.');
    return decoded;
  });
  fb.docGet.mockClear();
  fb.docSet.mockClear();
  fb.collectionGet.mockClear();
  // CommunityDragon answers with no champions, so an admitted sync fails inside the work with its
  // own message; the Riot probe is refused outright. Nothing leaves the machine.
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    if (String(url).includes('communitydragon')) return { json: async () => [] };
    throw new Error('offline');
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Whether a handler did any of its work, as opposed to only checking who asked. */
const WORK: Record<string, () => boolean> = {
  crawlOnce: () =>
    fb.docSet.mock.calls.length > 0 || fb.docGet.mock.calls.some(([path]) => path === CRAWL_STATE),
  syncChampionTraits: () => fetchMock.mock.calls.length > 0 || fb.docSet.mock.calls.length > 0,
  buildMatchupIndexOnce: () => fb.collectionGet.mock.calls.length > 0 || fb.docSet.mock.calls.length > 0
};

const HANDLERS: Array<[string, unknown, Record<string, string>]> = [
  // crawlOnce is asked to switch the crawler ON, which is the worst thing an anonymous caller could do.
  ['crawlOnce', crawlOnce, { enable: 'true' }],
  ['syncChampionTraits', syncChampionTraits, {}],
  ['buildMatchupIndexOnce', buildMatchupIndexOnce, {}]
];

describe.each(HANDLERS)('%s', (name, handler, query) => {
  it('refuses a request with no token with 401 and does none of the work', async () => {
    const sent = await call(handler, { query });
    expect(sent).toEqual({ status: 401, body: { error: 'Missing Authorization: Bearer <ID_TOKEN> header.' } });
    expect(fb.verifyIdToken).not.toHaveBeenCalled();
    expect(WORK[name]()).toBe(false);
  });

  it('refuses a token that does not verify with 401', async () => {
    const sent = await call(handler, { token: 'forged', query });
    expect(sent.status).toBe(401);
    expect(WORK[name]()).toBe(false);
  });

  it('refuses a contributor and the e2e viewer with 403', async () => {
    for (const token of ['editor', 'e2e']) {
      const sent = await call(handler, { token, query });
      expect(sent.status).toBe(403);
      expect(sent.body).toEqual({ error: expect.stringMatching(/^Admin access required to /) });
    }
    expect(WORK[name]()).toBe(false);
  });

  it("refuses an admin's email signed in with a provider the rules do not accept", async () => {
    const sent = await call(handler, { token: 'passwordAdmin', query });
    expect(sent.status).toBe(403);
    expect(WORK[name]()).toBe(false);
  });

  it('refuses an admin whose access entry has been switched off', async () => {
    // The role is still admin; only `active` says they are out. getAccessRoleByEmail's
    // `!data?.active` is the one thing standing between this entry and the switch.
    fb.docs.set('access/lead@example.com', { active: false, role: 'admin' });
    const sent = await call(handler, { token: 'admin', query });
    expect(sent).toEqual({ status: 403, body: { error: expect.stringMatching(/^Admin access required to /) } });
    expect(fb.docSet).not.toHaveBeenCalled();
    expect(WORK[name]()).toBe(false);
  });

  it('refuses GET with 405, even from an admin', async () => {
    const sent = await call(handler, { method: 'GET', token: 'admin', query });
    expect(sent).toEqual({ status: 405, body: { error: 'Method not allowed. Use POST.' } });
    expect(WORK[name]()).toBe(false);
  });

  it('answers the CORS preflight with 204 without a token', async () => {
    const sent = await call(handler, { method: 'OPTIONS' });
    expect(sent).toEqual({ status: 204, body: '' });
    expect(WORK[name]()).toBe(false);
  });

  it('lets an admin through to the work', async () => {
    await call(handler, { token: 'admin', query: name === 'crawlOnce' ? { enable: 'false' } : query });
    expect(WORK[name]()).toBe(true);
  });
});

describe('what an admitted request does', () => {
  it('crawlOnce moves the switch for an admin and reports it', async () => {
    const sent = await call(crawlOnce, { token: 'admin', query: { enable: 'false' } });
    expect(fb.docSet).toHaveBeenCalledWith(CRAWL_STATE, { enabled: false }, { merge: true });
    expect(sent).toMatchObject({ status: 200, body: { ok: true, enabled: false, tallied: 0 } });
  });

  it('syncChampionTraits reaches CommunityDragon for the bootstrap admin, who has no access entry', async () => {
    const sent = await call(syncChampionTraits, { token: 'bootstrap' });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('communitydragon.org'));
    // An empty champion list is a failed run, and it says so rather than wiping the stored map.
    expect(sent).toEqual({ status: 500, body: { error: 'Champion traits fetch returned only 0 entries.' } });
    expect(fb.docSet).not.toHaveBeenCalled();
  });

  it('buildMatchupIndexOnce reads the raw buckets for an admin', async () => {
    const sent = await call(buildMatchupIndexOnce, { token: 'admin' });
    expect(fb.collectionGet).toHaveBeenCalledWith('matchupStats');
    expect(sent).toEqual({
      status: 200,
      body: { ok: true, note: '0 lane buckets indexed, 0 of 0 pairings published' }
    });
  });
});

describe('riotKeyHealth', () => {
  it('still answers signed out, because the public e2e checks call it with no token', async () => {
    const sent = await call(riotKeyHealth, { method: 'GET' });
    expect(sent.status).toBe(200);
    expect(fb.verifyIdToken).not.toHaveBeenCalled();
  });
});
