/**
 * Which Firestore rules are released, read through the doors the app uses (27 Sep 2026).
 *
 * Signed-out reads cannot tell one ruleset from another: every ruleset since 27 Sep refuses
 * them all but meta/settings. The tell is a member's token on a path where the rulesets
 * disagree, so this mints a custom token for the e2e viewer (a root viewer with no team
 * entries, E2E_EMAIL) the way e2e/tests/auth.setup.ts does, exchanges it for an ID token
 * with the public web key, and reads:
 *
 *   teams/<id>/draftEvents   Stage 4 rules 403 (admin-read), the 8 Sep catch-all 200
 *   teams/<id>/players       Stage 4 rules 200 (root members read every team),
 *                            release 3 rules 403 (only the team's own list, or a root admin)
 *
 * Read-only. Needs FIREBASE_SERVICE_ACCOUNT (JSON or a path) and E2E_EMAIL in the
 * environment, and api/node_modules installed (firebase-admin is taken from there).
 *
 *   node scripts/rules-live-check.cjs [teamId]     (teamId defaults to a probe id that need not exist)
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const root = path.resolve(__dirname, '..');
const requireApi = createRequire(path.join(root, 'api', 'package.json'));
const { initializeApp, cert } = requireApi('firebase-admin/app');
const { getAuth } = requireApi('firebase-admin/auth');

const raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
if (!raw) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set. Put the service account JSON in it, or a path to the file.');
  process.exit(1);
}
const text = raw.trim().startsWith('{') ? raw : fs.readFileSync(raw, 'utf8');
const account = JSON.parse(text);
const env = fs.readFileSync(path.join(root, 'frontend', 'src', 'environments', 'environment.ts'), 'utf8');
const apiKey = env.match(/apiKey: '([^']+)'/)?.[1];
if (!apiKey) {
  console.error('No apiKey in frontend/src/environments/environment.ts (local mode?).');
  process.exit(1);
}
const teamId = process.argv[2] || 'zz-probe';
const BASE = `https://firestore.googleapis.com/v1/projects/${account.project_id}/databases/(default)/documents/`;

async function code(p, token) {
  const r = await fetch(BASE + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return r.status;
}

(async () => {
  console.log(`signed out: teams ${await code('teams')}, players ${await code('players')}, meta/settings ${await code('meta/settings')} (expect 403, 403, 200)`);
  const email = process.env.E2E_EMAIL;
  if (!email) throw new Error('E2E_EMAIL is not set.');
  const app = initializeApp({ credential: cert(account) }, 'rules-live-check');
  const user = await getAuth(app).getUserByEmail(email);
  const custom = await getAuth(app).createCustomToken(user.uid);
  const exchange = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true })
  });
  const { idToken } = await exchange.json();
  if (!idToken) throw new Error('The custom token could not be exchanged for an ID token.');
  const v = (p) => code(p, idToken);
  const players = await v('players');
  const teamPlayers = await v(`teams/${teamId}/players`);
  const draftLog = await v(`teams/${teamId}/draftEvents`);
  const members = await v(`members/${encodeURIComponent(email)}`);
  console.log(`root viewer: players ${players}, teams/${teamId}/players ${teamPlayers}, teams/${teamId}/draftEvents ${draftLog}, members/<own> ${members}`);
  if (players !== 200) console.log('VERDICT: the e2e viewer cannot read the root; check its access entry');
  else if (draftLog !== 403) console.log('VERDICT: the 8 Sep public-read rules are still released');
  else if (teamPlayers === 200) console.log('VERDICT: the Stage 4 rules are released (root members read every team); release 3 is not deployed yet');
  else console.log('VERDICT: the release 3 rules are released (a root viewer is refused a team it is not listed on)');
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
