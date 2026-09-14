import { describe, expect, it } from 'vitest';
import { CHAMPION_LANES } from '../../data/champion-lanes';
import {
  blockedSet,
  compAvailability,
  CompChampions,
  normalizeChampion,
  playedGames,
  poolPressure,
  uniqueChampions
} from './draft.util';

/**
 * Every champion whose Riot id (what a replay and a Riot game store) is not its display name (what the
 * wall, the pickers and people write) in lower case — the twenty on the 13 Sep 2026 snapshot's
 * champion index, each against the name the champion data gives it — plus what people type.
 */
const SPELLINGS: readonly (readonly string[])[] = [
  ['AurelionSol', 'Aurelion Sol', 'aurelionsol'],
  ['Belveth', "Bel'Veth", 'belveth'],
  ['Chogath', "Cho'Gath", 'chogath'],
  ['DrMundo', 'Dr. Mundo', 'dr mundo', 'drmundo'],
  ['JarvanIV', 'Jarvan IV', 'jarvan iv'],
  ['KSante', "K'Sante", 'ksante'],
  ['Kaisa', "Kai'Sa", 'kaisa'],
  ['Khazix', "Kha'Zix", 'khazix'],
  ['KogMaw', "Kog'Maw", 'kogmaw'],
  ['LeeSin', 'Lee Sin', 'leesin'],
  ['MasterYi', 'Master Yi', 'master yi'],
  ['MissFortune', 'Miss Fortune', 'missfortune'],
  ['MonkeyKing', 'Wukong', 'wukong', 'monkeyking'],
  ['Nunu', 'Nunu & Willump', 'nunu', 'nunuwillump'],
  ['RekSai', "Rek'Sai", 'reksai'],
  ['Renata', 'Renata Glasc', 'renata', 'renataglasc'],
  ['TahmKench', 'Tahm Kench', 'tahmkench'],
  ['TwistedFate', 'Twisted Fate', 'twistedfate'],
  ['Velkoz', "Vel'Koz", 'velkoz'],
  ['XinZhao', 'Xin Zhao', 'xinzhao'],
  ['Leblanc', 'LeBlanc', 'leblanc'],
  ['FiddleSticks', 'Fiddlesticks', 'fiddlesticks']
];

describe('normalizeChampion — one key whatever the spelling', () => {
  for (const spellings of SPELLINGS) {
    it(`reads ${spellings.join(' / ')} as one champion`, () => {
      const keys = new Set(spellings.map(normalizeChampion));
      expect(keys.size).toBe(1);
      expect([...keys][0]).not.toBe('');
    });
  }

  it('keys a Riot id the way the display name keys, not the other way round', () => {
    expect(normalizeChampion('MonkeyKing')).toBe(normalizeChampion('Wukong'));
    expect(normalizeChampion('MonkeyKing')).toBe('wukong');
    expect(normalizeChampion('Nunu')).toBe('nunuwillump');
    expect(normalizeChampion('Renata')).toBe('renataglasc');
  });

  it('keeps different champions apart', () => {
    expect(normalizeChampion('Nunu')).not.toBe(normalizeChampion('Nami'));
    expect(normalizeChampion('Renata Glasc')).not.toBe(normalizeChampion('Renekton'));
    expect(normalizeChampion('Wukong')).not.toBe(normalizeChampion('MasterYi'));
    expect(normalizeChampion('')).toBe('');
  });

  it('finds a wall tile for every Riot id on the snapshot, so a burned or banned id greys its tile', () => {
    // The wall's tiles are display names; the lane table carries the same names for every champion.
    const tiles = new Map(Object.keys(CHAMPION_LANES).map((name) => [normalizeChampion(name), name]));
    for (const [id, display] of SPELLINGS.map((s) => [s[0], s[1]] as const)) {
      expect(tiles.get(normalizeChampion(id))?.toLowerCase(), id).toBe(display.toLowerCase());
    }
  });
});

