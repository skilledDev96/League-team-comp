import { describe, expect, it } from 'vitest';
import { CHAMPION_LANES } from '../../data/champion-lanes';
import type { SeriesGame } from '../../models/team.models';
import { DRAFT_LENGTH } from './draft-sequence';
import {
  blockedSet,
  compAvailability,
  CompChampions,
  gameAfterPlayed,
  gameHasContent,
  gapsBefore,
  gapsLine,
  normalizeChampion,
  playedGameWrite,
  playedGames,
  playedSeats,
  poolPressure,
  uniqueChampions,
  wilsonLowerBound
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

  it('ignores a ban nobody saw, which closes no champion (17 Sep 2026)', () => {
    const set = blockedSet(['-', 'Vi'], ['-']);
    expect([...set]).toEqual(['vi']);
    expect(set.has('')).toBe(false);
    expect(set.has('-')).toBe(false);
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

  it('ranks playable comps by win rate when the samples are alike', () => {
    const rated = [
      { ...COMPS[0], winRate: 40, games: 10 },
      { ...COMPS[1], winRate: 80, games: 10 },
      { ...COMPS[2], winRate: 60, games: 10 }
    ];
    const rows = compAvailability(rated, blockedSet());
    expect(rows.map((r) => r.name)).toEqual(['Poke', 'Dive', 'Engage']);
  });

  it('puts a 5–1 comp above a 1–0 comp, because one game cannot carry 100%', () => {
    // The popup sorted on the raw rate (17 Sep 2026): 100% from one game stood above 83% from six.
    const rows = compAvailability([{ ...COMPS[0], winRate: 100, games: 1 }, { ...COMPS[1], winRate: 83, games: 6 }], blockedSet());
    expect(rows.map((r) => [r.name, r.winRate, r.games])).toEqual([['Poke', 83, 6], ['Engage', 100, 1]]);
  });

  it('puts a comp never played last, below even a losing record', () => {
    const rows = compAvailability(
      [{ ...COMPS[2] }, { ...COMPS[0], winRate: 0, games: 3 }, { ...COMPS[1], winRate: 100, games: 1 }],
      blockedSet()
    );
    expect(rows.map((r) => r.name)).toEqual(['Poke', 'Engage', 'Dive']);
  });

  it('reads a rate with no games behind it as no record', () => {
    const rows = compAvailability([{ ...COMPS[0], winRate: 90 }, { ...COMPS[1], winRate: 10, games: 2 }], blockedSet());
    expect(rows.map((r) => r.name)).toEqual(['Poke', 'Engage']);
  });

  it('still ranks broken comps by damage before record', () => {
    // Poke loses one champion, Engage two; the nearer fix leads regardless of record.
    const rated = [
      { ...COMPS[0], winRate: 90, games: 10 },
      { ...COMPS[1], winRate: 10, games: 10 }
    ];
    const rows = compAvailability(rated, blockedSet(['Maokai', 'Vi', 'Jayce']));
    expect(rows.map((r) => r.name)).toEqual(['Poke', 'Engage']);
  });

  it('breaks a tie between equally broken comps on the record, no games last', () => {
    // Vi breaks Engage and Dive by one champion each; Poke is intact and leads. Both expected orders run
    // against name order (Dive before Engage), so a tiebreak dropped, reversed or on the raw rate fails here.
    const rated = [
      { ...COMPS[0], winRate: 83, games: 6 },
      { ...COMPS[1] },
      { ...COMPS[2], winRate: 100, games: 1 }
    ];
    expect(compAvailability(rated, blockedSet(['Vi'])).map((r) => r.name)).toEqual(['Poke', 'Engage', 'Dive']);
    const unplayed = [{ ...COMPS[0], winRate: 0, games: 4 }, { ...COMPS[2] }];
    expect(compAvailability(unplayed, blockedSet(['Vi'])).map((r) => r.name)).toEqual(['Engage', 'Dive']);
  });

  it('treats a differently punctuated pick as the same champion', () => {
    const [dive] = compAvailability([COMPS[2]], blockedSet(["kai'sa"]));
    expect(dive.blocked).toEqual(['Kaisa']);
  });

  it('does not call an empty comp playable', () => {
    const [empty] = compAvailability([{ id: 'x', name: 'Empty', champions: [] }], blockedSet());
    expect(empty.playable).toBe(false);
  });

  // ---- Seats with fallbacks (20 Sep 2026) -------------------------------------------------------
  // The lead: "the dive comp has naut a priority but Leona can also be added as a secondary pick".
  const DIVE: CompChampions = {
    ...COMPS[2],
    champions: ['Camille', 'Vi', 'Ahri', 'Kaisa', 'Nautilus'],
    seats: [
      { role: 'Top', champions: ['Camille'] },
      { role: 'Jungle', champions: ['Vi'] },
      { role: 'Mid', champions: ['Ahri'] },
      { role: 'ADC', champions: ['Kaisa'] },
      { role: 'Support', champions: ['Nautilus', 'Leona'] }
    ]
  };

  it('keeps the comp playable whichever one of the seat’s two champions is banned', () => {
    for (const ban of ['Nautilus', 'Leona']) {
      const [dive] = compAvailability([DIVE], blockedSet([ban]));
      expect(dive.playable, ban).toBe(true);
      expect(dive.lost, ban).toBe(0);
    }
  });

  it('breaks it only once both of them are gone, and counts one seat lost', () => {
    const [dive] = compAvailability([DIVE], blockedSet(['Nautilus', 'Leona']));
    expect(dive.playable).toBe(false);
    expect(dive.lost).toBe(1);
    // Both champions are still reported gone; it is the seat that decides whether the comp survives.
    expect(dive.blocked).toEqual(['Nautilus', 'Leona']);
  });

  it('says which seat is running a substitute and what it would field now', () => {
    const [dive] = compAvailability([DIVE], blockedSet(['Nautilus']));
    expect(dive.substituted).toBe(1);
    const support = dive.seats.find((s) => s.role === 'Support')!;
    expect(support.best).toBe('Leona');
    expect(support.substituted).toBe(true);
    expect(support.lost).toBe(false);
    expect(support.options).toEqual([
      { champion: 'Nautilus', gone: true, rank: 0 },
      { champion: 'Leona', gone: false, rank: 1 }
    ]);
  });

  it('orders the broken by the seats they lost, not by the champions', () => {
    // Dive loses one seat with three champions in it; Poke loses two seats of one. The nearer fix is Dive,
    // which the old count of blocked champions (3 against 2) had the wrong way round.
    const deep: CompChampions = {
      ...DIVE,
      seats: DIVE.seats!.map((s) => (s.role === 'Support' ? { ...s, champions: ['Nautilus', 'Leona', 'Rakan'] } : s))
    };
    const rows = compAvailability([deep, COMPS[1]], blockedSet(['Nautilus', 'Leona', 'Rakan', 'Jayce', 'Nidalee']));
    expect(rows.map((r) => [r.name, r.lost, r.blocked.length])).toEqual([
      ['Dive', 1, 3],
      ['Poke', 2, 2]
    ]);
  });

  it('reads a comp that sent no seats as one champion a seat, exactly as before', () => {
    const [engage] = compAvailability([COMPS[0]], blockedSet(['Vi']));
    expect(engage.seats.map((s) => [s.role, s.options.map((o) => o.champion)])).toEqual([
      ['Top', ['Maokai']],
      ['Jungle', ['Vi']],
      ['Mid', ['Yasuo']],
      ['ADC', ['Miss Fortune']],
      ['Support', ['Nautilus']]
    ]);
    expect(engage.lost).toBe(1);
    expect(engage.substituted).toBe(0);
  });

  it('treats a seat nobody filled as no constraint, and still draws it as a row', () => {
    const four: CompChampions = {
      id: 'four',
      name: 'Four',
      champions: ['Camille', 'Vi', 'Ahri', 'Kaisa', ''],
      seats: [
        { role: 'Top', champions: ['Camille'] },
        { role: 'Jungle', champions: ['Vi'] },
        { role: 'Mid', champions: ['Ahri'] },
        { role: 'ADC', champions: ['Kaisa'] },
        { role: 'Support', champions: [] }
      ]
    };
    const [row] = compAvailability([four], blockedSet());
    expect(row.playable).toBe(true);
    expect(row.seats).toHaveLength(5);
    expect(row.seats.at(-1)).toMatchObject({ role: 'Support', options: [], best: '', lost: false });
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

describe('gapsBefore', () => {
  const five = ['Shen', 'Diana', 'Yone', 'Tristana', 'Zilean'];
  const theirs = ['Urgot', 'JarvanIV', 'Syndra', 'Kaisa', 'Leona'];
  const game = (id: string, gameNumber: number, ourChampions: string[] = [], theirChampions: string[] = []) => ({ id, gameNumber, ourChampions, theirChampions });

  it('names the earlier games short of five picks a side, in game order', () => {
    // Paradox Requiem as it stood before game 3 on 10 Sep 2026: two games played without the room.
    const games = [game('g3', 3), game('g2', 2), game('g1', 1)];
    expect(gapsBefore(games, 3)).toEqual([
      { id: 'g1', gameNumber: 1, picks: 0, missing: 10 },
      { id: 'g2', gameNumber: 2, picks: 0, missing: 10 }
    ]);
  });

  it('counts the empty seats honestly, not a whole game', () => {
    const games = [game('g1', 1, five, theirs), game('g2', 2, ['Ornn', '', 'Ahri', '', ''], ['Renekton', 'Shyvana', '  ', 'Sylas'])];
    expect(gapsBefore(games, 3)).toEqual([{ id: 'g2', gameNumber: 2, picks: 5, missing: 5 }]);
  });

  it('leaves out a full board, this game and every later one', () => {
    const games = [game('g1', 1, five, theirs), game('g2', 2), game('g3', 3)];
    expect(gapsBefore(games, 2)).toEqual([]);
    expect(gapsBefore(games, 1)).toEqual([]);
  });

  it('never counts more than five a side', () => {
    expect(gapsBefore([game('g1', 1, [...five, 'Extra'], theirs.slice(0, 4))], 2)).toEqual([{ id: 'g1', gameNumber: 1, picks: 9, missing: 1 }]);
  });
});

describe('gapsLine', () => {
  it('says which games are empty and how many champions the burn is missing', () => {
    expect(gapsLine([{ id: 'g1', gameNumber: 1, picks: 0, missing: 10 }])).toBe('Game 1 has no picks, so the burn is missing up to 10 champions');
    expect(gapsLine([
      { id: 'g1', gameNumber: 1, picks: 0, missing: 10 },
      { id: 'g2', gameNumber: 2, picks: 0, missing: 10 }
    ])).toBe('Games 1 and 2 have no picks, so the burn is missing up to 20 champions');
  });

  it('counts a half-entered game by its seats', () => {
    expect(gapsLine([{ id: 'g2', gameNumber: 2, picks: 9, missing: 1 }])).toBe('Game 2 has 9 of 10 picks, so the burn is missing up to 1 champion');
    expect(gapsLine([
      { id: 'g1', gameNumber: 1, picks: 0, missing: 10 },
      { id: 'g2', gameNumber: 2, picks: 0, missing: 10 },
      { id: 'g3', gameNumber: 3, picks: 7, missing: 3 }
    ])).toBe('Games 1 and 2 have no picks and game 3 has 7 of 10 picks, so the burn is missing up to 23 champions');
  });

  it('says nothing without a gap', () => {
    expect(gapsLine([])).toBe('');
  });
});

describe('playedSeats', () => {
  it('keeps each champion in the seat it was entered in, an empty seat as ""', () => {
    expect(playedSeats(['Ornn', '', 'Ahri'])).toEqual(['Ornn', '', 'Ahri', '', '']);
    expect(playedSeats([' Shen ', '   ', undefined, 'Jinx', 'Thresh'])).toEqual(['Shen', '', '', 'Jinx', 'Thresh']);
    expect(playedSeats(undefined)).toEqual(['', '', '', '', '']);
  });

  it('cuts a list longer than five at the fifth seat', () => {
    expect(playedSeats(['Shen', 'Diana', 'Yone', 'Tristana', 'Zilean', 'Extra'])).toEqual(['Shen', 'Diana', 'Yone', 'Tristana', 'Zilean']);
  });
});

describe('playedGameWrite', () => {
  // Paradox Requiem game 1 as it stood on 10 Sep 2026: bans written by the Skip bans test aid, a hold
  // and a pick log from the sequence walked through it, and a replay linked over an earlier board.
  const live: SeriesGame = {
    id: 'g1',
    seriesId: 's-paradox',
    gameNumber: 1,
    ourChampions: ['', 'Diana'],
    theirChampions: [],
    bans: ['Ahri', 'Zed', 'Sylas'],
    ourSide: 'red',
    draftStep: 7,
    holding: 'Yone',
    pickLog: ['our:Jungle'],
    advice: { step: 6, action: 'pick', askedAt: '2026-09-10T18:58:00.000Z' } as SeriesGame['advice'],
    matchId: 'EUW1-7977500462',
    beforeLink: { ourChampions: [], theirChampions: [] },
    order: 3
  };
  const entry = { ourSide: 'blue' as const, ours: ['Shen', 'Diana', 'Yone', 'Tristana', 'Zilean'], theirs: ['Urgot', '', 'Syndra'], win: true };

  it('writes the side, both fives as seats, the result and the step at the end', () => {
    const saved = playedGameWrite(live, entry);
    expect(saved.ourSide).toBe('blue');
    expect(saved.ourChampions).toEqual(['Shen', 'Diana', 'Yone', 'Tristana', 'Zilean']);
    expect(saved.theirChampions).toEqual(['Urgot', '', 'Syndra', '', '']);
    expect(saved.win).toBe(true);
    expect(saved.draftStep).toBe(DRAFT_LENGTH);
  });

  it('clears the hold and the pick log of a sequence that never ran', () => {
    const saved = playedGameWrite(live, entry);
    expect(saved.holding).toBeUndefined();
    expect(saved.pickLog).toBeUndefined();
  });

  it('keeps the bans, the advice, the replay and everything else the dialog does not ask about', () => {
    const saved = playedGameWrite(live, entry);
    expect(saved.bans).toEqual(['Ahri', 'Zed', 'Sylas']);
    expect(saved.advice).toEqual(live.advice);
    expect(saved.matchId).toBe('EUW1-7977500462');
    expect(saved.beforeLink).toEqual({ ourChampions: [], theirChampions: [] });
    expect([saved.id, saved.seriesId, saved.gameNumber, saved.order]).toEqual(['g1', 's-paradox', 1, 3]);
  });

  it('takes the result off when none is given, and cuts a sixth champion', () => {
    const saved = playedGameWrite({ ...live, win: false }, { ...entry, ours: [...entry.ours, 'Extra'], win: undefined });
    expect(saved.win).toBeUndefined();
    expect(saved.ourChampions).toHaveLength(5);
    expect(saved.ourChampions).not.toContain('Extra');
  });

  it('leaves the game it was given untouched', () => {
    playedGameWrite(live, entry);
    expect(live.holding).toBe('Yone');
    expect(live.ourChampions).toEqual(['', 'Diana']);
  });
});

describe('gameAfterPlayed', () => {
  const full = ['Shen', 'Diana', 'Yone', 'Tristana', 'Zilean'];
  const g = (id: string, gameNumber: number, extra: Partial<SeriesGame> = {}) => ({ id, gameNumber, ourChampions: [] as string[], theirChampions: [] as string[], ...extra });

  it('hands the room back to the game it was on when an earlier game was entered from the warning', () => {
    const games = [g('g1', 1, { win: true, draftStep: DRAFT_LENGTH }), g('g2', 2), g('g3', 3)];
    expect(gameAfterPlayed(games, games[0], 'g3')).toEqual({ id: 'g3', back: true });
  });

  it('moves on to the next game still to draft when the game on the clock was entered', () => {
    const games = [g('g1', 1, { win: true, draftStep: DRAFT_LENGTH }), g('g2', 2), g('g3', 3)];
    expect(gameAfterPlayed(games, games[0], 'g1')).toEqual({ id: 'g2', back: false });
  });

  it('skips a later game with a result or a finished board, in game order', () => {
    const games = [
      g('g4', 4),
      g('g1', 1),
      g('g2', 2, { win: false }),
      g('g3', 3, { ourChampions: full, theirChampions: full })
    ];
    expect(gameAfterPlayed(games, games[1], 'g1')).toEqual({ id: 'g4', back: false });
  });

  it('stays on the saved game when nothing after it is left to draft, or the game it came from is gone', () => {
    const games = [g('g1', 1), g('g2', 2, { win: true })];
    expect(gameAfterPlayed(games, games[0], 'g1')).toEqual({ id: 'g1', back: false });
    expect(gameAfterPlayed(games, games[0], 'deleted')).toEqual({ id: 'g1', back: false });
    expect(gameAfterPlayed(games, games[0], '')).toEqual({ id: 'g1', back: false });
  });
});

describe('wilsonLowerBound', () => {
  it('is what a record can support, as a percentage', () => {
    expect(Math.round(wilsonLowerBound(100, 1))).toBe(21);
    expect(Math.round(wilsonLowerBound(83, 6))).toBe(43);
    expect(wilsonLowerBound(83, 6)).toBeGreaterThan(wilsonLowerBound(100, 1));
  });

  it('is nothing with no games, and clamps a rate outside 0–100', () => {
    expect(wilsonLowerBound(100, 0)).toBe(0);
    expect(wilsonLowerBound(100, -3)).toBe(0);
    expect(wilsonLowerBound(150, 4)).toBe(wilsonLowerBound(100, 4));
    expect(wilsonLowerBound(-20, 4)).toBe(0);
  });
});

describe('gameHasContent', () => {
  it('counts a pick, a ban or a result, and not the empty seats a draft leaves', () => {
    expect(gameHasContent({ ourChampions: ['', '', '', '', ''], theirChampions: [], bans: [] })).toBe(false);
    expect(gameHasContent({ ourChampions: ['', 'Vi'], theirChampions: [] })).toBe(true);
    expect(gameHasContent({ ourChampions: [], theirChampions: [], bans: ['Zed'] })).toBe(true);
    expect(gameHasContent({ ourChampions: [], theirChampions: [], win: false })).toBe(true);
  });
});
