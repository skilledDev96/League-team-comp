/**
 * The doors the `onRequest` handlers stand behind.
 *
 * `admitAdmin` (27 Sep 2026) came first, for the three admin-only manual triggers
 * `syncChampionTraits`, `crawlOnce` and `buildMatchupIndexOnce`. Until then all three answered
 * anyone holding the URL, which the site ships: anyone could spend the Riot key's two-minute
 * allowance on a crawl tick, switch the crawler on or off with `crawlOnce?enable=`, and run a
 * 512 MiB rollup that re-reads every raw matchup bucket. Their scheduled twins
 * (`refreshChampionTraits`, `crawlChampionStats`, `buildMatchupIndex`) are `onSchedule` and never
 * reachable over HTTP, so nothing automatic calls these and nothing breaks when they ask for a
 * token.
 *
 * `admitMember` and `admitEditor` (the same day, release 3 of the multi-team work) are the same
 * door for the six handlers that work for a team: `enrichPlayer`, `getCompAnalysis`,
 * `refreshTeamDataOnce`, `draftAdvice` and `gameReview` need an editor of the team the request
 * names, `getOpponentHistory` a member. Each carried its own token check before, without the
 * provider check and against the root list only; now all nine handlers share one.
 *
 * The check: a Bearer ID token, verified; a token from one of the app's two doors, Google or the
 * e2e runner's custom token, exactly as `signedIn()` in `firestore.rules` requires; an email; and
 * then the role the email holds on the team (`roles.ts`: the root list for the root, a root
 * admin everywhere, else the team's own list). Admin is the lead's buttons, not an editor's, and
 * `admitAdmin` asks the root, since the three triggers are the site's and not a team's.
 *
 * Pure, with the Firebase calls passed in, so the refusals can be tested without a project.
 */
import { normalizeEmail, parseBearerToken } from './parse-request';
import { AccessRole } from './roles';
import { DEFAULT_TEAM_ID } from './team-scope';

export type { AccessRole } from './roles';

/** The sign-in providers `firestore.rules` accepts. A new sign-in method has to be added in both. */
export const ALLOWED_SIGN_IN_PROVIDERS: readonly string[] = ['google.com', 'custom'];

/** The part of a verified ID token this reads; firebase-admin's `DecodedIdToken` satisfies it. */
export interface DecodedIdTokenLike {
  email?: string;
  firebase?: { sign_in_provider?: string };
}

export interface AccessAuthDeps {
  /** `getAuth().verifyIdToken`; throws on a forged, expired or revoked token. */
  verifyIdToken(token: string): Promise<DecodedIdTokenLike>;
  /**
   * The role an email holds on a team (`roles.ts` `roleOf`): on the root the bootstrap admin, else
   * an active `access/{email}` entry, else null; on a team a root admin, else the team's own entry.
   */
  roleOf(email: string, teamId: string): Promise<AccessRole | null>;
}

/** The name the admin door was written under; the same dependencies serve every door now. */
export type AdminAuthDeps = AccessAuthDeps;

/** The least a caller must be. */
export type Least = 'member' | 'editor' | 'admin';

export type AccessAuthResult =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403; error: string };

export type AdminAuthResult = AccessAuthResult;

function allows(least: Least, role: AccessRole | null): boolean {
  if (!role) return false;
  if (least === 'member') return true;
  if (least === 'editor') return role === 'admin' || role === 'contributor';
  return role === 'admin';
}

const REQUIRED: Record<Least, string> = { member: 'Member', editor: 'Editor', admin: 'Admin' };

/**
 * Whether the Authorization header belongs to at least a `least` of `teamId`. `action` finishes
 * the refusal's sentence ("Editor access required to review a game."). The steps, in order, and
 * what each refuses with: no Bearer token, 401; a token that does not verify, 401; a provider the
 * rules do not accept, 403; no email claim, 401; a role below `least` on the team, 403. Nothing is
 * read from Firestore before the provider and the email are known.
 */
