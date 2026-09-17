import { describe, expect, it } from 'vitest';
import { Scrim, SeriesGame, Tournament, TournamentSeries } from '../models/team.models';
import { localDayOf, recordCommand, recordingQueue, RecordingQueueInput } from './recording-queue';

// The shape of 17 Sep 2026: twenty-one customs imported, one recorded, eighteen saved on 16.17, and
// Paradox Requiem games 1 and 2 on 16.18 in the tournament. Played at midday UTC, so the local day
// is the same one in any timezone a spec runs in.

const OLD = '16.17.810.4348';
const NEW = '16.18.815.9717';

const scrim = (id: string, over: Partial<Scrim> = {}): Scrim => ({
  id,
  playedOn: '2026-09-01T12:00:00.000Z',
  durationSec: 1800,
  blueWon: true,
  players: [],
  order: 0,
  gameVersion: OLD,
  ...over
});

const TOURNAMENTS: Tournament[] = [
  { id: 't-oryx', name: 'Oryx Fearless League', kind: 'tournament', order: 0 },
  { id: 't-scrims', name: 'Scrims', kind: 'scrims', fearless: false, order: 1 }
];

const SERIES: TournamentSeries[] = [
  { id: 's-paradox', tournamentId: 't-oryx', opponent: 'Paradox Requiem', bestOf: 3, order: 0 },
  { id: 's-moss', tournamentId: 't-scrims', opponent: 'MOSS 2', bestOf: 0, order: 1 }
];

const GAMES: SeriesGame[] = [
  { id: 'g-p1', seriesId: 's-paradox', gameNumber: 1, matchId: 'EUW1-7979450974', ourChampions: [], theirChampions: [], order: 0 },
  { id: 'g-p2', seriesId: 's-paradox', gameNumber: 2, matchId: 'EUW1-7979537790', ourChampions: [], theirChampions: [], order: 1 },
  { id: 'g-m1', seriesId: 's-moss', gameNumber: 1, matchId: 'EUW1-7977592156', ourChampions: [], theirChampions: [], order: 2 }
];

const oldScrims = Array.from({ length: 18 }, (_, i) =>
  scrim(`EUW1-79700000${String(i).padStart(2, '0')}`, { playedOn: `2026-09-${String(i + 1).padStart(2, '0')}T12:00:00.000Z`, opponent: 'MOSS 2' })
);

const TODAY: RecordingQueueInput = {
  scrims: [
    ...oldScrims,
    scrim('EUW1-7977592156', { playedOn: '2026-09-08T12:00:00.000Z' }),
    scrim('EUW1-7979450974', { playedOn: '2026-09-10T12:00:00.000Z', gameVersion: NEW, durationSec: 2201 }),
    scrim('EUW1-7979537790', { playedOn: '2026-09-10T13:00:00.000Z', gameVersion: NEW })
  ],
  seriesGames: GAMES,
  series: SERIES,
  tournaments: TOURNAMENTS,
  recordedIds: ['EUW1-7977592156'],
  today: '2026-09-17'
};

