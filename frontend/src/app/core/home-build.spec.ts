import { describe, expect, it } from 'vitest';
import { AnalysisGame, Player, Scrim, SeriesGame, Tournament, TournamentSeries } from '../models/team.models';
import { buildHome } from './home-build';
import { HomeInput } from './home-model';

const NOW = new Date(2026, 8, 13, 14, 0).getTime();

const player = (id: string, name: string, role: Player['role'], order: number, main: string, over: Partial<Player> = {}) =>
  ({ id, name, role, order, top3: [main], profile: { riotTag: 'EUW' }, ...over }) as unknown as Player;

const players = [
  player('p-top', 'Zac', 'Top', 0, 'Aatrox'),
  player('p-jg', 'Go10x', 'Jungle', 1, 'Vi'),
  player('p-mid', 'Mido', 'Mid', 2, 'Ahri'),
  player('p-adc', 'SkilledScarecrow', 'ADC', 3, 'Jinx'),
  player('p-sup', 'Suppy', 'Support', 4, 'Leona'),
  player('p-sub', 'Benchy', 'Top', 5, 'Ornn', { sub: true })
];

const tournaments = [
  { id: 'cup', name: 'Oryx Fearless', kind: 'tournament', order: 0, startDate: '2026-09-01', active: true },
  { id: 'scrims', name: 'Scrims', kind: 'scrims', order: 1 }
] as unknown as Tournament[];

const series = [
  { id: 'a', tournamentId: 'cup', opponent: 'Tidal Wolves', bestOf: 3, order: 0, scheduledAt: '2026-09-06T19:00' },
  { id: 'b', tournamentId: 'cup', opponent: 'Iron Owls', bestOf: 3, order: 1, scheduledAt: '2026-09-20T19:30' }
] as unknown as TournamentSeries[];

/** The other side's Riot ids, which a replay file carries and the home page must never print. */
const THEIR_NAMES = ['RivalTopLaner', 'RivalJungler', 'RivalMid', 'RivalMarksman', 'RivalSupport'];

const seat = (name: string, tag: string, champion: string, team: number, position: string, kills: number, deaths: number, assists: number, damage: number) => ({
  name, tag, champion, team, win: team === 100, position, kills, deaths, assists, gold: 10_000, damage, damageToBuildings: 0, damageTaken: 15_000, visionScore: 20, cs: 180
});

const replay = (id: string, playedOn: string): Scrim =>
  ({
    id,
    playedOn,
    durationSec: 1700,
    blueWon: true,
    order: 0,
    ourSide: 'blue',
    opponent: 'Tidal Wolves',
    players: [
      seat('Zac', 'EUW', 'Aatrox', 100, 'TOP', 2, 2, 5, 12_000),
      seat('Go10x', 'EUW', 'Vi', 100, 'JUNGLE', 3, 2, 9, 10_000),
      seat('Mido', 'EUW', 'Ahri', 100, 'MIDDLE', 4, 2, 6, 15_000),
      seat('SkilledScarecrow', 'EUW', 'Jinx', 100, 'BOTTOM', 12, 1, 5, 32_000),
      seat('Suppy', 'EUW', 'Leona', 100, 'UTILITY', 1, 3, 14, 5_000),
      seat(THEIR_NAMES[0], 'RIV', 'Renekton', 200, 'TOP', 1, 4, 2, 9_000),
      seat(THEIR_NAMES[1], 'RIV', 'Lee Sin', 200, 'JUNGLE', 2, 5, 3, 8_000),
      seat(THEIR_NAMES[2], 'RIV', 'Syndra', 200, 'MIDDLE', 3, 4, 2, 14_000),
      seat(THEIR_NAMES[3], 'RIV', 'Kaisa', 200, 'BOTTOM', 4, 5, 1, 16_000),
      seat(THEIR_NAMES[4], 'RIV', 'Nautilus', 200, 'UTILITY', 0, 4, 6, 4_000)
    ]
  }) as unknown as Scrim;

const seriesGame = (id: string, seriesId: string, gameNumber: number, win: boolean, matchId?: string) =>
  ({ id, seriesId, gameNumber, win, ourSide: 'blue', ourChampions: [], theirChampions: [], ...(matchId ? { matchId } : {}) }) as unknown as SeriesGame;

