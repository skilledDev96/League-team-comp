#!/usr/bin/env node
/**
 * backfill-replay-versions: the client build each imported custom was saved on, read off the
 * replay files still in the League client's folder (17 Sep 2026).
 *
 * Why: a replay plays only in the client of the patch it was saved on, so a custom can be recorded
 * (`npm run record -- <matchId>`) only until the next patch lands. Admin › Diagnostics lists the
 * customs that can still be recorded from `Scrim.gameVersion`, which the importer writes from
 * 17 Sep 2026 on; every scrim imported before that has none. The build sits in the first bytes of
 * the file, so this reads 64 bytes a file and never the other twenty megabytes.
 *
 *   Usage (PowerShell):
 *     $env:FIREBASE_SERVICE_ACCOUNT = 'C:\path\to\service-account.json'; node scripts/backfill-replay-versions.mjs
 *     node scripts/backfill-replay-versions.mjs --apply
 *   Usage (bash):
 *     FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)" node scripts/backfill-replay-versions.mjs [--apply]
 *   Options: [--apply] [--dir <folder>]
 *
 * A dry run by default: it reads the folder and the `scrims` collection and prints a table of what
 * it would write. With --apply it writes, and it writes one field only — `gameVersion`, with
 * `update()` on a scrim document that exists and has none, conditioned on the document not having
 * changed since it was read. It never creates a document, never touches another field and never
 * replaces a build already stored. With no service account a dry run still prints the folder's
 * builds. firebase-admin comes from e2e/node_modules, the same account the e2e runner signs in
 * with; the account itself is never printed.
 */
import fsDefault from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/** Where the League client saves replays, unless --dir says otherwise. */
export function defaultReplayDir(env = process.env) {
  return path.join(env.USERPROFILE || os.homedir(), 'Documents', 'League of Legends', 'Replays');
}

/** How much of a file is read: the magic, ten bytes, the build's length and the build. */
export const HEADER_BYTES = 64;

/** Byte 14 holds the build's length and the ASCII build follows it. Mirrors `buildFromHeader` in frontend/src/app/core/replay-parse.ts. */
const BUILD_LENGTH_AT = 14;

/** The client build out of a header, or undefined. Mirrors `buildFromHeader` in frontend/src/app/core/replay-parse.ts. */
export function buildFromHeader(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.length <= BUILD_LENGTH_AT) return undefined;
  if (String.fromCharCode(view[0], view[1], view[2], view[3]) !== 'RIOT') return undefined;
  const length = view[BUILD_LENGTH_AT];
  const start = BUILD_LENGTH_AT + 1;
  if (!length || start + length > view.length) return undefined;
  const text = String.fromCharCode(...view.subarray(start, start + length));
  return /^\d+(\.\d+){1,3}$/.test(text) ? text : undefined;
}

/** "16.18.815.9717" is patch "26.18". Mirrors `patchOfBuild` in frontend/src/app/core/replay-parse.ts. */
export function patchOfBuild(build) {
  const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(String(build ?? '').trim());
  if (!match) return '';
  const major = Number(match[1]);
  return `${major >= 15 ? major + 10 : major}.${Number(match[2])}`;
}

/** The match id the client names a file with, as the importer reads it; empty for a renamed file. */
export function matchIdFromFilename(filename) {
  const stem = String(filename).replace(/\.rofl$/i, '').trim();
  return /^[A-Z0-9]+-\d+$/i.test(stem) ? stem.toUpperCase() : '';
}

/** Every replay in the folder with its id and build (undefined when the header has none). */
export function readFolder(dir, fs = fsDefault) {
  if (!fs.existsSync(dir)) throw new Error(`No replay folder at ${dir}. Pass --dir <folder> if the client saves them elsewhere.`);
  const files = [];
  for (const name of fs.readdirSync(dir)) {
    if (!/\.rofl$/i.test(name)) continue;
    const matchId = matchIdFromFilename(name);
    if (!matchId) continue;
    const fd = fs.openSync(path.join(dir, name), 'r');
    try {
      const buffer = Buffer.alloc(HEADER_BYTES);
      const read = fs.readSync(fd, buffer, 0, HEADER_BYTES, 0);
      files.push({ matchId, build: buildFromHeader(buffer.subarray(0, read)) });
    } finally {
      fs.closeSync(fd);
    }
  }
  return files;
}

/**
 * What each scrim gets: `write` when it has no build and its file has one, `has` when it already
 * carries one (with the file's, when the two differ), `no-file` when the folder has no such
 * replay, `unreadable` when the file's header carries no build. Newest id first, which is the
 * order the client numbers games in. `notImported` counts the folder's replays with no scrim.
 */
export function planBackfill(files, scrims) {
  const byId = new Map(files.map((f) => [f.matchId, f]));
  const rows = scrims.map((scrim) => {
    const id = String(scrim.id).toUpperCase();
    const file = byId.get(id);
    const stored = typeof scrim.gameVersion === 'string' && scrim.gameVersion ? scrim.gameVersion : '';
    if (stored) return { id: scrim.id, opponent: scrim.opponent ?? '', build: stored, action: 'has', fileBuild: file?.build ?? '' };
    if (!file) return { id: scrim.id, opponent: scrim.opponent ?? '', build: '', action: 'no-file', fileBuild: '' };
    if (!file.build) return { id: scrim.id, opponent: scrim.opponent ?? '', build: '', action: 'unreadable', fileBuild: '' };
    return { id: scrim.id, opponent: scrim.opponent ?? '', build: file.build, action: 'write', fileBuild: file.build };
  });
  rows.sort((a, b) => String(b.id).localeCompare(String(a.id), undefined, { numeric: true }));
  const scrimIds = new Set(scrims.map((s) => String(s.id).toUpperCase()));
  const notImported = files.filter((f) => !scrimIds.has(f.matchId)).length;
  return { rows, notImported };
}

