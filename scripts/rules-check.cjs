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
// The cases go up in requests of BATCH each (the endpoint refuses a larger suite; see BATCH).
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

// teams/{teamId}: another team's tree (release 2, 27 Sep 2026), the same collection and meta names as the root
// under a root team document. One membership list for every team in this release, so the blocks ask the root
// hasAccess()/canEdit()/isAdmin(); per-team access is release 3. Before the blocks the two root catch-alls covered
// the whole tree: a contributor could write the team document and its meta/settings, a viewer could list its
// draftEvents. Every 'was allowed through the root catch-all' below names one of those.
//
// THE GUARD, first: 'teams' in ownBlock() without its own blocks refuses every read of every team, and Firestore ORs
// every matching rule, so the blocks without 'teams' in ownBlock() refuse nothing. Both halves must land together.
t('viewer', 'get', 'teams/b/players/p1', 'ALLOW', 'GUARD: fails when teams is in ownBlock() without its blocks');
// the team document: members read (the switcher lists teams); admins create, update and delete; the functions'
// refreshStartedAt write goes through the admin SDK, which rules do not apply to
t('viewer', 'get', 'teams/b', 'ALLOW', 'the switcher');
t('viewer', 'list', 'teams/any', 'ALLOW', 'the switcher lists teams');
t('contributor', 'get', 'teams/b', 'ALLOW');
t('admin', 'get', 'teams/b', 'ALLOW');
t('bootstrap', 'get', 'teams/b', 'ALLOW');
t('e2e', 'get', 'teams/b', 'ALLOW');
t('anon', 'get', 'teams/b', 'DENY');
t('anon', 'list', 'teams/any', 'DENY');
t('nonmember', 'get', 'teams/b', 'DENY');
t('inactiveViewer', 'get', 'teams/b', 'DENY');
t('passwordAttacker', 'get', 'teams/b', 'DENY');
for (const m of ['create', 'update', 'delete']) {
  t('admin', m, 'teams/b', 'ALLOW');
  t('bootstrap', m, 'teams/b', 'ALLOW');
  t('contributor', m, 'teams/b', 'DENY', 'was allowed through the root catch-all');
  t('viewer', m, 'teams/b', 'DENY');
  t('anon', m, 'teams/b', 'DENY');
  t('inactiveAdmin', m, 'teams/b', 'DENY');
}
// the list collections under the prefix: members read, editors write, the root catch-all's terms
t('viewer', 'list', 'teams/b/players/any', 'ALLOW');
t('contributor', 'get', 'teams/b/players/p1', 'ALLOW');
t('admin', 'get', 'teams/b/players/p1', 'ALLOW');
t('bootstrap', 'get', 'teams/b/players/p1', 'ALLOW');
t('e2e', 'get', 'teams/b/players/p1', 'ALLOW', 'a viewer through the custom token');
t('anon', 'get', 'teams/b/players/p1', 'DENY');
t('anon', 'list', 'teams/b/players/any', 'DENY');
t('nonmember', 'get', 'teams/b/players/p1', 'DENY');
t('inactiveViewer', 'get', 'teams/b/players/p1', 'DENY');
t('passwordAttacker', 'get', 'teams/b/players/p1', 'DENY');
for (const m of ['create', 'update', 'delete']) {
  t('contributor', m, 'teams/b/players/p1', 'ALLOW');
  t('admin', m, 'teams/b/players/p1', 'ALLOW');
  t('bootstrap', m, 'teams/b/players/p1', 'ALLOW');
  t('viewer', m, 'teams/b/players/p1', 'DENY');
  t('anon', m, 'teams/b/players/p1', 'DENY');
  t('inactiveContrib', m, 'teams/b/players/p1', 'DENY');
}
t('e2e', 'update', 'teams/b/players/p1', 'DENY', 'a viewer through the custom token');
t('passwordVerified', 'update', 'teams/b/players/p1', 'DENY');
for (const coll of ['comps/c1', 'seriesGames/g1', 'gameReviews/NA1_1', 'matchTimeline/NA1_1', 'rankHistory/p1',
  'replayRecordings/m1', 'replayShots/m1__60', 'filmCommitments/NA1_1', 'meta/teamIdentity', 'meta/refreshLog', 'meta/resourceLinks']) {
  t('viewer', 'get', `teams/b/${coll}`, 'ALLOW');
  t('anon', 'get', `teams/b/${coll}`, 'DENY');
}
t('contributor', 'update', 'teams/b/seriesGames/g1', 'ALLOW', 'every save of a game');
t('contributor', 'delete', 'teams/b/gameReviews/NA1_1', 'ALLOW');
// the team's meta/settings: members only, no public read (the signed-out shell prints the ROOT name); admin write
t('viewer', 'get', 'teams/b/meta/settings', 'ALLOW');
t('contributor', 'get', 'teams/b/meta/settings', 'ALLOW');
t('anon', 'get', 'teams/b/meta/settings', 'DENY', "the root's is public, a team's is not");
t('nonmember', 'get', 'teams/b/meta/settings', 'DENY');
t('inactiveViewer', 'get', 'teams/b/meta/settings', 'DENY');
t('contributor', 'update', 'teams/b/meta/settings', 'DENY', 'was allowed through the root catch-all');
t('viewer', 'update', 'teams/b/meta/settings', 'DENY');
t('admin', 'update', 'teams/b/meta/settings', 'ALLOW');
t('admin', 'create', 'teams/b/meta/settings', 'ALLOW', 'the create-team batch');
t('bootstrap', 'create', 'teams/b/meta/settings', 'ALLOW');
t('admin', 'delete', 'teams/b/meta/settings', 'ALLOW', 'the delete-team batch');
t('inactiveAdmin', 'update', 'teams/b/meta/settings', 'DENY');
// the rest of the team's meta: the catch-all's terms, as at the root. resourceLinks is the third document of the
// create-team and delete-team batches (with teams/b and meta/settings), the one shipped write that crosses three
// blocks, so its two operations are pinned by name rather than implied by compAnalysis.
t('admin', 'create', 'teams/b/meta/resourceLinks', 'ALLOW', 'the create-team batch');
t('admin', 'delete', 'teams/b/meta/resourceLinks', 'ALLOW', 'the delete-team batch');
t('viewer', 'get', 'teams/b/meta/compAnalysis', 'ALLOW');
t('contributor', 'update', 'teams/b/meta/compAnalysis', 'ALLOW');
t('contributor', 'create', 'teams/b/meta/compAnalysis', 'ALLOW');
t('contributor', 'update', 'teams/b/meta/selfScout', 'ALLOW');
t('viewer', 'update', 'teams/b/meta/compAnalysis', 'DENY');
t('anon', 'get', 'teams/b/meta/compAnalysis', 'DENY');
// the team's draft log: the root block's twin. Admins read, editors create and update, nobody deletes.
t('viewer', 'get', 'teams/b/draftEvents/e1', 'DENY', "teammates' emails; was allowed through the root catch-all");
t('viewer', 'list', 'teams/b/draftEvents/any', 'DENY', 'was allowed through the root catch-all');
t('e2e', 'get', 'teams/b/draftEvents/e1', 'DENY');
t('contributor', 'get', 'teams/b/draftEvents/e1', 'DENY');
t('contributor', 'list', 'teams/b/draftEvents/any', 'DENY');
t('admin', 'get', 'teams/b/draftEvents/e1', 'ALLOW');
t('admin', 'list', 'teams/b/draftEvents/any', 'ALLOW', 'Diagnostics');
t('bootstrap', 'list', 'teams/b/draftEvents/any', 'ALLOW');
t('inactiveAdmin', 'get', 'teams/b/draftEvents/e1', 'DENY');
t('anon', 'get', 'teams/b/draftEvents/e1', 'DENY');
t('anon', 'list', 'teams/b/draftEvents/any', 'DENY');
t('nonmember', 'get', 'teams/b/draftEvents/e1', 'DENY');
t('contributor', 'create', 'teams/b/draftEvents/e1', 'ALLOW', 'every save of a game');
t('contributor', 'update', 'teams/b/draftEvents/e1', 'ALLOW', 'one game saved twice inside a tenth of a second');
t('admin', 'create', 'teams/b/draftEvents/e1', 'ALLOW');
t('bootstrap', 'create', 'teams/b/draftEvents/e1', 'ALLOW');
t('viewer', 'create', 'teams/b/draftEvents/e1', 'DENY');
t('viewer', 'update', 'teams/b/draftEvents/e1', 'DENY');
t('anon', 'create', 'teams/b/draftEvents/e1', 'DENY');
t('inactiveContrib', 'create', 'teams/b/draftEvents/e1', 'DENY');
t('passwordVerified', 'create', 'teams/b/draftEvents/e1', 'DENY');
t('contributor', 'delete', 'teams/b/draftEvents/e1', 'DENY');
t('admin', 'delete', 'teams/b/draftEvents/e1', 'DENY', 'nothing in the app deletes a row');
t('bootstrap', 'delete', 'teams/b/draftEvents/e1', 'DENY');
t('viewer', 'get', 'teams/b/draftEvents/e1/x/y', 'DENY', 'teamOwnBlock guard on the subcollection');
t('admin', 'get', 'teams/b/draftEvents/e1/x/y', 'DENY');
t('contributor', 'create', 'teams/b/draftEvents/e1/x/y', 'DENY');
// teams/{teamId}/access: reserved for release 3 (a team's own membership list); nothing reads or writes it yet
for (const w of ['anon', 'nonmember', 'viewer', 'contributor', 'admin', 'bootstrap'])
  t(w, 'get', 'teams/b/access/x', 'DENY', 'reserved for release 3');
