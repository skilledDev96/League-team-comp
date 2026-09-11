import { describe, expect, it } from 'vitest';
import {
  ReplayDeathPlayer,
  ReplayDeathState,
  ReplayEvent,
  ReplayRecording,
  ReplaySample,
  ReplaySampleRow,
  ReplaySeat,
  ReplayShot,
  ReplayShotRef,
  Role
} from '../models/team.models';
import { deathLine, deathLines, FIGHT_WINDOW_SEC, fightLines, MAX_DEATH_LINES, MAX_FIGHT_LINES, MAX_RECORDING_LINES, RECORDING_HEAD, recordingLines, recordingSeatLines, recordingStory } from './replay-lines';

/**
 * The mirror check. This is the same fixture and the same expected sentences
 * as `api/src/replay-recording.spec.ts`: the drawer and the review's prompt
 * must read the same game off the same document, so if one of the two copies
 * drifts, one of the two suites goes red. The death boards below are the same
 * check on `deathLines`, whose two copies are likewise one function written
 * twice.
 */

const SEATS: Role[] = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
const NAMES = ['Ruan', 'Jay', 'Dan', 'Kobus', 'Pieter'];
const OURS = ['Ornn', 'LeeSin', 'Ahri', 'Jinx', 'Leona'];
const THEIRS = ['Darius', 'Vi', 'Syndra', 'Caitlyn', 'Thresh'];

const seats: ReplaySeat[] = [
  ...SEATS.map((seat, i) => ({ seat, champion: OURS[i], ours: true, name: NAMES[i] })),
  ...SEATS.map((seat, i) => ({ seat, champion: THEIRS[i], ours: false }))
];