describe('recordingQueue', () => {
  it('sorts the customs as they stand today: two to record, one recorded, eighteen past their patch', () => {
    const q = recordingQueue(TODAY);
    expect(q.recordable.map((r) => r.matchId)).toEqual(['EUW1-7979537790', 'EUW1-7979450974']);
    expect(q.recorded.map((r) => r.matchId)).toEqual(['EUW1-7977592156']);
    expect(q.closed).toHaveLength(18);
    expect(q.unknown).toEqual([]);
    expect(q.currentPatch).toBe('26.18');
  });

  it('estimates the close as the day before two weeks after the first game on the patch, and says it is an estimate', () => {
    // 26.18 landed on 9 Sep and its first custom came on the 10th: two weeks from the game is a day late, and the
    // day before is 23 Sep, when 26.19 lands. A deadline estimate errs early, never late (17 Sep 2026).
    const q = recordingQueue(TODAY);
    expect(q.closesOn).toBe('2026-09-23');
    expect(q.estimated).toBe(true);
    expect(q.lapsed).toBe(false);
  });

  it('has closed the current patch by the estimate on the day it gives', () => {
    const q = recordingQueue({ ...TODAY, today: '2026-09-23' });
    expect(q.lapsed).toBe(true);
    expect(q.recordable).toEqual([]);
  });

  it('takes the date set in Settings over the estimate', () => {
    const q = recordingQueue({ ...TODAY, nextPatchOn: '2026-09-23' });
    expect(q.closesOn).toBe('2026-09-23');
    expect(q.estimated).toBe(false);
  });

  it('ignores a date left in Settings from the last patch, which this patch’s own games were played after', () => {
    const q = recordingQueue({ ...TODAY, nextPatchOn: '2026-09-09' });
    expect(q.closesOn).toBe('2026-09-23');
    expect(q.estimated).toBe(true);
  });

  it('ignores a date set for a later patch, which would bring back replays the client can no longer play', () => {
    // 26.19 lands on 23 Sep and the admin moves Next patch on to 7 Oct that day, before any 26.19 custom is
    // imported: 26.18 is still the newest patch, and its games stay closed.
    const q = recordingQueue({ ...TODAY, nextPatchOn: '2026-10-07', today: '2026-09-23' });
    expect(q.currentPatch).toBe('26.18');
    expect(q.closesOn).toBe('2026-09-23');
    expect(q.estimated).toBe(true);
    expect(q.lapsed).toBe(true);
    expect(q.recordable).toEqual([]);
    expect(q.closed).toHaveLength(20);
  });

  it('takes a set date up to three weeks after the patch’s first game, for a long patch, and none later', () => {
    expect(recordingQueue({ ...TODAY, nextPatchOn: '2026-10-01' })).toMatchObject({ closesOn: '2026-10-01', estimated: false });
    expect(recordingQueue({ ...TODAY, nextPatchOn: '2026-10-02' })).toMatchObject({ closesOn: '2026-09-23', estimated: true });
  });

  it('moves the current patch’s games to the closed ones once the day it closes has come', () => {
    const q = recordingQueue({ ...TODAY, nextPatchOn: '2026-09-23', today: '2026-09-23' });
    expect(q.lapsed).toBe(true);
    expect(q.recordable).toEqual([]);
    expect(q.closed).toHaveLength(20);
    // Recorded stays recorded whatever the patch did.
    expect(q.recorded).toHaveLength(1);
  });

  it('names each row by the series’ opponent and game, with its length, date and patch', () => {
    const [newest] = recordingQueue(TODAY).recordable;
    expect(newest).toEqual({
      matchId: 'EUW1-7979537790',
      opponent: 'Paradox Requiem',
      game: 'Game 2',
      durationSec: 1800,
      playedOn: '2026-09-10T13:00:00.000Z',
      patch: '26.18',
      tournament: true
    });
    const [recorded] = recordingQueue(TODAY).recorded;
    expect(recorded).toMatchObject({ opponent: 'MOSS 2', game: 'Game 1', tournament: false });
  });

  it('falls back to the name a replay was filed under when no series game carries it', () => {
    const q = recordingQueue({ ...TODAY, scrims: [scrim('EUW1-1', { opponent: ' Nameless Five ' })], recordedIds: [], today: '2026-09-02' });
    expect(q.recordable).toHaveLength(1);
    expect(q.recordable[0]).toMatchObject({ opponent: 'Nameless Five', game: '', tournament: false, patch: '26.17' });
  });

  it('lists tournament games first and the newest next, whichever group is newer', () => {
    const scrimOnNew = scrim('EUW1-7984886534', { playedOn: '2026-09-15T12:00:00.000Z', gameVersion: NEW, opponent: 'MOSS 2' });
    const q = recordingQueue({ ...TODAY, scrims: [...TODAY.scrims, scrimOnNew] });
    expect(q.recordable.map((r) => r.matchId)).toEqual(['EUW1-7979537790', 'EUW1-7979450974', 'EUW1-7984886534']);
  });

  it('keeps a scrim with no build apart, and does not let it decide the patch', () => {
    const q = recordingQueue({ ...TODAY, scrims: [...TODAY.scrims, scrim('EUW1-2', { gameVersion: undefined })] });
    expect(q.unknown.map((r) => r.matchId)).toEqual(['EUW1-2']);
    expect(q.unknown[0].patch).toBe('');
    expect(q.recordable).toHaveLength(2);
  });

  it('compares patches as numbers, so 26.18 is newer than 26.9', () => {
    const q = recordingQueue({
      ...TODAY,
      scrims: [scrim('EUW1-3', { gameVersion: '16.9.700.1' }), scrim('EUW1-4', { gameVersion: '16.18.815.9717', playedOn: '2026-09-10T12:00:00.000Z' })],
      recordedIds: []
    });
    expect(q.currentPatch).toBe('26.18');
    expect(q.recordable.map((r) => r.matchId)).toEqual(['EUW1-4']);
    expect(q.closed.map((r) => r.matchId)).toEqual(['EUW1-3']);
  });

  it('has no patch and no closing date when no scrim carries a build', () => {
    const q = recordingQueue({ ...TODAY, scrims: [scrim('EUW1-5', { gameVersion: undefined })], nextPatchOn: '2026-09-23', recordedIds: [] });
    expect(q.currentPatch).toBe('');
    expect(q.closesOn).toBe('');
    expect(q.lapsed).toBe(false);
    expect(q.unknown).toHaveLength(1);
  });
});

describe('recordCommand and localDayOf', () => {
  it('copies the command the recorder runs with', () => {
    expect(recordCommand('EUW1-7979450974')).toBe('npm run record -- EUW1-7979450974');
  });

  it('writes a local day', () => {
    expect(localDayOf(new Date(2026, 8, 7, 23, 30).getTime())).toBe('2026-09-07');
  });
});
