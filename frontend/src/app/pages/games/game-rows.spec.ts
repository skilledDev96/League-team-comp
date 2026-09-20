import { describe, expect, it } from 'vitest';
import { AnalysisGame, Player, Scrim, SeriesGame, Tournament, TournamentSeries } from '../../models/team.models';
import { buildGameRows, filterRows, fromAnalysis, fromScrim, fromSeriesGame, GameRow, meanLength, playerLines, record, rosterIds, toughest } from './game-rows';

const roster = [
  { id: 'p1', name: 'Zac', role: 'Top', profile: { riotTag: '#EUW' } },
  { id: 'p2', name: 'Go10x', role: 'Jungle', profile: { riotTag: 'BOM' } }
] as unknown as Player[];

const analysis = (over: Partial<AnalysisGame> = {}): AnalysisGame => ({
  matchId: 'm1',
  compId: null,
  compName: null,
  win: true,
  queue: 'Flex',
  date: 1_700_000_000_000,
  side: 'blue',
  durationSec: 1800,
  players: [
    { name: 'Go10x', position: 'JUNGLE', champion: 'Vi', kills: 4, deaths: 2, assists: 10, cs: 180, damage: 12_000, killParticipation: 0.7 },
    { name: 'Zac', position: 'TOP', champion: 'Aatrox', kills: 6, deaths: 3, assists: 4, cs: 240, damage: 18_000, visionScore: 25 }
  ],
  enemies: [{ position: 'TOP', champion: 'Renekton' }, { position: 'JUNGLE', champion: 'Lee Sin' }],
  kills: { ours: 20, theirs: 12 },
  ...over
});

const scrim = (over: Partial<Scrim> = {}): Scrim => ({
  id: 's1',
  playedOn: '2026-09-01T18:00:00.000Z',
  durationSec: 1500,
  blueWon: false,
  order: 1,
  players: [
    { name: 'Zac', tag: 'EUW', champion: 'Ornn', team: 200, win: true, position: 'TOP', kills: 2, deaths: 1, assists: 8, gold: 12_000, damage: 9_000, damageToBuildings: 0, damageTaken: 20_000, visionScore: 30, cs: 200 },
    { name: 'Someone', tag: 'X', champion: 'Ahri', team: 100, win: false, position: 'MIDDLE', kills: 1, deaths: 5, assists: 0, gold: 8_000, damage: 7_000, damageToBuildings: 0, damageTaken: 9_000, visionScore: 10, cs: 150 }
  ],
  ...over
});

