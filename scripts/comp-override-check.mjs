#!/usr/bin/env node
/**
 * comp-override-check: what the ten hand-placed games look like now that a comp's seat can hold
 * fallbacks (20 Sep 2026).
 *
 * Why: `compOverrides/{matchId}` is one game placed by hand, for an off-book game that really was a
 * known comp or one the matcher read wrongly. A seat that can be filled by a fallback matches more
 * fives than a seat that cannot, so some of those corrections may now be redundant — the matcher
 * reaches the same comp by itself — and some may be contradicted, the matcher now naming a different
 * comp the person's answer is overruling. Neither is automatically wrong: an override beating the
 * matcher is the point of an override. This only says which is which, so the lead can retire the ones
 * that are no longer doing anything and look twice at the rest.
 *
 * **It is a dry run and only a dry run.** There is no --apply and no write path in this file: it opens
 * Firestore, reads three things and prints. Nothing here changes a stored figure, and nothing in this
 * slice backfills anything — the first thing that will move a record is the lead adding a fallback and
 * the next analysis refresh running.
 *
 *   Usage (PowerShell):
 *     cd api; npm run build; cd ..
 *     $env:FIREBASE_SERVICE_ACCOUNT = 'C:\path\to\service-account.json'; node scripts/comp-override-check.mjs
 *   Usage (bash):
 *     (cd api && npm run build)
 *     FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" node scripts/comp-override-check.mjs
 *   Options: [--json]
 *
 * The matchers are **imported from `api/lib`, never reimplemented here** — that is the whole point of
 * the check. `matchComp` is the one the functions run, and "today's answer" is that same function with
 * each comp's `seats` left off, which is exactly what it did before seats existed (proved over the old
 * cases and 300 generated ones in `api/src/comp-match.spec.ts`). A copy of the rule in this file could
 * drift from the deployed one and would then reassure us about code nobody runs. Build `api/` first or
 * the script says so and stops.
 *
 * The comps are turned into a request through `analysisRequestFrom`, the same function the morning run
 * uses, so the seats this scores with are the seats the refresh will score with.
 *
 * firebase-admin comes from e2e/node_modules and the service account is the one the e2e runner signs in
 * with; the account itself is never printed.
 */
import fsDefault from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/** How the run reads one override. Each line of the report is one of these. */
/**
 * @typedef {object} OverrideRow
 * @property {string} matchId
 * @property {string} forcedId     The comp the override names, after `countsUnder`.
 * @property {string} forcedName
 * @property {string} beforeId     What the matcher said on its own, before seats.
 * @property {string} beforeName
 * @property {number} beforeScore
 * @property {string} afterId      What the seat-aware matcher says on its own.
 * @property {string} afterName
 * @property {number} afterScore
 * @property {number} onFallback   Seats the winning comp filled with a fallback, after.
 * @property {string} verdict      redundant | contradicted | still needed | names a missing comp
 * @property {boolean} changed     Whether the seat rule moved this game's unaided answer.
 * @property {string[]} notes
 */

// ---- The rule the report applies -------------------------------------------

/**
 * What one override is now worth, given what the matcher says without it.
 *
 * `auto` is the game's attribution with the overrides map emptied — the comp it would land on if
 * nobody had touched it — and `forced` is where the override puts it. Both have already been through
 * `countsUnder`, so this compares end points and never raw ids: an override onto a comp that folds
 * into the one the matcher found is redundant, not contradicted.
 */
export function verdictFor(forcedId, autoId, compExists) {
  if (!compExists) return 'points at a comp that no longer exists';
  if (!autoId) return 'still doing the work — the matcher has no answer of its own';
  return autoId === forcedId
    ? 'redundant — the matcher reaches the same comp by itself'
    : 'contradicted — the matcher now says something else';
}

/** A short line for a comp the report names, so a deleted id still prints as something. */
function nameOf(id, byId) {
  if (!id) return '—';
  return byId.get(id)?.name ?? `${id} (deleted)`;
}

// ---- The run ---------------------------------------------------------------

