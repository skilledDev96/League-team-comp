import { describe, expect, it } from 'vitest';
import { ROSTER_VIEWS, rosterViewOf } from './roster-view';

describe('rosterViewOf', () => {
  it('reads the three views, and lands the old Table and Scouting links on Players', () => {
    expect(ROSTER_VIEWS).toEqual(['cards', 'players', 'report']);
    for (const view of ROSTER_VIEWS) expect(rosterViewOf(view)).toBe(view);
    expect(rosterViewOf('table')).toBe('players');
    expect(rosterViewOf('scouting')).toBe('players');
  });

  it('is nothing for a word that is not a view', () => {
    expect(rosterViewOf(null)).toBeNull();
    expect(rosterViewOf('')).toBeNull();
    expect(rosterViewOf('overview')).toBeNull();
  });
});