t('admin', 'list', 'teams/b/access/any', 'DENY', 'reserved for release 3');
t('admin', 'create', 'teams/b/access/x', 'DENY', 'reserved for release 3');
t('bootstrap', 'create', 'teams/b/access/x', 'DENY', 'reserved for release 3');
t('contributor', 'update', 'teams/b/access/x', 'DENY', 'reserved for release 3');
t('admin', 'get', 'teams/b/access/x/y/z', 'DENY', 'teamOwnBlock guard on the subcollection');
// deeper paths under a team: the subcollection twin
t('viewer', 'get', 'teams/b/players/p1/x/y', 'ALLOW');
t('contributor', 'create', 'teams/b/players/p1/x/y', 'ALLOW');
t('admin', 'update', 'teams/b/players/p1/x/y', 'ALLOW');
t('viewer', 'create', 'teams/b/players/p1/x/y', 'DENY', 'members read, only editors write');
t('anon', 'get', 'teams/b/players/p1/x/y', 'DENY');
t('inactiveContrib', 'update', 'teams/b/players/p1/x/y', 'DENY');
// And nothing at the root moved: the root cases above (a viewer's get and list of players, anon's get of
// meta/settings, a contributor's update of players and of meta/settings, a viewer's get of draftEvents) run against
// this same file in this same suite, so they are that proof and are not repeated here; a second copy of a case can
// only agree with the first, and each costs one of the BATCH slots below.

