import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { ReplayRecording, ReplayShot } from '../models/team.models';
import { AuthService } from './auth.service';
import { devRecordingKey, devShotKey, ReplayRecordingService, shotSrc } from './replay-recording.service';
import { TeamScopeService } from './team-scope.service';

/**
 * The reader for a recorded game. Firestore never runs in a spec: the one
 * private read is stubbed, and what these tests care about is how often it
 * is asked — a recording is read once a session, and a picture is read once
 * a document, because each is a few hundred kilobytes. Since release 2
 * (27 Sep 2026) they also pin which path it is asked for: Bom Squad's two
 * collections are the literal root paths they always were.
 */

const ID = 'EUW1-7977592156';

const recording = {
  matchId: ID,
  recordedAt: '2026-09-10T18:20:00.000Z',
  recorderVersion: 1,
  durationSec: 2040,
  ourSide: 'blue',
  seats: [{ seat: 'ADC', champion: 'Jinx', ours: true, name: 'Rhu' }],
  samples: [],
  events: [],
  shots: [{ sec: 620, kind: 'death', label: 'Jinx falls in the river', seat: 'ADC', docId: `${ID}__620` }],
  bytes: 4200
} as unknown as ReplayRecording;

const shot = {
  matchId: ID,
  sec: 620,
  kind: 'death',
  label: 'Jinx falls in the river',
  mediaType: 'image/jpeg',
  bytes: 240_000,
  data: 'AAAA'
} as unknown as ReplayShot;

type Read = (path: string, shape: (data: unknown) => unknown) => Promise<unknown>;
type Private = { read: Read; db(): unknown; isDev(): boolean };
type Listing = { db(): unknown; listCollection(db: unknown, path: string): Promise<{ docs: { id: string }[] }> };

