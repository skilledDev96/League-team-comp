// Evaluates firestore.rules against mocked requests through the Rules API's test endpoint (the same
// endpoint `firebase deploy --dry-run` compiles through). get()/exists() are mocked, so no Firestore
// document is read, and nothing is released. Usage: node scripts/rules-check.cjs [path to firestore.rules]
//
// Why a script and not the emulator (26 Sep 2026): the emulator needs Java, which this machine does not
// have. The Rules API evaluates the file server side instead; nothing here deploys or reads a document.
//
// It holds no credentials. It borrows the firebase CLI's own login (`firebase login`) through
// firebase-tools installed as a global npm package (`npm install -g firebase-tools`; the standalone
// firebase binary has no lib folder to load), from FIREBASE_TOOLS_LIB (the lib folder itself) when
// set, else `npm root -g`/firebase-tools/lib. Written against firebase-tools 15.
// The rules file defaults to the repo's firestore.rules, the project to .firebaserc's default.
// Exits 1 when any case fails, when a case comes back without a result, or when the file does not
// compile — so it can gate a `npm run deploy:rules`.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

/** The four files of firebase-tools' lib this loads; a folder missing any of them is not used. */
const LIB_FILES = ['auth.js', 'requireAuth.js', 'apiv2.js', 'api.js'];

/** The global firebase-tools lib folder, or a clear word on where it was looked for. */
function firebaseToolsLib() {
  const tried = [];
  const candidates = [];
  if (process.env.FIREBASE_TOOLS_LIB) candidates.push(process.env.FIREBASE_TOOLS_LIB);
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (globalRoot) candidates.push(path.join(globalRoot, 'firebase-tools', 'lib'));
  } catch {
    // npm not on PATH: only FIREBASE_TOOLS_LIB can say where it is.
  }
  for (const dir of candidates) {
    const missing = LIB_FILES.filter((f) => !fs.existsSync(path.join(dir, f)));
    if (!missing.length) return dir;
    tried.push(`${dir} (no ${missing.join(', ')})`);
  }
  throw new Error(
    'firebase-tools not found as a global npm package. Install it (npm install -g firebase-tools; the ' +
      'standalone binary has no lib to load) or set FIREBASE_TOOLS_LIB to its lib folder. ' +
      `Looked in: ${tried.join('; ') || 'nowhere (FIREBASE_TOOLS_LIB unset and npm not on PATH)'}`
  );
}

/** .firebaserc's default project, else the one this app runs on. */
function defaultProject() {
  try {
    const rc = JSON.parse(fs.readFileSync(path.join(ROOT, '.firebaserc'), 'utf8'));
    if (rc?.projects?.default) return rc.projects.default;
  } catch {
    // no .firebaserc: fall through.
  }
  return 'lol-bom-squad';
}

let auth;
let requireAuth;
let Client;
let RULES_ORIGIN;
try {
  const LIB = firebaseToolsLib();
  auth = require(path.join(LIB, 'auth.js'));
  ({ requireAuth } = require(path.join(LIB, 'requireAuth.js')));
  ({ Client } = require(path.join(LIB, 'apiv2.js')));
  const { rulesOrigin } = require(path.join(LIB, 'api.js'));
  // A function since firebase-tools 13, a plain string before it.
  RULES_ORIGIN = typeof rulesOrigin === 'function' ? rulesOrigin() : rulesOrigin;
} catch (e) {
  console.error('ERROR', e.message);
  process.exit(1);
}

const PROJECT = defaultProject();
const rulesFile = path.resolve(process.argv[2] || path.join(ROOT, 'firestore.rules'));
const content = fs.readFileSync(rulesFile, 'utf8');
const DOCS = '/databases/(default)/documents';

