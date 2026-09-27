import { isDevMode, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { MatchTimeline } from '../models/team.models';
import { AuthService } from './auth.service';
import { DEV_TIMELINE_KEY, devTimelineKey, MatchTimelineService } from './match-timeline.service';
import { TeamScopeService } from './team-scope.service';

const ID = 'EUW1_7000000001';

/** A version 3 document as a dev would paste it: reduced locally, positions and wards on it. */
const pasted = {
  matchId: ID,
  timelineVersion: 3,
  builtAt: '2026-09-10T06:30:00.000Z',
  ourSide: 'blue',
  durationSec: 1800,
  frameSec: 60,
  goldDiff: [0, 100, 300],
  positions: { minutes: [0, 1], ours: { Jungle: [1000, 1000, 3000, 5000] }, theirs: {} },
  wards: [{ sec: 95, seat: 'Support', type: 'trinket', x: 11500, y: 2400 }]
} as unknown as MatchTimeline;

type Read = (path: string) => Promise<MatchTimeline | null>;
type Private = { read: Read; isDev(): boolean };

describe('MatchTimelineService', () => {
  const auth = { mode: 'firebase' as const, userEmail: signal<string | null>('a@example.com') };
  /** The scope as the test drives it; the real one follows the account and localStorage (its own spec). */
  const scope = { activeTeamId: signal(DEFAULT_TEAM_ID), choose: vi.fn<(teamId: string) => void>() };
  let service: MatchTimelineService;
  let read: Mock<Read>;

  /** The service with its one Firestore read stubbed: never Firestore in a spec, and the spec counts whether it was asked. */
  function create(): MatchTimelineService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: TeamScopeService, useValue: scope }
      ]
    });
    const made = TestBed.inject(MatchTimelineService);
    (made as unknown as Private).read = read;
    return made;
  }

  beforeEach(() => {
    localStorage.clear();
    auth.userEmail.set('a@example.com');
    scope.activeTeamId.set(DEFAULT_TEAM_ID);
    // The read answers "absent" unless a case says otherwise.
    read = vi.fn<Read>(async () => null);
    service = create();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('the dev override', () => {
    it('runs as a dev build under test, and keys the paste by the match id', () => {
      expect(isDevMode()).toBe(true);
      expect(devTimelineKey(ID)).toBe(`${DEV_TIMELINE_KEY}${ID}`);
      expect(devTimelineKey(ID)).toBe('bom-dev-timeline:EUW1_7000000001');
    });

    it('takes the pasted document over Firestore in a dev build, and keeps it as loaded', async () => {
      localStorage.setItem(devTimelineKey(ID), JSON.stringify(pasted));
      const got = await service.load(ID);
      expect(got).toEqual(pasted);
      expect(service.known().get(ID)).toEqual(pasted);
      expect(read).not.toHaveBeenCalled();
      // A second load is the kept one, not a second parse.
      expect(await service.load(ID)).toBe(got);
    });

    it('picks up a fresh paste after forget, the way the takeover refreshes a landed review', async () => {
      localStorage.setItem(devTimelineKey(ID), JSON.stringify(pasted));
      await service.load(ID);
      localStorage.setItem(devTimelineKey(ID), JSON.stringify({ ...pasted, durationSec: 2400 }));
      service.forget(ID);
      expect((await service.load(ID))?.durationSec).toBe(2400);
      expect(read).not.toHaveBeenCalled();
    });

    it('falls through to Firestore on a value that is not JSON, warning once', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      localStorage.setItem(devTimelineKey(ID), '{not json');
      expect(await service.load(ID)).toBeNull();
      expect(service.known().get(ID)).toBeNull();
      expect(read).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(devTimelineKey(ID));
    });

    it('falls through on a document for another match, an array, or a bare value, each with one warning', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      for (const bad of [JSON.stringify({ ...pasted, matchId: 'EUW1_1' }), JSON.stringify([pasted]), '"EUW1_7000000001"', 'null']) {
        warn.mockClear();
        read.mockClear();
        service = create();
        localStorage.setItem(devTimelineKey(ID), bad);
        expect(await service.load(ID), bad).toBeNull();
        expect(read, bad).toHaveBeenCalledTimes(1);
        expect(warn, bad).toHaveBeenCalledTimes(1);
      }
    });

    it('reads Firestore, and nothing else, when no paste is there', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      localStorage.setItem(devTimelineKey('EUW1_other'), JSON.stringify({ ...pasted, matchId: 'EUW1_other' }));
      expect(await service.load(ID)).toBeNull();
      expect(read).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledWith(`matchTimeline/${ID}`);
      expect(warn).not.toHaveBeenCalled();
    });

    it('never looks at storage in a production build', async () => {
      vi.spyOn(service as unknown as Private, 'isDev').mockReturnValue(false);
      localStorage.setItem(devTimelineKey(ID), JSON.stringify(pasted));
      const getItem = vi.spyOn(Storage.prototype, 'getItem');
      expect(await service.load(ID)).toBeNull();
      expect(getItem).not.toHaveBeenCalled();
      expect(read).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * The document is the active team's (27 Sep 2026, release 2). For Bom Squad the path is the literal
   * `matchTimeline/{matchId}` it always was; another team reads under its prefix; and a switch or an account
   * change empties what was read, so a match id two teams share can never show the other team's timeline.
   */
  describe('the team (release 2)', () => {
    it("reads Bom Squad's timeline at matchTimeline/{matchId}, the literal path it always was, and once", async () => {
      read.mockResolvedValue(pasted);
      expect(await service.load(ID)).toEqual(pasted);
      expect(await service.load(ID)).toEqual(pasted);
      expect(read).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledWith('matchTimeline/EUW1_7000000001');
    });

    it("reads another team's timeline under its prefix", async () => {
      scope.activeTeamId.set('b');
      service = create();
      await service.load(ID);
      expect(read).toHaveBeenCalledWith('teams/b/matchTimeline/EUW1_7000000001');
    });

    it("empties what was read when the team changes, and reads the new team's document afresh", async () => {
      read.mockResolvedValue(pasted);
      await service.load(ID);
      // The effect running with nothing changed keeps what was read.
      TestBed.tick();
      expect(service.known().size).toBe(1);

      scope.activeTeamId.set('b');
      TestBed.tick();
      expect(service.known().size).toBe(0);
      await service.load(ID);
      expect(read).toHaveBeenCalledTimes(2);
      expect(read).toHaveBeenLastCalledWith('teams/b/matchTimeline/EUW1_7000000001');
    });

    it('empties on sign-out, so the next account starts with nothing of the last one', async () => {
      read.mockResolvedValue(pasted);
      await service.load(ID);
      auth.userEmail.set(null);
      TestBed.tick();
      expect(service.known().size).toBe(0);
    });

    it("keeps a read that was in flight when the team changed off the new team's map", async () => {
      let answer!: (t: MatchTimeline | null) => void;
      read.mockImplementationOnce(() => new Promise<MatchTimeline | null>((resolve) => (answer = resolve)));
      const pending = service.load(ID);
      scope.activeTeamId.set('b');
      TestBed.tick();
      answer(pasted);
      // Whoever asked on the old team still gets the old team's answer; the map holds nothing of it.
      expect(await pending).toEqual(pasted);
      expect(service.known().size).toBe(0);
      await service.load(ID);
      expect(read).toHaveBeenLastCalledWith('teams/b/matchTimeline/EUW1_7000000001');
    });
  });
});
