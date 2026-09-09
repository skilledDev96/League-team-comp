import { describe, expect, it } from 'vitest';
import { FilmPrefs } from '../models/team.models';
import { dueReminder, nextAskAt, tallyLine } from './film-progress';

const done = '2026-09-09T20:00:00.000Z';

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
});

describe('tallyLine', () => {
  it('reads Watched with the tally once the card was reached', () => {
    expect(tallyLine({ done, tally: { called: 4, of: 5 } }, 5)).toBe('Watched · called 4 of 5');
    expect(tallyLine({ done }, 5)).toBe('Watched');
  });

  it('reads Continue with the chapter part way through, and nothing when nothing started', () => {
    expect(tallyLine({ calls: { title: 1 } }, 7, 2)).toBe('Continue · 3 of 7');
    expect(tallyLine({ calls: { title: 1 } }, 7, 12)).toBe('Continue · 7 of 7');
    expect(tallyLine({ calls: { title: 1 } }, 7)).toBe('Continue');
    expect(tallyLine({}, 7)).toBe('');
    expect(tallyLine(undefined, 7)).toBe('');
  });
});
