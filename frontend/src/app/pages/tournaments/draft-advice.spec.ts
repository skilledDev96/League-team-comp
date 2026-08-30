import { describe, expect, it } from 'vitest';
import { ChampionTraits, Role } from '../../models/team.models';
import { CompAvailability } from './draft.util';
import { compGaps, currentStanding, enemyRead, suggestForLane, weightedWinRate } from './draft-advice';

function comp(over: Partial<CompAvailability> & { id: string; name: string }): CompAvailability {
  return {
    available: [],
    blocked: [],
    playable: true,
    ...over
  } as CompAvailability;
}

/** Each comp's champion for a lane, keyed off the comp id in these tests. */
const lineups: Record<string, Partial<Record<Role, string>>> = {
  engage: { Top: 'Maokai', Mid: 'Galio', ADC: 'Miss Fortune' },
  poke:   { Top: 'Jayce',  Mid: 'Galio', ADC: 'Ezreal' },
  fresh:  { Top: 'Sett',   Mid: 'Ahri',  ADC: 'Jinx' }
};
const pick = (c: CompAvailability, lane: Role) => lineups[c.id]?.[lane] ?? '';

describe('suggestForLane', () => {
  const comps = [
    comp({ id: 'engage', name: 'Engage', winRate: 83, games: 6 }),
    comp({ id: 'poke', name: 'Poke', winRate: 50, games: 4 }),
    comp({ id: 'fresh', name: 'Fresh', games: 0 })
  ];

  it('names the comps a champion would keep reachable', () => {
    const [top] = suggestForLane('Top', ['Maokai'], comps, pick);
    expect(top.champion).toBe('Maokai');
    expect(top.comps.map((c) => c.name)).toEqual(['Engage']);
    expect(top.winRate).toBe(83);
    expect(top.games).toBe(6);
  });

  it('ranks a played comp above an unplayed one, whatever the percentage', () => {
    // Fresh has no games, so its absent win rate must not sort as a win.
    const order = suggestForLane('Mid', ['Ahri', 'Galio'], comps, pick).map((s) => s.champion);
    expect(order).toEqual(['Galio', 'Ahri']);
  });

  it('carries the game count, so a small sample cannot pass as a strong one', () => {
    const [ahri] = suggestForLane('Mid', ['Ahri'], comps, pick);
    expect(ahri.games).toBe(0);
    expect(ahri.winRate).toBeUndefined();
  });

  it('gathers every comp a champion appears in', () => {
    // Galio is mid in both Engage and Poke.
    const [galio] = suggestForLane('Mid', ['Galio'], comps, pick);
    expect(galio.comps.map((c) => c.name)).toEqual(['Engage', 'Poke']);
    expect(galio.games).toBe(10);
  });

  it('ignores comps that are already broken', () => {
    const broken = [comp({ id: 'engage', name: 'Engage', winRate: 83, games: 6, playable: false })];
    expect(suggestForLane('Top', ['Maokai'], broken, pick)).toEqual([]);
  });

  it('says nothing about a champion in none of our comps', () => {
    expect(suggestForLane('Top', ['Garen'], comps, pick)).toEqual([]);
  });

  it('matches champions regardless of punctuation or casing', () => {
    const [mf] = suggestForLane('ADC', ['miss fortune'], comps, pick);
    expect(mf?.comps.map((c) => c.name)).toEqual(['Engage']);
  });
});

describe('compGaps', () => {
  const t = (over: Partial<ChampionTraits>): ChampionTraits => ({
    id: 'X', name: 'X', damage: 'physical', attack: 'melee',
    roles: [], cc: 1, mobility: 1, durability: 1, utility: 1, ...over
  });

  it('stays quiet until there is enough of a comp to be short of anything', () => {
    expect(compGaps([t({ durability: 0, cc: 0 })]).missing).toEqual([]);
    expect(compGaps([t({ durability: 0, cc: 0 }), t({ durability: 0, cc: 0 })]).missing).toEqual([]);
  });

  it('calls out a comp with nobody to walk in first', () => {
    const squishy = [t({ durability: 1, cc: 2 }), t({ durability: 0, cc: 2 }), t({ durability: 1, cc: 2 })];
    expect(compGaps(squishy).missing).toContain('No frontline — nobody to walk in first');
  });

  it('calls out a comp that cannot catch anyone', () => {
    const noCc = [t({ durability: 3, cc: 0 }), t({ durability: 0, cc: 1 }), t({ durability: 0, cc: 1 })];
    expect(compGaps(noCc).missing).toContain('Little crowd control — hard to catch anyone');
  });

  it('names one-sided damage once four are in, with the count', () => {
    const allAd = Array.from({ length: 4 }, () => t({ damage: 'physical', durability: 3, cc: 2 }));
    expect(compGaps(allAd).missing).toContain('4 of 4 AD — one item line answers it');
  });

  it('does not call damage one-sided on three picks', () => {
    const threeAd = Array.from({ length: 3 }, () => t({ damage: 'physical', durability: 3, cc: 2 }));
    expect(compGaps(threeAd).missing.some((m) => m.includes('AD'))).toBe(false);
  });

  it('says nothing about a comp that is not short of anything', () => {
    const rounded = [
      t({ damage: 'physical', durability: 3, cc: 2 }),
      t({ damage: 'magic', durability: 2, cc: 2 }),
      t({ damage: 'magic', durability: 0, cc: 1 }),
      t({ damage: 'physical', durability: 0, cc: 1 })
    ];
    expect(compGaps(rounded).missing).toEqual([]);
  });

  it('reports the raw counts alongside the sentences', () => {
    const g = compGaps([t({ damage: 'magic', durability: 3, cc: 2 })]);
    expect(g).toMatchObject({ magic: 1, physical: 0, frontline: 1, cc: 2, picked: 1 });
  });
});

