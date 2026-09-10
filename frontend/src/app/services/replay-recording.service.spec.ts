import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { ReplayRecording, ReplayShot } from '../models/team.models';
import { devRecordingKey, devShotKey, ReplayRecordingService, shotSrc } from './replay-recording.service';

/**
 * The reader for a recorded game. Firestore never runs in a spec: the one
 * private read is stubbed, and what these tests care about is how often it
 * is asked — a recording is read once a session, and a picture is read once
 * a document, because each is a few hundred kilobytes.
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

type Read = (collection: string, id: string, shape: (data: unknown) => unknown) => Promise<unknown>;
type Private = { read: Read; db(): unknown; isDev(): boolean };

describe('ReplayRecordingService', () => {
  let service: ReplayRecordingService;
  let read: Mock<Read>;

  beforeEach(() => {
    localStorage.clear();
    service = new ReplayRecordingService();
    read = vi.fn<Read>(async (collection, id) => (collection === 'replayRecordings' ? (id === ID ? recording : null) : id === `${ID}__620` ? shot : null));
    (service as unknown as Private).read = read;
  });

  afterEach(() => {
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
    expect(read.mock.calls[0][0]).toBe('replayRecordings');
    expect(read.mock.calls[0][1]).toBe(ID);
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
    expect(read.mock.calls[0][0]).toBe('replayShots');
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
      service = new ReplayRecordingService();
      (service as unknown as Private).read = read;
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
    const offline = new ReplayRecordingService();
    vi.spyOn(offline as unknown as Private, 'db').mockReturnValue(null);
    expect(await offline.load(ID)).toBeNull();
    expect(await offline.loadShot(`${ID}__620`)).toBeNull();
    expect(offline.has(ID)).toBe(false);
  });
});