describe('game rows', () => {
  it('reads a Riot game in seat order with its numbers, and their side from the roles', () => {
    const row = fromAnalysis(analysis(), { id: 'c1', name: 'Dive' });
    expect(row.ours.map((p) => p.role)).toEqual(['Top', 'Jungle']);
    expect(row.ours[0]).toMatchObject({ champion: 'Aatrox', player: 'Zac', stats: { kills: 6, cs: 240 } });
    expect(row.theirs.map((p) => p.champion)).toEqual(['Renekton', 'Lee Sin']);
    expect(row).toMatchObject({ source: 'riot', label: 'Flex', win: true, side: 'blue', compId: 'c1', compName: 'Dive', kills: { ours: 20, theirs: 12 } });
  });

  it('carries their figures when the analysis has them, and leaves a seat without them without', () => {
    // A Riot game refreshed on or after 10 Sep 2026: each enemy seat has its figures off the cache.
    const row = fromAnalysis(
      analysis({
        enemies: [
          { position: 'JUNGLE', champion: 'Lee Sin', stats: { kills: 3, deaths: 5, assists: 6, cs: 160, damage: 9_500, damageTaken: 21_000, visionScore: 18, killParticipation: 0.75 } },
          { position: 'TOP', champion: 'Renekton', stats: { kills: 5, deaths: 4, assists: 2, cs: 230, damage: 52_500 } },
          { position: 'MIDDLE', champion: 'Ahri' }
        ]
      }),
      null
    );
    expect(row.theirs.map((p) => p.champion)).toEqual(['Renekton', 'Lee Sin', 'Ahri']);
    expect(row.theirs[0].stats).toEqual({ kills: 5, deaths: 4, assists: 2, cs: 230, damage: 52_500 });
    expect(row.theirs[1].stats).toEqual({ kills: 3, deaths: 5, assists: 6, cs: 160, damage: 9_500, damageTaken: 21_000, vision: 18, killParticipation: 0.75 });
    expect(row.theirs[1].player).toBeNull();
    // The seat the analysis did not figure stays unfigured: the page shows a dash, not a zero.
    expect(row.theirs[2].stats).toBeUndefined();
    // An analysis from before the figures shipped is unchanged.
    expect(fromAnalysis(analysis(), null).theirs.every((p) => p.stats === undefined)).toBe(true);
  });

  it('reads a scrim from the roster side, and leaves one out whose side nobody can tell', () => {
    const ours = rosterIds(roster);
    const row = fromScrim(scrim(), ours)!;
    expect(row).toMatchObject({ source: 'scrim', side: 'red', win: true, kills: { ours: 2, theirs: 1 } });
    expect(row.ours[0]).toMatchObject({ champion: 'Ornn', player: 'Zac' });
    expect(row.theirs[0].player).toBeNull();
    expect(fromScrim(scrim({ players: [] }), ours)).toBeNull();
    expect(fromScrim(scrim({ players: [], ourSide: 'blue' }), ours)).toMatchObject({ win: false });
  });

  it('reads a tournament game with its champions only, naming our seats from the roster', () => {
    const series = { id: 'ser', opponent: 'MAD', bestOf: 3, scheduledAt: '2026-09-06T18:00:00.000Z' } as TournamentSeries;
    const game = { id: 'g', seriesId: 'ser', gameNumber: 2, order: 2, ourChampions: ['Aatrox', '', 'Ahri'], theirChampions: [], win: false } as SeriesGame;
    const row = fromSeriesGame(game, series, { Top: 'Zac', Mid: 'Mid Guy' })!;
    expect(row).toMatchObject({ source: 'tournament', label: 'Bo3 game 2', opponent: 'MAD', win: false });
    expect(row.ours.map((p) => p.role + ':' + p.champion + ':' + p.player)).toEqual(['Top:Aatrox:Zac', 'Mid:Ahri:Mid Guy']);
    expect(row.ours[0].stats).toBeUndefined();
    expect(fromSeriesGame({ ...game, win: undefined }, series)).toBeNull();
  });

  it('takes the numbers from a replay imported against a tournament game, but keeps the series result', () => {
    const series = { id: 'ser', opponent: 'MAD', bestOf: 3 } as TournamentSeries;
    const game = { id: 'g', seriesId: 'ser', gameNumber: 1, order: 1, ourChampions: ['Ornn'], theirChampions: ['Ahri'], win: true, ourSide: 'red', matchId: 's1' } as SeriesGame;
    const row = fromSeriesGame(game, series, {}, scrim(), rosterIds(roster))!;
    expect(row).toMatchObject({ id: 'series-g', source: 'tournament', label: 'Bo3 game 1', opponent: 'MAD', win: true, side: 'red', matchId: 's1', durationSec: 1500 });
    expect(row.ours[0]).toMatchObject({ champion: 'Ornn', player: 'Zac', stats: { kills: 2 } });
    expect(row.link?.path).toBe('/tournaments');
  });

  it('filters by source, window, result, opponent and champion', () => {
    const now = 1_700_000_000_000 + 10 * 86_400_000;
    const rows = [fromAnalysis(analysis(), null), fromAnalysis(analysis({ matchId: 'm2', win: false, date: now - 40 * 86_400_000 }), null)];
    const base = { source: 'all' as const, days: 0, result: 'all' as const, opponent: '' };
    expect(filterRows(rows, base, now)).toHaveLength(2);
    expect(filterRows(rows, { ...base, days: 30 }, now)).toHaveLength(1);
    expect(filterRows(rows, { ...base, result: 'loss' }, now).map((r) => r.id)).toEqual(['riot-m2']);
    expect(filterRows(rows, { ...base, source: 'scrim' }, now)).toHaveLength(0);
    expect(filterRows(rows, { ...base, champion: (c) => c.includes('Renekton') }, now)).toHaveLength(2);
    expect(filterRows(rows, { ...base, champion: (c) => c.includes('Jinx') }, now)).toHaveLength(0);
  });

  it('records, mean length and player lines count only what each game knows', () => {
    const rows = [fromAnalysis(analysis(), null), fromScrim(scrim(), rosterIds(roster))!];
    expect(record(rows)).toEqual({ games: 2, wins: 2, losses: 0, winRate: 100 });
    expect(meanLength(rows)).toBe(1650);
    const series = { id: 'ser', opponent: 'MAD', bestOf: 3 } as TournamentSeries;
    const typed = fromSeriesGame({ id: 'g', seriesId: 'ser', gameNumber: 1, order: 1, ourChampions: ['Sion'], theirChampions: [], win: false } as SeriesGame, series, { Top: 'Zac' })!;
    const lines = playerLines([...rows, typed]);
    const zac = lines.find((l) => l.name === 'Zac')!;
    // The typed-in game counts as played; its missing numbers count nowhere.
    expect(zac).toMatchObject({ games: 3, wins: 2, statGames: 2, kills: 8, deaths: 4, assists: 12, kda: 5 });
    expect(zac.champions.map((c) => c.champion)).toEqual(['Aatrox', 'Ornn', 'Sion']);
    expect(zac.csPerMin).toBe(8); // 240 cs over 30 minutes plus 200 over 25
    expect(zac.visionPerGame).toBe(27.5); // 25 in the Riot game, 30 in the scrim
    expect(zac.killParticipation).toBe(1); // computed from the row's kills where the source had none
    expect(lines.map((l) => l.role)).toEqual(['Top', 'Jungle']); // seat order, not games played
    const go = lines.find((l) => l.name === 'Go10x')!;
    expect(go.killParticipation).toBeCloseTo(0.7);
    expect(go.visionPerGame).toBeUndefined();
    expect(go.damageShare).toBeCloseTo(0.4);
  });

  it('names their champions that keep beating us', () => {
    const rows = [
      fromAnalysis(analysis({ win: false }), null),
      fromAnalysis(analysis({ matchId: 'm2', win: false }), null),
      fromAnalysis(analysis({ matchId: 'm3', win: true, enemies: [{ position: 'TOP', champion: 'Renekton' }] }), null)
    ];
    expect(toughest(rows)[0]).toMatchObject({ champion: 'Lee Sin', games: 2, wins: 0, winRate: 0 });
    expect(toughest(rows)[1]).toMatchObject({ champion: 'Renekton', games: 3, winRate: 33 });
  });
});

