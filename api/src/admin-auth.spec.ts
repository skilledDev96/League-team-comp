import { describe, expect, it, vi } from 'vitest';
import {
  ALLOWED_SIGN_IN_PROVIDERS,
  AccessAuthDeps,
  AccessRole,
  DecodedIdTokenLike,
  admitAdmin,
  admitEditor,
  admitMember,
  authorize,
  authorizeAdmin
} from './admin-auth';

/** Tokens by name, as verifyIdToken would decode them; anything else fails verification. */
const TOKENS: Record<string, DecodedIdTokenLike> = {
  admin: { email: 'Lead@Example.com ', firebase: { sign_in_provider: 'google.com' } },
  editor: { email: 'editor@example.com', firebase: { sign_in_provider: 'google.com' } },
  viewer: { email: 'viewer@example.com', firebase: { sign_in_provider: 'google.com' } },
  teamOnly: { email: 'teamonly@example.com', firebase: { sign_in_provider: 'google.com' } },
  e2e: { email: 'e2e@bomsquad.test', firebase: { sign_in_provider: 'custom' } },
  e2eAdmin: { email: 'lead@example.com', firebase: { sign_in_provider: 'custom' } },
  passwordAdmin: { email: 'lead@example.com', firebase: { sign_in_provider: 'password' } },
  passwordTeamOnly: { email: 'teamonly@example.com', firebase: { sign_in_provider: 'password' } },
  anonymous: { firebase: { sign_in_provider: 'anonymous' } },
  noProvider: { email: 'lead@example.com' },
  noEmail: { firebase: { sign_in_provider: 'google.com' } }
};

/** The root list. */
const ROLES: Record<string, AccessRole> = {
  'lead@example.com': 'admin',
  'editor@example.com': 'contributor',
  'viewer@example.com': 'viewer',
  'e2e@bomsquad.test': 'viewer'
};

/** Team b's own list: one person who is on b and nowhere else, and the root viewer as a contributor. */
const TEAM_ROLES: Record<string, Record<string, AccessRole>> = {
  b: { 'teamonly@example.com': 'contributor', 'viewer@example.com': 'contributor' }
};

/** `roleOf` as `roles.ts` answers it (its own spec pins the rule): the root list at the root, a root admin everywhere, else the team's list. */
function fakeRoleOf(email: string, teamId: string): AccessRole | null {
  const root = ROLES[email] ?? null;
  if (teamId === 'default') return root;
  if (root === 'admin') return 'admin';
  return TEAM_ROLES[teamId]?.[email] ?? null;
}

function deps(): AccessAuthDeps & { verifyIdToken: ReturnType<typeof vi.fn>; roleOf: ReturnType<typeof vi.fn> } {
  return {
    verifyIdToken: vi.fn(async (token: string) => {
      const decoded = TOKENS[token];
      if (!decoded) throw new Error('Firebase ID token has invalid signature.');
      return decoded;
    }),
    roleOf: vi.fn(async (email: string, teamId: string) => fakeRoleOf(email, teamId))
  };
}

const ACTION = 'run the crawler by hand';