const flex = (matchId: string, date: string, win: boolean, carry = 'Go10x'): AnalysisGame =>
  ({
    matchId,
    compId: null,
    compName: null,
    win,
    queue: 'Flex',
    date: Date.parse(date),
    side: 'red',
    durationSec: 1900,
    players: [
      { name: 'Zac', position: 'TOP', champion: 'Aatrox', kills: 2, deaths: 3, assists: 4, cs: 220, damage: 14_000, killParticipation: 0.4 },
      { name: 'Go10x', position: 'JUNGLE', champion: 'Vi', kills: carry === 'Go10x' ? 11 : 2, deaths: 1, assists: 9, cs: 170, damage: carry === 'Go10x' ? 30_000 : 9_000, killParticipation: 0.8 }
    ],
    enemies: [{ position: 'TOP', champion: 'Renekton' }, { position: 'JUNGLE', champion: 'Lee Sin' }],
    kills: { ours: 18, theirs: 11 }
  }) as unknown as AnalysisGame;

const input = (over: Partial<HomeInput> = {}): HomeInput => ({
  now: NOW,
  hour: 14,
  mode: 'season',
  seatDismissed: false,
  teamName: 'Bom Squad',
  players,
  comps: [],
  analysis: [flex('EUW_1', '2026-09-03T20:00:00Z', true), flex('EUW_2', '2026-09-08T20:00:00Z', false), flex('EUW_0', '2026-07-01T20:00:00Z', true)],
  tournaments,
  series,
  seriesGames: [seriesGame('a1', 'a', 1, true, 'r-1'), seriesGame('a2', 'a', 2, true, 'r-2')],
  scrims: [replay('r-1', '2026-09-06T19:40:00Z'), replay('r-2', '2026-09-06T20:30:00Z')],
  practice: new Set(),
  compOverride: () => '',
  ...over
});