import { reviewBlockReason } from './game-rows';

describe('reviewBlockReason', () => {
  it('blocks a tournament game with no replay and allows anything with a match id', () => {
    expect(reviewBlockReason({ source: 'tournament' })).toMatch(/import its replay/);
    expect(reviewBlockReason({ source: 'tournament', matchId: 'EUW1-1' })).toBeNull();
    expect(reviewBlockReason({ source: 'riot', matchId: 'EUW1_1' })).toBeNull();
  });
});

/**
 * The one row builder the Games page and Home share (13 Sep 2026). Moved out of GamesComponent
 * verbatim; these pin what it promises, so a second reader cannot count a game a second way.
 */
describe('buildGameRows', () => {
  const tournaments = [
    { id: 't1', name: 'Oryx', kind: 'tournament', order: 0 },
    { id: 'scrims', name: 'Scrims', kind: 'scrims', order: 1 }
  ] as unknown as Tournament[];
  const cup = { id: 'ser1', tournamentId: 't1', opponent: 'Tidal Wolves', bestOf: 3, order: 0, scheduledAt: '2026-09-05' } as unknown as TournamentSeries;
  const block = { id: 'ser2', tournamentId: 'scrims', opponent: 'Iron Owls', bestOf: 0, order: 0 } as unknown as TournamentSeries;
  const base = {
    analysis: [] as AnalysisGame[],
    comps: [],
    compOverride: () => '',
    players: roster,
    starters: roster,
    tournaments,
    series: [cup, block],
    seriesGames: [] as SeriesGame[],
    scrims: [] as Scrim[]
  };

  it('lets a tournament game own its replay: no Riot row and no scrim row for the same game, and the comp the Riot row carried stays', () => {
    const replay = scrim({ id: 'r-9' });
    const game = { id: 'g1', seriesId: 'ser1', gameNumber: 1, win: true, matchId: 'r-9', ourChampions: [], theirChampions: [] } as unknown as SeriesGame;
    const dive = { id: 'dive', name: 'Dive', picks: { Top: '', Jungle: '', Mid: '', ADC: '', Support: '' }, order: 0 };
    const rows = buildGameRows({ ...base, comps: [dive], analysis: [analysis({ matchId: 'r-9', queue: 'Scrim', compId: 'dive', compName: 'Dive' })], scrims: [replay], seriesGames: [game] });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('tournament');
    expect(rows[0].matchId).toBe('r-9');
    // The comp the analysis placed the game under travels with it (13 Sep 2026): a league game played with a comp is
    // that comp's game, and dropping it here took five of Dive's six games off its record on Games, Home and Comps.
    expect(rows[0]).toMatchObject({ compId: 'dive', compName: 'Dive' });
  });

  it('reads a game in the scrims group as a scrim, and stamps the series on both kinds', () => {
    const inCup = { id: 'g1', seriesId: 'ser1', gameNumber: 1, win: true, ourChampions: ['Aatrox'], theirChampions: ['Renekton'] } as unknown as SeriesGame;
    const inBlock = { id: 'g2', seriesId: 'ser2', gameNumber: 1, win: false, ourChampions: ['Ornn'], theirChampions: ['Ahri'] } as unknown as SeriesGame;
    const rows = buildGameRows({ ...base, seriesGames: [inCup, inBlock] });
    const bySeries = Object.fromEntries(rows.map((r) => [r.seriesId, r.source]));
    expect(bySeries).toEqual({ ser1: 'tournament', ser2: 'scrim' });
  });

  // 21 Sep 2026: ending a tournament is not deleting it. The Games list reads the group's `kind` and nothing else
  // about it, so a split that is over lists exactly the games it listed the day before, as the same source.
  it('lists every game of an ended tournament, unchanged', () => {
    const inCup = { id: 'g1', seriesId: 'ser1', gameNumber: 1, win: true, ourChampions: ['Aatrox'], theirChampions: ['Renekton'] } as unknown as SeriesGame;
    const inBlock = { id: 'g2', seriesId: 'ser2', gameNumber: 1, win: false, ourChampions: ['Ornn'], theirChampions: ['Ahri'] } as unknown as SeriesGame;
    const live = buildGameRows({ ...base, seriesGames: [inCup, inBlock] });
    const ended = buildGameRows({
      ...base,
      tournaments: tournaments.map((t) => (t.id === 't1' ? { ...t, endedAt: '2026-09-20', finish: '3rd of 12' } : t)) as unknown as Tournament[],
      seriesGames: [inCup, inBlock]
    });
    expect(ended).toEqual(live);
    expect(record(ended)).toEqual(record(live));
  });

  it('drops a scrim whose side cannot be told, and sorts newest first', () => {
    const unsided = scrim({ id: 's-x', players: [scrim().players[1]] });
    const older = scrim({ id: 's-old', playedOn: '2026-08-01T18:00:00.000Z' });
    const newer = analysis({ matchId: 'm-new', date: Date.parse('2026-09-10T18:00:00.000Z') });
    const rows = buildGameRows({ ...base, analysis: [newer], scrims: [unsided, older] });
    expect(rows).toHaveLength(2);
    expect(rows[0].date).toBeGreaterThan(rows[1].date);
    expect(rows.some((r) => r.matchId === 's-x' || r.id.includes('s-x'))).toBe(false);
  });

  /**
   * One remake rule (14 Sep 2026): under ten minutes a game is a remake, from every source, and no record reads it.
   * The five on the stored data were early wins of 76 to 205 seconds, which lifted All time from 62–89 to 67–89.
   */
  it('leaves out a remake from every source, keeps a game of ten minutes and a game whose length nobody knows', () => {
    const remadeRiot = analysis({ matchId: 'riot-76s', durationSec: 76, win: true });
    const remadeLate = analysis({ matchId: 'riot-9m', durationSec: 540, win: true });
    const tenMinutes = analysis({ matchId: 'riot-600s', durationSec: 600, win: false });
    const noLength = analysis({ matchId: 'riot-unknown', durationSec: undefined, win: false });
    const remadeScrim = scrim({ id: 's-remake', durationSec: 143 });
    const typed = { id: 'g-typed', seriesId: 'ser1', gameNumber: 1, win: true, ourChampions: ['Aatrox'], theirChampions: ['Renekton'] } as unknown as SeriesGame;
    const rows = buildGameRows({ ...base, analysis: [remadeRiot, remadeLate, tenMinutes, noLength], scrims: [remadeScrim], seriesGames: [typed] });
    expect(rows.map((r) => r.id).sort()).toEqual(['riot-riot-600s', 'riot-riot-unknown', 'series-g-typed']);
    expect(record(rows)).toEqual({ games: 3, wins: 1, losses: 2, winRate: 33 });
  });

  it('keeps a remade replay a tournament game owns from coming back as a scrim or a Riot row', () => {
    const replay = scrim({ id: 'r-remake', durationSec: 180 });
    const game = { id: 'g1', seriesId: 'ser1', gameNumber: 1, win: true, matchId: 'r-remake', ourChampions: [], theirChampions: [] } as unknown as SeriesGame;
    const rows = buildGameRows({ ...base, analysis: [analysis({ matchId: 'r-remake', queue: 'Scrim', durationSec: 180 })], scrims: [replay], seriesGames: [game] });
    expect(rows).toEqual([]);
  });

  // 17 Sep 2026: the rehearsals drafted against "test" in the live group were counting as league games.
  it('leaves every game of a sandbox series out, and keeps its replay from coming back as a scrim or a Riot row', () => {
    const sandbox = { id: 'ser-test', tournamentId: 't1', opponent: 'test', bestOf: 3, order: 1, sandbox: true } as unknown as TournamentSeries;
    const typed = { id: 'g-typed', seriesId: 'ser-test', gameNumber: 1, win: true, ourChampions: ['Aatrox'], theirChampions: ['Renekton'] } as unknown as SeriesGame;
    const withReplay = { id: 'g-replay', seriesId: 'ser-test', gameNumber: 2, win: true, matchId: 'r-test', ourChampions: [], theirChampions: [] } as unknown as SeriesGame;
    const real = { id: 'g-real', seriesId: 'ser1', gameNumber: 1, win: false, ourChampions: ['Ornn'], theirChampions: ['Ahri'] } as unknown as SeriesGame;
    const rows = buildGameRows({
      ...base,
      series: [cup, block, sandbox],
      analysis: [analysis({ matchId: 'r-test', queue: 'Scrim' })],
      scrims: [scrim({ id: 'r-test' })],
      seriesGames: [typed, withReplay, real]
    });
    expect(rows.map((r) => r.id)).toEqual(['series-g-real']);
    expect(record(rows)).toEqual({ games: 1, wins: 0, losses: 1, winRate: 0 });
  });

  // 17 Sep 2026, from the review: a rehearsal's result toggled back off makes no row and so claims nothing, and its
  // replay came back as a Scrim row — through the analysis, or through the scrims store when the analysis lacks it.
  it('keeps the replay of a sandbox game with no result out, whether the analysis or only the scrims store holds it', () => {
    const sandbox = { id: 'ser-test', tournamentId: 't1', opponent: 'test', bestOf: 3, order: 1, sandbox: true } as unknown as TournamentSeries;
    const unresolved = { id: 'g-off', seriesId: 'ser-test', gameNumber: 1, matchId: 'r-test', ourChampions: [], theirChampions: [] } as unknown as SeriesGame;
    const storeOnly = { id: 'g-store', seriesId: 'ser-test', gameNumber: 2, matchId: 'r-store', ourChampions: [], theirChampions: [] } as unknown as SeriesGame;
    const real = { id: 'g-real', seriesId: 'ser1', gameNumber: 1, win: false, ourChampions: ['Ornn'], theirChampions: ['Ahri'] } as unknown as SeriesGame;
    const sources = {
      ...base,
      analysis: [analysis({ matchId: 'r-test', queue: 'Scrim', win: true })],
      scrims: [scrim({ id: 'r-test' }), scrim({ id: 'r-store' })]
    };
    // Without the flag both replays are ordinary scrims, so the case below is the flag at work and not a sideless file.
    const asScrims = buildGameRows({ ...sources, series: [cup, block, { ...sandbox, sandbox: undefined }], seriesGames: [unresolved, storeOnly, real] });
    expect(asScrims.map((r) => r.id).sort()).toEqual(['riot-r-test', 'scrim-r-store', 'series-g-real']);
    const rows = buildGameRows({ ...sources, series: [cup, block, sandbox], seriesGames: [unresolved, storeOnly, real] });
    expect(rows.map((r) => r.id)).toEqual(['series-g-real']);
    expect(record(rows)).toEqual({ games: 1, wins: 0, losses: 1, winRate: 0 });
  });
});