describe('the wall greys what the series burned, whatever the replay called it', () => {
  // Paradox Requiem, 13 Sep 2026 snapshot: game 1 stored JarvanIV and Kaisa (theirs), game 2 MonkeyKing
  // (ours). The wall keyed its set by lower case, so for game 3 the Jarvan IV, Kai'Sa and Wukong tiles
  // stayed pickable — 37 greyed where 40 should be.
  const burnedBeforeG3 = [
    'Shen', 'Diana', 'Yone', 'Tristana', 'Zilean', 'Urgot', 'JarvanIV', 'Syndra', 'Kaisa', 'Leona',
    'Ornn', 'MonkeyKing', 'Ahri', 'Jinx', 'Thresh', 'Renekton', 'Shyvana', 'Sylas', 'Yunara', 'Seraphine'
  ];

  it('blocks the display-name tile for every stored id', () => {
    const blocked = blockedSet(burnedBeforeG3);
    for (const tile of ['Jarvan IV', "Kai'Sa", 'Wukong', 'Shen']) expect(blocked.has(normalizeChampion(tile)), tile).toBe(true);
    // What lower case alone found: the three the old wall missed are exactly these.
    const lower = new Set(burnedBeforeG3.map((c) => c.toLowerCase()));
    expect(['Jarvan IV', "Kai'Sa", 'Wukong'].filter((t) => lower.has(t.toLowerCase()))).toEqual([]);
  });

  it('takes Wukong out of DrunkenBannana’s pool once MonkeyKing is burned', () => {
    const [row] = poolPressure([{ name: 'DrunkenBannana', role: 'Mid', pool: ['Wukong', 'Ahri', 'Yone'] }], blockedSet(burnedBeforeG3));
    expect(row.gone).toEqual(['Wukong', 'Ahri', 'Yone']);
    expect(row.left).toEqual([]);
  });

  it('breaks a comp drafted with the display name when the replay burned the id', () => {
    const [comp] = compAvailability(
      [{ id: 'c', name: 'Dive', champions: ['Renata Glasc', 'Wukong', "Kai'Sa", 'Nunu & Willump', 'Miss Fortune'] }],
      blockedSet(['Renata', 'MonkeyKing', 'Kaisa', 'Nunu', 'MissFortune'])
    );
    expect(comp.blocked).toHaveLength(5);
    expect(comp.playable).toBe(false);
  });

  it('breaks a comp drafted with the id when the ban was typed as the name', () => {
    const [comp] = compAvailability([{ id: 'c', name: 'Ids', champions: ['MonkeyKing', 'LeeSin'] }], blockedSet(['wukong', 'Lee Sin']));
    expect(comp.available).toEqual([]);
  });
});

describe('uniqueChampions', () => {
  it('counts a champion once across spellings, keeping the first one met', () => {
    expect(uniqueChampions(['MonkeyKing', 'Ahri'], ['Wukong', "Kai'Sa", 'Kaisa', ''])).toEqual(['MonkeyKing', 'Ahri', "Kai'Sa"]);
  });

  it('matches a Set of one spelling each', () => {
    expect(uniqueChampions(['Ahri', 'Ahri', 'Zed'])).toEqual(['Ahri', 'Zed']);
  });
});

describe('playedGames', () => {
  it('keeps a game with a result or a replay and leaves an empty board out', () => {
    // MOSS 2 on the 13 Sep 2026 snapshot: two replays and game 3, an empty board opened on 13 Sep.
    const moss2 = [
      { id: 'game-2bf19e22', win: false, matchId: 'EUW1-7977500462' },
      { id: 'game-2e156073', win: false, matchId: 'EUW1-7977592156' },
      { id: 'game-3bdd6d33' }
    ];
    expect(playedGames(moss2).map((g) => g.id)).toEqual(['game-2bf19e22', 'game-2e156073']);
    // 5s: a board at step 9 and one at step 0, neither played — "not played yet · 2 games" becomes no count.
    const fives: { id: string; win?: boolean; matchId?: string }[] = [{ id: 'game-026f8731' }, { id: 'game-76f95ffe' }];
    expect(playedGames(fives)).toEqual([]);
  });

  it('counts a typed result with no replay, and a replay with no result yet', () => {
    expect(playedGames([{ win: true }, { matchId: 'EUW1-1' }, { win: undefined }])).toHaveLength(2);
  });
});

const COMPS: CompChampions[] = [
  { id: 'engage', name: 'Engage', champions: ['Maokai', 'Vi', 'Yasuo', 'Miss Fortune', 'Nautilus'] },
  { id: 'poke', name: 'Poke', champions: ['Jayce', 'Nidalee', 'Xerath', 'Ezreal', 'Karma'] },
  { id: 'dive', name: 'Dive', champions: ['Camille', 'Vi', 'Ahri', 'Kaisa', 'Rakan'] }
];

describe('blockedSet', () => {
  it('folds several lists into one normalised set', () => {
    const set = blockedSet(['Vi'], ['Miss Fortune'], undefined, ["Kai'Sa"]);
    expect(set.has('vi')).toBe(true);
    expect(set.has('missfortune')).toBe(true);
    expect(set.has('kaisa')).toBe(true);
  });

  it('matches regardless of punctuation or casing', () => {
    expect(blockedSet(["Kai'Sa"]).has(blockedSet(['kaisa']).values().next().value!)).toBe(true);
  });

  it('ignores empty entries', () => {
    expect(blockedSet(['', 'Vi']).size).toBe(1);
  });
});