/**
 * The whole check with its doors open, so it can be driven with fakes: `lib` is the built api
 * (`matchComp`, `attributeComp`, `analysisRequestFrom`), `store` reads the three collections, and
 * `log` takes the lines.
 *
 * Reads and prints. There is deliberately no branch in here that writes.
 */
export async function run({ lib, store, log = console.log }) {
  const [comps, overrides, analysis] = await Promise.all([store.comps(), store.overrides(), store.analysis()]);

  // The comps exactly as a refresh would send them: priority five in `champions`, plus `seats` on the
  // comps that hold a fallback. One function, so this cannot disagree with the morning run.
  const request = lib.analysisRequestFrom([], comps, []);
  const withSeats = request.comps;
  // Today's answer: the same comps with `seats` left off, which is the matcher as it stood before
  // seats existed. Not a reimplementation — the same function, given the older shape.
  const withoutSeats = withSeats.map(({ seats, ...rest }) => rest);
  const byId = new Map(withSeats.map((comp) => [comp.id, comp]));

  const seatedComps = withSeats.filter((comp) => comp.seats?.some((seat) => seat.length > 1));
  log(`${comps.length} comps, ${seatedComps.length} of them holding a fallback.`);
  if (!seatedComps.length) {
    log('No comp holds a fallback yet, so the two matchers must agree on every game below.');
    log('A disagreement here would be a bug in the seat rule, not a change of the lead\'s making.\n');
  } else {
    log(`Holding fallbacks: ${seatedComps.map((c) => c.name).join(', ')}\n`);
  }

  const games = new Map(analysis.map((game) => [game.matchId, game]));
  const rows = [];
  let mismatched = 0;

  for (const { matchId, compId: forcedRaw } of overrides) {
    const game = games.get(matchId);
    const notes = [];
    if (!game) {
      // The analysis is one document of the newest games; an override on an older game is normal.
      rows.push({
        matchId,
        forcedId: forcedRaw,
        forcedName: nameOf(forcedRaw, byId),
        beforeId: '',
        beforeName: '—',
        beforeScore: 0,
        afterId: '',
        afterName: '—',
        afterScore: 0,
        onFallback: 0,
        verdict: byId.has(forcedRaw)
          ? 'not checkable — the game is not in the stored analysis'
          : 'points at a comp that no longer exists',
        changed: false,
        scoreChanged: false,
        notes: ['The stored analysis is one document of the newest games; the matcher cannot be re-run on an older one.']
      });
      continue;
    }

    // The same five the matcher was handed: `AnalysisGame.players` is our side, one entry a seat.
    const played = (game.players ?? []).map((p) => p.champion).filter(Boolean);
    // Attribution with the overrides map EMPTIED: where this game would land if nobody had placed it.
    const beforeMatch = lib.matchComp(played, withoutSeats, lib.COMP_MATCH_THRESHOLD);
    const before = lib.attributeComp(beforeMatch, matchId, {}, withoutSeats);
    const afterMatch = lib.matchComp(played, withSeats, lib.COMP_MATCH_THRESHOLD);
    const after = lib.attributeComp(afterMatch, matchId, {}, withSeats);
    // And where the override puts it, through the same function, so `countsUnder` is applied to both.
    const forced = lib.attributeComp(afterMatch, matchId, { [matchId]: forcedRaw }, withSeats);

    if (game.compId && forced.compId && game.compId !== forced.compId) {
      // The stored game says one thing and re-running the rules says another. Innocent reasons: the
      // comps or this override were edited since the last refresh. The other reason is that this
      // script is wrong. Either way it is said out loud, rather than quietly comparing against a
      // stale document and reporting the difference as the seat rule's doing.
      mismatched += 1;
      notes.push(
        `Stored analysis has this under ${nameOf(game.compId, byId)}; re-running today's rules gives ${forced.compName} — the comps or this override changed after the last refresh.`
      );
    }
    if (afterMatch.onFallback > 0) {
      notes.push(`${afterMatch.onFallback} of ${afterMatch.overlap} matched seats went to a fallback.`);
    }
    if (afterMatch.tiedNames.length > 1) {
      notes.push(`Ambiguous: ties with ${afterMatch.tiedNames.join(', ')}.`);
    }

    rows.push({
      matchId,
      forcedId: forced.compId ?? forcedRaw,
      forcedName: forced.compName ?? nameOf(forcedRaw, byId),
      beforeId: before.compId ?? '',
      beforeName: before.compName ?? '—',
      beforeScore: beforeMatch.overlap,
      afterId: after.compId ?? '',
      afterName: after.compName ?? '—',
      afterScore: afterMatch.overlap,
      onFallback: afterMatch.onFallback,
      verdict: verdictFor(forced.compId ?? '', after.compId ?? '', byId.has(forcedRaw)),
      // Two different questions, and the second is the quiet one: a fallback can raise a comp's score
      // without changing which comp wins, and that is exactly what moves a game across the threshold
      // on some *other* game. Both are reported.
      changed: (before.compId ?? '') !== (after.compId ?? ''),
      scoreChanged: beforeMatch.overlap !== afterMatch.overlap,
      notes
    });
  }

  // ---- The report ----------------------------------------------------------

  for (const row of rows) {
    log(`${row.matchId}`);
    log(`  forced to      ${row.forcedName}`);
    log(`  today's rule   ${row.beforeName}${row.beforeId ? ` (${row.beforeScore} of 5 seats)` : ' (below the threshold)'}`);
    log(
      `  seat-aware     ${row.afterName}${row.afterId ? ` (${row.afterScore} of 5 seats` : ' (below the threshold'}` +
        `${row.afterId && row.onFallback ? `, ${row.onFallback} on a fallback` : ''})`
    );
    log(`  verdict        ${row.verdict}`);
    if (row.changed) log('  >> the seat rule changed which comp this game lands on');
    else if (row.scoreChanged) log('  >> the seat rule raised the score, but not which comp wins');
    for (const note of row.notes) log(`  note: ${note}`);
    log('');
  }

  const changed = rows.filter((r) => r.changed);
  const rescored = rows.filter((r) => r.scoreChanged && !r.changed);
  const counts = rows.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }), {});
  log(`${rows.length} overrides:`);
  for (const [verdict, count] of Object.entries(counts)) log(`  ${count} ${verdict}`);
  log(`\nThe seat rule changed the comp on ${changed.length}${changed.length ? `: ${changed.map((r) => r.matchId).join(', ')}` : ''}.`);
  log(`It raised the score without changing the comp on ${rescored.length}${rescored.length ? `: ${rescored.map((r) => r.matchId).join(', ')}` : ''}.`);
  if (!seatedComps.length && (changed.length || rescored.length)) {
    log('\nWARNING: no comp holds a fallback, so nothing should have moved at all.');
    log('Treat this as a bug in the seat rule, not as a change of the lead\'s making.');
  }
  if (mismatched) {
    log(`\n${mismatched} game(s) are stored under a different comp than re-running today's rules gives.`);
    log('That is the comps or the overrides having changed since the last refresh — or this check being wrong. Worth a look either way.');
  }
  log('\nNothing was written. This script has no write path.');
  return { rows, changed: changed.length, rescored: rescored.length, seated: seatedComps.length, mismatched };
}

