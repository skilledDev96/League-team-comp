/**
 * The build backfill (17 Sep 2026), driven against a fake folder and a fake store.
 *
 * It lives here for the reason the recorder's spec does: `scripts/` has no runner of its own, and
 * the script is plain ESM on node's own modules. What it guards: the header is read the way the
 * importer reads it (the two are mirrored, so a drift turns this red), a dry run writes nothing,
 * `--apply` writes `gameVersion` alone and only onto a scrim that has none, and a folder with no
 * such replay or a header with no build is said rather than guessed.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  buildFromHeader,
  formatTable,
  HEADER_BYTES,
  matchIdFromFilename,
  parseArgs,
  parseServiceAccount,
  patchOfBuild,
  planBackfill,
  readFolder,
  run
} from '../../scripts/backfill-replay-versions.mjs';

/** A header as the client writes it: the magic, ten bytes, the build's length at byte 14, the build. */
function header(build, length = build.length) {
  const out = new Uint8Array(HEADER_BYTES);
  out.set(new TextEncoder().encode('RIOT'), 0);
  out.set([0x02, 0x00, 0xf6, 0xa1, 0x0a, 0xf0, 0x85, 0x04, 0xa7, 0xee], 4);
  out[14] = length;
  out.set(new TextEncoder().encode(build), 15);
  return out;
}

/** Just the parts of node's fs the folder read touches, over a map of file name to bytes. */
function fakeFs(files, dirExists = true) {
  const open = new Map();
  let next = 3;
  return {
    existsSync: () => dirExists,
    readdirSync: () => Object.keys(files),
    openSync: (full) => {
      const name = full.split(/[\\/]/).pop();
      const fd = next++;
      open.set(fd, files[name]);
      return fd;
    },
    readSync: (fd, buffer, offset, length, position) => {
      const bytes = open.get(fd).subarray(position, position + length);
      buffer.set(bytes, offset);
      return bytes.length;
    },
    closeSync: (fd) => open.delete(fd),
    open
  };
}

const FOLDER = {
  'EUW1-7979450974.rofl': header('16.18.815.9717'),
  'EUW1-7979537790.rofl': header('16.18.815.9717'),
  'EUW1-7977592156.rofl': header('16.17.810.4348'),
  'EUW1-7970000001.rofl': new Uint8Array(HEADER_BYTES),
  'EUW1-7917488820.rofl': header('16.13.791.5903'),
  'renamed scrim.rofl': header('16.18.815.9717'),
  'notes.txt': new Uint8Array(4)
};

const SCRIMS = [
  { id: 'EUW1-7979450974', opponent: 'Paradox Requiem' },
  { id: 'EUW1-7979537790', opponent: 'Paradox Requiem', gameVersion: '16.18.815.9717' },
  { id: 'EUW1-7977592156', opponent: 'MOSS 2', gameVersion: '16.17.1.1' },
  { id: 'EUW1-7970000001', opponent: 'MOSS 2' },
  { id: 'EUW1-7960000000', opponent: 'MAD Synergy' }
];

describe('the header, as the importer reads it', () => {
  it('reads the build after the length byte, and nothing that is not a build', () => {
    expect(buildFromHeader(header('16.18.815.9717'))).toBe('16.18.815.9717');
    expect(buildFromHeader(header('16.18.815.9717', 60))).toBeUndefined();
    expect(buildFromHeader(new Uint8Array(HEADER_BYTES))).toBeUndefined();
    expect(buildFromHeader(header('not a build'))).toBeUndefined();
  });

  it('names the patch ten ahead of the client, and ids the way the importer does', () => {
    expect(patchOfBuild('16.18.815.9717')).toBe('26.18');
    expect(patchOfBuild('')).toBe('');
    expect(matchIdFromFilename('euw1-7979450974.rofl')).toBe('EUW1-7979450974');
    expect(matchIdFromFilename('renamed scrim.rofl')).toBe('');
  });
});

describe('readFolder', () => {
  it('reads 64 bytes of every replay named by its match id, and closes each file', () => {
    const fs = fakeFs(FOLDER);
    const read = vi.spyOn(fs, 'readSync');
    const files = readFolder('C:/Replays', fs);
    expect(files).toEqual([
      { matchId: 'EUW1-7979450974', build: '16.18.815.9717' },
      { matchId: 'EUW1-7979537790', build: '16.18.815.9717' },
      { matchId: 'EUW1-7977592156', build: '16.17.810.4348' },
      { matchId: 'EUW1-7970000001', build: undefined },
      { matchId: 'EUW1-7917488820', build: '16.13.791.5903' }
    ]);
    expect(read.mock.calls.every((call) => call[3] === HEADER_BYTES && call[4] === 0)).toBe(true);
    expect(fs.open.size).toBe(0);
  });

  it('says where it looked when there is no folder', () => {
    expect(() => readFolder('C:/Nowhere', fakeFs({}, false))).toThrow(/C:\/Nowhere.*--dir/);
  });
});

