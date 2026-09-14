import { TestBed } from '@angular/core/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../environments/environment';
import { Comp, Player, SeriesGame, Tournament, TournamentSeries } from '../../models/team.models';
import { TeamDataService } from '../../services/team-data.service';
import { normalizeChampion } from './draft.util';
import { TournamentContextService } from './tournament-context.service';

// Local mode: no listeners, no backend; the signals hold what the test sets.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

// The 13 Sep 2026 snapshot: the Oryx league (fearless) with Paradox Requiem's three games as stored,
// and the scrims group (not fearless) with MOSS 2 and 5s.
const tournaments = [
  { id: 'tournament-f9515444', name: 'Oryx Fearless League 2026 Split 2', order: 0 },
  { id: 'tournament-12c5a17f', name: 'Scrims', kind: 'scrims', fearless: false, order: 2 }
] as unknown as Tournament[];
const series = [
  { id: 'series-7f25f7b7', tournamentId: 'tournament-f9515444', opponent: 'Paradox Requiem', bestOf: 3, status: 'scheduled', order: 1 },
  { id: 'series-1d59cb83', tournamentId: 'tournament-12c5a17f', opponent: 'MOSS 2', bestOf: 0, status: 'scheduled', order: 0 },
  { id: 'series-b9c612ac', tournamentId: 'tournament-12c5a17f', opponent: '5s', bestOf: 0, status: 'scheduled', order: 1 }
] as unknown as TournamentSeries[];
const g = (id: string, seriesId: string, gameNumber: number, over: Partial<SeriesGame>) =>
  ({ id, seriesId, gameNumber, order: gameNumber, ourChampions: [], theirChampions: [], ...over }) as SeriesGame;
const games: SeriesGame[] = [
  g('game-d20a9b2c', 'series-7f25f7b7', 1, { win: true, matchId: 'EUW1-7979450974', ourChampions: ['Shen', 'Diana', 'Yone', 'Tristana', 'Zilean'], theirChampions: ['Urgot', 'JarvanIV', 'Syndra', 'Kaisa', 'Leona'] }),
  g('game-545c100f', 'series-7f25f7b7', 2, { win: false, matchId: 'EUW1-7979537790', ourChampions: ['Ornn', 'MonkeyKing', 'Ahri', 'Jinx', 'Thresh'], theirChampions: ['Renekton', 'Shyvana', 'Sylas', 'Yunara', 'Seraphine'] }),
  g('game-23d8aeaf', 'series-7f25f7b7', 3, { win: false, matchId: 'EUW1-7979615260', ourChampions: ['Mordekaiser', 'Vi', 'Akali', 'Aphelios', 'Nautilus'], theirChampions: ['Sion', 'FiddleSticks', 'Yasuo', 'Caitlyn', 'Rell'] }),
  g('game-2bf19e22', 'series-1d59cb83', 1, { win: false, matchId: 'EUW1-7977500462' }),
  g('game-2e156073', 'series-1d59cb83', 2, { win: false, matchId: 'EUW1-7977592156' }),
  g('game-3bdd6d33', 'series-1d59cb83', 3, { ourSide: 'red', draftStep: 0 }),
  g('game-026f8731', 'series-b9c612ac', 1, { ourSide: 'red', draftStep: 9, ourChampions: ['', '', '', 'Jinx', 'Seraphine'] }),
  g('game-76f95ffe', 'series-b9c612ac', 2, { ourSide: 'blue', draftStep: 0 })
];

describe.skipIf(typeof localStorage === 'undefined')('TournamentContextService', () => {
  let data: TeamDataService;
  let ctx: TournamentContextService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    data = TestBed.inject(TeamDataService);
    ctx = TestBed.inject(TournamentContextService);
    data.tournaments.set(tournaments);
    data.tournamentSeries.set(series);
    data.seriesGames.set(games);
  });

  it('counts only the games that were played on a series head', () => {
    expect(ctx.gamesFor('series-1d59cb83')).toHaveLength(3);
    expect(ctx.playedGamesFor('series-1d59cb83').map((x) => x.id)).toEqual(['game-2bf19e22', 'game-2e156073']);
    expect(ctx.playedGamesFor('series-b9c612ac')).toEqual([]);
    expect(ctx.playedGamesFor('series-7f25f7b7')).toHaveLength(3);
  });

  it('burns a champion once whether one game stored its id and another its name', () => {
    expect(ctx.usedCount('series-7f25f7b7')).toBe(30);
    // A typed game 4 with Wukong and Kai'Sa adds nothing: both are already burned under their ids.
    data.seriesGames.set([...games, g('game-x', 'series-7f25f7b7', 4, { ourChampions: ['Wukong', "Kai'Sa", 'Jarvan IV'] })]);
    expect(ctx.usedCount('series-7f25f7b7')).toBe(30);
    expect(ctx.burnedBefore('series-7f25f7b7', 5)).toHaveLength(30);
    expect(ctx.burnedBeforeBySide('series-7f25f7b7', 5).our).toHaveLength(17);
  });

  it('carries MonkeyKing, JarvanIV and Kaisa into game 3 as the champions the wall shows', () => {
    const burned = new Set(ctx.burnedBefore('series-7f25f7b7', 3).map(normalizeChampion));
    for (const tile of ['Wukong', 'Jarvan IV', "Kai'Sa"]) expect(burned.has(normalizeChampion(tile)), tile).toBe(true);
    expect(burned.size).toBe(20);
  });

  it('breaks a comp drafted with display names once the replays burned the ids', () => {
    data.comps.set([
      { id: 'c1', name: 'Wukong dive', order: 0, picks: { Top: 'Ornn', Jungle: 'Wukong', Mid: 'Taliyah', ADC: "Kai'Sa", Support: 'Nautilus' } },
      { id: 'c2', name: 'Open', order: 1, picks: { Top: 'Gragas', Jungle: 'Lee Sin', Mid: 'Orianna', ADC: 'Miss Fortune', Support: 'Braum' } }
    ] as unknown as Comp[]);
    data.players.set([{ id: 'drunkenbannana', name: 'DrunkenBannana', order: 1, top3: ['Wukong', 'Galio'] }] as unknown as Player[]);
    const rows = ctx.compAvailability('series-7f25f7b7');
    expect(rows.find((r) => r.id === 'c1')?.blocked).toEqual(['Ornn', 'Wukong', "Kai'Sa", 'Nautilus']);
    expect(rows.find((r) => r.id === 'c2')?.playable).toBe(true);
    expect(ctx.poolPressure('series-7f25f7b7')[0]).toMatchObject({ left: ['Galio'], gone: ['Wukong'] });
  });

  it('burns nothing in the scrims group', () => {
    expect(ctx.usedChampions('series-1d59cb83')).toEqual([]);
  });
});
