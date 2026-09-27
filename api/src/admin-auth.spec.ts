import { describe, expect, it, vi } from 'vitest';
import {
  ALLOWED_SIGN_IN_PROVIDERS,
  AccessRole,
  AdminAuthDeps,
  DecodedIdTokenLike,
  admitAdmin,
  authorizeAdmin
} from './admin-auth';

/** Tokens by name, as verifyIdToken would decode them; anything else fails verification. */
const TOKENS: Record<string, DecodedIdTokenLike> = {
  admin: { email: 'Lead@Example.com ', firebase: { sign_in_provider: 'google.com' } },
  editor: { email: 'editor@example.com', firebase: { sign_in_provider: 'google.com' } },
  viewer: { email: 'viewer@example.com', firebase: { sign_in_provider: 'google.com' } },
  e2e: { email: 'e2e@bomsquad.test', firebase: { sign_in_provider: 'custom' } },
  e2eAdmin: { email: 'lead@example.com', firebase: { sign_in_provider: 'custom' } },
  passwordAdmin: { email: 'lead@example.com', firebase: { sign_in_provider: 'password' } },
  anonymous: { firebase: { sign_in_provider: 'anonymous' } },
  noProvider: { email: 'lead@example.com' },
  noEmail: { firebase: { sign_in_provider: 'google.com' } }
};

const ROLES: Record<string, AccessRole> = {
  'lead@example.com': 'admin',
  'editor@example.com': 'contributor',
  'viewer@example.com': 'viewer',
  'e2e@bomsquad.test': 'viewer'
};

function deps(): AdminAuthDeps & { verifyIdToken: ReturnType<typeof vi.fn>; roleOf: ReturnType<typeof vi.fn> } {
  return {
    verifyIdToken: vi.fn(async (token: string) => {
      const decoded = TOKENS[token];
      if (!decoded) throw new Error('Firebase ID token has invalid signature.');
      return decoded;
    }),
    roleOf: vi.fn(async (email: string) => ROLES[email] ?? null)
  };
}

const ACTION = 'run the crawler by hand';

describe('authorizeAdmin', () => {
  it('accepts an admin signed in with Google, and names them by their normalised email', async () => {
    const d = deps();
    expect(await authorizeAdmin('Bearer admin', d, ACTION)).toEqual({ ok: true, email: 'lead@example.com' });
    expect(d.roleOf).toHaveBeenCalledWith('lead@example.com');
  });

  it('accepts an admin whose token came through the custom-token door, as the rules do', async () => {
    expect(await authorizeAdmin('Bearer e2eAdmin', deps(), ACTION)).toEqual({ ok: true, email: 'lead@example.com' });
  });

  it('refuses no header, a blank one and a non-Bearer one with 401, before verifying anything', async () => {
    for (const header of [undefined, '', 'Basic abc', 'Bearer']) {
      const d = deps();
      const result = await authorizeAdmin(header, d, ACTION);
      expect(result).toEqual({ ok: false, status: 401, error: 'Missing Authorization: Bearer <ID_TOKEN> header.' });
      expect(d.verifyIdToken).not.toHaveBeenCalled();
    }
  });

  it('refuses a token that does not verify with 401, and never looks up a role', async () => {
    const d = deps();
    const result = await authorizeAdmin('Bearer forged', d, ACTION);
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(d.roleOf).not.toHaveBeenCalled();
  });

  it('refuses a contributor, a viewer and the e2e viewer with 403', async () => {
    for (const token of ['editor', 'viewer', 'e2e']) {
      const result = await authorizeAdmin(`Bearer ${token}`, deps(), ACTION);
      expect(result).toEqual({ ok: false, status: 403, error: 'Admin access required to run the crawler by hand.' });
    }
  });

  it('refuses someone with no access entry with 403', async () => {
    const d = deps();
    d.verifyIdToken.mockResolvedValueOnce({ email: 'stranger@example.com', firebase: { sign_in_provider: 'google.com' } });
    expect(await authorizeAdmin('Bearer anything', d, ACTION)).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses an admin's email on a provider the rules do not accept, before the role lookup", async () => {
    for (const token of ['passwordAdmin', 'anonymous', 'noProvider']) {
      const d = deps();
      const result = await authorizeAdmin(`Bearer ${token}`, d, ACTION);
      expect(result).toEqual({ ok: false, status: 403, error: 'Sign in with Google to run the crawler by hand.' });
      expect(d.roleOf).not.toHaveBeenCalled();
    }
  });

  it('refuses a token with no email claim with 401', async () => {
    const d = deps();
    expect(await authorizeAdmin('Bearer noEmail', d, ACTION)).toEqual({
      ok: false,
      status: 401,
      error: 'Authenticated user has no email claim.'
    });
    expect(d.roleOf).not.toHaveBeenCalled();
  });

  it('accepts exactly the providers firestore.rules signedIn() accepts', () => {
    expect([...ALLOWED_SIGN_IN_PROVIDERS].sort()).toEqual(['custom', 'google.com']);
  });
});

/** A response that records what the door answered. */
function response() {
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return {
        json(body: unknown) {
          sent.body = body;
        },
        send(body: string) {
          sent.body = body;
        }
      };
    }
  };
  return { res, sent };
}

describe('admitAdmin', () => {
  it('answers the CORS preflight with 204 and no token', async () => {
    const d = deps();
    const { res, sent } = response();
    expect(await admitAdmin({ method: 'OPTIONS', headers: {} }, res, d, ACTION)).toBe(false);
    expect(sent).toEqual({ status: 204, body: '' });
    expect(d.verifyIdToken).not.toHaveBeenCalled();
  });

  it('refuses anything but POST with 405, even from an admin', async () => {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const { res, sent } = response();
      expect(await admitAdmin({ method, headers: { authorization: 'Bearer admin' } }, res, deps(), ACTION)).toBe(false);
      expect(sent).toEqual({ status: 405, body: { error: 'Method not allowed. Use POST.' } });
    }
  });

  it('sends the refusal it was given and stops the handler', async () => {
    const { res, sent } = response();
    expect(await admitAdmin({ method: 'POST', headers: { authorization: 'Bearer editor' } }, res, deps(), ACTION)).toBe(false);
    expect(sent).toEqual({ status: 403, body: { error: 'Admin access required to run the crawler by hand.' } });
  });

  it('refuses with 500 when the access lookup itself fails, rather than letting the handler run', async () => {
    const d = deps();
    d.roleOf.mockRejectedValueOnce(new Error('Firestore unavailable'));
    const { res, sent } = response();
    expect(await admitAdmin({ method: 'POST', headers: { authorization: 'Bearer admin' } }, res, d, ACTION)).toBe(false);
    expect(sent).toEqual({ status: 500, body: { error: 'Could not check access: Firestore unavailable' } });
  });

  it('lets an admin through and sends nothing itself', async () => {
    const { res, sent } = response();
    expect(await admitAdmin({ method: 'POST', headers: { authorization: 'Bearer admin' } }, res, deps(), ACTION)).toBe(true);
    expect(sent).toEqual({});
  });
});
