import { describe, expect, it } from 'vitest';
import { Tournament } from '../models/team.models';
import { endedLast, endedTournamentIds, hasLiveTournament, isActiveTournament, isEndedTournament, lastEndedTournament, todayStored } from './tournament-ended';

const t = (id: string, over: Partial<Tournament> = {}) => ({ id, name: id, kind: 'tournament', order: 0, ...over }) as unknown as Tournament;

describe('an ended tournament', () => {
  it('is ended only when a day is stored, and blank text is not a day', () => {
    expect(isEndedTournament({ endedAt: '2026-09-21' })).toBe(true);
    expect(isEndedTournament({ endedAt: '' })).toBe(false);
    expect(isEndedTournament({ endedAt: '   ' })).toBe(false);
    expect(isEndedTournament({})).toBe(false);
    expect(isEndedTournament(undefined)).toBe(false);
  });

  // The rule the whole feature rests on: enforced on read, so a document nobody wrote through the app obeys it too.
  it('is never the active one, even with the flag still set on the document', () => {
    expect(isActiveTournament({ active: true })).toBe(true);
    expect(isActiveTournament({ active: true, endedAt: '2026-09-21' })).toBe(false);
    expect(isActiveTournament({ active: false })).toBe(false);
    expect(isActiveTournament({})).toBe(false);
    expect(isActiveTournament(null)).toBe(false);
  });

  it('lists the ended ids for a reader holding series', () => {
    expect([...endedTournamentIds([t('live'), t('over', { endedAt: '2026-09-20' })])]).toEqual(['over']);
  });

  // What "ended and not replaced" means for Home's Season over rung: the scrims group never replaces anything.
  it('knows whether a real tournament is still running', () => {
    expect(hasLiveTournament([t('live')])).toBe(true);
    expect(hasLiveTournament([t('over', { endedAt: '2026-09-20' }), t('live')])).toBe(true);
    expect(hasLiveTournament([t('over', { endedAt: '2026-09-20' })])).toBe(false);
    expect(hasLiveTournament([t('over', { endedAt: '2026-09-20' }), t('scrims', { kind: 'scrims' })])).toBe(false);
    expect(hasLiveTournament([])).toBe(false);
  });

  it('sorts the live groups first and keeps the order inside each half', () => {
    const list = [t('over', { endedAt: '2026-09-20' }), t('live'), t('older', { endedAt: '2026-05-01' }), t('scrims', { kind: 'scrims' })];
    expect(endedLast(list).map((x) => x.id)).toEqual(['live', 'scrims', 'over', 'older']);
    // A copy: the caller's list is left as it was.
    expect(list.map((x) => x.id)).toEqual(['over', 'live', 'older', 'scrims']);
  });

  it('names the split that ended most recently, never the scrims group and never a live one', () => {
    const list = [t('spring', { endedAt: '2026-05-31' }), t('summer', { endedAt: '2026-09-20' }), t('live'), t('scrims', { kind: 'scrims', endedAt: '2026-09-21' })];
    expect(lastEndedTournament(list)?.id).toBe('summer');
    expect(lastEndedTournament([t('live')])).toBeNull();
    expect(lastEndedTournament([])).toBeNull();
    // Two on the same day: the one entered later, by stored order.
    const sameDay = [t('first', { endedAt: '2026-09-20', order: 0 }), t('second', { endedAt: '2026-09-20', order: 3 })];
    expect(lastEndedTournament(sameDay)?.id).toBe('second');
    // A day nobody can parse still ends the split; it just loses to one that can be dated.
    expect(lastEndedTournament([t('vague', { endedAt: 'last summer' }), t('dated', { endedAt: '2026-01-02' })])?.id).toBe('dated');
    expect(lastEndedTournament([t('vague', { endedAt: 'last summer' })])?.id).toBe('vague');
  });

  it("stores today in the reader's own day, not UTC", () => {
    // Half past midnight local on 21 Sep: `toISOString` would call this the 20th anywhere east of Greenwich.
    expect(todayStored(new Date(2026, 8, 21, 0, 30).getTime())).toBe('2026-09-21');
    expect(todayStored(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
  });
});
