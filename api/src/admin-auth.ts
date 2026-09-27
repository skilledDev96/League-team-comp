/**
 * The door for the admin-only manual triggers: `syncChampionTraits`, `crawlOnce` and
 * `buildMatchupIndexOnce` (27 Sep 2026).
 *
 * Until then all three answered anyone holding the URL, which the site ships: anyone could spend
 * the Riot key's two-minute allowance on a crawl tick, switch the crawler on or off with
 * `crawlOnce?enable=`, and run a 512 MiB rollup that re-reads every raw matchup bucket. Their
 * scheduled twins (`refreshChampionTraits`, `crawlChampionStats`, `buildMatchupIndex`) are
 * `onSchedule` and never reachable over HTTP, so nothing automatic calls these and nothing breaks
 * when they ask for a token.
 *
 * The check is the one every other handler makes — a Bearer ID token, verified, then the
 * `access/{email}` role — with two things more: the role must be **admin** (these are the lead's
 * buttons, not an editor's), and the token must come from one of the app's two doors, Google or the
 * e2e runner's custom token, exactly as `signedIn()` in `firestore.rules` requires. The e2e account
 * is a viewer, so in practice only an admin's Google session gets through.
 *
 * Pure, with the Firebase calls passed in, so the refusals can be tested without a project.
 */
import { normalizeEmail, parseBearerToken } from './parse-request';

export type AccessRole = 'admin' | 'contributor' | 'viewer';

/** The sign-in providers `firestore.rules` accepts. A new sign-in method has to be added in both. */
export const ALLOWED_SIGN_IN_PROVIDERS: readonly string[] = ['google.com', 'custom'];

/** The part of a verified ID token this reads; firebase-admin's `DecodedIdToken` satisfies it. */
export interface DecodedIdTokenLike {
  email?: string;
  firebase?: { sign_in_provider?: string };
}

export interface AdminAuthDeps {
  /** `getAuth().verifyIdToken`; throws on a forged, expired or revoked token. */
  verifyIdToken(token: string): Promise<DecodedIdTokenLike>;
  /** The role an email holds: the bootstrap admin, else an active `access/{email}` entry, else null. */
  roleOf(email: string): Promise<AccessRole | null>;
}

export type AdminAuthResult =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Whether the Authorization header belongs to an admin. `action` finishes the refusal's sentence
 * ("Admin access required to run the crawler by hand.").
 */
export async function authorizeAdmin(
  authorization: string | undefined,
  deps: AdminAuthDeps,
  action: string
): Promise<AdminAuthResult> {
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

  const role = await deps.roleOf(email);
  if (role !== 'admin') {
    return { ok: false, status: 403, error: `Admin access required to ${action}.` };
  }

  return { ok: true, email };
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
 * What each admin-only handler opens with. Answers the CORS preflight, refuses anything but POST
 * and anyone but an admin, and returns true only when the handler may go on; every other answer
 * has already been sent. A failure while checking (the access read throwing) refuses too.
 */
export async function admitAdmin(
  req: AdminRequestLike,
  res: AdminResponseLike,
  deps: AdminAuthDeps,
  action: string
): Promise<boolean> {
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return false;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return false;
  }

  let result: AdminAuthResult;
  try {
    result = await authorizeAdmin(req.headers.authorization, deps, action);
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
