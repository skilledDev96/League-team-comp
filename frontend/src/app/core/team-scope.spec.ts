import { describe, expect, it } from 'vitest';
import { SEAT_DISMISSED_KEY } from '../pages/home/home.component';
import { PATTERN_FILTERS_KEY } from '../pages/review/review.component';
import { PLAYERS_QUEUE_KEY } from '../pages/roster/players/player-rows';
import { DEFAULT_TEAM_ID, isTeamId, scopedPath, storageKeyFor } from './team-scope';

/**
 * The mirror check. The fixture table below is the same, case for case, as the one in
 * `api/src/team-scope.spec.ts`: the app and the functions must put a team's data at the same
 * path, so if one of the two copies drifts, one of the two suites goes red. Neither spec reads the
 * other package's source. Change a case here and change it there.
 */

// ---- The fixture table (keep identical to api/src/team-scope.spec.ts) ----

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

/**
 * The app's own keys (27 Sep 2026, release 2), pinned outside the shared table because the functions have none:
 * each call site's base for the default team is the bare string it was, so nobody's stored Patterns filters,
 * Home seat dismissal or roster queue moves. The constants are the pages' own, imported, not retyped here: a typo
 * in a page's base would pass a check over literals while moving that page's stored data. The film chapter key
 * is pinned the same way with the real function in `film-progress.spec.ts`.
 */
describe("the app's storage keys on the default team", () => {
  it('are the bare keys they always were', () => {
    expect(storageKeyFor(PATTERN_FILTERS_KEY, DEFAULT_TEAM_ID)).toBe('bom-patterns-filters');
    expect(storageKeyFor(SEAT_DISMISSED_KEY, DEFAULT_TEAM_ID)).toBe('bom-home-seat-dismissed');
    expect(storageKeyFor(PLAYERS_QUEUE_KEY, DEFAULT_TEAM_ID)).toBe('bom-roster-queue');
  });
});
