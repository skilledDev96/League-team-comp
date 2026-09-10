import { describe, expect, it } from 'vitest';
import { LaneRole } from './lane-read';
import {
  MAX_RECORDING_LINES,
  MAX_REVIEW_SHOTS,
  recordingLines,
  ReplayEvent,
  ReplayRecording,
  ReplaySample,
  ReplaySampleRow,
  ReplaySeat,
  ReplayShotRef,
  shotsFor
} from './replay-recording';

const SEATS: LaneRole[] = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
const NAMES = ['Ruan', 'Jay', 'Dan', 'Kobus', 'Pieter'];
const OURS = ['Ornn', 'LeeSin', 'Ahri', 'Jinx', 'Leona'];
const THEIRS = ['Darius', 'Vi', 'Syndra', 'Caitlyn', 'Thresh'];

const seats: ReplaySeat[] = [
  ...SEATS.map((seat, i) => ({ seat, champion: OURS[i], ours: true, name: NAMES[i] })),
  ...SEATS.map((seat, i) => ({ seat, champion: THEIRS[i], ours: false }))
];

function row(seat: LaneRole, over: Partial<ReplaySampleRow> = {}): ReplaySampleRow {
  return { seat, cs: 80, level: 11, kills: 1, deaths: 1, assists: 2, ...over };
}

/** The twenty-minute checkpoint of the fixture game: 412 CS to 448, levels 11-12 against 12-13, kills 6-11. */
function sampleAt(minute: number): ReplaySample {
  const ourCs = [120, 60, 110, 122, 0];
  const theirCs = [130, 70, 118, 130, 0];
  return {
    minute,
    ours: SEATS.map((seat, i) => row(seat, { cs: ourCs[i], level: i < 2 ? 11 : i < 4 ? 12 : 11, kills: [2, 1, 2, 1, 0][i] })),
    theirs: SEATS.map((seat, i) => row(seat, { cs: theirCs[i], level: i === 0 ? 12 : i < 3 ? 13 : 12, kills: [3, 2, 3, 2, 1][i] }))
  };
}

function event(sec: number, over: Partial<ReplayEvent> = {}): ReplayEvent {
  return { sec, kind: 'kill', side: 'them', text: 'someone died', ...over };
}

function recording(over: Partial<ReplayRecording> = {}): ReplayRecording {
  return {
    matchId: 'EUW1-7977592156',
    recordedAt: '2026-09-10T19:04:00.000Z',
    recorderVersion: 1,
    durationSec: 1860,
    ourSide: 'blue',
    seats,
    samples: [sampleAt(20)],
    events: [
      event(844, { kind: 'objective', side: 'them', text: 'their dragon (infernal)', subType: 'infernal' }),
      event(1105, { kind: 'kill', side: 'them', text: 'Ruan (Top) died to a gank', victimSeat: 'Top' })
    ],
    shots: [],
    bytes: 24_000,
    ...over
  };
}

