import { describe, expect, it } from 'vitest';
import { AnalysisGame, FillIn, LearnEntry, PainPoint, Player, Scrim, SeriesGame, Tournament, TournamentSeries } from '../models/team.models';
import { sameChampion } from './champion-key';
import { buildRoster, cardById, cardByName, poolOf } from './roster-build';
import { RosterInput } from './roster-model';

const NOW = new Date(2026, 8, 13, 14, 0).getTime();

const player = (id: string, name: string, role: Player['role'], order: number, main: string, over: Partial<Player> = {}) =>
  ({ id, name, role, order, top3: [main], strengths: [], weaknesses: [], bans: [], profile: { riotTag: 'EUW' }, ...over }) as unknown as Player;

const players = [
  player('p-adc', 'SkilledScarecrow', 'ADC', 3, 'Jinx', { secondaryRoles: ['Mid'] }),
  player('p-top', 'Zac', 'Top', 0, 'Aatrox', { queueStats: { solo: { rank: { tier: 'GOLD', rank: 'II' } } } as never }),
  player('p-jg', 'Go10x', 'Jungle', 1, 'Vi'),
  player('p-mid', 'Mido', 'Mid', 2, 'Ahri'),
  player('p-sup', 'Suppy', 'Support', 4, 'Leona'),
  player('p-sub', 'Benchy', 'Top', 5, 'Ornn', { sub: true })
];

const tournaments = [{ id: 'cup', name: 'Oryx Fearless', kind: 'tournament', order: 0, startDate: '2026-09-01', active: true }] as unknown as Tournament[];
const series = [{ id: 'a', tournamentId: 'cup', opponent: 'Tidal Wolves', bestOf: 3, order: 0, scheduledAt: '2026-09-06T19:00' }] as unknown as TournamentSeries[];

