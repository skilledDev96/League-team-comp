import { DEFAULT_TEAM_ID } from './team-scope';

/**
 * The team a function call is for, and the check that the function answered for that team
 * (27 Sep 2026, release 2 of the multi-team work, the frontend half of Stage 2).
 *
 * `getCompAnalysis` and `gameReview` take an optional `teamId` in the body and echo the team they
 * computed and wrote for on the answer (`default` for the root). The echo exists for one reason:
 * both parsers ignore keys they do not know, so a deployment older than release 2 accepts a body
 * carrying `teamId: 'b'`, reads Bom Squad's data, writes the root `meta/compAnalysis` or
 * `gameReviews/{matchId}`, and says nothing about it. Applied to team b's signal that answer would
 * pass for team b's own. So the caller notes the team it sent for and refuses an answer whose echo
 * names another team or, while a team was asked for, no team at all: that silence is the stale
 * deployment. The root asked and the root answered, with or without the field, is what every call
 * before release 2 was, and passes.
 */

/** What the person is told, once, by whoever was about to apply the answer. */
export const BACKEND_BEHIND = 'The backend is behind this build. Deploy the functions, then refresh again.';

/** How it is told: a warning that stays as long as the activity board's own failures do. */
export const BACKEND_BEHIND_TOAST = { kind: 'warn', icon: 'warning', timeout: 10000 } as const;

/**
 * The `teamId` field a request body carries: no field for the default, so a Bom Squad body is byte
 * for byte the body it was before release 2, and the id for any other team. Spread into the body,
 * so the default adds no key rather than a null.
 */
export function teamIdForRequest(teamId: string): { teamId?: string } {
  return teamId === DEFAULT_TEAM_ID ? {} : { teamId };
}

/**
 * The team an answer says it was computed for. Absent, null or `default` is the root, which is how
 * the functions' own parser reads a body; anything else that is not a string names no team.
 */
export function echoedTeamId(answer: object): string | null {
  const echoed = (answer as { teamId?: unknown }).teamId;
  if (echoed == null || echoed === DEFAULT_TEAM_ID) return DEFAULT_TEAM_ID;
  return typeof echoed === 'string' ? echoed : null;
}

/** Whether the answer was computed for the team the request was sent for. */
export function echoMatches(sentFor: string, answer: object): boolean {
  return echoedTeamId(answer) === sentFor;
}

/** The typed refusal: the answer is not this team's, and the sentence says what to do. */
export class BackendBehindError extends Error {
  constructor(
    /** The team the request was sent for. */
    readonly sentFor: string,
    /** The team the answer named, `default` for the root and null for nothing readable. */
    readonly answeredFor: string | null
  ) {
    super(BACKEND_BEHIND);
    this.name = 'BackendBehindError';
  }
}

/** Refuse an answer whose echo is not the team the request was sent for. */
export function assertTeamEcho(sentFor: string, answer: object): void {
  const answeredFor = echoedTeamId(answer);
  if (answeredFor !== sentFor) throw new BackendBehindError(sentFor, answeredFor);
}

export function isBackendBehind(error: unknown): error is BackendBehindError {
  return error instanceof BackendBehindError;
}