export async function authorize(
  authorization: string | undefined,
  deps: AccessAuthDeps,
  action: string,
  teamId: string,
  least: Least
): Promise<AccessAuthResult> {
  const idToken = parseBearerToken(authorization);
  if (!idToken) {
    return { ok: false, status: 401, error: 'Missing Authorization: Bearer <ID_TOKEN> header.' };
  }

  let decoded: DecodedIdTokenLike;
  try {
    decoded = await deps.verifyIdToken(idToken);
  } catch {
    return { ok: false, status: 401, error: 'The ID token could not be verified. Sign in again and retry.' };
  }

  const provider = decoded.firebase?.sign_in_provider;
  if (!provider || !ALLOWED_SIGN_IN_PROVIDERS.includes(provider)) {
    return { ok: false, status: 403, error: `Sign in with Google to ${action}.` };
  }

  const email = normalizeEmail(decoded.email);
  if (!email) {
    return { ok: false, status: 401, error: 'Authenticated user has no email claim.' };
  }

  const role = await deps.roleOf(email, teamId);
  if (!allows(least, role)) {
    return { ok: false, status: 403, error: `${REQUIRED[least]} access required to ${action}.` };
  }

  return { ok: true, email };
}

/** Whether the Authorization header belongs to a root admin: `authorize` on the root, admin least. */
export function authorizeAdmin(
  authorization: string | undefined,
  deps: AccessAuthDeps,
  action: string
): Promise<AccessAuthResult> {
  return authorize(authorization, deps, action, DEFAULT_TEAM_ID, 'admin');
}

/** The parts of an Express request and response the door touches. */
export interface AdminRequestLike {
  method?: string;
  headers: { authorization?: string };
}

export interface AdminResponseLike {
  status(code: number): { json(body: unknown): unknown; send(body: string): unknown };
}

/**
 * What each guarded handler opens with. Answers the CORS preflight, refuses anything but POST
 * and anyone below `least` on `teamId`, and returns true only when the handler may go on; every
 * other answer has already been sent. A failure while checking (an access read throwing) refuses
 * too, with 500.
 */
export async function admit(
  req: AdminRequestLike,
  res: AdminResponseLike,
  deps: AccessAuthDeps,
  action: string,
  teamId: string,
  least: Least
): Promise<boolean> {
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return false;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return false;
  }

  let result: AccessAuthResult;
  try {
    result = await authorize(req.headers.authorization, deps, action, teamId, least);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    res.status(500).json({ error: `Could not check access: ${message}` });
    return false;
  }

  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return false;
  }
  return true;
}

/**
 * The door of the three admin-only manual triggers: a root admin, by POST. The triggers are the
 * site's, not a team's, so there is no team to name.
 */
export function admitAdmin(req: AdminRequestLike, res: AdminResponseLike, deps: AccessAuthDeps, action: string): Promise<boolean> {
  return admit(req, res, deps, action, DEFAULT_TEAM_ID, 'admin');
}

/**
 * The door of a handler that reads for a team: anyone with an active role on `teamId`, by POST.
 * The handler parses its body first, since the team is in it (`parseTeamId`: absent, null or
 * `default` is the root), so a body that names no team id is a 400 before the token is looked at;
 * that costs nothing and touches nothing.
 */
export function admitMember(req: AdminRequestLike, res: AdminResponseLike, deps: AccessAuthDeps, action: string, teamId: string): Promise<boolean> {
  return admit(req, res, deps, action, teamId, 'member');
}

/** The door of a handler that writes for a team or spends money for it: an admin or contributor of `teamId`, by POST. */
export function admitEditor(req: AdminRequestLike, res: AdminResponseLike, deps: AccessAuthDeps, action: string, teamId: string): Promise<boolean> {
  return admit(req, res, deps, action, teamId, 'editor');
}