// ---- personas -------------------------------------------------------------
const token = (email, provider = 'google.com', verified = true) => ({
  uid: 'u-' + (email || 'none'),
  token: { ...(email ? { email } : {}), email_verified: verified, firebase: { sign_in_provider: provider } }
});
const P = {
  anon: { auth: null, doc: undefined },
  nonmember: { auth: token('stranger@gmail.com'), doc: null },
  viewer: { auth: token('viewer@bom.test'), doc: { role: 'viewer', active: true } },
  viewerUpper: { auth: token('Viewer@Bom.test'), doc: { role: 'viewer', active: true }, key: 'viewer@bom.test' },
  e2e: { auth: token('e2e@bomsquad.test', 'custom', false), doc: { role: 'viewer', active: true } },
  contributor: { auth: token('contrib@bom.test'), doc: { role: 'contributor', active: true } },
  admin: { auth: token('admin@bom.test'), doc: { role: 'admin', active: true } },
  bootstrap: { auth: token('ruanhart7@gmail.com'), doc: undefined },
  inactiveViewer: { auth: token('gone@bom.test'), doc: { role: 'viewer', active: false } },
  inactiveContrib: { auth: token('gonec@bom.test'), doc: { role: 'contributor', active: false } },
  inactiveAdmin: { auth: token('gonea@bom.test'), doc: { role: 'admin' } },
  noRole: { auth: token('norole@bom.test'), doc: { active: true } },
  activeString: { auth: token('str@bom.test'), doc: { role: 'viewer', active: 'yes' } },
  activeZero: { auth: token('zero@bom.test'), doc: { role: 'contributor', active: 0 } },
  emptyRole: { auth: token('empty@bom.test'), doc: { role: '', active: true } },
  passwordAttacker: { auth: token('viewer@bom.test', 'password', false), doc: { role: 'viewer', active: true } },
  passwordVerified: { auth: token('contrib@bom.test', 'password', true), doc: { role: 'contributor', active: true } },
  anonWithEmail: { auth: token('viewer@bom.test', 'anonymous', false), doc: { role: 'viewer', active: true } },
  phoneNoEmail: { auth: token(null, 'phone', false), doc: undefined }
};

function mocksFor(p) {
  if (!p.auth || p.doc === undefined) return [];
  const key = p.key || p.auth.token.email;
  const at = `${DOCS}/access/${key}`;
  const mocks = [{ function: 'exists', args: [{ exactValue: at }], result: { value: p.doc !== null } }];
  if (p.doc !== null) mocks.push({ function: 'get', args: [{ exactValue: at }], result: { value: { data: p.doc } } });
  return mocks;
}

const cases = [];
function t(who, method, docPath, expect, note) {
  const p = P[who];
  cases.push({
    label: `${expect.padEnd(5)} ${who.padEnd(16)} ${method.padEnd(6)} ${docPath}${note ? '  (' + note + ')' : ''}`,
    tc: {
      expectation: expect,
      request: { ...(p.auth ? { auth: p.auth } : {}), path: `${DOCS}/${docPath}`, method },
      resource: { data: {} },
      functionMocks: mocksFor(p)
    }
  });
}

// meta/settings: public read, admin write
for (const w of ['anon', 'nonmember', 'viewer']) t(w, 'get', 'meta/settings', 'ALLOW');
t('contributor', 'update', 'meta/settings', 'DENY', 'was allowed through the old catch-all');
t('admin', 'update', 'meta/settings', 'ALLOW');
t('bootstrap', 'create', 'meta/settings', 'ALLOW', 'seedFirestore');
t('inactiveAdmin', 'update', 'meta/settings', 'DENY');

// the catch-all: team data
for (const coll of ['players/p1', 'comps/c1', 'seriesGames/g1', 'gameReviews/NA1_1', 'matchCache/NA1_1',
  'matchTimeline/NA1_1', 'championStats/16.17_ALL', 'matchupIndex/16.17_TOP', 'meta/compAnalysis', 'meta/teamIdentity',
  'rankHistory/p1', 'replayRecordings/m1', 'replayShots/m1__60', 'filmCommitments/NA1_1', 'filmNotes/NA1_1', 'trophies/t1']) {
  t('anon', 'get', coll, 'DENY');
  t('viewer', 'get', coll, 'ALLOW');
}
for (const w of ['nonmember', 'inactiveViewer', 'inactiveContrib', 'noRole', 'activeZero', 'emptyRole', 'passwordAttacker', 'passwordVerified', 'anonWithEmail', 'phoneNoEmail'])
  t(w, 'get', 'players/p1', 'DENY');
for (const w of ['viewerUpper', 'e2e', 'contributor', 'admin', 'bootstrap', 'activeString'])
  t(w, 'get', 'players/p1', 'ALLOW');
// writes to team data
for (const m of ['create', 'update', 'delete']) {
  t('viewer', m, 'players/p1', 'DENY');
  t('contributor', m, 'players/p1', 'ALLOW');
  t('admin', m, 'players/p1', 'ALLOW');
  t('bootstrap', m, 'players/p1', 'ALLOW');
  t('inactiveContrib', m, 'players/p1', 'DENY', 'was allowed before');
  t('activeZero', m, 'players/p1', 'DENY');
}
t('contributor', 'update', 'filmCommitments/NA1_1', 'ALLOW');
t('contributor', 'update', 'meta/selfScout', 'ALLOW');
t('contributor', 'delete', 'gameReviews/NA1_1', 'ALLOW');
t('e2e', 'update', 'players/p1', 'DENY');
t('passwordVerified', 'update', 'players/p1', 'DENY');
// subcollections
t('viewer', 'get', 'players/p1/notes/n1', 'ALLOW');
t('anon', 'get', 'players/p1/notes/n1', 'DENY');
t('contributor', 'create', 'players/p1/notes/n1', 'ALLOW');
t('viewer', 'create', 'players/p1/notes/n1', 'DENY', 'members read, only editors write');
t('anon', 'create', 'players/p1/notes/n1', 'DENY');
t('inactiveContrib', 'update', 'players/p1/notes/n1', 'DENY');
t('admin', 'get', 'access/admin@bom.test/x/y', 'DENY');
t('admin', 'get', 'userPrefs/admin@bom.test/x/y', 'DENY');
t('admin', 'get', 'crawlState/state/x/y', 'DENY');
// an own-block collection's subcollections stay out of the catch-all for writes too, even for an editor
t('contributor', 'create', 'access/contrib@bom.test/x/y', 'DENY', 'ownBlock guard on the subcollection write');
t('admin', 'create', 'userPrefs/viewer@bom.test/x/y', 'DENY');
t('contributor', 'update', 'crawlState/state/x/y', 'DENY');
t('contributor', 'create', 'clientErrors/err-1/x/y', 'DENY');

