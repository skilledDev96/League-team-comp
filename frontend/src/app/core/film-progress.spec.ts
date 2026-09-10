import { describe, expect, it } from 'vitest';
import { FilmCommitment, FilmPrefs, GameReview } from '../models/team.models';
import { advance, dueReminder, dueReminders, nextAskAt, reminderFor, tallyLine } from './film-progress';

const done = '2026-09-09T20:00:00.000Z';
const now = '2026-09-10T21:00:00.000Z';

describe('advance', () => {
  it('counts the ask and climbs from the later of the finish and now', () => {
    expect(advance({ done, nextAskAt: '2026-09-10T20:00:00.000Z', asked: 0 }, now)).toEqual({ asked: 1, nextAskAt: '2026-09-13T21:00:00.000Z' });
    expect(advance({ done, asked: 1 }, now)).toEqual({ asked: 2, nextAskAt: '2026-09-17T21:00:00.000Z' });
    expect(advance({ done }, now)).toEqual({ asked: 1, nextAskAt: '2026-09-13T21:00:00.000Z' });
    // A clock behind the finish (another device, a bad clock) counts from the finish.
    expect(advance({ done, asked: 0 }, '2026-09-09T10:00:00.000Z')).toEqual({ asked: 1, nextAskAt: '2026-09-12T20:00:00.000Z' });
  });

  it('never yields a date already past when the card is answered late', () => {
    const late = '2026-09-19T20:00:00.000Z';
    const next = advance({ done, nextAskAt: '2026-09-10T20:00:00.000Z', asked: 0 }, late);
    expect(next).toEqual({ asked: 1, nextAskAt: '2026-09-22T20:00:00.000Z' });
    expect(Date.parse(next.nextAskAt!)).toBeGreaterThan(Date.parse(late));
  });

  it('ends the ladder with an undefined time, which the save turns into a delete', () => {
    const last = advance({ done, asked: 2 }, now);
    expect(last.asked).toBe(3);
    expect(last.nextAskAt).toBeUndefined();
    expect('nextAskAt' in last).toBe(true);
  });

  it('counts from now when the film was never finished', () => {
    expect(advance({ nextAskAt: now, asked: 0 }, now)).toEqual({ asked: 1, nextAskAt: '2026-09-13T21:00:00.000Z' });
  });
});

