/**
 * Where a team's data lives (27 Sep 2026, release 2 of the multi-team work).
 *
 * Bom Squad's data sits on the flat root paths it has always used: `players`, `meta/settings`,
 * `rankHistory/{playerId}`. It never moves. Any other team lives under a prefix, `teams/{teamId}/<the
 * same collection names>` and `teams/{teamId}/meta/<the same doc ids>`, beneath a root document
 * `teams/{teamId}`. Every path question a function asks is answered here, once, so a handler given a
 * team id cannot half-apply the prefix.
 *
 * `frontend/src/app/core/team-scope.ts` is the same file for the app. The two specs carry the same
 * fixture table, duplicated on purpose, and neither reads the other's source: if one copy drifts,
 * one of the two suites goes red (the `api/src/replay-recording.ts` and `core/replay-lines.ts`
 * pattern).
 *
 * What never comes through here, because it is global whatever the team: `matchCache`,
 * `championStats`, `matchupStats`, `matchupIndex`, `crawlState`, `crawlSeen`, `meta/keyHealth`,
 * `meta/championTraits`, `clientErrors`, `userPrefs`, `access`, `teams` itself, and the public
 * `meta/settings` the signed-out shell prints the name from.
 */

/**
 * The flat root, which is Bom Squad. It is a name for "no prefix", never a document id: there is no
 * `teams/default`, and `isTeamId` refuses the word so a stray literal cannot be read as a team.
 */
export const DEFAULT_TEAM_ID = 'default';

/**
 * A team id is a document id we are happy to see in a path and a storage key: lower-case letters,
 * digits and hyphens, 1 to 40 long, starting with a letter or digit. Single letters are allowed
 * because the specs name their second team `b`. `default` means the root and `teams` is the
 * collection the prefix starts with, so neither is ever a team.
 */
const TEAM_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RESERVED = new Set([DEFAULT_TEAM_ID, 'teams']);

export function isTeamId(value: unknown): value is string {
  return typeof value === 'string' && !RESERVED.has(value) && TEAM_ID.test(value);
}

function assertTeamId(teamId: string): void {
  if (teamId !== DEFAULT_TEAM_ID && !isTeamId(teamId)) {
    throw new Error(`Not a team id: ${JSON.stringify(teamId)}`);
  }
}

/**
 * The team a request names, as every parser reads it. Absent, null and the word default all mean
 * the root, which is what every request sent before release 2 meant; anything else must be a team
 * id, and a value that is not one is refused rather than quietly read as the root, because a body
 * that carries `teamId: 'B'` meant another team and must not land on Bom Squad's paths. Answers the
 * string and not the paths so a handler can echo what it resolved to.
 */
export function parseTeamId(value: unknown): string {
  if (value == null || value === DEFAULT_TEAM_ID) return DEFAULT_TEAM_ID;
  if (!isTeamId(value)) throw new Error('teamId must be a team id.');
  return value;
}

/**
 * The Firestore path of a team's collection or document. For the default team it is the segments
 * joined and nothing else, so `scopedPath(DEFAULT_TEAM_ID, 'meta', 'refreshLog')` is the string
 * `'meta/refreshLog'` the code held as a literal before. For any other team the same segments sit
 * under `teams/{teamId}`. An empty segment would silently shorten the path into a different
 * document, and no segment at all would name the root, so both throw.
 */
export function scopedPath(teamId: string, ...segments: string[]): string {
  if (!segments.length) throw new Error('scopedPath needs at least one segment');
  for (const segment of segments) {
    if (!segment) throw new Error(`Empty path segment in ${JSON.stringify(segments)}`);
  }
  assertTeamId(teamId);
  if (teamId === DEFAULT_TEAM_ID) return segments.join('/');
  return ['teams', teamId, ...segments].join('/');
}

/**
 * The localStorage key a team-flavoured preference is kept under. The default team keeps the bare
 * key, so nobody's stored filters or dismissals move; any other team gets `base:teamId`. Kept here
 * so the mirror is whole; the functions have no storage of their own.
 */
export function storageKeyFor(base: string, teamId: string): string {
  assertTeamId(teamId);
  if (teamId === DEFAULT_TEAM_ID) return base;
  return `${base}:${teamId}`;
}

/**
 * One team's paths, for threading through a handler: `col('players')` and `doc('meta', 'refreshLog')`
 * answer with the same strings `scopedPath` would. `teamId` is what was resolved, the default when
 * the request named none.
 */
export interface TeamPaths {
  readonly teamId: string;
  col(name: string): string;
  doc(...segments: string[]): string;
}

/**
 * The paths of the team a request names. Absent, null and the default all mean the root, which is
 * what every request sent before release 2 meant. Anything else must pass `isTeamId`, and the parsers
 * check that before a handler gets here; the throw is the net under them.
 */
export function teamPaths(teamId?: string | null): TeamPaths {
  const id = teamId == null ? DEFAULT_TEAM_ID : teamId;
  assertTeamId(id);
  return {
    teamId: id,
    col: (name) => scopedPath(id, name),
    doc: (...segments) => scopedPath(id, ...segments)
  };
}
