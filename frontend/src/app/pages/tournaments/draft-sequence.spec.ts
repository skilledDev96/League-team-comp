import { describe, expect, it } from 'vitest';
import {
  BAN_TEAMS,
  banTeamAt,
  DRAFT_LENGTH,
  DRAFT_SEQUENCE,
  describeStep,
  draftProgress,
  isComplete,
  seatFor,
  stepAt
} from './draft-sequence';

/** Compact reading of the whole order, for asserting it in one go. */
const shape = DRAFT_SEQUENCE.map((s) => `${s.team[0]}${s.action[0]}`).join(' ');

describe('DRAFT_SEQUENCE', () => {
  it('is the competitive order: 3 bans each, 6 picks, 2 bans each, 4 picks', () => {
    expect(DRAFT_LENGTH).toBe(20);
    expect(shape).toBe(
      // bans 1        picks 1              bans 2        picks 2
      'bb rb bb rb bb rb ' + 'bp rp rp bp bp rp ' + 'rb bb rb bb ' + 'rp bp bp rp'
    );
  });

  it('gives each side ten actions — five bans and five picks', () => {
    for (const team of ['blue', 'red'] as const) {
      const mine = DRAFT_SEQUENCE.filter((s) => s.team === team);
      expect(mine.filter((s) => s.action === 'ban')).toHaveLength(5);
      expect(mine.filter((s) => s.action === 'pick')).toHaveLength(5);
    }
  });

  it('numbers each team\'s bans and picks from one, counting separately', () => {
    const bluePicks = DRAFT_SEQUENCE.filter((s) => s.team === 'blue' && s.action === 'pick');
    expect(bluePicks.map((s) => s.ordinal)).toEqual([1, 2, 3, 4, 5]);
    const redBans = DRAFT_SEQUENCE.filter((s) => s.team === 'red' && s.action === 'ban');
    expect(redBans.map((s) => s.ordinal)).toEqual([1, 2, 3, 4, 5]);
  });

  it('gives blue first pick and red last', () => {
    const picks = DRAFT_SEQUENCE.filter((s) => s.action === 'pick');
    expect(picks[0].team).toBe('blue');
    expect(picks.at(-1)!.team).toBe('red');
  });
});

describe('stepAt / isComplete', () => {
  it('reads the step at a position', () => {
    expect(stepAt(0)).toEqual({ team: 'blue', action: 'ban', ordinal: 1 });
    expect(stepAt(6)).toEqual({ team: 'blue', action: 'pick', ordinal: 1 });
    expect(stepAt(19)).toEqual({ team: 'red', action: 'pick', ordinal: 5 });
  });

  it('is over past the last step', () => {
    expect(stepAt(20)).toBeNull();
    expect(isComplete(20)).toBe(true);
    expect(isComplete(19)).toBe(false);
  });

  it('treats a game saved before the sequence existed as not yet started', () => {
    // Older games carry no position at all; they must open on step one rather
    // than crash or appear finished.
    expect(stepAt(undefined as unknown as number)).toEqual(DRAFT_SEQUENCE[0]);
    expect(stepAt(-3)).toEqual(DRAFT_SEQUENCE[0]);
  });
});

describe('draftProgress', () => {
  it('runs nought to a hundred across the draft', () => {
    expect(draftProgress(0)).toBe(0);
    expect(draftProgress(10)).toBe(50);
    expect(draftProgress(20)).toBe(100);
  });

  it('clamps rather than reporting past the end', () => {
    expect(draftProgress(99)).toBe(100);
    expect(draftProgress(-5)).toBe(0);
  });
});

describe('seatFor', () => {
  const empty = ['', '', '', '', ''];

  it('sends a pick to the lane it is actually played in', () => {
    expect(seatFor('Leona', empty)).toBe('Support');
    expect(seatFor('Vi', empty)).toBe('Jungle');
  });

  it('falls back to the first free seat when that lane is taken', () => {
    // Jungle already filled, so Vi has to go somewhere — Top is the first gap.
    const seats = ['', 'Sejuani', '', '', ''];
    expect(seatFor('Vi', seats)).toBe('Top');
  });

  it('uses the first free seat for a champion with no lane data', () => {
    expect(seatFor('Evelynn', empty)).toBe('Top');
  });

  it('gives nothing when every seat is full', () => {
    expect(seatFor('Vi', ['a', 'b', 'c', 'd', 'e'])).toBeNull();
  });

  it('prefers the real lane over the first gap', () => {
    // Top is free, but Leona is a support and belongs in the support seat.
    expect(seatFor('Leona', empty)).toBe('Support');
  });
});

describe('describeStep', () => {
  it('names the team, because sides swap between games', () => {
    expect(describeStep(DRAFT_SEQUENCE[0], 'Bom Squad', 'Noname')).toBe('Bom Squad ban 1');
    expect(describeStep(DRAFT_SEQUENCE[7], 'Bom Squad', 'Noname')).toBe('Noname pick 1');
  });
});

describe('BAN_TEAMS / banTeamAt', () => {
  it('gives each side five bans', () => {
    expect(BAN_TEAMS).toHaveLength(10);
    expect(BAN_TEAMS.filter((t) => t === 'blue')).toHaveLength(5);
    expect(BAN_TEAMS.filter((t) => t === 'red')).toHaveLength(5);
  });

  it('alternates in phase one and swaps who leads in phase two', () => {
    // Blue leads the first six; red leads the last four.
    expect(BAN_TEAMS.join(' ')).toBe('blue red blue red blue red red blue red blue');
  });

  it('reads the team for a stored ban position', () => {
    expect(banTeamAt(0)).toBe('blue');
    expect(banTeamAt(1)).toBe('red');
    expect(banTeamAt(6)).toBe('red');
    expect(banTeamAt(9)).toBe('blue');
  });

  it('gives nothing past the tenth ban rather than guessing', () => {
    expect(banTeamAt(10)).toBeNull();
  });
});
