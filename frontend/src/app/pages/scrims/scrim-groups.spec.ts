import { describe, expect, it } from 'vitest';
import { Scrim } from '../../models/team.models';
import { UNNAMED_OPPONENT, groupScrims, slugOpponent } from './scrim-groups';

const scrim = (id: string, opponent: string | undefined, playedOn: string): Scrim => ({
  id,
  opponent,
  playedOn,
  durationSec: 1800,
  blueWon: true,
  surrendered: false,
  players: [],
  order: 0
});

describe('slugOpponent', () => {
  it('folds case, spacing and punctuation into one key', () => {
    expect(slugOpponent('MOSS')).toBe('moss');
    expect(slugOpponent(' moss ')).toBe('moss');
    expect(slugOpponent('Elysion Esports')).toBe('elysion-esports');
    expect(slugOpponent('Elysion  Esports!')).toBe('elysion-esports');
  });

  it('never produces an empty key', () => {
    expect(slugOpponent('')).toBe('unnamed');
    expect(slugOpponent(undefined)).toBe('unnamed');
    expect(slugOpponent('   ')).toBe('unnamed');
    expect(slugOpponent('!!!')).toBe('unnamed');
  });

  it('is a safe document id: letters, digits and hyphens only', () => {
    expect(slugOpponent('Team #1 (EUW)')).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('groupScrims', () => {
  it('folds every spelling of a team into one group, keeping the first spelling', () => {
    const groups = groupScrims(
      [scrim('a', 'MOSS', '2026-08-31'), scrim('b', 'moss', '2026-09-01'), scrim('c', 'Moss ', '2026-09-02')],
      () => true
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('moss');
    expect(groups[0].name).toBe('MOSS');
    expect(groups[0].scrims).toHaveLength(3);
  });

  it('counts wins, losses and unknowns separately rather than guessing a side', () => {
    const results: Record<string, boolean | null> = { a: true, b: false, c: null };
    const groups = groupScrims(
      [scrim('a', 'SGC', '2026-08-30'), scrim('b', 'SGC', '2026-08-31'), scrim('c', 'SGC', '2026-09-01')],
      (s) => results[s.id]
    );
    expect(groups[0]).toMatchObject({ wins: 1, losses: 1, unknown: 1 });
  });

  it('orders groups by most recent scrim, and scrims within a group newest first', () => {
    const groups = groupScrims(
      [
        scrim('old', 'SGC', '2026-08-30'),
        scrim('mid', 'MOSS', '2026-08-31'),
        scrim('new', 'SGC', '2026-09-02'),
        scrim('newer', 'MOSS', '2026-09-03')
      ],
      () => true
    );
    expect(groups.map((g) => g.name)).toEqual(['MOSS', 'SGC']);
    expect(groups[1].scrims.map((s) => s.id)).toEqual(['new', 'old']);
    expect(groups[0].lastPlayed).toBe('2026-09-03');
  });

  it('files an unnamed scrim under a visible heading instead of dropping it', () => {
    const groups = groupScrims([scrim('a', undefined, '2026-09-01'), scrim('b', '', '2026-09-02')], () => null);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe(UNNAMED_OPPONENT);
    expect(groups[0].id).toBe('unnamed');
  });

  it('returns nothing for nothing', () => {
    expect(groupScrims([], () => true)).toEqual([]);
  });
});