describe('reminderFor', () => {
  const lessons = [
    { question: 'How many early deaths had no ward nearby?', options: ['One', 'Two', 'Three'], answer: 2, why: 'Three, minutes 4 to 9.' },
    { question: 'Whose dragon at 20?', options: ['Ours', 'Theirs', 'Nobody'], answer: 1, why: 'Their infernal, uncontested.' },
    { question: 'Who took first blood?', options: ['Us', 'Them', 'Nobody'], answer: 1, why: 'Theirs, bot at 4.' }
  ];
  const players = [
    {
      name: 'Rhu',
      seat: 'ADC',
      champion: 'Jinx',
      strength: { text: '' },
      workOn: { text: 'Died early, so hold the wave under tower.' },
      more: [{ text: 'Flashed forward into three at 14; keep Flash for the way out.', evidence: '', minute: 14, theme: 'fights' }]
    },
    { name: 'Go10x', seat: 'Jungle', champion: 'MonkeyKing', strength: { text: '' }, workOn: { text: '' } }
  ];
  const empty = { matchId: 'EUW1_1', team: { workOn: [], keepDoing: [] }, players: [] } as unknown as GameReview;
  const firstWorkOn = { text: 'Jinx died three times before ten; either play safer trades or ask for jungle pressure earlier.', evidence: '', minute: 9 };
  const secondWorkOn = { text: 'Nobody warded the river before the 20-minute dragon; either a control ward at 18 or the jungler paths there.', evidence: '', minute: 18 };
  /** A version 3 review: a work-on and nothing else the reminder reads. */
  const v3 = { ...empty, team: { ...empty.team, workOn: [firstWorkOn] } } as unknown as GameReview;
  /** A version 5 review: the headline, the one thing, two work-ons, the lessons, a note per player. */
  const v5 = { ...v3, players, team: { ...v3.team, workOn: [firstWorkOn, secondWorkOn], headline: 'Bled 35 kills while farming even', oneThing: 'Play safer trades or ask for jungle pressure earlier.', lessons } } as unknown as GameReview;
  const commitment: FilmCommitment = { matchId: 'EUW1_1', text: 'Either ward the river or ask for a gank.', options: ['Ward the river', 'Ask for a gank'], by: { a: 'b', b: 'b', c: 'a' } };

  it('reminds of the one thing, the commitment, your own ask and two further asks, and asks nothing', () => {
    const r = reminderFor(v5, { done, asked: 0 }, commitment, 42, 'ADC');
    expect(r).toEqual({
      headline: 'Bled 35 kills while farming even',
      oneThing: 'Play safer trades or ask for jungle pressure earlier.',
      commitment: 'Ask for a gank',
      ask: 'Hold the wave under tower.',
      more: ['Either a control ward at 18 or the jungler paths there.', 'Keep Flash for the way out.']
    });
    // The words of a question never reach the card, and nor do the lessons' answers (10 Sep 2026: a why explains an answer, so it read as a fragment).
    expect(JSON.stringify(r)).not.toMatch(/question|options|answer|minutes 4 to 9|infernal/);
    // It no longer turns with how often it has asked: the same reminder every time the ladder brings it back.
    expect(reminderFor(v5, { done, asked: 2 }, commitment, 42, 'ADC')).toEqual(r);
  });

  it('keeps the further asks to two, the team\'s before the viewer\'s own, never a line already on the card, and none when there is only one work-on', () => {
    // Without a seat the viewer's own further points are unknown, so only the team's second work-on is left.
    expect(reminderFor(v5, { done }, undefined, 42)!.more).toEqual(['Either a control ward at 18 or the jungler paths there.']);
    // A third work-on fills the second slot before the viewer's own point does.
    const third = { text: 'The mid laner roamed with no ward on the wave; ping before leaving lane.', evidence: '', minute: 12 };
    const three = { ...v5, team: { ...v5.team, workOn: [firstWorkOn, secondWorkOn, third] } } as unknown as GameReview;
    expect(reminderFor(three, { done }, undefined, 42, 'ADC')!.more).toEqual(['Either a control ward at 18 or the jungler paths there.', 'Ping before leaving lane.']);
    // A work-on whose ask is the one thing, or the viewer's own ask, is not said twice; a closing stop or a capital does not make it new.
    const echo = { text: 'Jinx kept dying; play safer trades or ask for jungle pressure earlier', evidence: '', minute: 9 };
    const echoOwn = { text: 'Rhu died early; hold the wave under tower.', evidence: '', minute: 5 };
    const echoed = { ...v5, team: { ...v5.team, workOn: [firstWorkOn, echo, echoOwn, secondWorkOn] } } as unknown as GameReview;
    expect(reminderFor(echoed, { done }, undefined, 42, 'ADC')!.more).toEqual(['Either a control ward at 18 or the jungler paths there.', 'Keep Flash for the way out.']);
    // Only the lessons and one work-on: nothing further, and the field is absent rather than empty.
    const one = { ...v5, team: { ...v5.team, workOn: [firstWorkOn] } } as unknown as GameReview;
    const r = reminderFor(one, { done }, undefined, 42)!;
    expect(r.more).toBeUndefined();
    expect('more' in r).toBe(false);
  });

  it('reads the commitment as the team\'s pick, ties to A, the sentence whole when the team took it whole, and nothing until somebody picked', () => {
    expect(reminderFor(v5, { done }, { ...commitment, by: { a: 'a', b: 'b' } }, 42)!.commitment).toBe('Ward the river');
    expect(reminderFor(v5, { done }, { ...commitment, by: { a: 'commit' } }, 42)!.commitment).toBe('Either ward the river or ask for a gank.');
    expect(reminderFor(v5, { done }, { ...commitment, options: undefined, by: { a: 'commit' } }, 42)!.commitment).toBe('Either ward the river or ask for a gank.');
    expect(reminderFor(v5, { done }, { ...commitment, by: {} }, 42)!.commitment).toBeUndefined();
    expect(reminderFor(v5, { done }, undefined, 42)!.commitment).toBeUndefined();
  });

  it('leaves out the ask without a seat, or for a seat the review has no note for', () => {
    expect(reminderFor(v5, { done }, undefined, 42)!.ask).toBeUndefined();
    expect(reminderFor(v5, { done }, undefined, 42, 'Jungle')!.ask).toBeUndefined();
    expect(reminderFor(v5, { done }, undefined, 42, 'Top')!.ask).toBeUndefined();
  });

  it('falls back to the first work-on as an ask for a version 3 review, with nothing else on the card', () => {
    expect(reminderFor(v3, { done }, undefined, 42, 'ADC')).toEqual({ headline: '', oneThing: 'Either play safer trades or ask for jungle pressure earlier.' });
  });

  it('is nothing without a one thing, a work-on or a commitment somebody picked on', () => {
    expect(reminderFor(empty, { done }, undefined, 42)).toBeNull();
    expect(reminderFor(empty, { done }, { ...commitment, by: {} }, 42)).toBeNull();
    // A commitment alone is a reminder; the one thing is then blank and the card shows the commitment line.
    expect(reminderFor(empty, { done }, commitment, 42)).toEqual({ headline: '', oneThing: '', commitment: 'Ask for a gank' });
  });
});