/**
 * One champion, one entry (14 Sep 2026). A replay stores Riot's id ("TahmKench", "MonkeyKing", "JarvanIV") and a Riot
 * row the display name, and the pools, "Played +N" and "Beats us most" counted each pair as two champions.
 */
describe('champions under one key', () => {
  const seat = (champion: string, player: string | null = 'Sir StonedAlot') => ({ role: 'Support', champion, player });
  const game = (id: string, win: boolean, champion: string, theirs: string[] = []) =>
    ({ id, source: 'riot', label: 'Flex', date: 1, win, ours: [seat(champion)], theirs: theirs.map((c) => seat(c, null)) }) as GameRow;

  it('counts a player\'s champion once whichever spelling each game stored, and shows the display name', () => {
    // Sir StonedAlot's pool on the stored data: Tahm Kench 9 of 13 from Riot, 0 of 3 from replays — 9 of 16.
    const rows = [
      ...Array.from({ length: 13 }, (_, i) => game(`riot-${i}`, i < 9, 'Tahm Kench')),
      ...Array.from({ length: 3 }, (_, i) => game(`replay-${i}`, false, 'TahmKench')),
      game('w1', true, 'MonkeyKing'),
      game('w2', false, 'Wukong'),
      game('k1', true, 'Kaisa'),
      game('k2', true, "Kai'Sa")
    ];
    const [line] = playerLines(rows);
    expect(line.champions).toEqual([
      { champion: 'Tahm Kench', games: 16, wins: 9 },
      { champion: "Kai'Sa", games: 2, wins: 2 },
      { champion: 'Wukong', games: 2, wins: 1 }
    ]);
  });

  it('counts their champion once in the ones that keep beating us', () => {
    const rows = [game('a', false, 'Ahri', ['XinZhao']), game('b', false, 'Ahri', ['Xin Zhao']), game('c', true, 'Ahri', ['Xin Zhao']), game('d', false, 'Ahri', ['LeBlanc']), game('e', false, 'Ahri', ['Leblanc'])];
    expect(toughest(rows)).toEqual([
      { champion: 'LeBlanc', games: 2, wins: 0, winRate: 0 },
      { champion: 'Xin Zhao', games: 3, wins: 1, winRate: 33 }
    ]);
  });
});
