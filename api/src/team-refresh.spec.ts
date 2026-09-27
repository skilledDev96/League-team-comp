import { describe, expect, it } from 'vitest';
import { nextTeamToRefresh, parseRefreshTeamRequest } from './team-refresh';

/** Two Amsterdam mornings: the ticks run at 07:00 to 07:45 local, which is 05:00 to 05:45 UTC in September. */
const TODAY = '2026-09-27';
const RAN_TODAY = '2026-09-27T05:00:12.000Z';
const RAN_YESTERDAY = '2026-09-26T05:15:03.000Z';
const RAN_LAST_WEEK = '2026-09-20T05:30:00.000Z';

describe('nextTeamToRefresh', () => {
  it('answers null with no teams, so the tick returns without a write', () => {
    expect(nextTeamToRefresh([], TODAY)).toBeNull();
  });

  it('takes the team refreshed longest ago', () => {
    const teams = [
      { id: 'a', refresh: 'on', lastRanAt: RAN_YESTERDAY },
      { id: 'b', refresh: 'on', lastRanAt: RAN_LAST_WEEK }
    ];
    expect(nextTeamToRefresh(teams, TODAY)).toBe('b');
  });

  it('puts a team never refreshed before any that has been', () => {
    const teams = [
      { id: 'a', refresh: 'on', lastRanAt: RAN_LAST_WEEK },
      { id: 'b', refresh: 'on' }
    ];
    expect(nextTeamToRefresh(teams, TODAY)).toBe('b');
  });

  it('drops a team already run today, on the Amsterdam day and not the UTC one', () => {
    // 23:30 UTC on the 26th is 01:30 on the 27th in Amsterdam: that run was today.
    const teams = [
      { id: 'a', refresh: 'on', lastRanAt: RAN_TODAY },
      { id: 'b', refresh: 'on', lastRanAt: '2026-09-26T23:30:00.000Z' },
      { id: 'c', refresh: 'on', lastRanAt: RAN_YESTERDAY }
    ];
    expect(nextTeamToRefresh(teams, TODAY)).toBe('c');
    expect(nextTeamToRefresh(teams.slice(0, 2), TODAY)).toBeNull();
  });

  it('drops a team whose run was started today and never reached its log, so a dead run costs its own team the morning and not the others', () => {
    // Team a's 07:00 run died before the log write: the log still says last week, the document says today.
    const teams = [
      { id: 'a', refresh: 'on', lastRanAt: RAN_LAST_WEEK, lastStartedAt: RAN_TODAY },
      { id: 'b', refresh: 'on', lastRanAt: RAN_YESTERDAY, lastStartedAt: RAN_YESTERDAY }
    ];
    expect(nextTeamToRefresh(teams, TODAY)).toBe('b');
    expect(nextTeamToRefresh(teams.slice(0, 1), TODAY)).toBeNull();
    // Tomorrow it is due again, and first: the order goes by the last run that finished.
    expect(nextTeamToRefresh(teams, '2026-09-28')).toBe('a');
    // A start that cannot be read is no start.
    expect(nextTeamToRefresh([{ id: 'a', refresh: 'on', lastStartedAt: 'not a time' }], TODAY)).toBe('a');
  });

  it('drops a team switched off, whatever its last run', () => {
    expect(nextTeamToRefresh([{ id: 'a', refresh: 'off' }], TODAY)).toBeNull();
    expect(nextTeamToRefresh([{ id: 'a', refresh: 'off' }, { id: 'b', refresh: 'on', lastRanAt: RAN_YESTERDAY }], TODAY)).toBe('b');
  });

  it('reads anything but the word off as on, the absent switch included', () => {
    expect(nextTeamToRefresh([{ id: 'a' }], TODAY)).toBe('a');
    expect(nextTeamToRefresh([{ id: 'a', refresh: 'on' }], TODAY)).toBe('a');
    expect(nextTeamToRefresh([{ id: 'a', refresh: true }], TODAY)).toBe('a');
  });

  it('skips a document whose id is not a team id, so a stray document cannot fail the tick', () => {
    const teams = [
      { id: 'default', refresh: 'on' },
      { id: 'Team B', refresh: 'on' },
      { id: 'b', refresh: 'on', lastRanAt: RAN_YESTERDAY }
    ];
    expect(nextTeamToRefresh(teams, TODAY)).toBe('b');
    expect(nextTeamToRefresh(teams.slice(0, 2), TODAY)).toBeNull();
  });

  it('treats a last run it cannot read as never run', () => {
    const teams = [
      { id: 'a', refresh: 'on', lastRanAt: RAN_LAST_WEEK },
      { id: 'b', refresh: 'on', lastRanAt: 'not a time' }
    ];
    expect(nextTeamToRefresh(teams, TODAY)).toBe('b');
  });

  it('breaks a tie by id, so two ticks cannot disagree', () => {
    expect(nextTeamToRefresh([{ id: 'b' }, { id: 'a' }], TODAY)).toBe('a');
    expect(nextTeamToRefresh([{ id: 'b', lastRanAt: RAN_YESTERDAY }, { id: 'a', lastRanAt: RAN_YESTERDAY }], TODAY)).toBe('a');
  });

  it('does not change the list it was given', () => {
    const teams = [{ id: 'b' }, { id: 'a' }];
    nextTeamToRefresh(teams, TODAY);
    expect(teams.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('parseRefreshTeamRequest', () => {
  it('reads no body, an empty body and the word default as the root', () => {
    expect(parseRefreshTeamRequest(undefined)).toEqual({ teamId: 'default' });
    expect(parseRefreshTeamRequest(null)).toEqual({ teamId: 'default' });
    expect(parseRefreshTeamRequest({})).toEqual({ teamId: 'default' });
    expect(parseRefreshTeamRequest({ teamId: null })).toEqual({ teamId: 'default' });
    expect(parseRefreshTeamRequest({ teamId: 'default' })).toEqual({ teamId: 'default' });
    // The handler took no body before release 2, so one it cannot read still means the root.
    expect(parseRefreshTeamRequest('')).toEqual({ teamId: 'default' });
    expect(parseRefreshTeamRequest(['b'])).toEqual({ teamId: 'default' });
  });

  it('reads a team id', () => {
    expect(parseRefreshTeamRequest({ teamId: 'b' })).toEqual({ teamId: 'b' });
    expect(parseRefreshTeamRequest({ teamId: 'bom-squad-2' })).toEqual({ teamId: 'bom-squad-2' });
  });

  it('refuses a capital, the teams collection and an empty string rather than reading them as the root', () => {
    for (const teamId of ['B', 'teams', '', 'a/b', 42]) {
      expect(() => parseRefreshTeamRequest({ teamId }), JSON.stringify(teamId)).toThrow('teamId must be a team id.');
    }
  });
});
