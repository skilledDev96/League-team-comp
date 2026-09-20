import { describe, expect, it } from 'vitest';
import { ChampionTraits, Comp, CompResult, GameReview, Play, Player } from '../models/team.models';
import { GameRow } from '../pages/games/game-rows';
import { compIconFor } from './comp-identity';
import { buildComps, championsOf, CompsInput, coverOf, faceOf, reviewedOf, sheetAfterIndex } from './comps-build';

const player = (id: string, name: string, role: Player['role'], order: number, over: Partial<Player> = {}) =>
  ({ id, name, role, order, top3: [], strengths: [], weaknesses: [], bans: [], ...over }) as unknown as Player;

const players = [
  player('p-adc', 'SkilledScarecrow', 'ADC', 3, { secondaryRoles: ['Mid'] }),
  player('p-top', 'Zac', 'Top', 0),
  player('p-jg', 'Go10x', 'Jungle', 1),
  player('p-mid', 'Mido', 'Mid', 2),
  player('p-sup', 'Suppy', 'Support', 4)
];

const c1: Comp = { id: 'c1', name: 'Front to back', picks: { Top: 'Ornn', Jungle: 'Trundle - peel', Mid: 'Orianna', ADC: 'Jinx', Support: 'Leona' }, order: 0, notes: 'Group at 14', bans: ['Zed'] };
const c2: Comp = { id: 'c2', name: 'Dive', picks: { Top: 'Camille', Jungle: 'Vi', Mid: 'Akali', ADC: 'Kaisa', Support: 'Nautilus' }, category: 'Meta', order: 2, countsUnder: 'c1' };
const c3: Comp = { id: 'c3', name: 'Half built', picks: { Top: 'Sett', Jungle: '', Mid: 'Ahri', ADC: '', Support: '' }, category: ' Comfort ', order: 1 };
/**
 * The lead's own example (20 Sep 2026): "the dive comp has naut a priority but Leona can also be added as a
 * secondary pick". Gwen sits behind Camille with a note, and a fallback is parked on an empty seat to prove the
 * invariant is read here too.
 */
const dive: Comp = {
  id: 'c4',
  name: 'Naut dive',
  order: 3,
  picks: { Top: 'Camille', Jungle: 'Vi', Mid: '', ADC: 'Kaisa', Support: 'Nautilus' },
  fallbacks: { Top: ['Gwen - into ranged'], Jungle: ['Wukong'], Mid: ['Sylas'], Support: ['Leona - if Naut is gone'] }
};

/** A row with our five and their five on it, the way the games page carries them. */
const row = (id: string, date: number, win: boolean, compId?: string, matchId?: string): GameRow =>
  ({
    id,
    source: 'riot',
    label: 'Flex',
    date,
    win,
    ours: players.map((p) => ({ player: p.name, role: p.role, champion: 'Ahri' })),
    theirs: ['RivalTop', 'RivalJungle', 'RivalMid', 'RivalAdc', 'RivalSupport'].map((name) => ({ player: name, role: 'Top', champion: 'Sion' })),
    ...(compId ? { compId, compName: compId } : {}),
    ...(matchId ? { matchId } : {})
  }) as unknown as GameRow;

/** A row carrying exactly these champions of ours; an empty list is a game typed in without its ten. */
const ourRow = (id: string, date: number, win: boolean, compId: string, champions: string[]): GameRow =>
  ({ ...row(id, date, win, compId), ours: champions.map((champion, k) => ({ player: players[k]?.name ?? null, role: '', champion })) }) as unknown as GameRow;

const rows = [row('r1', 300, true, 'c1', 'EUW_1'), row('r2', 200, false, 'c1', 'EUW_2'), row('r3', 100, true, 'c1', 'EUW_3'), row('r4', 250, true, 'c2', 'EUW_4'), row('r5', 400, false), row('r6', 50, true, 'gone', 'EUW_6')];
const results: CompResult[] = [
  { id: 'x1', compId: 'c1', outcome: 'win', playedOn: '2026-09-01', order: 1 },
  { id: 'x2', compId: 'c1', outcome: 'loss', playedOn: '2026-09-02', order: 2 }
];
const plays = [{ id: 'pl1', compId: 'c1', title: 'Dragon dive', phase: 'mid', tokens: [], order: 0 }] as unknown as Play[];
const reviews = [
  { matchId: 'EUW_1', compId: 'c1', team: { compVerdict: 'as drafted', compWhy: '' } },
  { matchId: 'EUW_2', compId: 'c1', team: { compVerdict: 'off plan', compWhy: 'Split instead of grouping' } },
  { matchId: 'EUW_4', compId: 'c2', team: { compVerdict: 'unclear', compWhy: '' } }
] as unknown as GameReview[];
/** Five traits that read as a teamfight comp for whichever comp they are handed: layered CC over two bodies. */
const traits = (n: number): ChampionTraits[] =>
  Array.from({ length: n }, (_, k) => ({ id: `t${k}`, name: `T${k}`, damage: k % 2 ? 'magic' : 'physical', attack: k < 2 ? 'ranged' : 'melee', roles: k === 1 ? ['marksman'] : ['tank'], cc: 2, mobility: 1, durability: k < 2 ? 1 : 2, utility: 1 })) as unknown as ChampionTraits[];

