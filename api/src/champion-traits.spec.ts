import { describe, expect, it } from 'vitest';
import { ChampionTraits, toTraits } from './champion-traits';

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

describe('toTraits', () => {
  it('reads the shape CommunityDragon actually publishes', () => {
    const traits = toTraits({
      name: 'Lee Sin',
      alias: 'LeeSin',
      roles: ['fighter', 'assassin'],
      tacticalInfo: { damageType: 'kPhysical', attackType: 'melee' },
      playstyleInfo: { crowdControl: 2, mobility: 3, durability: 2, utility: 1 }
    });
    expect(traits).toEqual({
      id: 'LeeSin',
      name: 'Lee Sin',
      damage: 'physical',
      attack: 'melee',
      roles: ['fighter', 'assassin'],
      cc: 2,
      mobility: 3,
      durability: 2,
      utility: 1
    });
  });

  it('keys on the alias, since that is what Data Dragon uses for icons', () => {
    // Wukong is MonkeyKing everywhere in Riot's own data; joining on the
    // display name would break exactly the champions with punctuation.
    expect(toTraits({ name: 'Wukong', alias: 'MonkeyKing' })?.id).toBe('MonkeyKing');
  });

  it('says unknown rather than guessing a damage type it was not given', () => {
    const traits = toTraits({ name: 'X', alias: 'X' });
    expect(traits?.damage).toBe('unknown');
    expect(traits?.attack).toBe('unknown');
  });

  it('skips an entry with no alias to join on', () => {
    expect(toTraits({ name: 'None' })).toBeNull();
  });
});