// access
t('viewer', 'get', 'access/viewer@bom.test', 'ALLOW', 'own entry');
t('viewerUpper', 'get', 'access/viewer@bom.test', 'ALLOW', 'own entry, token email mixed case');
t('e2e', 'get', 'access/e2e@bomsquad.test', 'ALLOW', 'own entry via custom token');
t('inactiveViewer', 'get', 'access/gone@bom.test', 'ALLOW', 'must learn inactive');
t('nonmember', 'get', 'access/stranger@gmail.com', 'ALLOW', 'must learn absent');
t('viewer', 'get', 'access/admin@bom.test', 'DENY');
t('contributor', 'get', 'access/admin@bom.test', 'DENY');
t('anon', 'get', 'access/viewer@bom.test', 'DENY');
t('admin', 'get', 'access/viewer@bom.test', 'ALLOW');
t('bootstrap', 'get', 'access/viewer@bom.test', 'ALLOW');
t('contributor', 'update', 'access/contrib@bom.test', 'DENY', 'self-promotion; allowed before');
t('contributor', 'create', 'access/new@bom.test', 'DENY');
t('admin', 'create', 'access/new@bom.test', 'ALLOW');
t('admin', 'delete', 'access/new@bom.test', 'ALLOW');
t('bootstrap', 'create', 'access/ruanhart7@gmail.com', 'ALLOW', 'seedFirestore');
t('inactiveAdmin', 'update', 'access/gonea@bom.test', 'DENY');
t('passwordAttacker', 'get', 'access/viewer@bom.test', 'DENY');

// userPrefs
t('viewer', 'get', 'userPrefs/viewer@bom.test', 'ALLOW');
t('viewer', 'update', 'userPrefs/viewer@bom.test', 'ALLOW');
t('viewer', 'create', 'userPrefs/viewer@bom.test', 'ALLOW');
t('e2e', 'update', 'userPrefs/e2e@bomsquad.test', 'ALLOW', 'auth.setup dismissing the tour');
t('bootstrap', 'update', 'userPrefs/ruanhart7@gmail.com', 'ALLOW');
t('viewer', 'get', 'userPrefs/admin@bom.test', 'DENY');
t('contributor', 'update', 'userPrefs/viewer@bom.test', 'DENY', 'allowed before');
t('anon', 'get', 'userPrefs/viewer@bom.test', 'DENY');
t('inactiveViewer', 'get', 'userPrefs/gone@bom.test', 'DENY');
t('nonmember', 'update', 'userPrefs/stranger@gmail.com', 'DENY');

// clientErrors
t('viewer', 'create', 'clientErrors/err-1', 'ALLOW');
t('e2e', 'create', 'clientErrors/err-1', 'ALLOW');
t('anon', 'create', 'clientErrors/err-1', 'DENY');
t('nonmember', 'create', 'clientErrors/err-1', 'DENY');
t('viewer', 'get', 'clientErrors/err-1', 'DENY');
t('contributor', 'get', 'clientErrors/err-1', 'DENY');
t('admin', 'get', 'clientErrors/err-1', 'ALLOW', 'Diagnostics');
t('contributor', 'update', 'clientErrors/err-1', 'DENY', 'allowed before');
t('admin', 'delete', 'clientErrors/err-1', 'DENY');