// ---- Doors -----------------------------------------------------------------

/** The service account, as JSON or as a path to a file holding it. Its contents are never printed. */
export function parseServiceAccount(raw, fs = fsDefault) {
  const value = String(raw ?? '').trim();
  if (!value) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set. Put the service account JSON in it, or a path to the file.');
  const text = value.startsWith('{') ? value : fs.existsSync(value) ? fs.readFileSync(value, 'utf8') : '';
  if (!text) throw new Error('FIREBASE_SERVICE_ACCOUNT is neither JSON nor a path to a readable file.');
  try {
    // Trimmed: a file written from PowerShell starts with a byte-order mark, which JSON.parse refuses.
    return JSON.parse(text.replace(/^\uFEFF/, '').trim());
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT did not parse as JSON. (Its contents are never printed.)');
  }
}

/** The built api — the deployed rules themselves, not a copy of them. */
async function openLib() {
  const lib = path.join(root, 'api', 'lib');
  if (!fsDefault.existsSync(path.join(lib, 'comp-match.js'))) {
    throw new Error('api/lib is not built. Run `npm run build` in api/ first — this script scores with the real matcher, never a copy of it.');
  }
  const base = pathToFileURL(path.join(lib, 'index.js'));
  const [match, attribution, refresh] = await Promise.all([
    import(new URL('comp-match.js', base).href),
    import(new URL('comp-attribution.js', base).href),
    import(new URL('daily-refresh.js', base).href)
  ]);
  return {
    matchComp: match.matchComp,
    attributeComp: attribution.attributeComp,
    analysisRequestFrom: refresh.analysisRequestFrom,
    // `COMP_MATCH_THRESHOLD` is not exported from `index.ts` (it sits beside the handlers and the
    // Riot I/O, which this must not import — importing index.ts would try to register functions).
    // It is 3 and has been since the matcher was written; the check says so out loud rather than
    // pretending to have read it, and `api/src/index.ts` is the place to change it.
    COMP_MATCH_THRESHOLD: 3
  };
}