describe('weightedWinRate', () => {
  it('weights by games, so a six-game comp outvotes a one-game comp', () => {
    // 83% over 6 and 0% over 1 is 71%, not the 42% a plain mean would give.
    expect(weightedWinRate([
      { id: 'a', name: 'A', winRate: 83, games: 6 },
      { id: 'b', name: 'B', winRate: 0, games: 1 }
    ])).toBe(71);
  });

  it('leaves unplayed comps out rather than counting them as losses', () => {
    expect(weightedWinRate([
      { id: 'a', name: 'A', winRate: 80, games: 5 },
      { id: 'b', name: 'B', games: 0 }
    ])).toBe(80);
  });

  it('gives nothing when none of them has been played', () => {
    // Better than a confident-looking 0%.
    expect(weightedWinRate([{ id: 'a', name: 'A', games: 0 }])).toBeUndefined();
    expect(weightedWinRate([])).toBeUndefined();
  });
});

describe('currentStanding', () => {
  it('reads across every reachable comp, weighted by games', () => {
    const comps = [
      comp({ id: 'a', name: 'A', winRate: 100, games: 2 }),
      comp({ id: 'b', name: 'B', winRate: 50, games: 6 })
    ];
    expect(currentStanding(comps)).toEqual({ rate: 63, games: 8 });
  });

  it('ignores comps that are already broken', () => {
    const comps = [
      comp({ id: 'a', name: 'A', winRate: 100, games: 4 }),
      comp({ id: 'b', name: 'B', winRate: 0, games: 4, playable: false })
    ];
    expect(currentStanding(comps).rate).toBe(100);
  });
});

describe('enemyRead', () => {
  const t = (over: Partial<ChampionTraits>): ChampionTraits => ({
    id: 'X', name: 'X', damage: 'physical', attack: 'melee',
    roles: [], cc: 1, mobility: 1, durability: 1, utility: 1, ...over
  });
  const many = (n: number, over: Partial<ChampionTraits>) => Array.from({ length: n }, () => t(over));

  it('says nothing off one or two picks', () => {
    // Two champions is not a draft to read.
    expect(enemyRead(many(2, { durability: 0, cc: 0 }))).toEqual([]);
  });

  it('reads one-sided damage, with the count', () => {
    const read = enemyRead(many(4, { damage: 'physical', durability: 3, cc: 2 }));
    expect(read.find((r) => r.strong === "They're 4 AD")?.rest).toBe('armour stacks well here.');
  });

  it('reads a missing frontline as an opening', () => {
    const squishy = many(3, { durability: 1, cc: 2, attack: 'ranged' });
    const line = enemyRead(squishy).find((r) => r.strong === 'They have no frontline');
    expect(line).toMatchObject({ tone: 'win', rest: 'a dive comp gets straight to their carries.' });
  });

  it('reads an all-melee comp', () => {
    const melee = many(3, { attack: 'melee', durability: 3, cc: 2 });
    expect(enemyRead(melee).some((r) => r.strong === 'Their comp is all melee')).toBe(true);
  });

  it('does not call a comp all-melee when someone is ranged', () => {
    const mixed = [t({ attack: 'ranged', durability: 3 }), ...many(2, { attack: 'melee', durability: 3 })];
    expect(enemyRead(mixed).some((r) => r.strong === 'Their comp is all melee')).toBe(false);
  });

  it('warns about heavy crowd control rather than calling it an opening', () => {
    const locked = many(4, { cc: 3, durability: 1, attack: 'ranged' });
    const line = enemyRead(locked).find((r) => r.strong === 'They have heavy crowd control');
    expect(line?.tone).toBe('loss');
  });

  it('warns when most of them are frontline', () => {
    const tanky = many(3, { durability: 3, cc: 2, attack: 'melee' });
    const line = enemyRead(tanky).find((r) => r.strong.includes('frontline'));
    expect(line).toMatchObject({ tone: 'loss' });
  });

  it('puts what we can exploit before what we should fear', () => {
    // A squishy, low-cc, all-melee comp: every line is an opening.
    const read = enemyRead(many(3, { durability: 0, cc: 0, attack: 'melee' }));
    expect(read.length).toBeGreaterThan(1);
    expect(read.every((r) => r.tone === 'win')).toBe(true);
  });
});