// draftEvents: the draft log, `by` a teammate's email on every row. Admins read (Diagnostics lists them), editors
// write (every save of a game writes one; update because two saves of one game inside a tenth of a second share an
// id and setDoc overwrites), nobody deletes. All of it was the catch-all's before: every member read, editors wrote.
t('viewer', 'get', 'draftEvents/e1', 'DENY', "teammates' emails; allowed before");
t('viewer', 'list', 'draftEvents/any', 'DENY', 'allowed before');
t('e2e', 'get', 'draftEvents/e1', 'DENY', 'a viewer through the custom token');
t('contributor', 'get', 'draftEvents/e1', 'DENY', 'allowed before');
t('contributor', 'list', 'draftEvents/any', 'DENY', 'allowed before');
t('admin', 'get', 'draftEvents/e1', 'ALLOW');
t('admin', 'list', 'draftEvents/any', 'ALLOW', 'Diagnostics');
t('bootstrap', 'list', 'draftEvents/any', 'ALLOW');
t('inactiveAdmin', 'get', 'draftEvents/e1', 'DENY');
t('inactiveAdmin', 'list', 'draftEvents/any', 'DENY');
t('anon', 'get', 'draftEvents/e1', 'DENY');
t('anon', 'list', 'draftEvents/any', 'DENY');
t('nonmember', 'get', 'draftEvents/e1', 'DENY');
t('contributor', 'create', 'draftEvents/e1', 'ALLOW', 'every save of a game');
t('contributor', 'update', 'draftEvents/e1', 'ALLOW', 'one game saved twice inside a tenth of a second');
t('admin', 'create', 'draftEvents/e1', 'ALLOW');
t('bootstrap', 'create', 'draftEvents/e1', 'ALLOW');
t('viewer', 'create', 'draftEvents/e1', 'DENY');
t('viewer', 'update', 'draftEvents/e1', 'DENY');
t('anon', 'create', 'draftEvents/e1', 'DENY');
t('nonmember', 'create', 'draftEvents/e1', 'DENY');
t('inactiveContrib', 'create', 'draftEvents/e1', 'DENY');
t('passwordVerified', 'create', 'draftEvents/e1', 'DENY');
t('contributor', 'delete', 'draftEvents/e1', 'DENY', 'allowed before');
t('admin', 'delete', 'draftEvents/e1', 'DENY', 'allowed before; nothing in the app deletes a row');
t('viewer', 'get', 'draftEvents/e1/x/y', 'DENY', 'ownBlock guard on the subcollection; allowed before');
t('admin', 'get', 'draftEvents/e1/x/y', 'DENY');
t('contributor', 'create', 'draftEvents/e1/x/y', 'DENY', 'allowed before');

// crawler state
for (const w of ['anon', 'viewer', 'admin', 'bootstrap']) {
  t(w, 'get', 'crawlState/state', 'DENY');
  t(w, 'get', 'crawlSeen/NA1_1', 'DENY');
}
t('contributor', 'update', 'crawlState/state', 'DENY', 'allowed before');

// list queries (the path is the collection's; the Rules API evaluates it as a list)
t('admin', 'list', 'access/any', 'ALLOW', 'Admin > Access listener');
t('viewer', 'list', 'access/any', 'DENY', 'the access listener for a viewer');
t('admin', 'list', 'clientErrors/any', 'ALLOW');
t('viewer', 'list', 'players/any', 'ALLOW');
t('anon', 'list', 'players/any', 'DENY');

(async () => {
  const account = auth.getProjectDefaultAccount(ROOT);
  if (!account) throw new Error('firebase CLI is not logged in (run: firebase login)');
  const options = {};
  auth.setActiveAccount(options, account);
  await requireAuth(options);
  const client = new Client({ urlPrefix: RULES_ORIGIN, apiVersion: 'v1' });
  console.log(`Rules: ${rulesFile}\nProject: ${PROJECT}\n`);
  const res = await client.post(`/projects/${PROJECT}:test`, {
    source: { files: [{ name: 'firestore.rules', content }] },
    testSuite: { testCases: cases.map((c) => c.tc) }
  });
  const issues = res.body.issues || [];
  for (const i of issues) console.log('ISSUE', i.severity, JSON.stringify(i.sourcePosition), i.description);
  const results = res.body.testResults || [];
  let pass = 0;
  let fail = 0;
  results.forEach((r, i) => {
    const ok = r.state === 'SUCCESS';
    if (ok) pass++;
    else fail++;
    const extra = ok ? '' : `  <-- ${r.state} ${JSON.stringify(r.debugMessages || [])} ${r.errorPosition ? JSON.stringify(r.errorPosition) : ''}`;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${cases[i].label}${extra}`);
  });
  const missing = cases.length - results.length;
  const errors = issues.filter((i) => i.severity === 'ERROR').length;
  console.log(`\n${pass} passed, ${fail} failed, ${cases.length} cases${missing ? `, ${missing} without a result` : ''}${errors ? `, ${errors} compile error(s)` : ''}`);
  if (fail || missing || errors) process.exitCode = 1;
})().catch((e) => {
  console.error('ERROR', e.message, e.context?.body ? JSON.stringify(e.context.body).slice(0, 2000) : '');
  process.exit(1);
});