const ACTION_WORDS = {
  write: 'write',
  has: 'has one',
  'no-file': 'no file in the folder',
  unreadable: 'no build in the header'
};

/** A plain text table: a header, a rule, and a line a row, each column padded to its widest cell. */
export function formatTable(columns, rows) {
  const widths = columns.map((c) => Math.max(c.label.length, ...rows.map((r) => String(r[c.key] ?? '').length)));
  const line = (cells) => cells.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join('  ').trimEnd();
  return [line(columns.map((c) => c.label)), line(widths.map((w) => '-'.repeat(w))), ...rows.map((r) => line(columns.map((c) => r[c.key])))].join('\n');
}

/** The rows as the table prints them. */
export function tableRows(rows) {
  return rows.map((r) => ({
    id: r.id,
    opponent: r.opponent,
    build: r.build,
    patch: patchOfBuild(r.build),
    action: r.action === 'has' && r.fileBuild && r.fileBuild !== r.build ? `has one (the file says ${r.fileBuild})` : ACTION_WORDS[r.action]
  }));
}

export const TABLE_COLUMNS = [
  { key: 'id', label: 'Match' },
  { key: 'opponent', label: 'Filed under' },
  { key: 'build', label: 'Build' },
  { key: 'patch', label: 'Patch' },
  { key: 'action', label: 'What happens' }
];

export function parseArgs(argv) {
  const args = { apply: false, dir: '', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dir') args.dir = argv[(i += 1)] ?? '';
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown option ${arg}. Options: [--apply] [--dir <folder>]`);
  }
  return args;
}

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

/** The `scrims` collection through firebase-admin from e2e/node_modules: a reader, and the one write this script makes. */
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
  const app = getApps().find((a) => a.name === 'backfill-replay-versions') ?? initializeApp({ credential: cert(account) }, 'backfill-replay-versions');
  const db = adminFirestore.getFirestore(app);
  const seen = new Map();
  return {
    scrims: async () => {
      const snap = await db.collection('scrims').get();
      return snap.docs.map((d) => {
        seen.set(d.id, d.updateTime);
        const data = d.data();
        return { id: d.id, opponent: data.opponent, gameVersion: data.gameVersion };
      });
    },
    /** Only `gameVersion`, only on the document as it was read: a scrim saved in between refuses the write. */
    writeVersion: async (id, gameVersion) => {
      const ref = db.collection('scrims').doc(id);
      const updateTime = seen.get(id);
      // update() refuses a document that does not exist, so nothing is ever created here either way.
      if (updateTime) await ref.update({ gameVersion }, { lastUpdateTime: updateTime });
      else await ref.update({ gameVersion });
    },
    close: () => deleteApp(app)
  };
}

/**
 * The whole run with its doors open, so a spec drives it with a fake folder and a fake store:
 * `fs` for the disk, `firestore` for `{ scrims(), writeVersion(id, build) }` (null for none), and
 * `log` for what is printed. Returns the plan and how many builds were written.
 */
export async function run({ dir, apply, firestore, fs = fsDefault, log = console.log }) {
  const files = readFolder(dir, fs);
  log(`${files.length} ${files.length === 1 ? 'replay' : 'replays'} in ${dir}.`);
  if (!firestore) {
    log('No service account, so no scrims to compare with: the builds the folder holds.\n');
    log(
      formatTable(
        [{ key: 'id', label: 'Match' }, { key: 'build', label: 'Build' }, { key: 'patch', label: 'Patch' }],
        files.map((f) => ({ id: f.matchId, build: f.build ?? '', patch: patchOfBuild(f.build) }))
      )
    );
    return { plan: planBackfill(files, []), written: 0, failed: [] };
  }

  const scrims = await firestore.scrims();
  const plan = planBackfill(files, scrims);
  log(`${scrims.length} scrims in Firestore; ${plan.notImported} of the folder's replays are not among them.\n`);
  log(formatTable(TABLE_COLUMNS, tableRows(plan.rows)));
  const toWrite = plan.rows.filter((r) => r.action === 'write');

  if (!apply) {
    log(`\nDry run: ${toWrite.length} ${toWrite.length === 1 ? 'build' : 'builds'} would be written. Run again with --apply to write them.`);
    return { plan, written: 0, failed: [] };
  }

  let written = 0;
  const failed = [];
  for (const row of toWrite) {
    try {
      await firestore.writeVersion(row.id, row.build);
      written += 1;
    } catch (err) {
      failed.push(row.id);
      log(`${row.id}: not written (${err instanceof Error ? err.message : String(err)}).`);
    }
  }
  log(`\nWrote ${written} ${written === 1 ? 'build' : 'builds'}${failed.length ? `; ${failed.length} failed, run again to retry them` : ''}.`);
  return { plan, written, failed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: FIREBASE_SERVICE_ACCOUNT=<json or a path to it> node scripts/backfill-replay-versions.mjs [--apply] [--dir <folder>]');
    return;
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT ?? '';
  if (!raw && args.apply) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set, and --apply has nothing to write to without it.');
  const firestore = raw ? openFirestore(raw) : null;
  try {
    const { failed } = await run({ dir: args.dir || defaultReplayDir(), apply: args.apply, firestore });
    if (failed.length) process.exitCode = 1;
  } finally {
    await firestore?.close?.();
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