describe('ReplayRecordingService', () => {
  const auth = { mode: 'firebase' as const, userEmail: signal<string | null>('a@example.com') };
  /** The scope as the test drives it; the real one follows the account and localStorage (its own spec). */
  const scope = { activeTeamId: signal(DEFAULT_TEAM_ID), choose: vi.fn<(teamId: string) => void>() };
  let service: ReplayRecordingService;
  let read: Mock<Read>;

  function create(): ReplayRecordingService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: TeamScopeService, useValue: scope }
      ]
    });
    const made = TestBed.inject(ReplayRecordingService);
    (made as unknown as Private).read = read;
    return made;
  }

  beforeEach(() => {
    localStorage.clear();
    auth.userEmail.set('a@example.com');
    scope.activeTeamId.set(DEFAULT_TEAM_ID);
    read = vi.fn<Read>(async (path) => (path.endsWith(`replayRecordings/${ID}`) ? recording : path.endsWith(`replayShots/${ID}__620`) ? shot : null));
    service = create();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('reads a recording once and keeps it, whatever asks and however often', async () => {
    expect(service.recordingFor(ID)).toBeUndefined();
    expect(service.has(ID)).toBe(false);

    const first = await service.load(ID);
    expect(first).toEqual(recording);
    expect(await service.load(ID)).toBe(first);
    // The row's chip, the frames strip and the story drawer all ask; one read serves them.
    expect(read).toHaveBeenCalledTimes(1);
    // Bom Squad's path, the literal it always was.
    expect(read.mock.calls[0][0]).toBe(`replayRecordings/${ID}`);
    expect(service.recordingFor(ID)).toEqual(recording);
    expect(service.has(ID)).toBe(true);
  });

  it('shares one read between callers that ask at the same time', async () => {
    const both = await Promise.all([service.load(ID), service.load(ID)]);
    expect(both[0]).toBe(both[1]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('remembers that a game has no recording, and never asks twice', async () => {
    expect(await service.load('EUW1-nothing')).toBeNull();
    expect(await service.load('EUW1-nothing')).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    expect(service.known().get('EUW1-nothing')).toBeNull();
    expect(service.has('EUW1-nothing')).toBe(false);
  });

  it('reads a picture by its document id, once, and hands it to an img', async () => {
    expect(service.shotFor(`${ID}__620`)).toBeUndefined();
    const got = await service.loadShot(`${ID}__620`);
    expect(await service.loadShot(`${ID}__620`)).toBe(got);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][0]).toBe(`replayShots/${ID}__620`);
    expect(service.shotFor(`${ID}__620`)).toEqual(shot);
    expect(shotSrc(got!)).toBe('data:image/jpeg;base64,AAAA');
  });

  it('reads a recording again after forget, and leaves the pictures alone', async () => {
    await service.load(ID);
    await service.loadShot(`${ID}__620`);
    service.forget(ID);
    expect(service.recordingFor(ID)).toBeUndefined();
    await service.load(ID);
    expect(read).toHaveBeenCalledTimes(3);
    expect(service.shotFor(`${ID}__620`)).toEqual(shot);
  });

  it('takes a pasted recording and a pasted picture over Firestore on a dev build, and keeps them', async () => {
    localStorage.setItem(devRecordingKey(ID), JSON.stringify(recording));
    localStorage.setItem(devShotKey(`${ID}__620`), JSON.stringify(shot));
    expect(await service.load(ID)).toEqual(recording);
    expect(await service.loadShot(`${ID}__620`)).toEqual(shot);
    expect(read).not.toHaveBeenCalled();
    expect(service.has(ID)).toBe(true);
    // The kept paste is what a second ask gets, not a second parse.
    expect(await service.load(ID)).toEqual(recording);
  });

  it('falls through to Firestore on a paste that is not JSON, not an object, or another game’s, warning once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const bad of ['{not json', JSON.stringify([recording]), JSON.stringify({ ...recording, matchId: 'EUW1-other' }), 'null']) {
      warn.mockClear();
      read.mockClear();
      service = create();
      localStorage.setItem(devRecordingKey(ID), bad);
      expect(await service.load(ID), bad).toEqual(recording);
      expect(read, bad).toHaveBeenCalledTimes(1);
      expect(warn, bad).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(devRecordingKey(ID));
    }
  });

  it('never looks at storage in a production build', async () => {
    vi.spyOn(service as unknown as Private, 'isDev').mockReturnValue(false);
    localStorage.setItem(devRecordingKey(ID), JSON.stringify(recording));
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    await service.load(ID);
    expect(getItem).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('answers nothing rather than throwing in local mode, where there is no database', async () => {
    const offline = create();
    // The real read this time, which is what answers nothing without a database.
    delete (offline as unknown as { read?: Read }).read;
    vi.spyOn(offline as unknown as Private, 'db').mockReturnValue(null);
    expect(await offline.load(ID)).toBeNull();
    expect(await offline.loadShot(`${ID}__620`)).toBeNull();
    expect(offline.has(ID)).toBe(false);
  });

  it('lists no recorded ids in local mode, where nothing is ever recorded (17 Sep 2026)', async () => {
    const offline = create();
    vi.spyOn(offline as unknown as Private, 'db').mockReturnValue(null);
    expect(await offline.recordedIds()).toEqual([]);
  });

  it('lists the id of every recording from Firestore, and throws on a failed read rather than answer none', async () => {
    // "None recorded" would put every recorded game back on Customs to record, so the card has to see the failure.
    const online = create();
    const seam = online as unknown as Listing;
    const db = { name: 'firestore' };
    vi.spyOn(seam, 'db').mockReturnValue(db);
    const list = vi.spyOn(seam, 'listCollection').mockResolvedValue({ docs: [{ id: ID }, { id: 'EUW1-7979450974' }] });
    expect(await online.recordedIds()).toEqual([ID, 'EUW1-7979450974']);
    // Bom Squad's collection, the literal it always was.
    expect(list).toHaveBeenCalledWith(db, 'replayRecordings');

    list.mockRejectedValue(new Error('Missing or insufficient permissions.'));
    await expect(online.recordedIds()).rejects.toThrow('Missing or insufficient permissions.');
  });

  /**
   * Both collections are the active team's (27 Sep 2026, release 2): another team reads and lists under its
   * prefix, and a switch or an account change empties the recordings and the pictures alike, so a match id two
   * teams share can never show the other side's recording.
   */
  describe('the team (release 2)', () => {
    it("reads and lists another team's recordings and pictures under its prefix", async () => {
      scope.activeTeamId.set('b');
      const online = create();
      expect(await online.load(ID)).toEqual(recording);
      expect(await online.loadShot(`${ID}__620`)).toEqual(shot);
      expect(read.mock.calls.map((c) => c[0])).toEqual([`teams/b/replayRecordings/${ID}`, `teams/b/replayShots/${ID}__620`]);

      const seam = online as unknown as Listing;
      const db = { name: 'firestore' };
      vi.spyOn(seam, 'db').mockReturnValue(db);
      const list = vi.spyOn(seam, 'listCollection').mockResolvedValue({ docs: [{ id: ID }] });
      expect(await online.recordedIds()).toEqual([ID]);
      expect(list).toHaveBeenCalledWith(db, 'teams/b/replayRecordings');
    });

    it('empties the recordings and the pictures when the team changes, and reads them afresh under the new prefix', async () => {
      await service.load(ID);
      await service.loadShot(`${ID}__620`);
      // The effect running with nothing changed keeps what was read.
      TestBed.tick();
      expect(service.has(ID)).toBe(true);

      scope.activeTeamId.set('b');
      TestBed.tick();
      expect(service.known().size).toBe(0);
      expect(service.knownShots().size).toBe(0);
      expect(service.has(ID)).toBe(false);
      await service.load(ID);
      expect(read).toHaveBeenLastCalledWith(`teams/b/replayRecordings/${ID}`, expect.any(Function));
    });

    it('empties on sign-out, so the next account starts with nothing of the last one', async () => {
      await service.load(ID);
      auth.userEmail.set(null);
      TestBed.tick();
      expect(service.known().size).toBe(0);
    });

    it("keeps a read that was in flight when the team changed off the new team's map", async () => {
      let answer!: (r: unknown) => void;
      read.mockImplementationOnce(() => new Promise<unknown>((resolve) => (answer = resolve)));
      const pending = service.load(ID);
      scope.activeTeamId.set('b');
      TestBed.tick();
      answer(recording);
      expect(await pending).toEqual(recording);
      expect(service.has(ID)).toBe(false);
    });
  });
});