// Cases per request. The Rules API answers a larger suite with a bare 400 INVALID_ARGUMENT and no word on why:
// measured on 27 Sep 2026, when the teams cases took the suite from 169 to 318, a request of 249 cases passed and
// one of 250 was refused, whichever 250 were sent. Each request carries the whole rules file again; nothing is
// deployed or read by any of them.
const BATCH = 200;

(async () => {
  const account = auth.getProjectDefaultAccount(ROOT);
  if (!account) throw new Error('firebase CLI is not logged in (run: firebase login)');
  const options = {};
  auth.setActiveAccount(options, account);
  await requireAuth(options);
  const client = new Client({ urlPrefix: RULES_ORIGIN, apiVersion: 'v1' });
  const requests = Math.ceil(cases.length / BATCH);
  console.log(`Rules: ${rulesFile}\nProject: ${PROJECT}\nCases: ${cases.length} in ${requests} request${requests === 1 ? '' : 's'} of at most ${BATCH}\n`);
  // [case index, result] pairs: a batch that comes back short leaves later batches' labels aligned, and the gap
  // counts as 'without a result' below.
  const results = [];
  let issues = [];
  for (let at = 0; at < cases.length; at += BATCH) {
    const res = await client.post(`/projects/${PROJECT}:test`, {
      source: { files: [{ name: 'firestore.rules', content }] },
      testSuite: { testCases: cases.slice(at, at + BATCH).map((c) => c.tc) }
    });
    // Every request compiles the same file, so the issues repeat; keep the first request's, and stop there
    // when the file does not compile, since no later batch can answer anything.
    if (at === 0) {
      issues = res.body.issues || [];
      for (const i of issues) console.log('ISSUE', i.severity, JSON.stringify(i.sourcePosition), i.description);
      if (issues.some((i) => i.severity === 'ERROR')) break;
    }
    (res.body.testResults || []).forEach((r, j) => results.push([at + j, r]));
  }
  let pass = 0;
  let fail = 0;
  results.forEach(([i, r]) => {
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
