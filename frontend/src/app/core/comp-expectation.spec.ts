import { describe, expect, it } from 'vitest';
import { ChampionTraits } from '../models/team.models';
import { compareCurve, deriveExpectation, expectationFor } from './comp-expectation';

const t = (id: string, over: Partial<ChampionTraits> = {}): ChampionTraits => ({
  id,
  name: id,
  damage: 'physical',
  attack: 'melee',
  roles: [],
  cc: 0,
  mobility: 0,
  durability: 0,
  utility: 0,
  ...over
});

const assassin = (id: string) => t(id, { roles: ['assassin'], mobility: 3, cc: 1 });
const marksman = (id: string) => t(id, { roles: ['marksman'], attack: 'ranged', damage: 'physical', cc: 1 });
const mage = (id: string) => t(id, { roles: ['mage'], attack: 'ranged', damage: 'magic', cc: 2 });
const tank = (id: string) => t(id, { roles: ['tank'], durability: 3, cc: 3, utility: 2 });
const enchanter = (id: string) => t(id, { roles: ['support'], attack: 'ranged', utility: 3, cc: 1 });
const fighter = (id: string) => t(id, { roles: ['fighter'], durability: 2, mobility: 1, cc: 1 });

describe('deriveExpectation', () => {
  it('abstains on a partial comp', () => {
    expect(deriveExpectation([assassin('a'), assassin('b'), assassin('c')])).toBeNull();
  });

  it('reads five assassins and fighters as a strong early that does not scale', () => {
    const e = deriveExpectation([assassin('a'), assassin('b'), assassin('c'), fighter('d'), fighter('e')])!;
    expect(e.early).toBe('high');
    expect(e.scaling).toBe('low');
  });

  it('reads marksmen and mages as scaling', () => {
    const e = deriveExpectation([marksman('a'), marksman('b'), mage('c'), mage('d'), tank('e')])!;
    expect(e.scaling).toBe('high');
    expect(e.early).toBe('low');
  });

  it('reads tanks with utility and crowd control as objective control and teamfight', () => {
    const e = deriveExpectation([tank('a'), tank('b'), tank('c'), enchanter('d'), mage('e')])!;
    expect(e.objectives).toBe('high');
    expect(e.teamfight).toBe('high');
  });

  it('counts the jungler double on the early axis', () => {
    const five = [fighter('top'), t('jg', { roles: ['fighter'], durability: 2, mobility: 2, cc: 1 }), mage('mid'), marksman('adc'), enchanter('sup')];
    expect(deriveExpectation(five)!.early).toBe('low');
    expect(deriveExpectation(five, { junglerId: 'jg' })!.early).toBe('mid');
  });

  it('nudges the axes from the identity and the name', () => {
    // Four ranged, one frontline: poke, which nudges nothing.
    const poke = deriveExpectation([marksman('a'), mage('b'), mage('c'), mage('d'), tank('e')])!;
    expect(poke.scaling).toBe('high');
    // A split comp is capped at mid on teamfight whatever its crowd control adds up to.
    const split = deriveExpectation([fighter('a'), fighter('b'), t('c', { roles: ['mage'], attack: 'ranged', cc: 1 }), marksman('d'), t('e', { roles: ['support'], attack: 'ranged', utility: 1, cc: 1 })])!;
    expect(split.teamfight).not.toBe('high');
    const named = deriveExpectation([assassin('a'), assassin('b'), assassin('c'), fighter('d'), fighter('e')], { name: 'Scaling five' })!;
    expect(named.scaling).toBe('mid');
  });
});

describe('expectationFor', () => {
  const five = [marksman('a'), marksman('b'), mage('c'), mage('d'), tank('e')];

  it('prefers what an editor wrote', () => {
    const edited = { early: 'high', scaling: 'low', objectives: 'mid', teamfight: 'mid' } as const;
    expect(expectationFor({ name: 'X', expect: edited, expectSource: 'edited' }, five)).toEqual({ expect: edited, source: 'edited' });
  });

  it('derives when nothing was written, and falls back to a stored value on a partial comp', () => {
    expect(expectationFor({ name: 'X' }, five)?.source).toBe('derived');
    const stored = { early: 'mid', scaling: 'mid', objectives: 'mid', teamfight: 'mid' } as const;
    expect(expectationFor({ name: 'X', expect: stored }, five.slice(0, 2))).toEqual({ expect: stored, source: 'derived' });
    expect(expectationFor({ name: 'X' }, [])).toBeNull();
  });
});

describe('compareCurve', () => {
  const strongEarly = { early: 'high', scaling: 'low', objectives: 'mid', teamfight: 'mid' } as const;
  const scaler = { early: 'low', scaling: 'high', objectives: 'mid', teamfight: 'mid' } as const;

  it('says when a strong early did not come, and when it did', () => {
    expect(compareCurve(strongEarly, { at10: -1200 })).toEqual(['Expected a strong early game, but was down 1.2k at ten.']);
    expect(compareCurve(strongEarly, { at10: 2500 })).toEqual(['The strong early game came: up 2.5k at ten.']);
  });

  it('reads a slow start as expected, and the scaling either way', () => {
    expect(compareCurve(scaler, { at10: -1500, at25: 3000 })).toEqual([
      'Down 1.5k at ten, which a slow-starting comp expects; the question is what came after.',
      'The scaling paid: up 3k at twenty-five.'
    ]);
    expect(compareCurve(scaler, { at25: -4000 })).toEqual(['Expected to scale, but was down 4k at twenty-five.']);
  });

  it('says nothing on an even game, a mid expectation, or no expectation', () => {
    expect(compareCurve(strongEarly, { at10: 400 })).toEqual([]);
    expect(compareCurve({ early: 'mid', scaling: 'mid', objectives: 'mid', teamfight: 'mid' }, { at10: -3000, at25: -5000 })).toEqual([]);
    expect(compareCurve(null, { at10: -3000 })).toEqual([]);
  });
});
