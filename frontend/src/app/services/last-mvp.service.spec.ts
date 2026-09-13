import { TestBed } from '@angular/core/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../environments/environment';
import { AnalysisGame, Player, SeriesGame, Tournament, TournamentSeries } from '../models/team.models';
import { LastMvpService } from './last-mvp.service';
import { TeamDataService } from './team-data.service';

// Local mode: no listeners, no backend; the signals hold what the test sets.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

const player = (id: string, name: string, role: Player['role'], order: number) =>
  ({ id, name, role, order, top3: [], strengths: [], weaknesses: [], bans: [] }) as unknown as Player;
const players = [player('p-top', 'Zac', 'Top', 0), player('p-jg', 'Go10x', 'Jungle', 1), player('p-mid', 'Mido', 'Mid', 2), player('p-adc', 'Rhu', 'ADC', 3), player('p-sup', 'Suppy', 'Support', 4)];
const tournaments = [{ id: 'cup', name: 'Oryx', kind: 'tournament', order: 0, startDate: '2026-09-01', active: true }] as unknown as Tournament[];
const series = [
  { id: 's1', tournamentId: 'cup', opponent: 'Tidal Wolves', bestOf: 1, order: 0, scheduledAt: '2026-09-06T19:00' },
  { id: 's2', tournamentId: 'cup', opponent: 'Iron Larks', bestOf: 1, order: 1, scheduledAt: '2026-09-13T19:00' }
] as unknown as TournamentSeries[];
/** A game where one seat clearly carried: our five, their five, figures on every seat. */
const game = (matchId: string, date: string, carry: 'BOTTOM' | 'MIDDLE'): AnalysisGame =>
  ({
    matchId, compId: null, compName: null, win: true, queue: 'Flex', date: Date.parse(date), side: 'blue', durationSec: 1800,
    kills: { ours: 20, theirs: 8 },
    players: [
      { name: 'Zac', position: 'TOP', champion: 'Aatrox', kills: 2, deaths: 2, assists: 6, cs: 200, damage: 12_000, damageTaken: 20_000, visionScore: 15, killParticipation: 0.4 },
      { name: 'Go10x', position: 'JUNGLE', champion: 'Vi', kills: 3, deaths: 2, assists: 9, cs: 160, damage: 10_000, damageTaken: 18_000, visionScore: 30, killParticipation: 0.6 },
      { name: 'Mido', position: 'MIDDLE', champion: 'Ahri', kills: carry === 'MIDDLE' ? 12 : 3, deaths: 1, assists: 8, cs: carry === 'MIDDLE' ? 320 : 200, damage: carry === 'MIDDLE' ? 40_000 : 14_000, damageTaken: 12_000, visionScore: 20, killParticipation: carry === 'MIDDLE' ? 1 : 0.55 },
      { name: 'Rhu', position: 'BOTTOM', champion: 'Jinx', kills: carry === 'BOTTOM' ? 12 : 3, deaths: 1, assists: 8, cs: carry === 'BOTTOM' ? 320 : 200, damage: carry === 'BOTTOM' ? 40_000 : 14_000, damageTaken: 12_000, visionScore: 20, killParticipation: carry === 'BOTTOM' ? 1 : 0.55 },
      { name: 'Suppy', position: 'UTILITY', champion: 'Leona', kills: 0, deaths: 3, assists: 14, cs: 30, damage: 5_000, damageTaken: 22_000, visionScore: 60, killParticipation: 0.7 }
    ],
    enemies: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].map((position) => ({ position, champion: 'Sion' }))
  }) as unknown as AnalysisGame;
const seriesGame = (id: string, seriesId: string, matchId: string) => ({ id, seriesId, gameNumber: 1, win: true, ourSide: 'blue', matchId, ourChampions: [], theirChampions: [] }) as unknown as SeriesGame;

describe.skipIf(typeof localStorage === 'undefined')('LastMvpService', () => {
  let data: TeamDataService;
  let svc: LastMvpService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    data = TestBed.inject(TeamDataService);
    svc = TestBed.inject(LastMvpService);
    data.players.set(players);
    data.tournaments.set(tournaments);
    data.tournamentSeries.set(series);
  });

  it('names nobody until a series has crowned someone', () => {
    data.seriesGames.set([]);
    data.compAnalysis.set({ games: [] } as never);
    expect(svc.holder()).toBeNull();
    expect(svc.isHolder('p-adc', 'Rhu')).toBe(false);
  });

  it('follows the MVP of the newest crowned series, by id or by name, and moves when the next series crowns someone else', () => {
    data.seriesGames.set([seriesGame('g1', 's1', 'EUW_1')]);
    data.compAnalysis.set({ games: [game('EUW_1', '2026-09-06T20:00', 'BOTTOM')] } as never);
    expect(svc.holder()).toMatchObject({ playerId: 'p-adc', opponent: 'Tidal Wolves', champion: 'Jinx' });
    expect(svc.isHolder('p-adc')).toBe(true);
    expect(svc.isHolder(null, 'rhu')).toBe(true);
    expect(svc.isHolder('p-mid')).toBe(false);
    expect(svc.isHolder(null, 'Mido')).toBe(false);

    data.seriesGames.set([seriesGame('g1', 's1', 'EUW_1'), seriesGame('g2', 's2', 'EUW_2')]);
    data.compAnalysis.set({ games: [game('EUW_1', '2026-09-06T20:00', 'BOTTOM'), game('EUW_2', '2026-09-13T20:00', 'MIDDLE')] } as never);
    expect(svc.holder()).toMatchObject({ playerId: 'p-mid', opponent: 'Iron Larks', champion: 'Ahri' });
    expect(svc.isHolder('p-adc')).toBe(false);
    expect(svc.isHolder('p-mid')).toBe(true);
  });
});