const input = (over: Partial<CompsInput> = {}): CompsInput => ({
  comps: [c1, c2, c3],
  compResults: results,
  plays,
  players,
  gameReviews: reviews,
  rows,
  matchNote: (id) => (id === 'EUW_2' ? 'Lost the 20-minute fight' : ''),
  traitsOf: (c) => traits(c.id === 'c3' ? 2 : 5),
  junglerIdOf: () => undefined,
  ...over
});

describe('buildComps', () => {
  it('keeps the comps in their order, with five seats, who covers each, and the shape', () => {
    const m = buildComps(input());
    expect(m.cards.map((c) => c.id)).toEqual(['c1', 'c3', 'c2']);
    const [front] = m.cards;
    expect(front.seats.map((s) => s.champion)).toEqual(['Ornn', 'Trundle', 'Orianna', 'Jinx', 'Leona']);
    expect(front.seats[1].note).toBe('peel');
    expect(front.seats[2].cover).toEqual([{ name: 'Mido', flex: false }, { name: 'SkilledScarecrow', flex: true }]);
    expect(front.complete).toBe(true);
    expect(front.icon).toBe(compIconFor(traits(5), 'Front to back'));
    expect(front.identity).toBe('teamfight');
    const half = m.cards[1];
    expect(half).toMatchObject({ filled: 2, complete: false, identity: 'unclear', identityLabel: 'Building', category: 'Comfort' });
    expect(m.categories).toEqual(['Comfort', 'Meta']);
  });

  it('counts a comp from the rows placed under it, newest first, and lets a logged record head the played one', () => {
    const m = buildComps(input());
    const [front, , dive] = m.cards;
    expect(front.played).toEqual({ games: 3, wins: 2, losses: 1, winRate: 67, form: ['W', 'L', 'W'], lastPlayed: 300, onFallback: 0 });
    expect(front.logged).toMatchObject({ games: 2, wins: 1, losses: 1, winRate: 50 });
    expect(front.logged?.results.map((r) => r.id)).toEqual(['x2', 'x1']);
    expect(front.headline).toEqual({ games: 2, wins: 1, losses: 1, winRate: 50, band: 'is-even', source: 'logged' });
    expect(dive.headline).toEqual({ games: 1, wins: 1, losses: 0, winRate: 100, band: 'is-good', source: 'played' });
    expect(m.cards[1].headline).toBeNull();
    expect(m.onRecord).toBe(4);
  });

  it('knows which comps count under which, the reviews and the notes of a comp’s games, and nothing of theirs', () => {
    const m = buildComps(input());
    const [front, , dive] = m.cards;
    expect(front.variants).toEqual([{ id: 'c2', name: 'Dive' }]);
    expect(dive.countsUnderName).toBe('Front to back');
    expect(front.reviewed).toEqual({ reviewed: 2, asDrafted: 1, offPlan: 1, unclear: 0, offPlanWhy: ['Split instead of grouping'] });
    expect(dive.reviewed).toEqual({ reviewed: 1, asDrafted: 0, offPlan: 0, unclear: 1, offPlanWhy: [] });
    expect(front.gameNotes).toEqual([{ matchId: 'EUW_2', text: 'Lost the 20-minute fight', win: false, date: 200 }]);
    expect(front.plays.map((p) => p.id)).toEqual(['pl1']);
    expect(JSON.stringify(m)).not.toMatch(/Rival/);
  });

  it('counts a review only when it names the comp: the Aphelios comp · Braum case from the audit reads nothing', () => {
    // Snapshot 13 Sep 2026: EUW1_7965177150 sits under comp-bd0dfea4 (Aphelios comp · Braum), and its only
    // review has compId null. The sheet printed "Played out as drafted in 0 of 1 reviewed game, unclear in 1."
    const braum: Comp = { id: 'comp-bd0dfea4', name: 'Aphelios comp · Braum', picks: { Top: 'Heimerdinger', Jungle: 'Vi', Mid: 'Anivia', ADC: 'Aphelios', Support: 'Braum' }, order: 19 };
    const played = [row('g1', 100, false, 'comp-bd0dfea4', 'EUW1_7965177150')];
    const review = { matchId: 'EUW1_7965177150', compId: null, team: { compVerdict: 'unclear', compWhy: 'No named comp was declared, but the Heimerdinger-Anivia zone core…' } } as unknown as GameReview;
    expect(reviewedOf(braum.id, [braum], played, [review])).toBeNull();
    expect(buildComps(input({ comps: [braum], rows: played, gameReviews: [review] })).cards[0].reviewed).toBeNull();
    // Another comp's review of the same game says nothing about this one either.
    expect(reviewedOf(braum.id, [braum, c1], played, [{ ...review, compId: 'c1' } as GameReview])).toBeNull();
    // Named, it counts; and a review naming a variant counts under the comp the variant counts under.
    expect(reviewedOf(braum.id, [braum], played, [{ ...review, compId: braum.id } as GameReview])).toMatchObject({ reviewed: 1, unclear: 1 });
    expect(reviewedOf('c1', [c1, c2], [row('g2', 100, true, 'c1', 'EUW_9')], [{ matchId: 'EUW_9', compId: 'c2', team: { compVerdict: 'as drafted', compWhy: '' } } as unknown as GameReview])).toMatchObject({ reviewed: 1, asDrafted: 1 });
  });

  it('picks the face: the champion the name names, else the seat the shape turns on, else the first filled', () => {
    const seats = buildComps(input()).cards[2].seats;
    expect(faceOf({ seats, name: 'Kaisa protect', identity: 'protect' })).toBe('Kaisa');
    // "Vi" is not read into "Dive"; the shape decides, and dive turns on the jungler.
    expect(faceOf({ seats, name: 'Dive', identity: 'dive' })).toBe('Vi');
    expect(faceOf({ seats, name: 'Divers', identity: 'protect' })).toBe('Kaisa');
    expect(faceOf({ seats, name: 'Whatever', identity: 'unclear' })).toBe('Akali');
    const half = buildComps(input()).cards[1].seats;
    expect(faceOf({ seats: half, name: 'Half built', identity: 'dive' })).toBe('Sett');
    expect(faceOf({ seats: half.map((s) => ({ ...s, champion: '' })), name: 'Empty', identity: 'unclear' })).toBeNull();
  });

  it('puts the sheet after the last cell of the row holding the tile, and after the last cell of all on a short last row', () => {
    expect([0, 1, 2, 3].map((i) => sheetAfterIndex(i, 4, 7))).toEqual([3, 3, 3, 3]);
    expect([4, 5, 6].map((i) => sheetAfterIndex(i, 4, 7))).toEqual([6, 6, 6]);
    expect(sheetAfterIndex(4, 2, 5)).toBe(4);
    expect(sheetAfterIndex(0, 0, 1)).toBe(0);
  });

  it('lists a seat’s cover main first and the champions a card holds', () => {
    expect(coverOf(players, 'Mid').map((c) => c.name)).toEqual(['Mido', 'SkilledScarecrow']);
    expect(coverOf(players, 'Support')).toEqual([{ name: 'Suppy', flex: false }]);
    expect(championsOf(buildComps(input()).cards[1])).toEqual(['Sett', 'Ahri']);
  });

  it('carries what each seat can play behind its priority, and holds nothing on a seat with no priority', () => {
    const [card] = buildComps(input({ comps: [dive], rows: [] })).cards;
    const seat = (role: string) => card.seats.find((s) => s.role === role)!;
    // The priority is exactly what `champion` and `note` have always been, and options[0] is the same entry.
    expect(seat('Support').champion).toBe('Nautilus');
    expect(seat('Support').options).toEqual([
      { champion: 'Nautilus', note: '' },
      { champion: 'Leona', note: 'if Naut is gone' }
    ]);
    expect(seat('Top').options.map((o) => o.champion)).toEqual(['Camille', 'Gwen']);
    // Mid holds Sylas in the document and no priority: the seat reads empty, and empty means empty.
    expect(seat('Mid')).toMatchObject({ champion: '', options: [] });
    // What the comp *fields* is unchanged: four seats filled, so it is still building.
    expect(card.filled).toBe(4);
    expect(card.complete).toBe(false);
    expect(card.seats.map((s) => s.champion)).toEqual(['Camille', 'Vi', '', 'Kaisa', 'Nautilus']);
  });

  it('answers the champion filter with every option, so a comp keeping Leona in reserve is one of its comps', () => {
    const cards = buildComps(input({ comps: [c1, dive], rows: [] })).cards;
    expect(championsOf(cards[1])).toEqual(['Camille', 'Gwen', 'Vi', 'Wukong', 'Kaisa', 'Nautilus', 'Leona']);
    // c1 fields Leona, the dive comp keeps her behind Nautilus: the page counts two comps with Leona.
    expect(cards.filter((c) => championsOf(c).includes('Leona')).map((c) => c.id)).toEqual(['c1', 'c4']);
    // A champion in nobody's seat is still in nobody's.
    expect(cards.filter((c) => championsOf(c).includes('Yuumi'))).toEqual([]);
  });

  it('lets the name name a fallback, and still puts one of the five it fields on the tile', () => {
    const seats = buildComps(input({ comps: [dive], rows: [] })).cards[0].seats;
    // Named after a priority: unchanged.
    expect(faceOf({ seats, name: 'Camille split', identity: 'unclear' })).toBe('Camille');
    // Named after the champion it keeps in reserve: that seat wins, and its *priority* is the face, because
    // a splash of a champion missing from the five icons would read as a mistake.
    expect(faceOf({ seats, name: 'Leona dive', identity: 'protect' })).toBe('Nautilus');
    expect(faceOf({ seats, name: 'Gwen split', identity: 'protect' })).toBe('Camille');
    // A name that names an earlier seat's fallback *and* a later seat's priority: the seat that actually fields
    // the champion wins, wherever it sits. Matching every option in one pass let Top's Gwen beat Support's
    // Nautilus on seat order alone, and an existing comp's splash changed under it.
    expect(faceOf({ seats, name: 'Gwen Nautilus dive', identity: 'split' })).toBe('Nautilus');
  });

  it('does not read a champion that is another seat’s priority as a fallback of the comp', () => {
    // comp-seats refuses a champion already in another seat on the *write* path; this read is written to survive
    // a hand-edited or pasted document, where Top can be the Leona Support keeps in reserve. Every Leona game is
    // then a game on the priority, and the receipt must not read "1 game · 1 on a fallback" for it.
    const crossed: Comp = {
      id: 'c5',
      name: 'Pasted',
      order: 4,
      picks: { Top: 'Leona', Jungle: 'Vi', Mid: 'Ahri', ADC: 'Kaisa', Support: 'Nautilus' },
      fallbacks: { Support: ['Leona'] }
    };
    const played = [ourRow('x1', 100, true, 'c5', ['Leona', 'Vi', 'Ahri', 'Kaisa', 'Nautilus'])];
    const [card] = buildComps(input({ comps: [crossed], rows: played, compResults: [], gameReviews: [] })).cards;
    expect(card.played).toMatchObject({ games: 1, onFallback: 0 });
  });

  it('counts the games fielded on a fallback, and cannot count one that carries no champions of ours', () => {
    const played = [
      ourRow('f1', 400, true, 'c4', ['Camille', 'Vi', 'Ahri', 'Kaisa', 'Leona']),
      ourRow('f2', 300, false, 'c4', ['Camille', 'Vi', 'Ahri', 'Kaisa', 'Nautilus']),
      // A tournament game typed in without its ten: `ours` is empty, so nothing says which way it went.
      ourRow('f3', 200, true, 'c4', []),
      // The replay spells him MonkeyKing and the seat says Wukong; one champion, one answer.
      ourRow('f4', 100, true, 'c4', ['Camille', 'MonkeyKing', 'Ahri', 'Kaisa', 'Nautilus'])
    ];
    const [card] = buildComps(input({ comps: [dive], rows: played, compResults: [], gameReviews: [] })).cards;
    expect(card.played).toMatchObject({ games: 4, wins: 3, losses: 1, onFallback: 2 });
    // The headline is untouched by the receipt.
    expect(card.headline).toEqual({ games: 4, wins: 3, losses: 1, winRate: 75, band: 'is-good', source: 'played' });

    // A comp holding no fallbacks can have no game on one, however its games were played.
    const plain = buildComps(input({ comps: [c1], rows: [ourRow('p1', 100, true, 'c1', ['Ornn', 'Trundle', 'Orianna', 'Jinx', 'Leona'])], compResults: [], gameReviews: [] })).cards[0];
    expect(plain.played).toMatchObject({ games: 1, onFallback: 0 });
  });
});