describe('buildHome', () => {
  it('never carries a name of theirs, though the replays it reads do', () => {
    const text = JSON.stringify(buildHome(input()));
    for (const name of THEIR_NAMES) expect(text).not.toContain(name);
    expect(text).not.toContain('RIV');
    expect(text).not.toContain('puuid');
  });

  it('puts the last series MVP in the spotlight and on the race, with the opponent as a team name', () => {
    const home = buildHome(input());
    expect(home.spotlight).toMatchObject({ kind: 'series', playerId: 'p-adc', name: 'SkilledScarecrow', champion: 'Jinx', opponent: 'Tidal Wolves', result: 'won', score: { wins: 2, losses: 0 }, titles: 1, read: 2, of: 2 });
    expect(home.race.entries[0]).toMatchObject({ playerId: 'p-adc', titles: 1 });
    expect(home.race.last).toMatchObject({ seriesId: 'a', name: 'SkilledScarecrow', champion: 'Jinx', opponent: 'Tidal Wolves' });
    expect(home.race.podium.map((p) => [p.place, p.entry.playerId])).toEqual([[1, 'p-adc']]);
    expect(home.race.waitingOn).toBeUndefined();
    expect(home.lineup.filter((c) => c.crowned).map((c) => c.playerId)).toEqual(['p-adc']);
  });

  it('names the next series, counting down only to a kick-off with a time of day', () => {
    const home = buildHome(input());
    expect(home.next).toMatchObject({ seriesId: 'b', opponent: 'Iron Owls', tournament: 'Oryx Fearless', bestOf: 3, at: Date.parse('2026-09-20T19:30'), when: '2026-09-20T19:30' });
    const dayOnly = series.map((s) => (s.id === 'b' ? { ...s, scheduledAt: '2026-09-20' } : s));
    expect(buildHome(input({ series: dayOnly })).next).toMatchObject({ at: null, when: '2026-09-20' });
    const freeText = series.map((s) => (s.id === 'b' ? { ...s, scheduledAt: 'Sunday evening' } : s));
    expect(buildHome(input({ series: freeText })).next).toMatchObject({ at: null, when: 'Sunday evening' });
  });

  it('counts the season as the running tournament, and everything on All time', () => {
    const season = buildHome(input());
    expect(season.season).toMatchObject({ label: 'Oryx Fearless', tournamentId: 'cup' });
    expect(season.record.counters).toMatchObject({ games: 4, wins: 3, losses: 1, seriesWon: 1, seriesPlayed: 1 });
    const all = buildHome(input({ mode: 'all' }));
    expect(all.record.counters).toMatchObject({ games: 5, wins: 4, losses: 1 });
    expect(all.record.segments.map((s) => s.key)).toEqual(['wins', 'losses']);
  });

  it('leaves a practice-tagged game out of every count', () => {
    const home = buildHome(input({ practice: new Set(['EUW_2']) }));
    expect(home.record.counters).toMatchObject({ games: 3, losses: 0 });
    expect(home.trend.points).toHaveLength(3);
  });

  it('greets the starter in the reader seat, and asks for a seat until told not to', () => {
    expect(buildHome(input({ seat: 'Jungle' })).welcome).toMatchObject({ greeting: 'Afternoon, Go10x', needsSeat: false, player: { id: 'p-jg' } });
    expect(buildHome(input()).welcome).toMatchObject({ greeting: 'Afternoon', needsSeat: true });
    expect(buildHome(input({ seatDismissed: true })).welcome.needsSeat).toBe(false);
  });

  it('shows the most game MVPs this season when no series has crowned anyone', () => {
    const home = buildHome(input({ seriesGames: [], scrims: [] }));
    expect(home.race.last).toBeNull();
    expect(home.spotlight).toMatchObject({ kind: 'games', playerId: 'p-jg', name: 'Go10x', champion: 'Vi', mvps: 2, of: 2 });
  });

  it('says which finished series is still waiting on its replays', () => {
    const typedIn = [seriesGame('a1', 'a', 1, true), seriesGame('a2', 'a', 2, true)];
    const home = buildHome(input({ seriesGames: typedIn, scrims: [] }));
    expect(home.race.last).toBeNull();
    expect(home.race.waitingOn).toBe('Tidal Wolves');
    expect(home.race.finished).toBe(1);
  });

  it('puts the trophies entered by hand newest first, named by their tournament, and marks the ones this season', () => {
    const trophies = [
      { id: 't-old', title: 'Clash cup', event: 'Clash — May', date: '2026-05-10', order: 0 },
      { id: 't-new', title: 'Split 2 group winners', placement: 1, tournamentId: 'cup', date: '2026-09-07', champion: 'Jinx', order: 1 },
      { id: 't-undated', title: 'Founders', order: 2 }
    ];
    const home = buildHome(input({ trophies }));
    expect(home.handTrophies.map((t) => [t.id, t.where ?? '', t.thisSeason])).toEqual([
      ['t-new', 'Oryx Fearless', true],
      ['t-old', 'Clash — May', false],
      ['t-undated', '', false]
    ]);
    expect(home.handTrophies[0]).toMatchObject({ placement: 1, champion: 'Jinx', at: new Date(2026, 8, 7).getTime() });
    expect(buildHome(input({ trophies, mode: 'all' })).handTrophies.every((t) => t.thisSeason)).toBe(true);
    expect(buildHome(input()).handTrophies).toEqual([]);
  });

  it('carries the motto and the banner, trimmed, with the base skin as no skin at all', () => {
    expect(buildHome(input({ motto: '  Draft it, then play it ', banner: { champion: ' Jinx ', skin: 3 } }))).toMatchObject({ motto: 'Draft it, then play it', banner: { champion: 'Jinx', skin: 3 } });
    expect(buildHome(input({ banner: { champion: 'Jinx', skin: 0 } })).banner).toEqual({ champion: 'Jinx' });
    expect(buildHome(input({ banner: { champion: '  ' } }))).toMatchObject({ motto: '', banner: null });
  });

  it('draws the seed as intentional empties: five mains, no record, nobody crowned, every trophy locked', () => {
    const home = buildHome(input({ analysis: [], seriesGames: [], scrims: [], series: [] }));
    expect(home.slides.map((s) => s.champion)).toEqual(['Aatrox', 'Vi', 'Ahri', 'Jinx', 'Leona']);
    expect(home.record.counters.games).toBe(0);
    expect(home.record.segments).toEqual([]);
    expect(home.spotlight).toBeNull();
    expect(home.next).toBeNull();
    expect(home.lineup.map((c) => [c.name, c.winRate])).toEqual([
      ['Zac', null],
      ['Go10x', null],
      ['Mido', null],
      ['SkilledScarecrow', null],
      ['Suppy', null]
    ]);
    expect(home.trophies.every((t) => !t.unlocked)).toBe(true);
    expect(home.advice).toMatchObject({ workOn: [], keepDoing: [], wins: 0, losses: 0, needs: 8 });
  });
});