describe('nextAskAt', () => {
  it('climbs the ladder: a day, three days, seven days, then nothing', () => {
    expect(nextAskAt(done, 0)).toBe('2026-09-10T20:00:00.000Z');
    expect(nextAskAt(done, 1)).toBe('2026-09-12T20:00:00.000Z');
    expect(nextAskAt(done, 2)).toBe('2026-09-16T20:00:00.000Z');
    expect(nextAskAt(done, 3)).toBeUndefined();
    expect(nextAskAt(done, 9)).toBeUndefined();
  });

  it('gives nothing for a time it cannot read', () => {
    expect(nextAskAt('not a time', 0)).toBeUndefined();
  });
});

describe('dueReminder', () => {
  const prefs: FilmPrefs = {
    seat: 'Mid',
    films: {
      late: { done, nextAskAt: '2026-09-16T20:00:00.000Z', asked: 2 },
      early: { done, nextAskAt: '2026-09-10T20:00:00.000Z', asked: 0 },
      middle: { done, nextAskAt: '2026-09-12T20:00:00.000Z', asked: 1 },
      off: { done },
      broken: { done, nextAskAt: 'nope' }
    }
  };

  it('finds the earliest film that is due, and skips the ones switched off', () => {
    expect(dueReminder(prefs, '2026-09-13T08:00:00.000Z')?.matchId).toBe('early');
    expect(dueReminder(prefs, '2026-09-10T20:00:00.000Z')?.matchId).toBe('early');
    expect(dueReminder(prefs, '2026-09-10T19:59:59.000Z')).toBeUndefined();
    const only = { films: { late: prefs.films!['late'], off: prefs.films!['off'] } };
    expect(dueReminder(only, '2026-09-20T00:00:00.000Z')).toEqual({ matchId: 'late', progress: prefs.films!['late'] });
  });

  it('is nothing without prefs or without a readable now', () => {
    expect(dueReminder(undefined, done)).toBeUndefined();
    expect(dueReminder({}, done)).toBeUndefined();
    expect(dueReminder(prefs, 'later')).toBeUndefined();
  });

  it('lists every due film earliest first, so a film with nothing to ask never blocks the next', () => {
    expect(dueReminders(prefs, '2026-09-13T08:00:00.000Z').map((d) => d.matchId)).toEqual(['early', 'middle']);
    expect(dueReminders(prefs, '2026-09-20T00:00:00.000Z').map((d) => d.matchId)).toEqual(['early', 'middle', 'late']);
    expect(dueReminders(prefs, '2026-09-10T00:00:00.000Z')).toEqual([]);
    expect(dueReminders(undefined, done)).toEqual([]);
  });
});

describe('tallyLine', () => {
  it('reads Watched once the card was reached, whatever an old document still carries', () => {
    expect(tallyLine({ done }, 4)).toBe('Watched');
    expect(tallyLine({ done, tally: { called: 4, of: 5 } }, 4)).toBe('Watched');
  });

  it('reads Continue with the chapter part way through, and nothing when nothing started', () => {
    expect(tallyLine({ calls: { title: 1 } }, 4, 2)).toBe('Continue · 3 of 4');
    expect(tallyLine({ calls: { title: 1 } }, 4, 12)).toBe('Continue · 4 of 4');
    expect(tallyLine({ calls: { title: 1 } }, 4)).toBe('Continue');
    expect(tallyLine({}, 4)).toBe('');
    expect(tallyLine(undefined, 4)).toBe('');
  });
});
