import { describe, expect, it } from 'vitest';
import {
  assertTeamEcho,
  BACKEND_BEHIND,
  BACKEND_BEHIND_TOAST,
  BackendBehindError,
  echoMatches,
  isBackendBehind,
  teamIdForRequest
} from './team-echo';
import { DEFAULT_TEAM_ID } from './team-scope';

/**
 * The echo check both function callers share (27 Sep 2026, release 2, Stage 2). `CompAnalysisService`
 * runs it over a `getCompAnalysis` answer and `GameReviewService` over a `gameReview` answer, written
 * or declined; the shapes below are those three, cut down to what the check reads.
 */
describe('teamIdForRequest', () => {
  it('adds no key for the default, so a Bom Squad body is byte for byte the body it was before release 2', () => {
    const body = { players: [], comps: [], overrides: {}, ...teamIdForRequest(DEFAULT_TEAM_ID) };
    expect(Object.keys(body)).toEqual(['players', 'comps', 'overrides']);
    expect(JSON.stringify(body)).toBe('{"players":[],"comps":[],"overrides":{}}');
    expect(JSON.stringify({ matchId: 'EUW1_1', expect: null, ...teamIdForRequest(DEFAULT_TEAM_ID) })).toBe(
      '{"matchId":"EUW1_1","expect":null}'
    );
  });

  it('names any other team', () => {
    expect(teamIdForRequest('b')).toEqual({ teamId: 'b' });
    expect(JSON.stringify({ matchId: 'EUW1_1', expect: null, ...teamIdForRequest('bom-squad-2') })).toBe(
      '{"matchId":"EUW1_1","expect":null,"teamId":"bom-squad-2"}'
    );
  });
});

describe('the echo', () => {
  /** sentFor, the answer as the function wrote it, whether it is this team's. */
  const CASES: [string, Record<string, unknown>, boolean, string][] = [
    [DEFAULT_TEAM_ID, { comps: [], games: [] }, true, 'the root asked, no echo: a deployment older than release 2 answering for the root'],
    [DEFAULT_TEAM_ID, { comps: [], games: [], teamId: 'default' }, true, 'the root asked, the root echoed'],
    [DEFAULT_TEAM_ID, { declined: true, teamId: null }, true, 'the root asked, a null echo is the root too'],
    ['b', { comps: [], games: [], teamId: 'b' }, true, 'team b asked, team b echoed'],
    ['b', { matchId: 'EUW1_1', reviewedAt: '2026-09-27T07:00:00.000Z', teamId: 'b' }, true, 'a written review for team b'],
    ['b', { declined: true, teamId: 'b' }, true, 'a declined review for team b'],
    ['b', { comps: [], games: [] }, false, 'team b asked, no echo: the stale deployment wrote the root'],
    ['b', { declined: true }, false, 'team b asked, a declined verdict with no echo is about the root'],
    ['b', { comps: [], games: [], teamId: 'c' }, false, 'team b asked, team c echoed'],
    ['b', { comps: [], games: [], teamId: 'default' }, false, 'team b asked, the root echoed'],
    ['b', { comps: [], games: [], teamId: 42 }, false, 'team b asked, nothing readable echoed'],
    [DEFAULT_TEAM_ID, { comps: [], games: [], teamId: 'b' }, false, 'the root asked, a team echoed']
  ];

  for (const [sentFor, answer, ok, why] of CASES) {
    it(`${ok ? 'accepts' : 'refuses'}: ${why}`, () => {
      expect(echoMatches(sentFor, answer)).toBe(ok);
      if (ok) expect(() => assertTeamEcho(sentFor, answer)).not.toThrow();
      else expect(() => assertTeamEcho(sentFor, answer)).toThrow(BackendBehindError);
    });
  }

  it('refuses with the sentence the appliers show, naming both teams', () => {
    let caught: unknown;
    try {
      assertTeamEcho('b', { comps: [], games: [] });
    } catch (error) {
      caught = error;
    }
    expect(isBackendBehind(caught)).toBe(true);
    const refusal = caught as BackendBehindError;
    expect(refusal.message).toBe(BACKEND_BEHIND);
    expect(refusal.message).toBe('The backend is behind this build. Deploy the functions, then refresh again.');
    expect(refusal.name).toBe('BackendBehindError');
    expect(refusal.sentFor).toBe('b');
    expect(refusal.answeredFor).toBe(DEFAULT_TEAM_ID);
    expect(new BackendBehindError('b', 'c').answeredFor).toBe('c');
    // The toast the appliers show is a warning, and stays as long as the activity board's own failures do.
    expect(BACKEND_BEHIND_TOAST.kind).toBe('warn');
    expect(BACKEND_BEHIND_TOAST.timeout).toBe(10000);
  });

  it('tells the refusal from any other failure, so the appliers can leave those on their own path', () => {
    expect(isBackendBehind(new Error(BACKEND_BEHIND))).toBe(false);
    expect(isBackendBehind('The backend is behind this build.')).toBe(false);
    expect(isBackendBehind(undefined)).toBe(false);
  });
});
