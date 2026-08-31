import { describe, expect, it } from 'vitest';
import { Role } from '../models/team.models';
import { assignRolesFromPlay, rolesDisagree } from './opponent-roles';

const at = (role: Role, games: number) => ({ role, games });

describe('assignRolesFromPlay', () => {
  it('gives each player the seat they actually play', () => {
    const roster = [
      { role: 'Top' as Role, positions: [at('ADC', 40)] },
      { role: 'Jungle' as Role, positions: [at('Support', 35)] },
      { role: 'Mid' as Role, positions: [at('Top', 30)] },
      { role: 'ADC' as Role, positions: [at('Mid', 25)] },
      { role: 'Support' as Role, positions: [at('Jungle', 20)] }
    ];
    expect(assignRolesFromPlay(roster)).toEqual(['ADC', 'Support', 'Top', 'Mid', 'Jungle']);
  });

  it('gives a contested seat to whoever plays it more', () => {
    // A support with 60 games there beats a mid with 3 games of support.
    const roster = [
      { role: 'Top' as Role, positions: [at('Support', 3), at('Mid', 50)] },
      { role: 'Jungle' as Role, positions: [at('Support', 60)] }
    ];
    const out = assignRolesFromPlay(roster);
    expect(out[1]).toBe('Support');
    expect(out[0]).toBe('Mid');
  });

  it('falls to a real second position rather than to whatever is left', () => {
    const roster = [
      { role: 'Top' as Role, positions: [at('Mid', 40), at('Top', 30)] },
      { role: 'Mid' as Role, positions: [at('Mid', 50)] }
    ];
    expect(assignRolesFromPlay(roster)).toEqual(['Top', 'Mid']);
  });

  it('never seats two players in the same role', () => {
    const roster = Array.from({ length: 5 }, () => ({ positions: [at('Mid', 40)] }));
    expect(new Set(assignRolesFromPlay(roster)).size).toBe(5);
  });

  it('keeps a hand-set role when nobody scouted claims that seat', () => {
    // A human may have set it deliberately — a sub, or a swap being practised.
    const roster = [
      { role: 'Support' as Role },
      { role: 'Jungle' as Role, positions: [at('Jungle', 30)] }
    ];
    expect(assignRolesFromPlay(roster)).toEqual(['Support', 'Jungle']);
  });

  it('ignores a position with no games behind it', () => {
    const roster = [{ role: 'Top' as Role, positions: [at('Support', 0)] }];
    expect(assignRolesFromPlay(roster)).toEqual(['Top']);
  });

  it('gives everyone a seat even with nothing to go on', () => {
    expect(assignRolesFromPlay([{}, {}, {}, {}, {}])).toHaveLength(5);
    expect(new Set(assignRolesFromPlay([{}, {}, {}, {}, {}])).size).toBe(5);
  });
});

describe('rolesDisagree', () => {
  it('spots a roster that is off by a swap', () => {
    const roster = [
      { role: 'Top' as Role, positions: [at('ADC', 40)] },
      { role: 'ADC' as Role, positions: [at('Top', 40)] }
    ];
    expect(rolesDisagree(roster)).toBe(true);
  });

  it('stays quiet when the roster already matches', () => {
    const roster = [
      { role: 'Top' as Role, positions: [at('Top', 40)] },
      { role: 'ADC' as Role, positions: [at('ADC', 40)] }
    ];
    expect(rolesDisagree(roster)).toBe(false);
  });

  it('stays quiet on an unscouted roster rather than offering a shuffle', () => {
    expect(rolesDisagree([{ role: 'Top' as Role }, { role: 'Mid' as Role }])).toBe(false);
  });
});