function row(seat: Role, over: Partial<ReplaySampleRow> = {}): ReplaySampleRow {
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
  it('opens by saying where the game came from, what the minutes lack, and what the frames carry instead', () => {
    const [provenance, limit, frames] = recordingLines(recording());
    expect([provenance, limit, frames]).toEqual([...RECORDING_HEAD]);
    expect(provenance).toContain('recorded from the replay');
    expect(provenance).toMatch(/no match and no timeline/);
    expect(limit).toMatch(/no team gold/);
    expect(limit).toMatch(/spectated player alone/);
    // The half that was missing until 11 Sep 2026: the minutes have no team gold, but every frame's
    // top bar does, and saying only the first half told the model to ignore it.
    expect(frames).toMatch(/top bar shows each team’s gold/);
    expect(frames).toMatch(/neutral timers/);
    expect(frames).toMatch(/not legible/);
  });

  it('names our five with their names and theirs as a champion in a seat', () => {
    const lines = recordingLines(recording());
    const ours = lines.find((l) => l.startsWith('OUR FIVE'));
    const theirs = lines.find((l) => l.startsWith('THEIR FIVE'));
    expect(ours).toBe('OUR FIVE: Top Ruan on Ornn, Jungle Jay on LeeSin, Mid Dan on Ahri, ADC Kobus on Jinx, Support Pieter on Leona.');
    expect(theirs).toBe('THEIR FIVE, a champion in a seat: Top Darius, Jungle Vi, Mid Syndra, ADC Caitlyn, Support Thresh.');
    for (const name of NAMES) expect(theirs).not.toContain(name);
    expect(recordingSeatLines(recording())).toEqual([ours, theirs]);
  });

  it('prints an event at the minute the replay clock showed, in the recorder’s own words', () => {
    const lines = recordingLines(recording());
    expect(lines).toContain('Minute 14: their dragon (infernal).');
    expect(lines).toContain('Minute 18: Ruan (Top) died to a gank.');
  });

  it('says who a thing went to when the recorder’s words do not, and leaves a kill and the end alone', () => {
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
    const rec = recording({
      samples: [sampleAt(5), sampleAt(10)],
      events: [event(660, { kind: 'objective', side: 'us', text: 'our herald' }), event(120, { kind: 'first', side: 'them', text: 'first blood to them' })]
    });
    const expected = [
      'Minute 2: first blood to them.',
      'At five minutes: our five had 412 CS to their 448, levels 11-12 against 12-13, kills 6-11.',
      'At ten minutes: our five had 412 CS to their 448, levels 11-12 against 12-13, kills 6-11.',
      'Minute 11: our herald.'
    ];
    expect(recordingLines(rec).filter((l) => /^Minute |^At /.test(l))).toEqual(expected);
    // The drawer shows exactly the same game, without the prompt's preamble.
    expect(recordingStory(rec)).toEqual(expected);
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

  it('still says where the game came from when the recorder sent nothing else, and the drawer then has nothing to show', () => {
    const bare = { ...recording(), seats: [], samples: [], events: [] };
    expect(recordingLines(bare)).toHaveLength(3);
    expect(recordingLines(bare)[0]).toContain('recorded from the replay');
    expect(recordingStory(bare)).toEqual([]);
  });

  it('has nothing to say about a game nobody recorded', () => {
    expect(recordingLines(null)).toEqual([]);
    expect(recordingLines(undefined)).toEqual([]);
    expect(recordingStory(null)).toEqual([]);
    expect(recordingSeatLines(null)).toEqual([]);
  });
});

describe('deathLines', () => {
  const ITEMS = ['Sunfire Aegis', 'Plated Steelcaps', 'Stealth Ward'];

  function held(seat: Role, ours: boolean, over: Partial<ReplayDeathPlayer> = {}): ReplayDeathPlayer {
    return { seat, ours, level: 11, cs: 132, items: [...ITEMS], ...over };
  }

  /** All ten on their feet, so a test only has to say who was not. */
  function ten(over: (seat: Role, ours: boolean) => Partial<ReplayDeathPlayer> = () => ({})): ReplayDeathPlayer[] {
    return [...SEATS.map((seat) => held(seat, true, over(seat, true))), ...SEATS.map((seat) => held(seat, false, over(seat, false)))];
  }

  function board(sec: number, seat: Role, players = ten()): ReplayDeathState {
    return { sec, seat, players };
  }

  it('has nothing to say about a recording from before the recorder kept the boards', () => {
    // A document written by version 1 must read exactly as it did: no death
    // lines of its own, and the minute-by-minute lines untouched by the new key.
    expect(deathLines(recording())).toEqual([]);
    expect(recordingLines(recording({ deaths: [board(1105, 'Top')] }))).toEqual(recordingLines(recording()));
  });

  it('names what the player who fell was holding, and their level and farm', () => {
    expect(deathLines(recording({ deaths: [board(1105, 'Top')] }))).toEqual([
      'Minute 18: our Top fell, holding Sunfire Aegis, Plated Steelcaps, Stealth Ward; level 11, 132 cs.'
    ]);
  });

  it('says so plainly when the player who fell had bought nothing yet', () => {
    const empty = board(180, 'Mid', ten((seat, ours) => (ours && seat === 'Mid' ? { items: [], level: 4, cs: 21 } : {})));
    expect(deathLines(recording({ deaths: [empty] }))).toEqual(['Minute 3: our Mid fell, holding nothing; level 4, 21 cs.']);
  });

  it('lists who was already on the floor with the seconds left on them, as a seat on a side and never a name', () => {
    const players = ten((seat, ours) => (ours && seat === 'Jungle' ? { dead: true, respawn: 21.4 } : !ours && seat === 'Mid' ? { dead: true } : {}));
    const [line] = deathLines(recording({ deaths: [board(1105, 'Top', players)] }));
    expect(line).toContain('already down: our Jungle (21s left), their Mid');
    // Riot's rule holds here as everywhere: a death board carries a seat and a
    // side and nothing else, so no name of ours and no Riot id of theirs can
    // reach a line even when the board is read out in full.
    for (const name of NAMES) expect(line).not.toContain(name);
    expect(line).not.toMatch(/#|puuid/i);
    for (const row of players.filter((p) => !p.ours)) expect(Object.keys(row).some((key) => /name|riot|puuid|summoner/i.test(key))).toBe(false);
  });

  it('reads a player with no `dead` key as alive, which is how the recorder writes it', () => {
    expect(deathLines(recording({ deaths: [board(1105, 'Top')] }))[0]).not.toContain('already down');
    const standing = board(1105, 'Top', ten(() => ({ dead: false })));
    expect(deathLines(recording({ deaths: [standing] }))[0]).not.toContain('already down');
  });

  it('prints at most twenty boards, the earliest of them: the rest are stored and simply not read', () => {
    const many = Array.from({ length: 30 }, (_, i) => board(300 + i * 60, 'Top'));
    const lines = deathLines(recording({ deaths: many }));
    expect(lines).toHaveLength(MAX_DEATH_LINES);
    expect(lines[0]).toContain('Minute 5:');
    expect(lines[lines.length - 1]).toContain('Minute 24:');
  });

  it('puts the deaths in time order however they were stored', () => {
    const deaths = [board(1400, 'ADC'), board(300, 'Support'), board(844, 'Jungle')];
    expect(deathLines(recording({ deaths })).map((l) => l.slice(0, l.indexOf(' fell')))).toEqual([
      'Minute 5: our Support',
      'Minute 14: our Jungle',
      'Minute 23: our ADC'
    ]);
  });

  it('is the deaths it keeps, in order, each one mapped through `deathLine`', () => {
    // The film's strip asks `deathLine` for the sentence of the death it is holding, because it
    // walks the moments the recorder kept pictures of and not this list. If `deathLines` wrote its
    // own sentence instead of mapping, one filter's difference would put every sentence of the strip
    // on the wrong death — so the two are one function, asserted here as the same words.
    const deaths = [board(1400, 'ADC'), board(300, 'Support'), board(844, 'Jungle'), board(1105, 'Top')];
    const kept = [...deaths].sort((a, b) => a.sec - b.sec).slice(0, 3);
    expect(deathLines(recording({ deaths }), 3)).toEqual(kept.map(deathLine));
    expect(deathLines(recording({ deaths }))).toEqual([...deaths].sort((a, b) => a.sec - b.sec).map(deathLine));
    expect(deathLine(board(1400, 'ADC'))).toBe('Minute 23: our ADC fell, holding Sunfire Aegis, Plated Steelcaps, Stealth Ward; level 11, 132 cs.');
  });
});

/**
 * The strip's stored shape, which this side reads rather than builds: `shotsFor` lives in
 * `api/src/replay-recording.ts` alone — the review is the only caller that picks frames, and the app
 * shows the refs the recorder wrote — so what the mirror can hold here is the shape those refs come
 * in, and Riot's rule over the ids themselves.
 */
describe('the strip a recorder keeps of a moment', () => {
  it('hangs the run-up off the ref as document ids, and the frame offset off the picture', () => {
    const ref: ReplayShotRef = {
      sec: 1105,
      kind: 'death',
      label: 'Jinx falls at 18:25',
      seat: 'ADC',
      docId: 'EUW1-7977592156__1105',
      runUp: ['EUW1-7977592156__1105__2', 'EUW1-7977592156__1105__1']
    };
    const runUpFrame: ReplayShot = {
      matchId: 'EUW1-7977592156',
      sec: 1105,
      frame: 2,
      kind: 'death',
      label: ref.label,
      mediaType: 'image/jpeg',
      bytes: 210_000,
      data: 'BASE64'
    };
    // Earliest first, the moment last, and `docId` still means the picture OF the moment — which is
    // what lets a recording written by a newer recorder read the same wherever it is opened.
    expect([...(ref.runUp ?? []), ref.docId]).toEqual(['EUW1-7977592156__1105__2', 'EUW1-7977592156__1105__1', 'EUW1-7977592156__1105']);
    expect(runUpFrame.frame).toBe(2);
    // Absent or 0 is the moment itself, which keeps the id the moment has always had.
    const moment: ReplayShot = { ...runUpFrame, frame: undefined };
    expect(moment.frame ?? 0).toBe(0);
    // A run-up id is the match, the second and how many seconds before it — there is no room in one
    // for a name or a Riot id of theirs, here as everywhere.
    for (const id of ref.runUp ?? []) expect(id).toMatch(/^EUW1-7977592156__1105__[12]$/);
  });
});

describe('fightLines', () => {
  /** All ten on their feet at 130 farm and level 11, so a test only has to say who was not. */
  function standing(seat: (typeof SEATS)[number], ours: boolean, over: Partial<ReplayDeathPlayer> = {}): ReplayDeathPlayer {
    return { seat, ours, level: 11, cs: 130, items: ['Sunfire Aegis'], ...over };
  }

  function ten(over: (seat: (typeof SEATS)[number], ours: boolean) => Partial<ReplayDeathPlayer> = () => ({})): ReplayDeathPlayer[] {
    return [...SEATS.map((seat) => standing(seat, true, over(seat, true))), ...SEATS.map((seat) => standing(seat, false, over(seat, false)))];
  }

  function board(sec: number, seat: (typeof SEATS)[number], players = ten()): ReplayDeathState {
    return { sec, seat, players };
  }

  /** A death of ours: the client files a kill under the killer's side, so ours is a kill of theirs. */
  function fell(sec: number, seat: (typeof SEATS)[number]): ReplayEvent {
    return event(sec, { side: 'them', victimSeat: seat, text: 'someone kills someone' });
  }

  /** One of theirs going down. */
  function killed(sec: number, seat: (typeof SEATS)[number]): ReplayEvent {
    return event(sec, { side: 'us', victimSeat: seat, text: 'someone kills someone' });
  }

  it('has nothing to say about a game with no deaths of ours', () => {
    expect(fightLines(recording({ events: [] }))).toEqual([]);
    expect(fightLines(recording({ events: [killed(600, 'Mid'), event(844, { kind: 'objective', text: 'their dragon' })] }))).toEqual([]);
  });

  it('gives a death that stood alone its own line, and says whether anything came back', () => {
    expect(fightLines(recording({ events: [fell(1105, 'Top')] }))).toEqual(['18:25 — Ornn fell, and killed nobody in return.']);
    expect(fightLines(recording({ events: [fell(1105, 'Top'), killed(1100, 'Mid')] }))).toEqual(['18:25 — Ornn fell, one of theirs with them.']);
  });

  it('chains deaths of ours within the window into one fight and starts a new one past it', () => {
    const events = [fell(600, 'Top'), fell(600 + FIGHT_WINDOW_SEC, 'ADC'), fell(600 + FIGHT_WINDOW_SEC + 31, 'Mid')];
    const lines = fightLines(recording({ events }));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('10:00 — two of ours fell inside 30 seconds: Ornn, then Jinx, and killed nobody in return.');
    expect(lines[1]).toBe('11:01 — Ahri fell, and killed nobody in return.');
  });

  it('reads the hole we were in across the whole fight, not off the board it opened on', () => {
    // The state a fight opens in is five on five and says nothing. The 4v5 a coach is looking for
    // shows a few seconds later, once one of ours is down and the rest fight on anyway — which is
    // the whole point of the line, and reading only the first board missed every one of them.
    const deaths = [
      board(600, 'Top'),
      board(620, 'ADC', ten((seat, ours) => (ours && seat === 'Top' ? { dead: true, respawn: 14.4 } : {}))),
      board(640, 'Mid', ten((seat, ours) => (ours && (seat === 'Top' || seat === 'ADC') ? { dead: true, respawn: 22 } : !ours && seat === 'Jungle' ? { dead: true, respawn: 9 } : {})))
    ];
    const [line] = fightLines(recording({ events: [fell(600, 'Top'), fell(620, 'ADC'), fell(640, 'Mid')], deaths }));
    // Two readings, each with its own clock: the fight opened even and the hole is its own casualties.
    expect(line).toContain('we opened it five up');
    expect(line).toContain('by 10:40 we were two down: Ornn (22s left), Jinx (22s left)');
    expect(line).toContain('by 10:40 they were one down: their Jungle (9s left)');
  });

  it('never counts the player who is falling as one of the already down', () => {
    // The board is read two seconds before the death it belongs to, so a client that has the victim
    // on the floor early would otherwise open the sentence by giving the fight's own death as the
    // reason for it.
    const deaths = [board(600, 'Top', ten((seat, ours) => (ours && seat === 'Top' ? { dead: true, respawn: 30 } : {})))];
    const [line] = fightLines(recording({ events: [fell(600, 'Top')], deaths }));
    expect(line).not.toContain('we were');
    expect(line).toBe('10:00 — Ornn fell, and killed nobody in return; we opened it five up; Ornn was level 11 on 130 cs against their Top’s 11 and 130.');
  });

  it('counts a kill of theirs into one fight at most, however the two sit', () => {
    // The edge is half the window and fights are split by a gap longer than the window, so two
    // fights' edges can never reach the same second.
    const events = [fell(600, 'Top'), killed(612, 'Mid'), fell(640, 'ADC')];
    const lines = fightLines(recording({ events }));
    expect(lines).toEqual(['10:00 — Ornn fell, one of theirs with them.', '10:40 — Jinx fell, and killed nobody in return.']);
  });

  it('falls back to the seat when the recording carries no champion for it', () => {
    const bare = recording({ events: [fell(600, 'Top')] });
    const [line] = fightLines({ ...bare, seats: [] });
    expect(line).toBe('10:00 — our Top fell, and killed nobody in return.');
  });

  it('works on a recording made before the boards existed, and says only what it can', () => {
    const lines = fightLines(recording({ events: [fell(600, 'Top'), fell(610, 'ADC')], deaths: undefined }));
    expect(lines).toEqual(['10:00 — two of ours fell inside 10 seconds: Ornn, then Jinx, and killed nobody in return.']);
  });

  it('puts the whole of a fight into one sentence, levels and farm and all', () => {
    const deaths = [
      board(1447, 'Support', ten((seat, ours) => (ours && seat === 'Support' ? { level: 9, cs: 20 } : !ours && seat === 'Support' ? { level: 11, cs: 20 } : {}))),
      board(1451, 'Top', ten((seat, ours) => (ours && seat === 'Support' ? { dead: true, respawn: 30 } : {})))
    ];
    const events = [fell(1447, 'Support'), fell(1451, 'Top'), killed(1449, 'Mid'), killed(1450, 'ADC')];
    expect(fightLines(recording({ events, deaths }))).toEqual([
      '24:07 — two of ours fell inside 4 seconds: Leona, then Ornn, two of theirs with them; we opened it five up; by 24:11 we were one down: Leona (30s left); Leona was level 9 on 20 cs against their Support’s 11 and 20.'
    ]);
  });

  it('keeps the fights that cost most when there are more than the cap, and puts them back in time order', () => {
    const singles = Array.from({ length: MAX_FIGHT_LINES + 4 }, (_, i) => fell(300 + i * 60, 'Mid'));
    // One wipe late in the game, which must survive the cap however many solo deaths came first.
    const wipe = [fell(2000, 'Top'), fell(2004, 'ADC'), fell(2008, 'Jungle')];
    const lines = fightLines(recording({ events: [...singles, ...wipe] }));
    expect(lines).toHaveLength(MAX_FIGHT_LINES);
    expect(lines[lines.length - 1]).toContain('three of ours fell');
    const seconds = lines.map((l) => l.slice(0, l.indexOf(' —')));
    expect(seconds).toEqual([...seconds].sort((a, b) => Number(a.split(':')[0]) - Number(b.split(':')[0]) || Number(a.split(':')[1]) - Number(b.split(':')[1])));
  });

  /**
    * OURS BY CHAMPION, THEIRS BY SEAT (12 Sep 2026). The Riot rule is about THEIR side, and this
    * used to assert no champion name at all — true of the old sentence, stricter than the rule, and
    * the reason the block fed the model "our Jungle, ADC and Support". What may never appear is a
    * person: no Riot id, no puuid, no player name on either side, and no champion of theirs here,
    * since they stay seats. Ours are named the way the whole app names them.
    */
  it('names ours by champion and leaves theirs a seat, and never a person', () => {
    const deaths = [board(600, 'Top', ten((seat, ours) => (ours && seat === 'Mid' ? { dead: true, respawn: 12 } : !ours && seat === 'ADC' ? { dead: true } : {})))];
    const [line] = fightLines(recording({ events: [fell(600, 'Top'), killed(598, 'Jungle')], deaths }));
    // Nobody's name, ever, on either side.
    for (const name of NAMES) expect(line).not.toContain(name);
    expect(line).not.toMatch(/#|puuid/i);
    // Theirs stay seats: not one of their champions is named.
    for (const champion of THEIRS) expect(line).not.toContain(champion);
    expect(line).toContain('their ADC');
    // Ours are named, and no bare "our <seat>" is left behind.
    expect(line).toContain('Ornn');
    expect(line).toContain('Ahri (12s left)');
    expect(line).not.toMatch(/our (Top|Jungle|Mid|ADC|Support)/);
  });
});
