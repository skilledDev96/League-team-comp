import { describe, expect, it } from 'vitest';
import { FilmCommitment, FilmPrefs, GameReview } from '../models/team.models';
import { lessonCalls } from './film-build';
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
    { question: 'Whose dragon at 20?', options: ['Ours', 'Theirs', 'Nobody'], answer: 1, why: 'Their infernal, uncontested.' }
  ];
  const base = { matchId: 'EUW1_1', team: { workOn: [], keepDoing: [] } } as unknown as GameReview;
  const withLessons = { ...base, team: { ...base.team, lessons } } as unknown as GameReview;
  const commitment: FilmCommitment = { matchId: 'EUW1_1', text: 'Either ward the river or ask for a gank.', options: ['Ward the river', 'Ask for a gank'], by: { a: 'b', b: 'b', c: 'a' } };

  it('asks the lessons in turn, built the way the film builds them', () => {
    const calls = lessonCalls(lessons, 42);
    expect(reminderFor(withLessons, { done, asked: 0 }, commitment, 42)).toEqual(calls[0]);
    expect(reminderFor(withLessons, { done, asked: 1 }, commitment, 42)).toEqual(calls[1]);
    expect(reminderFor(withLessons, { done, asked: 2 }, commitment, 42)).toEqual(calls[0]);
    expect(reminderFor(withLessons, { done }, undefined, 42)).toEqual(calls[0]);
  });

  it('falls back to the commitment as a two-way call with the team\'s pick as the answer', () => {
    const call = reminderFor(base, { done, asked: 0 }, commitment, 42)!;
    expect(call).toEqual({ key: 'commit', question: 'Last game we committed to one of these. Which was it?', options: ['Ward the river', 'Ask for a gank'], answer: 1, why: 'Either ward the river or ask for a gank.' });
    expect(reminderFor(base, { done }, { ...commitment, by: { a: 'a', b: 'b' } }, 42)!.answer).toBe(0);
  });

  it('asks nothing without lessons and without a two-way commitment the team picked on', () => {
    expect(reminderFor(base, { done }, undefined, 42)).toBeNull();
    expect(reminderFor(base, { done }, { ...commitment, options: undefined }, 42)).toBeNull();
    expect(reminderFor(base, { done }, { ...commitment, by: {} }, 42)).toBeNull();
    expect(reminderFor(base, { done }, { ...commitment, by: { a: 'commit' } }, 42)).toBeNull();
    expect(reminderFor({ ...withLessons, team: { ...withLessons.team, lessons: [] } } as GameReview, { done }, undefined, 42)).toBeNull();
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