describe('recordingLines', () => {
  it('opens by saying the game was recorded because Riot has no data for it, and that there is no team gold', () => {
    const [provenance, limit] = recordingLines(recording());
    expect(provenance).toContain('recorded from the replay');
    expect(provenance).toMatch(/no match and no timeline/);
    expect(limit).toMatch(/no team gold/);
    expect(limit).toMatch(/spectated player alone/);
  });

  it('names our five with their names and theirs as a champion in a seat', () => {
    const lines = recordingLines(recording());
    const ours = lines.find((l) => l.startsWith('OUR FIVE'));
    const theirs = lines.find((l) => l.startsWith('THEIR FIVE'));
    expect(ours).toBe('OUR FIVE: Top Ruan on Ornn, Jungle Jay on LeeSin, Mid Dan on Ahri, ADC Kobus on Jinx, Support Pieter on Leona.');
    expect(theirs).toBe('THEIR FIVE, a champion in a seat: Top Darius, Jungle Vi, Mid Syndra, ADC Caitlyn, Support Thresh.');
    for (const name of NAMES) expect(theirs).not.toContain(name);
  });

  it('prints an event at the minute the replay clock showed, in the recorder’s own words', () => {
    const lines = recordingLines(recording());
    expect(lines).toContain('Minute 14: their dragon (infernal).');
    expect(lines).toContain('Minute 18: Ruan (Top) died to a gank.');
  });

  it('says who a thing went to when the recorder’s words do not, and leaves a kill and the end alone', () => {
    // The recorder writes a label and puts the side in a field ("Infernal
    // dragon", side 'them'), so the line has to say whose it was; "to them"
    // rather than "theirs", because a tower belongs to whoever lost it.
    const lines = recordingLines(
      recording({
        samples: [],
        events: [
          event(120, { kind: 'first', side: 'them', text: 'First blood' }),
          event(500, { kind: 'objective', side: 'them', text: 'Infernal dragon' }),
          event(700, { kind: 'tower', side: 'us', text: 'Tower down' }),
          event(900, { kind: 'kill', side: 'us', text: 'Ornn kills Darius' }),
          event(1855, { kind: 'end', side: 'them', text: 'They won' })
        ]
      })
    );
    expect(lines).toContain('Minute 2: First blood, to them.');
    expect(lines).toContain('Minute 8: Infernal dragon, to them.');
    expect(lines).toContain('Minute 11: Tower down, to us.');
    expect(lines).toContain('Minute 15: Ornn kills Darius.');
    expect(lines).toContain('Minute 30: They won.');
  });

  it('reads a checkpoint as CS, levels and the kill tally, and never a gold figure', () => {
    const lines = recordingLines(recording());
    expect(lines).toContain('At twenty minutes: our five had 412 CS to their 448, levels 11-12 against 12-13, kills 6-11.');
    expect(lines.join(' ')).not.toMatch(/gold lead|gold at|k gold/i);
  });

  it('adds the ward tally only when every one of the five carries one', () => {
    const both = sampleAt(15);
    both.ours = both.ours.map((r) => ({ ...r, wardScore: 8 }));
    both.theirs = both.theirs.map((r) => ({ ...r, wardScore: 11 }));
    expect(recordingLines(recording({ samples: [both] })).find((l) => l.startsWith('At fifteen'))).toContain('wards 40 to 55');

    const partial = sampleAt(15);
    partial.ours = partial.ours.map((r, i) => (i === 0 ? { ...r, wardScore: 8 } : r));
    expect(recordingLines(recording({ samples: [partial] })).find((l) => l.startsWith('At fifteen'))).not.toContain('wards ');
  });

  it('puts everything in time order, checkpoints among the events', () => {
    const lines = recordingLines(
      recording({
        samples: [sampleAt(5), sampleAt(10)],
        events: [event(660, { kind: 'objective', side: 'us', text: 'our herald' }), event(120, { kind: 'first', side: 'them', text: 'first blood to them' })]
      })
    );
    const body = lines.filter((l) => /^Minute |^At /.test(l));
    expect(body).toEqual([
      'Minute 2: first blood to them.',
      'At five minutes: our five had 412 CS to their 448, levels 11-12 against 12-13, kills 6-11.',
      'At ten minutes: our five had 412 CS to their 448, levels 11-12 against 12-13, kills 6-11.',
      'Minute 11: our herald.'
    ]);
  });

  it('keeps at most forty lines, and keeps the spine of the game over the kills and the towers', () => {
    const kills = Array.from({ length: 40 }, (_, i) => event(300 + i * 20, { kind: 'kill', side: i % 2 === 0 ? 'them' : 'us', text: `kill ${i}` }));
    const towers = Array.from({ length: 11 }, (_, i) => event(600 + i * 60, { kind: 'tower', side: 'them', text: `tower ${i}` }));
    const spine = [
      event(120, { kind: 'first', side: 'them', text: 'first blood to them' }),
      event(500, { kind: 'objective', side: 'them', text: 'their dragon (ocean)' }),
      event(1400, { kind: 'objective', side: 'them', text: 'their baron' }),
      event(1855, { kind: 'end', side: 'them', text: 'they won in 31 minutes' })
    ];
    const lines = recordingLines(recording({ events: [...kills, ...towers, ...spine] }));
    expect(lines).toHaveLength(MAX_RECORDING_LINES);
    for (const s of spine) expect(lines.some((l) => l.includes(s.text))).toBe(true);
    expect(lines.some((l) => l.includes('tower '))).toBe(false);
    // Our deaths outlast our kills: a review is about the deaths.
    const survived = (i: number) => lines.some((l) => l.endsWith(`kill ${i}.`));
    expect(kills.filter((_, i) => i % 2 === 0).every((_, j) => survived(j * 2))).toBe(true);
    expect(kills.filter((_, i) => i % 2 === 1).every((_, j) => survived(j * 2 + 1))).toBe(false);
    const minutes = lines.filter((l) => l.startsWith('Minute ')).map((l) => Number(l.slice(7, l.indexOf(':'))));
    expect([...minutes].sort((a, b) => a - b)).toEqual(minutes);
  });

  it('thins the checkpoints to five and keeps the last', () => {
    const samples = [5, 10, 15, 20, 25, 30, 35, 40].map((m) => sampleAt(m));
    const marks = recordingLines(recording({ samples, events: [] })).filter((l) => l.startsWith('At '));
    expect(marks.length).toBeLessThanOrEqual(5);
    expect(marks[marks.length - 1]).toContain('At forty minutes');
  });

  it('still says where the game came from when the recorder sent nothing else', () => {
    const bare = recordingLines({ ...recording(), seats: [], samples: [], events: [] });
    expect(bare).toHaveLength(2);
    expect(bare[0]).toContain('recorded from the replay');
  });
});

describe('shotsFor', () => {
  const shot = (sec: number, kind: ReplayShotRef['kind'], docId = `EUW1-7977592156__${sec}`): ReplayShotRef => ({ sec, kind, label: `${kind} at ${sec}`, docId });

  it('takes every death first in time order, then the objectives, then the end', () => {
    const shots = [shot(1855, 'end'), shot(900, 'objective'), shot(1105, 'death'), shot(400, 'objective'), shot(300, 'death')];
    expect(shotsFor(recording({ shots }), 8).map((s) => s.docId)).toEqual([
      'EUW1-7977592156__300',
      'EUW1-7977592156__1105',
      'EUW1-7977592156__400',
      'EUW1-7977592156__900',
      'EUW1-7977592156__1855'
    ]);
  });

  it('stops at max, which is eight for a review, and never gets there on the objectives when the deaths fill it', () => {
    const shots = [...Array.from({ length: 12 }, (_, i) => shot(100 + i * 60, 'death')), shot(1800, 'end')];
    const picked = shotsFor(recording({ shots }), MAX_REVIEW_SHOTS);
    expect(picked).toHaveLength(8);
    expect(picked.every((s) => s.kind === 'death')).toBe(true);
    expect(shotsFor(recording({ shots }), 0)).toEqual([]);
  });

  it('drops a shot with a document id it could not have written, and never sends one twice', () => {
    const shots = [shot(300, 'death', '../secrets/one'), shot(400, 'death', 'EUW1__400'), shot(400, 'objective', 'EUW1__400')];
    expect(shotsFor(recording({ shots }), 8).map((s) => s.docId)).toEqual(['EUW1__400']);
  });

  it('has nothing to send for a recording with no frames', () => {
    expect(shotsFor(recording())).toEqual([]);
  });
});
