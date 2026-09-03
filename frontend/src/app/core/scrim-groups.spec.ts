import { describe, expect, it } from 'vitest';
import { Scrim } from '../models/team.models';
import { UNNAMED_OPPONENT, groupScrims, scrimOpponentId } from './scrim-groups';

const scrim = (id: string, opponent: string | undefined, playedOn: string, ourSide?: 'blue' | 'red', blueWon = true): Scrim => ({
  id,
  opponent,
  playedOn,
  durationSec: 1500,
  blueWon,
  ourSide,
  players: [],
  order: 0
});

const wonOf = (s: Scrim): boolean | null => (s.ourSide ? (s.ourSide === 'blue') === s.blueWon : null);

describe('scrimOpponentId', () => {
  it('collapses spelling and spacing differences into one team', () => {
    expect(scrimOpponentId('MOSS')).toBe(scrimOpponentId('moss '));
    expect(scrimOpponentId('Elysion Esports')).toBe('elysion-esports');
  });

  it('is safe as a document key', () => {
    expect(scrimOpponentId('Team / With ? Symbols!')).toBe('team-with-symbols');
  });

  it('has a fixed id for the unnamed', () => {
    expect(scrimOpponentId(undefined)).toBe('unnamed');
    expect(scrimOpponentId('   ')).toBe('unnamed');
  });
});

describe('groupScrims', () => {
  it('groups by opponent, newest opponent first, newest game first inside', () => {
    const groups = groupScrims(
      [
        scrim('a', 'MOSS', '2026-08-31T20:00:00Z'),
        scrim('b', 'SGC', '2026-09-02T20:00:00Z'),
        scrim('c', 'MOSS', '2026-08-31T21:00:00Z')
      ],
      wonOf
    );
    expect(groups.map((g) => g.name)).toEqual(['SGC', 'MOSS']);
    expect(groups[1].games.map((g) => g.scrim.id)).toEqual(['c', 'a']);
  });

  it('splits an opponent into dated sessions, newest first', () => {
    const groups = groupScrims(
      [
        scrim('a', 'MOSS', '2026-08-24T20:00:00Z'),
        scrim('b', 'MOSS', '2026-08-31T20:00:00Z'),
        scrim('c', 'MOSS', '2026-08-31T21:30:00Z')
      ],
      wonOf
    );
    expect(groups[0].sessions.map((s) => s.day)).toEqual(['2026-08-31', '2026-08-24']);
    expect(groups[0].sessions[0].games).toHaveLength(2);
  });

  it('tallies wins and losses, and leaves an unknown side out of both', () => {
    const groups = groupScrims(
      [
        scrim('a', 'MOSS', '2026-08-31T20:00:00Z', 'blue', true), // win
        scrim('b', 'MOSS', '2026-08-31T21:00:00Z', 'red', true), // loss
        scrim('c', 'MOSS', '2026-08-31T22:00:00Z') // nobody said
      ],
      wonOf
    );
    expect(groups[0]).toMatchObject({ wins: 1, losses: 1 });
    expect(groups[0].games).toHaveLength(3);
  });

  it('shows the name from the newest scrim, so a corrected spelling wins', () => {
    const groups = groupScrims(
      [scrim('a', 'moss', '2026-08-24T20:00:00Z'), scrim('b', 'MOSS', '2026-08-31T20:00:00Z')],
      wonOf
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('MOSS');
  });

  it('gathers unnamed scrims into one group rather than scattering them', () => {
    const groups = groupScrims(
      [scrim('a', undefined, '2026-08-31T20:00:00Z'), scrim('b', '', '2026-08-31T21:00:00Z')],
      wonOf
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe(UNNAMED_OPPONENT);
    expect(groups[0].id).toBe('unnamed');
  });

  it('is empty for no scrims', () => {
    expect(groupScrims([], wonOf)).toEqual([]);
  });
});
