import { describe, expect, it } from 'vitest';
import { ChampionTraits } from '../models/team.models';
import { classifyComp, damageProfile } from './comp-identity';

function t(over: Partial<ChampionTraits> = {}): ChampionTraits {
  return {
    id: 'X',
    name: 'X',
    damage: 'physical',
    attack: 'melee',
    roles: ['fighter'],
    cc: 1,
    mobility: 1,
    durability: 1,
    utility: 1,
    ...over
  };
}

describe('damageProfile', () => {
  it('counts the split', () => {
    const profile = damageProfile([
      t({ damage: 'physical' }),
      t({ damage: 'physical' }),
      t({ damage: 'magic' }),
      t({ damage: 'mixed' }),
      t({ damage: 'magic' })
    ]);
    expect(profile).toMatchObject({ physical: 2, magic: 2, mixed: 1 });
  });

  it('flags a comp a single item line answers', () => {
    const profile = damageProfile(Array.from({ length: 5 }, () => t({ damage: 'physical' })));
    expect(profile.lopsided).toBe(true);
  });

  it('does not let mixed damage disguise a one-sided comp', () => {
    // Four physical plus one mixed is still armour-stacked against.
    const profile = damageProfile([
      ...Array.from({ length: 4 }, () => t({ damage: 'physical' })),
      t({ damage: 'mixed' })
    ]);
    expect(profile.lopsided).toBe(true);
  });

  it('leaves a balanced comp alone', () => {
    const profile = damageProfile([
      t({ damage: 'physical' }),
      t({ damage: 'physical' }),
      t({ damage: 'physical' }),
      t({ damage: 'magic' }),
      t({ damage: 'magic' })
    ]);
    expect(profile.lopsided).toBe(false);
  });

  it('says nothing about a comp that is not finished', () => {
    expect(damageProfile([t(), t()]).lopsided).toBe(false);
  });
});

describe('classifyComp', () => {
  const ranged = (over: Partial<ChampionTraits> = {}) => t({ attack: 'ranged', durability: 0, ...over });

  it('calls five ranged with no frontline a poke comp', () => {
    expect(classifyComp(Array.from({ length: 5 }, () => ranged()))).toBe('poke');
  });

  it('calls mobile and heavy crowd control a dive comp', () => {
    const comp = Array.from({ length: 5 }, () => t({ mobility: 2, cc: 2 }));
    expect(classifyComp(comp)).toBe('dive');
  });

  it('reads dive before teamfight when a comp is both', () => {
    // A comp that can jump on you is played as dive, whatever else it can do.
    const comp = Array.from({ length: 5 }, () => t({ mobility: 2, cc: 2, durability: 2 }));
    expect(classifyComp(comp)).toBe('dive');
  });

  it('calls layered crowd control with bodies a teamfight comp', () => {
    const comp = Array.from({ length: 5 }, () => t({ cc: 2, durability: 2, mobility: 1 }));
    expect(classifyComp(comp)).toBe('teamfight');
  });

  it('calls enchanters around a carry protect-the-carry', () => {
    const comp = [
      t({ roles: ['marksman'], attack: 'ranged', utility: 1, cc: 1, mobility: 1 }),
      t({ roles: ['support'], utility: 3, cc: 1, mobility: 1 }),
      t({ roles: ['support'], utility: 3, cc: 1, mobility: 1 }),
      t({ roles: ['tank'], durability: 3, cc: 1, mobility: 1 }),
      t({ roles: ['mage'], utility: 1, cc: 1, mobility: 1 })
    ];
    expect(classifyComp(comp)).toBe('protect');
  });

  it('refuses to label a comp that is not finished', () => {
    // Three champions is a coin flip, and a label would be read as a finding.
    expect(classifyComp([t(), t(), t()])).toBe('unclear');
  });

  it('says unclear rather than forcing a shape that is not there', () => {
    const comp = Array.from({ length: 5 }, () => t({ cc: 0, mobility: 0, durability: 0, utility: 0, roles: [] }));
    expect(classifyComp(comp)).toBe('unclear');
  });
});
