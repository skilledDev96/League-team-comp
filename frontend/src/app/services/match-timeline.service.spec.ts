import { isDevMode } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { MatchTimeline } from '../models/team.models';
import { DEV_TIMELINE_KEY, devTimelineKey, MatchTimelineService } from './match-timeline.service';

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

type Read = (matchId: string) => Promise<MatchTimeline | null>;
type Private = { read: Read; isDev(): boolean };

describe('MatchTimelineService, the dev override', () => {
  let service: MatchTimelineService;
  let read: Mock<Read>;

  beforeEach(() => {
    localStorage.clear();
    service = new MatchTimelineService();
    // Never Firestore in a spec: the read answers "absent", and the spec counts whether it was asked.
    read = vi.fn<Read>(async () => null);
    (service as unknown as Private).read = read;
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

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
      service = new MatchTimelineService();
      (service as unknown as Private).read = read;
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
    expect(read).toHaveBeenCalledWith(ID);
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