describe('compAvailability', () => {
  it('marks a comp playable when nothing it needs is gone', () => {
    const [first] = compAvailability([COMPS[1]], blockedSet(['Vi']));
    expect(first.playable).toBe(true);
    expect(first.blocked).toEqual([]);
  });

  it('breaks a comp that lost a champion, and says which', () => {
    const [engage] = compAvailability([COMPS[0]], blockedSet(['Vi']));
    expect(engage.playable).toBe(false);
    expect(engage.blocked).toEqual(['Vi']);
    expect(engage.available).toHaveLength(4);
  });

  it('puts playable comps first, then the least-damaged', () => {
    // Vi breaks Engage and Dive; Dive also loses Ahri, so Engage is the nearer fix.
    const rows = compAvailability(COMPS, blockedSet(['Vi', 'Ahri']));
    expect(rows.map((r) => r.name)).toEqual(['Poke', 'Engage', 'Dive']);
  });

  it('ranks playable comps by win rate, best first', () => {
    const rated = [
      { ...COMPS[0], winRate: 40 },
      { ...COMPS[1], winRate: 80 },
      { ...COMPS[2], winRate: 60 }
    ];
    const rows = compAvailability(rated, blockedSet());
    expect(rows.map((r) => r.name)).toEqual(['Poke', 'Dive', 'Engage']);
  });

  it('sinks a comp with no record below one that has won', () => {
    const rows = compAvailability([{ ...COMPS[0] }, { ...COMPS[1], winRate: 10 }], blockedSet());
    expect(rows.map((r) => r.name)).toEqual(['Poke', 'Engage']);
  });

  it('still ranks broken comps by damage before win rate', () => {
    // Poke loses one champion, Engage two; the nearer fix leads regardless of record.
    const rated = [
      { ...COMPS[0], winRate: 90 },
      { ...COMPS[1], winRate: 10 }
    ];
    const rows = compAvailability(rated, blockedSet(['Maokai', 'Vi', 'Jayce']));
    expect(rows.map((r) => r.name)).toEqual(['Poke', 'Engage']);
  });

  it('treats a differently punctuated pick as the same champion', () => {
    const [dive] = compAvailability([COMPS[2]], blockedSet(["kai'sa"]));
    expect(dive.blocked).toEqual(['Kaisa']);
  });

  it('does not call an empty comp playable', () => {
    const [empty] = compAvailability([{ id: 'x', name: 'Empty', champions: [] }], blockedSet());
    expect(empty.playable).toBe(false);
  });
});

describe('poolPressure', () => {
  const players = [
    { name: 'Go10x', role: 'Jungle', pool: ['Vi', 'Sejuani', 'Nidalee'] },
    { name: 'Rulukuku', role: 'Top', pool: ['Yorick', 'Maokai', 'Camille', 'Ornn'] }
  ];

  it('splits each pool into what is left and what is gone', () => {
    const jungler = poolPressure(players, blockedSet(['Vi', 'Sejuani'])).find(
      (r) => r.name === 'Go10x'
    );
    expect(jungler?.left).toEqual(['Nidalee']);
    expect(jungler?.gone).toEqual(['Vi', 'Sejuani']);
  });

  it('lists players in draft order rather than by how thin their pool is', () => {
    // Sorting by pressure reordered the list between picks, which moves a row
    // out from under the cursor in the middle of a draft. Go10x has the thinner
    // pool here and still comes second, because Top is drafted before Jungle.
    const rows = poolPressure(players, blockedSet(['Vi']));
    expect(rows.map((r) => r.name)).toEqual(['Rulukuku', 'Go10x']);
  });

  it('still flags a thin pool wherever it sits in the order', () => {
    const rows = poolPressure(players, blockedSet(['Vi', 'Sejuani']));
    expect(rows.find((r) => r.name === 'Go10x')?.critical).toBe(true);
    expect(rows.find((r) => r.name === 'Rulukuku')?.critical).toBe(false);
  });

  it('flags a pool down to two champions', () => {
    const rows = poolPressure([{ name: 'Solo', pool: ['Ahri', 'Zed', 'Sylas'] }], blockedSet(['Sylas']));
    expect(rows[0].left).toHaveLength(2);
    expect(rows[0].critical).toBe(true);
  });

  it('leaves a pool of three alone — that is depth, not a warning', () => {
    const rows = poolPressure([{ name: 'Solo', pool: ['Ahri', 'Zed', 'Sylas'] }], blockedSet());
    expect(rows[0].critical).toBe(false);
  });

  it('flags an empty pool', () => {
    const rows = poolPressure([{ name: 'Solo', pool: ['Ahri'] }], blockedSet(['Ahri']));
    expect(rows[0].left).toEqual([]);
    expect(rows[0].critical).toBe(true);
  });
});
