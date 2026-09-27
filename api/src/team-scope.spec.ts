import { describe, expect, it } from 'vitest';
import { DEFAULT_TEAM_ID, isTeamId, scopedPath, storageKeyFor, teamPaths } from './team-scope';

/**
 * The mirror check. The fixture table below is the same, case for case, as the one in
 * `frontend/src/app/core/team-scope.spec.ts`: the functions and the app must put a team's data at
 * the same path, so if one of the two copies drifts, one of the two suites goes red. Neither spec
 * reads the other package's source. Change a case here and change it there.
 */

// ---- The fixture table (keep identical to frontend/src/app/core/team-scope.spec.ts) ----

/** teamId, segments, the path. The default cases are today's literal strings, verbatim. */
const PATHS: [string, string[], string][] = [
  ['default', ['players'], 'players'],
  ['default', ['meta', 'settings'], 'meta/settings'],
  ['default', ['meta', 'compAnalysis'], 'meta/compAnalysis'],
  ['default', ['rankHistory', 'p1'], 'rankHistory/p1'],
  ['default', ['meta/settings'], 'meta/settings'],
  ['b', ['players'], 'teams/b/players'],
  ['b', ['meta', 'compAnalysis'], 'teams/b/meta/compAnalysis'],
  ['b', ['players', 'p1'], 'teams/b/players/p1'],
  ['bom-squad-2', ['rankHistory', 'p1'], 'teams/bom-squad-2/rankHistory/p1']
];

const TEAM_IDS_ACCEPTED = ['b', 'bom-squad-2', 'a1b2c3', 'a'.repeat(40)];
const TEAM_IDS_REFUSED = ['default', 'B', 'teams', '', 'a/b', 'a'.repeat(41), '-b', 'bom squad'];

/** base, teamId, the key. The default keeps the bare key. */
const STORAGE_KEYS: [string, string, string][] = [
  ['bom-patterns-filters', 'default', 'bom-patterns-filters'],
  ['bom-patterns-filters', 'b', 'bom-patterns-filters:b'],
  ['bom-film-chapter:EUW1-1', 'bom-squad-2', 'bom-film-chapter:EUW1-1:bom-squad-2']
];

// ---- End of the fixture table ----

describe('DEFAULT_TEAM_ID', () => {
  it('is the word default, and is not itself a team id', () => {
    expect(DEFAULT_TEAM_ID).toBe('default');
    expect(isTeamId(DEFAULT_TEAM_ID)).toBe(false);
  });
});

describe('isTeamId', () => {
  it('accepts a lower-case slug of up to 40 characters', () => {
    for (const id of TEAM_IDS_ACCEPTED) expect(isTeamId(id), id).toBe(true);
  });

  it('refuses the default, the teams collection, capitals, slashes, spaces, an empty string and 41 characters', () => {
    for (const id of TEAM_IDS_REFUSED) expect(isTeamId(id), JSON.stringify(id)).toBe(false);
  });

  it('refuses anything that is not a string', () => {
    for (const value of [null, undefined, 1, {}, ['b']]) expect(isTeamId(value)).toBe(false);
  });
});

describe('scopedPath', () => {
  it('joins the segments for the default team and prefixes teams/{id} for any other', () => {
    for (const [teamId, segments, path] of PATHS) expect(scopedPath(teamId, ...segments), path).toBe(path);
  });

  it('gives the default team exactly the strings the code held as literals', () => {
    expect(scopedPath(DEFAULT_TEAM_ID, 'players')).toBe('players');
    expect(scopedPath(DEFAULT_TEAM_ID, 'meta', 'settings')).toBe('meta/settings');
    expect(scopedPath(DEFAULT_TEAM_ID, 'meta', 'compAnalysis')).toBe('meta/compAnalysis');
    expect(scopedPath(DEFAULT_TEAM_ID, 'rankHistory', 'p1')).toBe('rankHistory/p1');
  });

  it('throws on an empty segment, on no segment, and on a value that is not a team id', () => {
    expect(() => scopedPath('b', 'players', '')).toThrow();
    expect(() => scopedPath(DEFAULT_TEAM_ID, '')).toThrow();
    expect(() => scopedPath('b')).toThrow();
    expect(() => scopedPath(DEFAULT_TEAM_ID)).toThrow();
    for (const id of TEAM_IDS_REFUSED.filter((v) => v !== DEFAULT_TEAM_ID)) {
      expect(() => scopedPath(id, 'players'), JSON.stringify(id)).toThrow();
    }
  });
});

describe('storageKeyFor', () => {
  it('keeps the bare key for the default team and appends :teamId for any other', () => {
    for (const [base, teamId, key] of STORAGE_KEYS) expect(storageKeyFor(base, teamId), key).toBe(key);
  });

  it('throws on a value that is not a team id', () => {
    expect(() => storageKeyFor('bom-patterns-filters', 'B')).toThrow();
    expect(() => storageKeyFor('bom-patterns-filters', '')).toThrow();
  });
});

// The functions' own helper; the app has no counterpart, so these cases are not in the table.
describe('teamPaths', () => {
  it('is the root when the request names no team, null, or the default', () => {
    for (const given of [undefined, null, DEFAULT_TEAM_ID]) {
      const paths = teamPaths(given);
      expect(paths.teamId).toBe(DEFAULT_TEAM_ID);
      expect(paths.col('players')).toBe('players');
      expect(paths.doc('meta', 'refreshLog')).toBe('meta/refreshLog');
      expect(paths.doc('rankHistory', 'p1')).toBe('rankHistory/p1');
    }
  });

  it('answers every path under teams/{id} for another team, with the same strings scopedPath gives', () => {
    const paths = teamPaths('b');
    expect(paths.teamId).toBe('b');
    // Guarded, so renaming the table's second team cannot leave this loop asserting nothing.
    const rows = PATHS.filter(([teamId]) => teamId === 'b');
    expect(rows.length).toBeGreaterThan(0);
    for (const [, segments, path] of rows) {
      expect(paths.doc(...segments)).toBe(path);
      if (segments.length === 1) expect(paths.col(segments[0])).toBe(path);
    }
    expect(teamPaths('bom-squad-2').doc('meta', 'compAnalysis')).toBe('teams/bom-squad-2/meta/compAnalysis');
  });

  it('throws on a value that is not a team id, so a parser that forgot to check cannot escape the prefix', () => {
    for (const id of TEAM_IDS_REFUSED.filter((v) => v !== DEFAULT_TEAM_ID)) {
      expect(() => teamPaths(id), JSON.stringify(id)).toThrow();
    }
    expect(() => teamPaths('b').doc('players', '')).toThrow();
  });
});