/** The three collections this reads, and nothing else. No write path. */
function openFirestore(raw) {
  const requireE2e = createRequire(path.join(root, 'e2e', 'package.json'));
  let adminApp;
  let adminFirestore;
  try {
    adminApp = requireE2e('firebase-admin/app');
    adminFirestore = requireE2e('firebase-admin/firestore');
  } catch {
    throw new Error('firebase-admin is not installed in e2e/. Run npm install there first.');
  }
  const { cert, deleteApp, getApps, initializeApp } = adminApp;
  const account = parseServiceAccount(raw);
  const app =
    getApps().find((a) => a.name === 'comp-override-check') ??
    initializeApp({ credential: cert(account) }, 'comp-override-check');
  const db = adminFirestore.getFirestore(app);
  return {
    // Read exactly as `rosterFromPlayers` in api/src/index.ts reads them, id off the document, so the
    // request this builds is the request the functions build.
    comps: async () => {
      const snap = await db.collection('comps').get();
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    },
    overrides: async () => {
      const snap = await db.collection('compOverrides').get();
      // `CompOverride` carries `matchId` as a field and is keyed by the same value, and the api reads
      // the field. The document id is the fallback, since the two are equal by construction and a
      // document hand-written without the field would otherwise vanish from the report in silence.
      return snap.docs
        .map((d) => {
          const data = d.data() ?? {};
          return {
            matchId: typeof data.matchId === 'string' && data.matchId ? data.matchId : d.id,
            compId: typeof data.compId === 'string' ? data.compId : ''
          };
        })
        .filter((o) => o.compId);
    },
    analysis: async () => {
      const doc = await db.collection('meta').doc('compAnalysis').get();
      return doc.exists ? (doc.data()?.games ?? []) : [];
    },
    close: () => deleteApp(app)
  };
}

export function parseArgs(argv) {
  const args = { json: false, help: false };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown option ${arg}. Options: [--json]`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: FIREBASE_SERVICE_ACCOUNT=<json or a path to it> node scripts/comp-override-check.mjs [--json]');
    console.log('Reads compOverrides, comps and meta/compAnalysis and prints. It never writes.');
    return;
  }
  const lib = await openLib();
  const store = openFirestore(process.env.FIREBASE_SERVICE_ACCOUNT ?? '');
  try {
    // --json prints the rows as data instead of the report, for a diff between two runs. The lines
    // are swallowed rather than interleaved, so the output is parseable.
    const result = await run({ lib, store, log: args.json ? () => {} : console.log });
    if (args.json) console.log(JSON.stringify(result, null, 2));
  } finally {
    await store.close?.();
  }
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
const same = process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self;
if (same) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