const THEIR_NAMES = ['RivalTopLaner', 'RivalJungler', 'RivalMid', 'RivalMarksman', 'RivalSupport'];
const seat = (name: string, tag: string, champion: string, team: number, position: string, kills: number, deaths: number, assists: number, damage: number) => ({
  name, tag, champion, team, win: team === 100, position, kills, deaths, assists, gold: 10_000, damage, damageToBuildings: 0, damageTaken: 15_000, visionScore: 20, cs: 180
});
/** A replay whose file spells our marksman in lower case, as a client can. */
const replay = (id: string, playedOn: string): Scrim =>
  ({
    id, playedOn, durationSec: 1700, blueWon: true, order: 0, ourSide: 'blue', opponent: 'Tidal Wolves',
    players: [
      seat('Zac', 'EUW', 'Aatrox', 100, 'TOP', 2, 2, 5, 12_000),
      seat('Go10x', 'EUW', 'Vi', 100, 'JUNGLE', 3, 2, 9, 10_000),
      seat('Mido', 'EUW', 'Ahri', 100, 'MIDDLE', 4, 2, 6, 15_000),
      seat('skilledscarecrow', 'EUW', 'MissFortune', 100, 'BOTTOM', 12, 1, 5, 32_000),
      seat('Suppy', 'EUW', 'Leona', 100, 'UTILITY', 1, 3, 14, 5_000),
      ...THEIR_NAMES.map((n, k) => seat(n, 'RIV', ['Renekton', 'Lee Sin', 'Syndra', 'Kaisa', 'Nautilus'][k], 200, ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'][k], 2, 4, 3, 9_000))
    ]
  }) as unknown as Scrim;

const seriesGame = (id: string, gameNumber: number, win: boolean, matchId?: string) =>
  ({ id, seriesId: 'a', gameNumber, win, ourSide: 'blue', ourChampions: [], theirChampions: [], ...(matchId ? { matchId } : {}) }) as unknown as SeriesGame;

const flex = (matchId: string, date: string, win: boolean): AnalysisGame =>
  ({
    matchId, compId: null, compName: null, win, queue: 'Flex', date: Date.parse(date), side: 'red', durationSec: 1900,
    players: [
      { name: 'Zac', position: 'TOP', champion: 'Aatrox', kills: 2, deaths: 3, assists: 4, cs: 220, damage: 14_000, killParticipation: 0.4 },
      { name: 'SkilledScarecrow', position: 'BOTTOM', champion: 'Jinx', kills: 6, deaths: 2, assists: 6, cs: 260, damage: 24_000, killParticipation: 0.6 }
    ],
    enemies: [{ position: 'TOP', champion: 'Renekton' }],
    kills: { ours: 18, theirs: 11 }
  }) as unknown as AnalysisGame;

const fillIn = { id: 'f1', summoner: 'Ringer', status: 'On call', preferredRoles: ['Mid', 'Support', 'Nope'], order: 0, riot: { top3: ['Syndra'], refreshedAt: '2026-09-01', queueStats: { flex: { rank: { tier: 'PLATINUM', rank: 'IV' } } } } } as unknown as FillIn;
const pains = [
  { id: 'pp2', playerId: 'p-adc', text: 'Ward river at 3:15', resolved: false, order: 2 },
  { id: 'pp1', playerId: 'p-adc', text: 'Wave before roam', resolved: false, order: 1 },
  { id: 'pp3', playerId: 'p-adc', text: 'Flash timers', resolved: true, order: 3 }
] as PainPoint[];
const learning = [
  { id: 'l1', playerId: 'p-adc', champion: 'Kaisa', priority: 'low', status: 'learning', order: 0 },
  { id: 'l2', playerId: 'p-adc', champion: 'Ezreal', priority: 'high', status: 'ready', order: 1 },
  { id: 'l3', playerId: 'p-adc', champion: 'Xayah', priority: 'high', status: 'learning', order: 2 }
] as LearnEntry[];

const input = (over: Partial<RosterInput> = {}): RosterInput => ({
  now: NOW,
  mode: 'all',
  players,
  fillIns: [fillIn],
  painPoints: pains,
  learnEntries: learning,
  comps: [],
  analysis: [flex('EUW_1', '2026-09-03T20:00:00Z', true), flex('EUW_2', '2026-09-08T20:00:00Z', false), flex('EUW_0', '2026-07-01T20:00:00Z', true)],
  tournaments,
  series,
  seriesGames: [seriesGame('a1', 1, true, 'r-1'), seriesGame('a2', 2, true, 'r-2')],
  scrims: [replay('r-1', '2026-09-06T19:40:00Z'), replay('r-2', '2026-09-06T20:30:00Z')],
  practice: new Set(),
  compOverride: () => '',
  ...over
});

describe('buildRoster', () => {
  it('never carries a name of theirs, though the replays it reads do', () => {
    const text = JSON.stringify(buildRoster(input()));
    for (const name of THEIR_NAMES) expect(text).not.toContain(name);
    expect(text).not.toContain('RIV');
    expect(text).not.toContain('puuid');
  });

  it('seats the five in lane order, the bench apart, and a fill-in as a player of their first real seat', () => {
    const m = buildRoster(input());
    expect(m.starters.map((c) => c.name)).toEqual(['Zac', 'Go10x', 'Mido', 'SkilledScarecrow', 'Suppy']);
    expect(m.bench.map((c) => c.id)).toEqual(['p-sub']);
    expect(m.fillIns[0]).toMatchObject({ id: 'fill-f1', group: 'fillIns', fillInId: 'f1', fillInStatus: 'On call', role: 'Mid', secondaryRoles: ['Support'], rank: { label: 'Platinum IV', queue: 'Flex' }, form: [], titles: 0 });
    expect(m.fillIns[0].playerId).toBeUndefined();
    expect(cardById(m, 'p-top')?.rank).toEqual({ label: 'Gold II', queue: 'Solo' });
    expect(cardByName(m, 'skilledSCARECROW')?.id).toBe('p-adc');
  });

  it('reads every game of theirs under any spelling: record, form newest first, and the splash they play most', () => {
    const adc = cardById(buildRoster(input()), 'p-adc')!;
    // Three flex games and two tournament games from replays that spell the name in lower case.
    expect(adc).toMatchObject({ games: 5, wins: 4, winRate: 80, band: 'is-good' });
    expect(adc.form).toEqual(['L', 'W', 'W', 'W', 'W']);
    expect(adc.champion).toBe('Jinx');
    expect(adc.stats?.statGames).toBe(5);
  });

  it('leaves practice out, and the season scope out of an old game', () => {
    const practice = buildRoster(input({ practice: new Set(['EUW_2']) }));
    expect(cardById(practice, 'p-top')).toMatchObject({ games: 4, wins: 4 });
    const season = buildRoster(input({ mode: 'season' }));
    expect(cardById(season, 'p-top')?.games).toBe(4);
    expect(season.games).toBe(4);
  });

  it('crowns the player with the most series MVP titles, and shares the crown on a tie', () => {
    const m = buildRoster(input());
    expect(m.mostTitles).toBe(1);
    expect(m.starters.filter((c) => c.crowned).map((c) => c.id)).toEqual(['p-adc']);
    expect(cardById(m, 'p-adc')).toMatchObject({ titles: 1, lastTitle: { opponent: 'Tidal Wolves', champion: 'MissFortune' } });
    expect(buildRoster(input({ seriesGames: [], scrims: [] })).starters.some((c) => c.crowned)).toBe(false);
  });

  it('lists the pool as played most first with its record, then what was written down and never played', () => {
    const adc = cardById(buildRoster(input()), 'p-adc')!;
    expect(adc.pool.map((e) => [e.champion, e.games, e.winRate, e.declared])).toEqual([
      ['Jinx', 3, 67, true],
      ['MissFortune', 2, 100, false]
    ]);
    const declaredOnly = poolOf({ top3: ['Miss Fortune', 'Caitlyn'] }, { champions: [{ champion: 'MissFortune', games: 2, wins: 1 }] } as never);
    expect(declaredOnly.map((e) => [e.champion, e.declared, e.winRate, e.band])).toEqual([
      ['MissFortune', true, 50, 'is-even'],
      ['Caitlyn', true, null, '']
    ]);
  });

  it('carries what they are working on in order, what is resolved, and learning before ready by priority', () => {
    const adc = cardById(buildRoster(input()), 'p-adc')!;
    expect(adc.working.map((w) => w.text)).toEqual(['Wave before roam', 'Ward river at 3:15']);
    expect(adc.resolved).toBe(1);
    expect(adc.learning.map((l) => l.champion)).toEqual(['Xayah', 'Kaisa', 'Ezreal']);
  });

  it('draws the seed as empties: every starter, no record, no form, the pool from the roster', () => {
    const m = buildRoster(input({ analysis: [], seriesGames: [], scrims: [], series: [], painPoints: [], learnEntries: [], fillIns: [] }));
    expect(m.starters).toHaveLength(5);
    expect(m.starters.every((c) => c.winRate === null && c.form.length === 0 && c.band === '')).toBe(true);
    expect(cardById(m, 'p-mid')).toMatchObject({ champion: 'Ahri', pool: [{ champion: 'Ahri', games: 0, declared: true }] });
    expect(m.fillIns).toEqual([]);
  });
});

describe('sameChampion', () => {
  it('matches a Riot id to a display name, the renamed ids included, and nothing blank', () => {
    expect(sameChampion('MissFortune', 'Miss Fortune')).toBe(true);
    expect(sameChampion('MonkeyKing', 'Wukong')).toBe(true);
    expect(sameChampion('Chogath', "Cho'Gath")).toBe(true);
    expect(sameChampion('Nunu', 'Nunu & Willump')).toBe(true);
    expect(sameChampion('Jinx', 'Jhin')).toBe(false);
    expect(sameChampion('', '')).toBe(false);
  });
});
