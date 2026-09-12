import { describe, expect, it } from 'vitest';
import { Role } from '../models/team.models';
import { assignRolesFromPlay, rolesDisagree, seatOffer, withSeats } from './opponent-roles';

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

/**
 * The offer (12 Sep 2026). An op.gg multi-link is not ordered by role, so pasting a roster in the
 * wrong order is the easy mistake — and then every row of the table is about the wrong player.
 * This is what notices. It stays an offer: a team that has just swapped roles looks identical.
 */
describe('seatOffer', () => {
  const p = (name: string, role: Role, positions?: { role: Role; games: number }[], sub?: boolean) => ({
    name,
    role,
    ...(positions ? { positions } : {}),
    ...(sub ? { sub: true } : {})
  });

  /** Five pasted in the wrong order: each of them mains the seat of the next one along. */
  const wrongOrder = [
    p('a', 'Top', [{ role: 'Jungle', games: 40 }]),
    p('b', 'Jungle', [{ role: 'Mid', games: 40 }]),
    p('c', 'Mid', [{ role: 'ADC', games: 40 }]),
    p('d', 'ADC', [{ role: 'Support', games: 40 }]),
    p('e', 'Support', [{ role: 'Top', games: 40 }])
  ];

  it('names every seat the games would move, and who holds it', () => {
    const offer = seatOffer(wrongOrder)!;
    expect(offer).not.toBeNull();
    expect(offer.map((c) => `${c.player.name}: ${c.from}->${c.to}`)).toEqual([
      'a: Top->Jungle',
      'b: Jungle->Mid',
      'c: Mid->ADC',
      'd: ADC->Support',
      'e: Support->Top'
    ]);
  });

  it('says nothing when the roster already agrees with the games', () => {
    const right = [
      p('a', 'Top', [{ role: 'Top', games: 40 }]),
      p('b', 'Jungle', [{ role: 'Jungle', games: 40 }]),
      p('c', 'Mid', [{ role: 'Mid', games: 40 }]),
      p('d', 'ADC', [{ role: 'ADC', games: 40 }]),
      p('e', 'Support', [{ role: 'Support', games: 40 }])
    ];
    expect(seatOffer(right)).toBeNull();
  });

  it('says nothing for a roster that is not a clean five', () => {
    // Six people cannot hold five distinct seats, so "disagrees" means nothing there.
    expect(seatOffer([...wrongOrder, p('f', 'Mid', [{ role: 'Mid', games: 40 }], true)])).not.toBeNull();
    expect(seatOffer(wrongOrder.slice(0, 4))).toBeNull();
    expect(seatOffer([])).toBeNull();
  });

  it('ignores a sub when deciding, and never offers to move one', () => {
    const withSub = [...wrongOrder, p('sub', 'Mid', [{ role: 'Mid', games: 99 }], true)];
    const offer = seatOffer(withSub)!;
    expect(offer.some((c) => c.player.name === 'sub')).toBe(false);
    expect(offer).toHaveLength(5);
  });

  it('says nothing when nobody has been scouted, rather than guessing', () => {
    const unscouted = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'].map((r) => p('x' + r, r as Role));
    expect(seatOffer(unscouted)).toBeNull();
  });
});

describe('withSeats', () => {
  const p = (name: string, role: Role, sub?: boolean) => ({ name, role, ...(sub ? { sub: true } : {}) });

  it('moves exactly the players the offer names and leaves the rest alone', () => {
    const roster = [p('a', 'Top'), p('b', 'Jungle'), p('sub', 'Mid', true)];
    const changes = [{ player: roster[0], from: 'Top' as Role, to: 'Jungle' as Role }];
    const out = withSeats(roster, changes);
    expect(out.map((x) => x.role)).toEqual(['Jungle', 'Jungle', 'Mid']);
    expect(out[1]).toBe(roster[1]);
    expect(out[2]).toBe(roster[2]);
  });

  it('does not mutate what it was given', () => {
    const roster = [p('a', 'Top')];
    withSeats(roster, [{ player: roster[0], from: 'Top', to: 'ADC' }]);
    expect(roster[0].role).toBe('Top');
  });
});
