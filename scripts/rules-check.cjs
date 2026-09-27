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
// `doc` is the persona's ROOT access entry (Bom Squad's list): undefined for none mocked at all (the bootstrap
// admin, whom the rules never read), null for no entry, else the document. Release 3 adds `teamDocs`, their entry
// per team on that team's own list (mocked at teams/{teamId}/access/{email}), and `membersDoc`, their index
// (mocked at members/{email}: the syncTeamMember trigger writes it beside every active team entry and deletes it
// when the last goes, so a persona with an active team doc has one and the inactive one has none).
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
  phoneNoEmail: { auth: token(null, 'phone', false), doc: undefined },
  // Release 3: people on a team's own list. The first three have no root entry and a doc on team b; the fourth is
  // on team c alone; the fifth is an inactive team entry (no index, the trigger dropped it); the last is a root
  // viewer whom team b lists as a contributor.
  teamViewer: { auth: token('tv@other.test'), doc: null, teamDocs: { b: { role: 'viewer', active: true } }, membersDoc: { teams: { b: 'viewer' } } },
  teamContributor: { auth: token('tc@other.test'), doc: null, teamDocs: { b: { role: 'contributor', active: true } }, membersDoc: { teams: { b: 'contributor' } } },
  teamAdmin: { auth: token('ta@other.test'), doc: null, teamDocs: { b: { role: 'admin', active: true } }, membersDoc: { teams: { b: 'admin' } } },
  teamContributorOther: { auth: token('tco@other.test'), doc: null, teamDocs: { c: { role: 'contributor', active: true } }, membersDoc: { teams: { c: 'contributor' } } },
  teamInactive: { auth: token('ti@other.test'), doc: null, teamDocs: { b: { role: 'contributor', active: false } }, membersDoc: null },
  rootViewerListed: { auth: token('rvl@bom.test'), doc: { role: 'viewer', active: true }, teamDocs: { b: { role: 'contributor', active: true } }, membersDoc: { teams: { b: 'contributor' } } },
  // The team viewer again with a mixed-case token email: the team entry and the index are keyed by the lower-cased
  // address (emailKey()), and the app writes both lower-cased, so every new block must read through emailKey().
  teamViewerUpper: { auth: token('TV@Other.test'), doc: null, teamDocs: { b: { role: 'viewer', active: true } }, membersDoc: { teams: { b: 'viewer' } }, key: 'tv@other.test' }
};

/** The team a case's path names, or null: `teams/b` and `teams/b/...` name b. The rules can only ask about that one. */
function teamOf(docPath) {
  const m = /^teams\/([^/]+)/.exec(docPath);
  return m ? m[1] : null;
}

/**
 * Every get()/exists() the rules could make for this persona on this path: the root entry, the entry on the team
 * the path names, and whether the index exists (anyMember() asks that and nothing more of it). A path the rules
 * read with no mock here does not come back as a clean DENY; the case fails or comes back without a result.
 */
function mocksFor(p, docPath) {
  if (!p.auth || !p.auth.token.email) return [];
  const key = p.key || p.auth.token.email;
  const mocks = [];
  const docAt = (at, data) => {
    mocks.push({ function: 'exists', args: [{ exactValue: at }], result: { value: data !== null } });
    if (data !== null) mocks.push({ function: 'get', args: [{ exactValue: at }], result: { value: { data } } });
  };
  if (p.doc !== undefined) docAt(`${DOCS}/access/${key}`, p.doc);
  const team = teamOf(docPath);
  if (team) docAt(`${DOCS}/teams/${team}/access/${key}`, (p.teamDocs || {})[team] ?? null);
  mocks.push({ function: 'exists', args: [{ exactValue: `${DOCS}/members/${key}` }], result: { value: !!p.membersDoc } });
  return mocks;
}

