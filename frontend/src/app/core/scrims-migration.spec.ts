import { describe, expect, it } from 'vitest';
import { Scrim, ScrimOpponent, SeriesGame, Tournament, TournamentSeries } from '../models/team.models';
import { migrationDone, MigrationWrite, planScrimsMigration, scrimsGroupOf } from './scrims-migration';

const ofKind = <K extends MigrationWrite['kind']>(writes: readonly MigrationWrite[], kind: K) => writes.filter((w): w is Extract<MigrationWrite, { kind: K }> => w.kind === kind);

const player = (team: number, position: string, champion: string, name: string, tag = 'EUW') =>
  ({ name, tag, champion, team, win: team === 100, position, kills: 0, deaths: 0, assists: 0, gold: 0, damage: 0, damageToBuildings: 0, damageTaken: 0, visionScore: 0, cs: 0 }) as Scrim['players'][number];

const five = (team: number, names: string[]) =>
  ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].map((pos, i) => player(team, pos, `C${team}${i}`, names[i] ?? `p${team}${i}`));

const scrim = (id: string, opponent: string | undefined, playedOn: string, ourNames: string[] = ['Go10x', 'Jinx', 'Mid', 'Top', 'Sup']): Scrim =>
  ({ id, opponent, playedOn, durationSec: 1800, blueWon: true, players: [...five(100, ourNames), ...five(200, [])], order: 0 }) as Scrim;

const ours = new Set(['go10x#euw', 'jinx#euw', 'mid#euw', 'top#euw', 'sup#euw']);

const base = (over: Partial<Parameters<typeof planScrimsMigration>[0]> = {}) =>
  planScrimsMigration({ scrims: [], scrimOpponents: [], tournaments: [], series: [], games: [], rosterIds: ours, ...over });

describe('planScrimsMigration', () => {
  it('creates the group when there is none, and adopts the tournament named Scrims by marking it', () => {
    expect(base().writes[0]).toEqual({ kind: 'group-create', tournament: expect.objectContaining({ name: 'Scrims', kind: 'scrims', fearless: false }) });
    const old: Tournament = { id: 't1', name: 'Scrims', order: 0 };
    const plan = base({ tournaments: [old] });
    expect(plan.group).toBe(old);
    expect(plan.writes[0]).toEqual({ kind: 'group-mark', tournament: { ...old, kind: 'scrims', fearless: false, name: 'Scrims' } });
    expect(scrimsGroupOf([{ id: 'x', name: 'Oryx', order: 0 }, { id: 'g', name: 'Whatever', kind: 'scrims', order: 1 }])?.id).toBe('g');
  });

  it('makes a series per opponent with the record copied, a game per replay in play order, and deletes the records', () => {
    const opp: ScrimOpponent = { id: 'moss-2', name: 'MOSS 2', notes: 'fast', bans: ['Ahri'], order: 0 };
    const plan = base({
      scrimOpponents: [opp],
      scrims: [scrim('EUW1-2', 'MOSS 2', '2026-09-08T20:00:00Z'), scrim('EUW1-1', 'moss 2', '2026-09-08T19:00:00Z')]
    });
    const kinds = plan.writes.map((w) => w.kind);
    expect(kinds).toEqual(['group-create', 'series', 'scrim-side', 'game', 'scrim-side', 'game', 'delete-opponent']);
    const series = ofKind(plan.writes, 'series')[0];
    expect(series.slug).toBe('moss-2');
    expect(series.series).toMatchObject({ opponent: 'MOSS 2', bestOf: 0, notes: 'fast', bans: ['Ahri'] });
    const games = ofKind(plan.writes, 'game');
    expect(games.map((g) => [g.scrimId, g.game.gameNumber])).toEqual([['EUW1-1', 1], ['EUW1-2', 2]]);
    expect(games[0].game).toMatchObject({ ourSide: 'blue', win: true, matchId: 'EUW1-1', ourChampions: ['C1000', 'C1001', 'C1002', 'C1003', 'C1004'] });
    expect(plan.opponents).toBe(1);
    expect(plan.replays).toBe(2);
    expect(migrationDone(plan)).toBe(false);
  });

  it('skips a slug that already has a series in the group, numbers after its games, and skips a replay already linked', () => {
    const group: Tournament = { id: 'g', name: 'Scrims', kind: 'scrims', fearless: false, order: 0 };
    const existing: TournamentSeries = { id: 's1', tournamentId: 'g', opponent: 'MOSS 2', bestOf: 0, order: 0 };
    const linked: SeriesGame = { id: 'g1', seriesId: 's1', gameNumber: 1, ourChampions: [], theirChampions: [], matchId: 'EUW1-1', order: 0 };
    const plan = base({
      tournaments: [group],
      series: [existing],
      games: [linked],
      scrims: [scrim('EUW1-1', 'MOSS 2', '2026-09-08T19:00:00Z'), scrim('EUW1-2', 'MOSS 2', '2026-09-08T20:00:00Z')]
    });
    expect(plan.writes.map((w) => w.kind)).toEqual(['scrim-side', 'game']);
    expect(ofKind(plan.writes, 'game')[0].game.gameNumber).toBe(2);
    expect(plan.opponents).toBe(0);
    expect(plan.replays).toBe(1);
  });

  it('files an unnamed replay under Unnamed opponent and leaves a replay nobody can side without a side', () => {
    const plan = base({ scrims: [scrim('EUW1-9', undefined, '2026-09-01T10:00:00Z', ['a', 'b', 'c', 'd', 'e'])] });
    const series = ofKind(plan.writes, 'series')[0];
    expect(series.series.opponent).toBe('Unnamed opponent');
    const game = ofKind(plan.writes, 'game')[0];
    expect(game.game.ourSide).toBeUndefined();
    expect(game.game.win).toBeUndefined();
    expect(game.game.matchId).toBe('EUW1-9');
    expect(plan.writes.some((w) => w.kind === 'scrim-side')).toBe(false);
  });

  it('plans nothing on a second run', () => {
    const group: Tournament = { id: 'g', name: 'Scrims', kind: 'scrims', fearless: false, order: 0 };
    const s: TournamentSeries = { id: 's1', tournamentId: 'g', opponent: 'MOSS 2', bestOf: 0, order: 0 };
    const g: SeriesGame = { id: 'g1', seriesId: 's1', gameNumber: 1, ourChampions: [], theirChampions: [], matchId: 'EUW1-1', order: 0 };
    const plan = base({ tournaments: [group], series: [s], games: [g], scrims: [scrim('EUW1-1', 'MOSS 2', '2026-09-08T19:00:00Z')] });
    expect(plan.writes).toEqual([]);
    expect(migrationDone(plan)).toBe(true);
  });
});