describe('planBackfill', () => {
  it('writes only a scrim with no build whose file has one, and says why for the rest', () => {
    const { rows, notImported } = planBackfill(readFolder('C:/Replays', fakeFs(FOLDER)), SCRIMS);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId['EUW1-7979450974']).toMatchObject({ action: 'write', build: '16.18.815.9717' });
    expect(byId['EUW1-7979537790']).toMatchObject({ action: 'has', build: '16.18.815.9717' });
    // A stored build is never replaced, even when the file disagrees; the table says so.
    expect(byId['EUW1-7977592156']).toMatchObject({ action: 'has', build: '16.17.1.1', fileBuild: '16.17.810.4348' });
    expect(byId['EUW1-7970000001']).toMatchObject({ action: 'unreadable' });
    expect(byId['EUW1-7960000000']).toMatchObject({ action: 'no-file' });
    expect(rows.map((r) => r.id)).toEqual(['EUW1-7979537790', 'EUW1-7979450974', 'EUW1-7977592156', 'EUW1-7970000001', 'EUW1-7960000000']);
    expect(notImported).toBe(1);
  });
});

describe('run', () => {
  const store = () => ({
    scrims: vi.fn(async () => SCRIMS),
    writeVersion: vi.fn(async () => undefined)
  });

  it('writes nothing on a dry run, and prints the table and what --apply would do', async () => {
    const firestore = store();
    const lines = [];
    const result = await run({ dir: 'C:/Replays', apply: false, firestore, fs: fakeFs(FOLDER), log: (l) => lines.push(l) });
    expect(firestore.writeVersion).not.toHaveBeenCalled();
    expect(result.written).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('Match');
    expect(out).toContain('26.18');
    expect(out).toContain('has one (the file says 16.17.810.4348)');
    expect(out).toContain('Dry run: 1 build would be written');
  });

  it('with --apply writes gameVersion alone, onto the one scrim that lacks it', async () => {
    const firestore = store();
    const result = await run({ dir: 'C:/Replays', apply: true, firestore, fs: fakeFs(FOLDER), log: () => undefined });
    expect(firestore.writeVersion.mock.calls).toEqual([['EUW1-7979450974', '16.18.815.9717']]);
    expect(result.written).toBe(1);
  });

  it('counts a refused write as failed and carries on', async () => {
    const firestore = store();
    firestore.writeVersion.mockRejectedValueOnce(new Error('FAILED_PRECONDITION'));
    const lines = [];
    const result = await run({ dir: 'C:/Replays', apply: true, firestore, fs: fakeFs(FOLDER), log: (l) => lines.push(l) });
    expect(result.failed).toEqual(['EUW1-7979450974']);
    expect(lines.join('\n')).toContain('1 failed');
  });

  it('prints the folder’s builds when there is no service account', async () => {
    const lines = [];
    const result = await run({ dir: 'C:/Replays', apply: false, firestore: null, fs: fakeFs(FOLDER), log: (l) => lines.push(l) });
    expect(result.written).toBe(0);
    expect(lines.join('\n')).toContain('EUW1-7917488820  16.13.791.5903  26.13');
  });
});

describe('the command line', () => {
  it('takes --apply and --dir and refuses anything else', () => {
    expect(parseArgs([])).toEqual({ apply: false, dir: '', help: false });
    expect(parseArgs(['--apply', '--dir', 'D:/Replays'])).toEqual({ apply: true, dir: 'D:/Replays', help: false });
    expect(() => parseArgs(['--write'])).toThrow(/Unknown option --write/);
  });

  it('reads the service account as JSON or a path, past a byte-order mark, and never quotes it', () => {
    const fs = { existsSync: () => true, readFileSync: () => '\uFEFF{"project_id":"bom"}' };
    expect(parseServiceAccount('C:/keys/sa.json', fs)).toEqual({ project_id: 'bom' });
    expect(parseServiceAccount('{"project_id":"bom"}')).toEqual({ project_id: 'bom' });
    let message = '';
    try {
      parseServiceAccount('{"private_key":"SECRET"');
    } catch (err) {
      message = String(err);
    }
    expect(message).toContain('did not parse as JSON');
    expect(message).not.toContain('SECRET');
  });

  it('pads a table to its widest cell', () => {
    expect(formatTable([{ key: 'a', label: 'A' }, { key: 'b', label: 'Bee' }], [{ a: 'long', b: 'x' }])).toBe('A     Bee\n----  ---\nlong  x');
  });
});
