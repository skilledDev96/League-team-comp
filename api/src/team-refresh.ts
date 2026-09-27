/**
 * The 07:00 ticks: which team runs next (27 Sep 2026, release 2 of the multi-team work).
 *
 * `refreshTeamData` at 06:30 is Bom Squad's and touches only the root. Every other team is refreshed
 * by `refreshTeams`, which fires at 07:00, 07:15, 07:30 and 07:45 Amsterdam and runs
 * `runTeamRefresh` for one team each time, never a loop: a run's budgets (players 360 s, timelines
 * 480 s, reviews 500 s) are all measured from one start inside a 540 s timeout, so a second team in
 * the same invocation would only ever be skipped. Which one team is decided here, where it can be
 * tested; the handler in index.ts lists the teams, reads their logs and calls `runTeamRefresh`.
 */

import { amsterdamDay } from './rank-history';
import { isTeamId, parseTeamId } from './team-scope';

/** What the handler knows about a team before choosing: its document and its last log. */
export interface TeamRefreshCandidate {
  /** The `teams/{id}` document id. */
  id: string;
  /** The team document's switch; anything but the word off is on. */
  refresh?: unknown;
  /** `ranAt` of the team's `meta/refreshLog`, when it has one. */
  lastRanAt?: string;
  /**
   * `refreshStartedAt` on the `teams/{id}` document: when a tick last started this team's run,
   * written before the run and whether or not it reached its log. A run the 540 s timeout kills
   * writes no log, and without this the next tick would read yesterday's log and pick the same
   * team again, four ticks and four Riot budgets in one morning while the other teams waited.
   */
  lastStartedAt?: string;
}

/** An ISO time as milliseconds; absent or unreadable is "never", which sorts before any time. */
function msOf(iso: string | undefined): number {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/** The Amsterdam day an ISO time falls on, or nothing for a time that cannot be read. */
function dayOf(iso: string | undefined): string {
  const ms = msOf(iso);
  return Number.isFinite(ms) ? amsterdamDay(new Date(ms)) : '';
}

/**
 * The one team due now: not switched off, not already run or started today, the one refreshed
 * longest ago first and a team never refreshed before any of them. Ties go by id so two ticks
 * cannot disagree. A start today counts as today's turn even when no log followed it: a run that
 * died costs its own team the morning and not the others, and it is tried again tomorrow. The
 * order stays by the last finished run, so a team whose run died keeps its place at the front.
 * A document whose id is not a team id is skipped, whatever it holds: `teamPaths` would refuse it
 * and the run must not fail on a stray document. Null when nothing is due, and the tick returns
 * without a write.
 */
export function nextTeamToRefresh(teams: readonly TeamRefreshCandidate[], today: string): string | null {
  const due = teams.filter(
    (team) => isTeamId(team.id) && team.refresh !== 'off' && dayOf(team.lastRanAt) !== today && dayOf(team.lastStartedAt) !== today
  );
  due.sort((a, b) => {
    const at = msOf(a.lastRanAt);
    const bt = msOf(b.lastRanAt);
    if (at !== bt) return at < bt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return due[0]?.id ?? null;
}

/**
 * `refreshTeamDataOnce`'s body: `{ teamId }`, optional. The handler took no body at all before
 * release 2, so an empty, missing or unreadable body still means the root; a `teamId` that is not
 * a team id is refused with `parseTeamId`'s message.
 */
export function parseRefreshTeamRequest(body: unknown): { teamId: string } {
  const candidate = body && typeof body === 'object' && !Array.isArray(body) ? (body as { teamId?: unknown }) : {};
  return { teamId: parseTeamId(candidate.teamId) };
}