const cases = [];
function t(who, method, docPath, expect, note) {
  const p = P[who];
  cases.push({
    label: `${expect.padEnd(5)} ${who.padEnd(20)} ${method.padEnd(6)} ${docPath}${note ? '  (' + note + ')' : ''}`,
    tc: {
      expectation: expect,
      request: { ...(p.auth ? { auth: p.auth } : {}), path: `${DOCS}/${docPath}`, method },
      resource: { data: {} },
      functionMocks: mocksFor(p, docPath)
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
// a team's admin is not the root's (release 3): Bom Squad's list is a root admin's alone
t('teamAdmin', 'get', 'access/ta@other.test', 'ALLOW', 'own root entry, absent: AuthService asks it at sign-in');
t('teamAdmin', 'get', 'access/admin@bom.test', 'DENY', "an admin of team b, on Bom Squad's list");
t('teamAdmin', 'list', 'access/any', 'DENY');
t('teamAdmin', 'create', 'access/new@bom.test', 'DENY');
t('teamAdmin', 'update', 'access/ta@other.test', 'DENY', 'self-admission to the root');

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
// a person on another team alone (release 3): their own, through the index; nobody else's still
t('teamViewer', 'get', 'userPrefs/tv@other.test', 'ALLOW', 'no root entry; the index names a team');
t('teamViewer', 'update', 'userPrefs/tv@other.test', 'ALLOW');
t('teamViewer', 'create', 'userPrefs/tv@other.test', 'ALLOW');
t('teamContributorOther', 'update', 'userPrefs/tco@other.test', 'ALLOW');
t('teamViewer', 'get', 'userPrefs/viewer@bom.test', 'DENY');
t('viewer', 'update', 'userPrefs/tv@other.test', 'DENY');
t('teamInactive', 'get', 'userPrefs/ti@other.test', 'DENY', 'no root entry and no index');

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
t('teamViewer', 'create', 'clientErrors/err-1', 'ALLOW', 'a report from another team (release 3)');
t('teamInactive', 'create', 'clientErrors/err-1', 'DENY');
t('teamViewer', 'get', 'clientErrors/err-1', 'DENY');
t('teamAdmin', 'list', 'clientErrors/any', 'DENY', "Diagnostics on Bom Squad is a root admin's");

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

// members/{email}: the per-person index of teams (release 3), { teams: { [teamId]: role } }, the syncTeamMember
// trigger's to write through the admin SDK. Own for anyone signed in, present or not (AuthService reads it beside the
// root entry at sign-in and must learn absent); nobody else's, a root admin included; written by nobody from the app.
t('teamViewer', 'get', 'members/tv@other.test', 'ALLOW', 'own index');
t('teamViewer', 'get', 'members/tc@other.test', 'DENY', "someone else's");
t('viewer', 'get', 'members/viewer@bom.test', 'ALLOW', 'own, absent: a root viewer asks at sign-in');
t('e2e', 'get', 'members/e2e@bomsquad.test', 'ALLOW', 'the e2e viewer asks at sign-in and learns absent');
t('viewerUpper', 'get', 'members/viewer@bom.test', 'ALLOW', 'own index, token email mixed case');
t('teamViewerUpper', 'get', 'members/tv@other.test', 'ALLOW', 'own index, token email mixed case, listed on team b');
t('teamViewerUpper', 'get', 'teams/b/access/tv@other.test', 'ALLOW', 'own team entry under the lower-cased key');
t('teamViewerUpper', 'get', 'teams/b', 'ALLOW');
t('teamViewerUpper', 'get', 'teams/b/players/p1', 'ALLOW', 'the team entry is read through emailKey()');
t('teamViewerUpper', 'get', 'userPrefs/tv@other.test', 'ALLOW');
t('teamViewerUpper', 'get', 'members/TV@Other.test', 'DENY', 'the index under the raw spelling is nobody\'s');
t('nonmember', 'get', 'members/stranger@gmail.com', 'ALLOW', 'own, absent: must learn absent before being turned away');
t('admin', 'get', 'members/tv@other.test', 'DENY', "a root admin reads a team's list, never an index");
t('bootstrap', 'get', 'members/tv@other.test', 'DENY');
t('admin', 'list', 'members/any', 'DENY');
t('anon', 'get', 'members/tv@other.test', 'DENY');
t('passwordAttacker', 'get', 'members/viewer@bom.test', 'DENY');
for (const m of ['create', 'update', 'delete']) {
  t('teamViewer', m, 'members/tv@other.test', 'DENY', 'the trigger writes it');
  t('teamAdmin', m, 'members/ta@other.test', 'DENY');
  t('admin', m, 'members/admin@bom.test', 'DENY');
  t('bootstrap', m, 'members/ruanhart7@gmail.com', 'DENY');
  t('anon', m, 'members/tv@other.test', 'DENY');
}
t('admin', 'get', 'members/tv@other.test/x/y', 'DENY', 'ownBlock guard on the subcollection');
t('teamViewer', 'get', 'members/tv@other.test/x/y', 'DENY');

// teams/{teamId}: another team's tree (release 2, 27 Sep 2026), the same collection and meta names as the root
// under a root team document. Since release 3 (the same day) every team has a membership list of its own,
// teams/{teamId}/access/{email}, and the blocks ask it through teamMember()/teamEditor()/teamAdmin(): a root admin
// passes every door; anyone else has what the team's own entry gives them, so Bom Squad's viewers and contributors
// are nobody on a team that does not list them (every 'allowed in Stage 4' below names one of those, when the
// blocks asked the root list for every team), and a person on team b alone is nobody on the root and on team c.
// Before the blocks the two root catch-alls covered the whole tree: a contributor could write the team document and
// its meta/settings, a viewer could list its draftEvents ('was allowed through the root catch-all').
//
// THE GUARD, first: 'teams' in ownBlock() without its own blocks refuses every read of every team, and Firestore ORs
// every matching rule, so the blocks without 'teams' in ownBlock() refuse nothing. Both halves must land together:
// the first case pins the first half, and the root viewer's DENY of the same path pins the second (without 'teams'
// in ownBlock() the root catch-all would let a root viewer in).
t('teamViewer', 'get', 'teams/b/players/p1', 'ALLOW', 'GUARD: fails when teams is in ownBlock() without its blocks');
t('viewer', 'get', 'teams/b/players/p1', 'DENY', "GUARD's other half: a root viewer on a team that does not list them; allowed in Stage 4");
// the team document: its members read it (one document listen per team the index names); only a root admin lists
// the collection, creates, updates and deletes; the functions' refreshStartedAt write goes through the admin SDK
t('teamViewer', 'get', 'teams/b', 'ALLOW', 'the switcher, one document listen');
t('teamContributor', 'get', 'teams/b', 'ALLOW');
t('teamAdmin', 'get', 'teams/b', 'ALLOW');
t('rootViewerListed', 'get', 'teams/b', 'ALLOW');
t('admin', 'get', 'teams/b', 'ALLOW');
t('bootstrap', 'get', 'teams/b', 'ALLOW');
t('viewer', 'get', 'teams/b', 'DENY', 'allowed in Stage 4');
t('contributor', 'get', 'teams/b', 'DENY', 'allowed in Stage 4');
t('e2e', 'get', 'teams/b', 'DENY', 'the e2e viewer is a root viewer with no index and opens no teams listen');
t('teamContributorOther', 'get', 'teams/b', 'DENY', 'listed on team c alone');
t('teamInactive', 'get', 'teams/b', 'DENY', 'an inactive team entry');
t('anon', 'get', 'teams/b', 'DENY');
t('nonmember', 'get', 'teams/b', 'DENY');
t('inactiveViewer', 'get', 'teams/b', 'DENY');
t('passwordAttacker', 'get', 'teams/b', 'DENY');
t('admin', 'list', 'teams/any', 'ALLOW', "a root admin's teams list");
t('bootstrap', 'list', 'teams/any', 'ALLOW');
t('viewer', 'list', 'teams/any', 'DENY', 'allowed in Stage 4; a root viewer opens no teams listen now');
t('teamViewer', 'list', 'teams/any', 'DENY', 'a list must be readable in full');
t('teamAdmin', 'list', 'teams/any', 'DENY', "a team's admin is not a root admin");
t('anon', 'list', 'teams/any', 'DENY');
for (const m of ['create', 'update', 'delete']) {
  t('admin', m, 'teams/b', 'ALLOW');
  t('bootstrap', m, 'teams/b', 'ALLOW');
  t('teamAdmin', m, 'teams/b', 'DENY', "a team's admin is not a root admin: no create, no delete; the app hides Delete team from them since the review of 27 Sep 2026");
  t('contributor', m, 'teams/b', 'DENY', 'was allowed through the root catch-all');
  t('viewer', m, 'teams/b', 'DENY');
  t('anon', m, 'teams/b', 'DENY');
  t('inactiveAdmin', m, 'teams/b', 'DENY');
}
// the list collections under the prefix: the team's members read, its editors write. The door in one table on
// teams/b/players/p1, get and create for every persona (the GUARD pair above is the two gets it leaves out).
t('teamViewer', 'list', 'teams/b/players/any', 'ALLOW');
t('admin', 'list', 'teams/b/players/any', 'ALLOW');
t('viewer', 'list', 'teams/b/players/any', 'DENY', 'allowed in Stage 4');
t('anon', 'list', 'teams/b/players/any', 'DENY');
for (const [who, get, create, note] of [
  ['admin', 'ALLOW', 'ALLOW', 'a root admin is an admin of every team'],
  ['bootstrap', 'ALLOW', 'ALLOW'],
  ['teamContributor', 'ALLOW', 'ALLOW'],
  ['teamAdmin', 'ALLOW', 'ALLOW'],
  ['rootViewerListed', 'ALLOW', 'ALLOW', "a root viewer whom team b lists as a contributor: the team's list decides"],
  ['contributor', 'DENY', 'DENY', 'a root contributor with no team entry; allowed in Stage 4'],
  ['e2e', 'DENY', 'DENY', 'a root viewer through the custom token'],
  ['teamContributorOther', 'DENY', 'DENY', 'listed on team c alone'],
  ['teamInactive', 'DENY', 'DENY', 'an inactive team entry: the truthy gate'],
  ['inactiveContrib', 'DENY', 'DENY'],
  ['inactiveViewer', 'DENY', 'DENY'],
  ['nonmember', 'DENY', 'DENY'],
  ['passwordAttacker', 'DENY', 'DENY'],
  ['passwordVerified', 'DENY', 'DENY'],
  ['anon', 'DENY', 'DENY']
]) {
  t(who, 'get', 'teams/b/players/p1', get, note);
  t(who, 'create', 'teams/b/players/p1', create, note);
}
t('teamViewer', 'create', 'teams/b/players/p1', 'DENY', 'members read, only editors write');
t('viewer', 'create', 'teams/b/players/p1', 'DENY');
for (const m of ['update', 'delete']) {
  t('teamContributor', m, 'teams/b/players/p1', 'ALLOW');
  t('teamAdmin', m, 'teams/b/players/p1', 'ALLOW');
  t('admin', m, 'teams/b/players/p1', 'ALLOW');
  t('bootstrap', m, 'teams/b/players/p1', 'ALLOW');
  t('rootViewerListed', m, 'teams/b/players/p1', 'ALLOW');
  t('teamViewer', m, 'teams/b/players/p1', 'DENY');
  t('contributor', m, 'teams/b/players/p1', 'DENY', 'allowed in Stage 4');
  t('teamContributorOther', m, 'teams/b/players/p1', 'DENY');
  t('anon', m, 'teams/b/players/p1', 'DENY');
  t('inactiveContrib', m, 'teams/b/players/p1', 'DENY');
}
t('e2e', 'update', 'teams/b/players/p1', 'DENY', 'a viewer through the custom token');
for (const coll of ['comps/c1', 'seriesGames/g1', 'gameReviews/NA1_1', 'matchTimeline/NA1_1', 'rankHistory/p1',
  'replayRecordings/m1', 'replayShots/m1__60', 'filmCommitments/NA1_1', 'meta/teamIdentity', 'meta/refreshLog', 'meta/resourceLinks']) {
  t('teamViewer', 'get', `teams/b/${coll}`, 'ALLOW');
  t('viewer', 'get', `teams/b/${coll}`, 'DENY', 'allowed in Stage 4');
  t('anon', 'get', `teams/b/${coll}`, 'DENY');
}
t('teamContributor', 'update', 'teams/b/seriesGames/g1', 'ALLOW', 'every save of a game');
t('teamContributor', 'delete', 'teams/b/gameReviews/NA1_1', 'ALLOW');
// the team's meta/settings: its members only, no public read (the signed-out shell prints the ROOT name); its admins
// write it, a root admin included
t('teamViewer', 'get', 'teams/b/meta/settings', 'ALLOW');
t('teamContributor', 'get', 'teams/b/meta/settings', 'ALLOW');
t('admin', 'get', 'teams/b/meta/settings', 'ALLOW');
t('viewer', 'get', 'teams/b/meta/settings', 'DENY', 'allowed in Stage 4');
t('anon', 'get', 'teams/b/meta/settings', 'DENY', "the root's is public, a team's is not");
t('nonmember', 'get', 'teams/b/meta/settings', 'DENY');
t('inactiveViewer', 'get', 'teams/b/meta/settings', 'DENY');
t('teamContributorOther', 'get', 'teams/b/meta/settings', 'DENY');
t('teamContributor', 'update', 'teams/b/meta/settings', 'DENY');
t('contributor', 'update', 'teams/b/meta/settings', 'DENY', 'was allowed through the root catch-all');
t('teamViewer', 'update', 'teams/b/meta/settings', 'DENY');
t('teamAdmin', 'update', 'teams/b/meta/settings', 'ALLOW', "Admin > Settings on the team, by the team's own admin");
t('admin', 'update', 'teams/b/meta/settings', 'ALLOW');
t('admin', 'create', 'teams/b/meta/settings', 'ALLOW', 'the create-team batch');
t('bootstrap', 'create', 'teams/b/meta/settings', 'ALLOW');
t('admin', 'delete', 'teams/b/meta/settings', 'ALLOW', 'the delete-team batch');
t('teamAdmin', 'delete', 'teams/b/meta/settings', 'ALLOW');
t('inactiveAdmin', 'update', 'teams/b/meta/settings', 'DENY');
// the rest of the team's meta: the catch-all's terms, as at the root. resourceLinks is the third document of the
// create-team and delete-team batches (with teams/b and meta/settings), the one shipped write that crosses three
// blocks, so its two operations are pinned by name rather than implied by compAnalysis.
t('admin', 'create', 'teams/b/meta/resourceLinks', 'ALLOW', 'the create-team batch');
t('admin', 'delete', 'teams/b/meta/resourceLinks', 'ALLOW', 'the delete-team batch');
t('teamViewer', 'get', 'teams/b/meta/compAnalysis', 'ALLOW');
t('teamContributor', 'update', 'teams/b/meta/compAnalysis', 'ALLOW');
t('teamContributor', 'create', 'teams/b/meta/compAnalysis', 'ALLOW');
t('teamContributor', 'update', 'teams/b/meta/selfScout', 'ALLOW');
t('teamViewer', 'update', 'teams/b/meta/compAnalysis', 'DENY');
t('contributor', 'update', 'teams/b/meta/compAnalysis', 'DENY', 'allowed in Stage 4');
t('anon', 'get', 'teams/b/meta/compAnalysis', 'DENY');
// the team's draft log: the root block's twin. Its admins read, its editors create and update, nobody deletes.
t('teamViewer', 'get', 'teams/b/draftEvents/e1', 'DENY', "teammates' emails");
t('teamViewer', 'list', 'teams/b/draftEvents/any', 'DENY');
t('teamContributor', 'get', 'teams/b/draftEvents/e1', 'DENY');
t('teamContributor', 'list', 'teams/b/draftEvents/any', 'DENY');
t('teamAdmin', 'get', 'teams/b/draftEvents/e1', 'ALLOW');
t('teamAdmin', 'list', 'teams/b/draftEvents/any', 'ALLOW', "Diagnostics, by the team's own admin");
t('admin', 'get', 'teams/b/draftEvents/e1', 'ALLOW');
t('admin', 'list', 'teams/b/draftEvents/any', 'ALLOW', 'Diagnostics');
t('bootstrap', 'list', 'teams/b/draftEvents/any', 'ALLOW');
t('viewer', 'list', 'teams/b/draftEvents/any', 'DENY');
t('e2e', 'get', 'teams/b/draftEvents/e1', 'DENY');
t('inactiveAdmin', 'get', 'teams/b/draftEvents/e1', 'DENY');
t('anon', 'get', 'teams/b/draftEvents/e1', 'DENY');
t('anon', 'list', 'teams/b/draftEvents/any', 'DENY');
t('nonmember', 'get', 'teams/b/draftEvents/e1', 'DENY');
t('teamContributor', 'create', 'teams/b/draftEvents/e1', 'ALLOW', 'every save of a game');
t('teamContributor', 'update', 'teams/b/draftEvents/e1', 'ALLOW', 'one game saved twice inside a tenth of a second');
t('teamAdmin', 'create', 'teams/b/draftEvents/e1', 'ALLOW');
t('admin', 'create', 'teams/b/draftEvents/e1', 'ALLOW');
t('bootstrap', 'create', 'teams/b/draftEvents/e1', 'ALLOW');
t('rootViewerListed', 'create', 'teams/b/draftEvents/e1', 'ALLOW');
t('teamViewer', 'create', 'teams/b/draftEvents/e1', 'DENY');
t('teamViewer', 'update', 'teams/b/draftEvents/e1', 'DENY');
t('contributor', 'create', 'teams/b/draftEvents/e1', 'DENY', 'allowed in Stage 4');
t('teamContributorOther', 'create', 'teams/b/draftEvents/e1', 'DENY');
t('anon', 'create', 'teams/b/draftEvents/e1', 'DENY');
t('inactiveContrib', 'create', 'teams/b/draftEvents/e1', 'DENY');
t('passwordVerified', 'create', 'teams/b/draftEvents/e1', 'DENY');
t('teamContributor', 'delete', 'teams/b/draftEvents/e1', 'DENY');
t('teamAdmin', 'delete', 'teams/b/draftEvents/e1', 'DENY');
t('admin', 'delete', 'teams/b/draftEvents/e1', 'DENY', 'nothing in the app deletes a row');
t('bootstrap', 'delete', 'teams/b/draftEvents/e1', 'DENY');
t('teamViewer', 'get', 'teams/b/draftEvents/e1/x/y', 'DENY', 'teamOwnBlock guard on the subcollection');
t('teamAdmin', 'get', 'teams/b/draftEvents/e1/x/y', 'DENY');
t('admin', 'get', 'teams/b/draftEvents/e1/x/y', 'DENY');
t('teamContributor', 'create', 'teams/b/draftEvents/e1/x/y', 'DENY');
// teams/{teamId}/access: the team's own membership list (release 3). Own entry for anyone signed in, present or not;
// the list, anyone else's entry and every write for the team's admins and root admins; it decides this team alone.
t('teamViewer', 'get', 'teams/b/access/tv@other.test', 'ALLOW', 'own entry');
t('teamContributor', 'get', 'teams/b/access/tc@other.test', 'ALLOW', 'own entry');
t('teamInactive', 'get', 'teams/b/access/ti@other.test', 'ALLOW', 'own entry, inactive: must learn inactive');
t('teamViewer', 'get', 'teams/b/access/tc@other.test', 'DENY', "someone else's entry");
t('teamContributor', 'get', 'teams/b/access/ta@other.test', 'DENY');
t('viewer', 'get', 'teams/b/access/viewer@bom.test', 'ALLOW', 'own entry, absent: anyone signed in may ask where they stand');
t('teamContributorOther', 'get', 'teams/b/access/tco@other.test', 'ALLOW', 'own entry, absent');
t('nonmember', 'get', 'teams/b/access/stranger@gmail.com', 'ALLOW', 'own entry, absent');
t('anon', 'get', 'teams/b/access/tv@other.test', 'DENY');
t('passwordAttacker', 'get', 'teams/b/access/viewer@bom.test', 'DENY');
t('teamAdmin', 'get', 'teams/b/access/tv@other.test', 'ALLOW', "the team's admin reads anyone's");
t('admin', 'get', 'teams/b/access/tv@other.test', 'ALLOW', 'a root admin, without an entry of their own');
t('teamAdmin', 'list', 'teams/b/access/any', 'ALLOW', 'Admin > Access on the team');
t('admin', 'list', 'teams/b/access/any', 'ALLOW', "a root admin: Admin > Access, the copy of Bom Squad's members, the delete-team batch");
t('bootstrap', 'list', 'teams/b/access/any', 'ALLOW');
t('teamContributor', 'list', 'teams/b/access/any', 'DENY');
t('teamViewer', 'list', 'teams/b/access/any', 'DENY');
t('viewer', 'list', 'teams/b/access/any', 'DENY');
t('contributor', 'list', 'teams/b/access/any', 'DENY');
t('anon', 'list', 'teams/b/access/any', 'DENY');
for (const m of ['create', 'update', 'delete']) {
  t('teamAdmin', m, 'teams/b/access/new@other.test', 'ALLOW');
  t('admin', m, 'teams/b/access/new@other.test', 'ALLOW');
  t('bootstrap', m, 'teams/b/access/new@other.test', 'ALLOW', m === 'create' ? 'the create-team batch seeds the creator and the copied members' : undefined);
  t('teamContributor', m, 'teams/b/access/new@other.test', 'DENY');
  t('contributor', m, 'teams/b/access/new@other.test', 'DENY');
  t('anon', m, 'teams/b/access/new@other.test', 'DENY');
}
t('teamContributor', 'update', 'teams/b/access/tc@other.test', 'DENY', 'self-promotion');
t('teamViewer', 'update', 'teams/b/access/tv@other.test', 'DENY', 'self-promotion');
t('teamAdmin', 'update', 'teams/b/access/ta@other.test', 'ALLOW', 'their own entry, as a root admin may at the root');
t('inactiveAdmin', 'create', 'teams/b/access/new@other.test', 'DENY');
// the list decides its own team alone
t('teamAdmin', 'list', 'teams/c/access/any', 'DENY', "an admin of team b, on team c's list");
t('teamAdmin', 'create', 'teams/c/access/new@other.test', 'DENY');
t('teamAdmin', 'get', 'teams/c', 'DENY');
t('teamAdmin', 'get', 'teams/c/players/p1', 'DENY');
t('teamContributorOther', 'get', 'teams/c/players/p1', 'ALLOW', 'their own team');
t('teamContributorOther', 'create', 'teams/c/players/p1', 'ALLOW');
t('admin', 'get', 'teams/b/access/x/y/z', 'DENY', 'teamOwnBlock guard on the subcollection');
t('teamAdmin', 'get', 'teams/b/access/x/y/z', 'DENY');
t('teamAdmin', 'create', 'teams/b/access/x/y/z', 'DENY');
// deeper paths under a team: the subcollection twin
t('teamViewer', 'get', 'teams/b/players/p1/x/y', 'ALLOW');
t('teamContributor', 'create', 'teams/b/players/p1/x/y', 'ALLOW');
t('admin', 'update', 'teams/b/players/p1/x/y', 'ALLOW');
t('teamViewer', 'create', 'teams/b/players/p1/x/y', 'DENY', 'members read, only editors write');
t('viewer', 'get', 'teams/b/players/p1/x/y', 'DENY', 'allowed in Stage 4');
t('anon', 'get', 'teams/b/players/p1/x/y', 'DENY');
t('inactiveContrib', 'update', 'teams/b/players/p1/x/y', 'DENY');
t('teamInactive', 'get', 'teams/b/players/p1/x/y', 'DENY');
// And the root is untouched by a team's list: a person on team b alone is nobody at the root, and Bom Squad's own
// cases above (a viewer's get and list of players, anon's get of meta/settings, a contributor's update of players
// and of meta/settings, a viewer's get of draftEvents) run against this same file, so they are that proof and are
// not repeated here; a second copy of a case can only agree with the first, and each costs one of the BATCH slots.
t('teamContributor', 'get', 'players/p1', 'DENY', 'listed on team b alone');
t('teamContributor', 'create', 'players/p1', 'DENY');
t('teamViewer', 'list', 'players/any', 'DENY');
t('teamContributor', 'get', 'meta/settings', 'ALLOW', 'public');
t('teamAdmin', 'update', 'meta/settings', 'DENY', "a team's admin is not the root's");
t('teamAdmin', 'get', 'draftEvents/e1', 'DENY');
t('teamAdmin', 'list', 'draftEvents/any', 'DENY');
t('rootViewerListed', 'get', 'players/p1', 'ALLOW', 'a root viewer still');
t('rootViewerListed', 'create', 'players/p1', 'DENY', 'a contributor on team b, a viewer at the root');
// The four site-wide root reads the app makes on every team (the two global meta listens, the champion stats and
// the matchup index) are anyone let in's since the review of 27 Sep 2026 (anyMember(), a block each): a person on
// another team alone reads them, nobody else new does, and the writes keep the catch-all's terms (editors of Bom
// Squad; the functions write through the admin SDK). The root viewer's ALLOW of championStats and matchupIndex is
// in the catch-all loop above. The ownBlock() entries of the two collections are pinned by the subcollection DENY
// at the end (without the entry the root subcollection catch-all would let a root viewer read under them); the
// siteMetaDoc() test has no observable guard, since the block and the catch-all agree for every persona, and stands
// for the "one block decides a path" rule alone.
for (const path of ['meta/keyHealth', 'meta/championTraits', 'championStats/16.17_ALL', 'matchupIndex/16.17_TOP']) {
  t('teamViewer', 'get', path, 'ALLOW', 'the app reads it on every team; a person on another team alone (release 3 review)');
  t('teamContributorOther', 'get', path, 'ALLOW');
  if (path.startsWith('meta/')) t('viewer', 'get', path, 'ALLOW', 'a root member, as before');
  t('e2e', 'get', path, 'ALLOW');
  t('anon', 'get', path, 'DENY');
  t('nonmember', 'get', path, 'DENY', 'signed in, on no list and in no index');
  t('teamInactive', 'get', path, 'DENY', 'no root entry and no index');
  t('inactiveViewer', 'get', path, 'DENY');
  t('passwordAttacker', 'get', path, 'DENY');
  t('contributor', 'update', path, 'ALLOW', "the catch-all's write terms, as before");
  t('viewer', 'update', path, 'DENY');
  t('teamContributor', 'update', path, 'DENY', 'a member of another team reads the site docs and writes none');
  t('teamAdmin', 'update', path, 'DENY');
  t('anon', 'update', path, 'DENY');
}
t('viewer', 'get', 'meta/compAnalysis', 'ALLOW', 'the rest of meta stays with the catch-all');
t('teamViewer', 'get', 'meta/compAnalysis', 'DENY', "Bom Squad's own analysis is not a site document");
t('teamViewer', 'get', 'meta/teamIdentity', 'DENY');
t('viewer', 'get', 'championStats/16.17_ALL/x/y', 'DENY', 'ownBlock guard on the subcollection; nothing lives there');
t('contributor', 'create', 'matchupIndex/16.17_TOP/x/y', 'DENY');

// Cases per request. The Rules API answers a larger suite with a bare 400 INVALID_ARGUMENT and no word on why:
// measured on 27 Sep 2026, when the teams cases took the suite from 169 to 318, a request of 249 cases passed and
// one of 250 was refused, whichever 250 were sent. Each request carries the whole rules file again; nothing is
// deployed or read by any of them. The release 3 cases (a list per team, the index) took it to 483, in three, and
// the review of 27 Sep 2026 (the four site-wide reads, the mixed-case team persona) to 545, still three.
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