describe('authorizeAdmin', () => {
  it('accepts an admin signed in with Google, and names them by their normalised email', async () => {
    const d = deps();
    expect(await authorizeAdmin('Bearer admin', d, ACTION)).toEqual({ ok: true, email: 'lead@example.com' });
    // The admin door asks the root: the three triggers are the site's, not a team's.
    expect(d.roleOf).toHaveBeenCalledWith('lead@example.com', 'default');
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

// ---- The member and editor doors (release 3, 27 Sep 2026) ---------------------------------------

const EDIT = 'review a game';
const READ = "read an opponent team's history";

describe('authorize, for a team', () => {
  it('shares the token, provider and email steps with the admin door, refusal for refusal', async () => {
    for (const header of [undefined, '', 'Basic abc', 'Bearer']) {
      const d = deps();
      expect(await authorize(header, d, EDIT, 'b', 'editor')).toEqual({ ok: false, status: 401, error: 'Missing Authorization: Bearer <ID_TOKEN> header.' });
      expect(d.verifyIdToken).not.toHaveBeenCalled();
    }
    expect(await authorize('Bearer forged', deps(), EDIT, 'b', 'editor')).toMatchObject({ ok: false, status: 401 });
    for (const token of ['passwordTeamOnly', 'anonymous', 'noProvider']) {
      const d = deps();
      expect(await authorize(`Bearer ${token}`, d, EDIT, 'b', 'editor')).toEqual({ ok: false, status: 403, error: 'Sign in with Google to review a game.' });
      expect(d.roleOf).not.toHaveBeenCalled();
    }
    const d = deps();
    expect(await authorize('Bearer noEmail', d, READ, 'b', 'member')).toEqual({ ok: false, status: 401, error: 'Authenticated user has no email claim.' });
    expect(d.roleOf).not.toHaveBeenCalled();
  });

  it('asks the role on the team the request named, by the normalised email', async () => {
    const d = deps();
    await authorize('Bearer admin', d, EDIT, 'b', 'editor');
    expect(d.roleOf).toHaveBeenCalledWith('lead@example.com', 'b');
    await authorize('Bearer editor', d, EDIT, 'default', 'editor');
    expect(d.roleOf).toHaveBeenCalledWith('editor@example.com', 'default');
  });

  it('lets a member in as a member, an editor in as an editor, and never a viewer as an editor', async () => {
    expect(await authorize('Bearer viewer', deps(), READ, 'default', 'member')).toEqual({ ok: true, email: 'viewer@example.com' });
    expect(await authorize('Bearer e2e', deps(), READ, 'default', 'member')).toEqual({ ok: true, email: 'e2e@bomsquad.test' });
    expect(await authorize('Bearer editor', deps(), EDIT, 'default', 'editor')).toEqual({ ok: true, email: 'editor@example.com' });
    expect(await authorize('Bearer admin', deps(), EDIT, 'default', 'editor')).toEqual({ ok: true, email: 'lead@example.com' });
    for (const token of ['viewer', 'e2e']) {
      expect(await authorize(`Bearer ${token}`, deps(), EDIT, 'default', 'editor')).toEqual({ ok: false, status: 403, error: 'Editor access required to review a game.' });
    }
  });

  it('lets a team-only contributor edit their team, and refuses them on the root and on another team', async () => {
    expect(await authorize('Bearer teamOnly', deps(), EDIT, 'b', 'editor')).toEqual({ ok: true, email: 'teamonly@example.com' });
    expect(await authorize('Bearer teamOnly', deps(), READ, 'b', 'member')).toEqual({ ok: true, email: 'teamonly@example.com' });
    expect(await authorize('Bearer teamOnly', deps(), EDIT, 'default', 'editor')).toEqual({ ok: false, status: 403, error: 'Editor access required to review a game.' });
    expect(await authorize('Bearer teamOnly', deps(), READ, 'default', 'member')).toEqual({ ok: false, status: 403, error: "Member access required to read an opponent team's history." });
    expect(await authorize('Bearer teamOnly', deps(), EDIT, 'c', 'editor')).toMatchObject({ ok: false, status: 403 });
    expect(await authorize('Bearer teamOnly', deps(), READ, 'c', 'member')).toMatchObject({ ok: false, status: 403 });
  });

  it("gives a root viewer the team's own role on a team, and a root admin admin everywhere", async () => {
    // A viewer at the root, a contributor on b: an editor of b, still no editor of the root.
    expect(await authorize('Bearer viewer', deps(), EDIT, 'b', 'editor')).toEqual({ ok: true, email: 'viewer@example.com' });
    expect(await authorize('Bearer viewer', deps(), EDIT, 'default', 'editor')).toMatchObject({ ok: false, status: 403 });
    expect(await authorize('Bearer admin', deps(), EDIT, 'never-listed', 'editor')).toEqual({ ok: true, email: 'lead@example.com' });
    expect(await authorize('Bearer admin', deps(), EDIT, 'never-listed', 'admin')).toEqual({ ok: true, email: 'lead@example.com' });
  });

  it('refuses a root contributor with no entry on the team', async () => {
    expect(await authorize('Bearer editor', deps(), EDIT, 'b', 'editor')).toEqual({ ok: false, status: 403, error: 'Editor access required to review a game.' });
    expect(await authorize('Bearer editor', deps(), READ, 'b', 'member')).toMatchObject({ ok: false, status: 403 });
  });
});

describe('admitMember and admitEditor', () => {
  it('answer the CORS preflight with 204 and refuse anything but POST with 405', async () => {
    for (const door of [admitMember, admitEditor]) {
      const d = deps();
      const preflight = response();
      expect(await door({ method: 'OPTIONS', headers: {} }, preflight.res, d, EDIT, 'b')).toBe(false);
      expect(preflight.sent).toEqual({ status: 204, body: '' });
      const get = response();
      expect(await door({ method: 'GET', headers: { authorization: 'Bearer teamOnly' } }, get.res, d, EDIT, 'b')).toBe(false);
      expect(get.sent).toEqual({ status: 405, body: { error: 'Method not allowed. Use POST.' } });
      expect(d.verifyIdToken).not.toHaveBeenCalled();
    }
  });

  it('send the refusal and stop the handler', async () => {
    const asEditor = response();
    expect(await admitEditor({ method: 'POST', headers: { authorization: 'Bearer viewer' } }, asEditor.res, deps(), EDIT, 'default')).toBe(false);
    expect(asEditor.sent).toEqual({ status: 403, body: { error: 'Editor access required to review a game.' } });
    const asMember = response();
    expect(await admitMember({ method: 'POST', headers: { authorization: 'Bearer teamOnly' } }, asMember.res, deps(), READ, 'default')).toBe(false);
    expect(asMember.sent).toEqual({ status: 403, body: { error: "Member access required to read an opponent team's history." } });
    const noToken = response();
    expect(await admitMember({ method: 'POST', headers: {} }, noToken.res, deps(), READ, 'b')).toBe(false);
    expect(noToken.sent).toEqual({ status: 401, body: { error: 'Missing Authorization: Bearer <ID_TOKEN> header.' } });
  });

  it('refuse with 500 when the role lookup itself fails', async () => {
    const d = deps();
    d.roleOf.mockRejectedValueOnce(new Error('Firestore unavailable'));
    const { res, sent } = response();
    expect(await admitEditor({ method: 'POST', headers: { authorization: 'Bearer teamOnly' } }, res, d, EDIT, 'b')).toBe(false);
    expect(sent).toEqual({ status: 500, body: { error: 'Could not check access: Firestore unavailable' } });
  });

  it('let the right person through and send nothing', async () => {
    const editor = response();
    expect(await admitEditor({ method: 'POST', headers: { authorization: 'Bearer teamOnly' } }, editor.res, deps(), EDIT, 'b')).toBe(true);
    expect(editor.sent).toEqual({});
    const member = response();
    expect(await admitMember({ method: 'POST', headers: { authorization: 'Bearer e2e' } }, member.res, deps(), READ, 'default')).toBe(true);
    expect(member.sent).toEqual({});
  });
});
