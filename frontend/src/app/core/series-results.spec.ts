import { describe, expect, it } from 'vitest';
import { AnalysisGame, Scrim, SeriesGame, Tournament, TournamentSeries } from '../models/team.models';
import { MvpGame } from './game-mvp';
import { crownOf, finishedSeries, isDecided, nextOpenSeries, seriesCrowns, seriesScoreOf, winsToTake } from './series-results';

const tournament = (id: string, over: Partial<Tournament> = {}) => ({ id, name: id, kind: 'tournament', order: 0, ...over }) as unknown as Tournament;
const series = (id: string, tournamentId: string, bestOf: number, order: number, over: Partial<TournamentSeries> = {}) =>
  ({ id, tournamentId, opponent: `Team ${id}`, bestOf, order, ...over }) as unknown as TournamentSeries;
const game = (seriesId: string, gameNumber: number, win?: boolean, over: Partial<SeriesGame> = {}) =>
  ({ id: `${seriesId}-g${gameNumber}`, seriesId, gameNumber, ourChampions: [], theirChampions: [], ...(win === undefined ? {} : { win }), ...over }) as unknown as SeriesGame;

const noAnalysis = new Map<string, AnalysisGame>();
const noScrims = new Map<string, Scrim>();

describe('series score and decided', () => {
  it('counts only games with a result', () => {
    expect(seriesScoreOf([{ win: true }, { win: false }, { win: undefined }, { win: true }])).toEqual({ wins: 2, losses: 1, played: 3 });
  });

  it('takes a best-of by its majority', () => {
    expect([1, 2, 3, 5, 0, -1].map(winsToTake)).toEqual([1, 2, 2, 3, 0, 0]);
  });

  it('decides a Bo3 at 2–0 but not at 1–0, and never an open-ended block', () => {
    expect(isDecided(3, { wins: 2, losses: 0, played: 2 })).toBe(true);
    expect(isDecided(3, { wins: 1, losses: 0, played: 1 })).toBe(false);
    expect(isDecided(3, { wins: 1, losses: 1, played: 2 })).toBe(false);
    expect(isDecided(2, { wins: 1, losses: 1, played: 2 })).toBe(true);
    expect(isDecided(0, { wins: 9, losses: 0, played: 9 })).toBe(false);
  });
});

describe('finishedSeries', () => {
  const base = { analysisById: noAnalysis, scrimById: noScrims };

  it('leaves out the scrims group and open-ended blocks however many games they hold', () => {
    const tournaments = [tournament('cup'), tournament('scrims', { kind: 'scrims' })];
    const all = [series('a', 'cup', 3, 0), series('s', 'scrims', 0, 0), series('b', 'cup', 0, 1)];
    const games = [game('a', 1, true), game('a', 2, true), game('s', 1, true), game('s', 2, true), game('b', 1, true)];
    expect(finishedSeries({ ...base, tournaments, series: all, seriesGames: games }).map((f) => f.series.id)).toEqual(['a']);
  });

  it('keeps a series left at 1–0 as finished-but-incomplete once a later series has results', () => {
    const tournaments = [tournament('cup')];
    const all = [series('r1', 'cup', 3, 0), series('r2', 'cup', 3, 1), series('r3', 'cup', 3, 2)];
    const games = [game('r1', 1, true), game('r2', 1, false), game('r2', 2, false)];
    const out = finishedSeries({ ...base, tournaments, series: all, seriesGames: games });
    expect(out.map((f) => [f.series.id, f.result, f.incomplete])).toEqual([
      ['r1', 'won', true],
      ['r2', 'lost', false]
    ]);
  });

  it('orders tournaments by their start date, and dates a series by its newest replay', () => {
    const tournaments = [tournament('late', { startDate: '2026-09-01', order: 0 }), tournament('early', { startDate: '2026-06-01', order: 1 })];
    const all = [series('l', 'late', 1, 0, { scheduledAt: '2026-09-05' }), series('e', 'early', 1, 0, { scheduledAt: '2026-06-05' })];
    const games = [game('l', 1, true, { matchId: 'rep-l' }), game('e', 1, false)];
    const scrimById = new Map([['rep-l', { playedOn: '2026-09-06T19:30:00.000Z' } as Scrim]]);
    const out = finishedSeries({ tournaments, series: all, seriesGames: games, analysisById: noAnalysis, scrimById });
    expect(out.map((f) => f.series.id)).toEqual(['e', 'l']);
    expect(out[1].endedAt).toBe(Date.parse('2026-09-06T19:30:00.000Z'));
    expect(out[0].endedAt).toBe(new Date(2026, 5, 5).getTime());
  });

  it('never finishes a sandbox series, and its results do not mark an earlier series as played past (17 Sep 2026)', () => {
    const tournaments = [tournament('cup')];
    const all = [series('r1', 'cup', 3, 0), series('test', 'cup', 3, 1, { opponent: 'test', sandbox: true })];
    const games = [game('r1', 1, true), game('test', 1, true), game('test', 2, true)];
    expect(finishedSeries({ ...base, tournaments, series: all, seriesGames: games })).toEqual([]);
  });
});

describe('nextOpenSeries', () => {
  it('is the first real series with no result, and nothing once every one has one', () => {
    const tournaments = [tournament('cup'), tournament('scrims', { kind: 'scrims' })];
    const all = [series('s', 'scrims', 0, 0), series('a', 'cup', 3, 1), series('b', 'cup', 3, 2)];
    expect(nextOpenSeries({ tournaments, series: all, seriesGames: [game('a', 1, true)] })?.id).toBe('b');
    expect(nextOpenSeries({ tournaments, series: all, seriesGames: [game('a', 1, true), game('b', 1, false)] })).toBeNull();
    expect(nextOpenSeries({ tournaments, series: [series('s', 'scrims', 0, 0)], seriesGames: [] })).toBeNull();
  });

  it('skips a sandbox series and puts a dated series before an undated one (17 Sep 2026)', () => {
    const tournaments = [tournament('cup')];
    const all = [
      series('r1', 'cup', 3, 0, { scheduledAt: '2026-09-10T19:00' }),
      series('test', 'cup', 3, 1, { opponent: 'test', sandbox: true, scheduledAt: '2026-09-12T19:00' }),
      series('tbd', 'cup', 3, 2),
      series('r2', 'cup', 3, 3, { scheduledAt: '2026-09-20T19:30' })
    ];
    expect(nextOpenSeries({ tournaments, series: all, seriesGames: [game('r1', 1, true)] })?.id).toBe('r2');
    expect(nextOpenSeries({ tournaments, series: all, seriesGames: [game('r1', 1, true), game('r2', 1, true)] })?.id).toBe('tbd');
    // A group holding only the sandbox has no next series at all.
    expect(nextOpenSeries({ tournaments, series: [all[1]], seriesGames: [] })).toBeNull();
  });
});

describe('crownOf', () => {
  const tournaments = [tournament('cup')];
  const roster = [{ id: 'p-adc', name: 'SkilledScarecrow' }, { id: 'p-jg', name: 'Go10x' }];
  const line = (name: string, position: string, champion: string, kills: number) => ({ name, position, champion, kills, deaths: 1, assists: 5, damage: 10_000 + kills * 1000, killParticipation: 0.6 });
  const riot = (carry: string): MvpGame => ({
    players: [line('Go10x', 'JUNGLE', 'Vi', carry === 'Go10x' ? 12 : 1), line('SkilledScarecrow', 'BOTTOM', 'Miss Fortune', carry === 'SkilledScarecrow' ? 12 : 1)],
    kills: { ours: 20, theirs: 10 }
  });
  const finishedOf = (games: SeriesGame[], analysis: [string, MvpGame][]) => {
    const [f] = finishedSeries({ tournaments, series: [series('a', 'cup', 3, 0)], seriesGames: games, analysisById: new Map(), scrimById: noScrims });
    return { f, analysisById: new Map(analysis) };
  };

  it('crowns a named roster player when most of the series carries figures', () => {
    const { f, analysisById } = finishedOf([game('a', 1, true, { matchId: 'm1' }), game('a', 2, true, { matchId: 'm2' })], [['m1', riot('SkilledScarecrow')], ['m2', riot('SkilledScarecrow')]]);
    const crown = crownOf(f, analysisById, noScrims, roster)!;
    expect(crown.counts).toBe(true);
    expect(crown.playerId).toBe('p-adc');
    expect(crown.mvp.champion).toBe('Miss Fortune');
  });

  it('shows a thin mark as provisional: one game of figures in a 2–0 is not more than half', () => {
    const { f, analysisById } = finishedOf([game('a', 1, true, { matchId: 'm1' }), game('a', 2, true)], [['m1', riot('Go10x')]]);
    const crown = crownOf(f, analysisById, noScrims, roster)!;
    expect(crown.counts).toBe(false);
    expect(crown.why).toBe('thin');
  });

  it('does not count a name the roster does not carry, and ignores a game 3 that was never played', () => {
    const renamed: MvpGame = { players: [line('OldName', 'BOTTOM', 'Jinx', 15)], kills: { ours: 20, theirs: 10 } };
    const { f, analysisById } = finishedOf(
      [game('a', 1, true, { matchId: 'm1' }), game('a', 2, true, { matchId: 'm2' }), game('a', 3)],
      [['m1', renamed], ['m2', renamed]]
    );
    const crown = crownOf(f, analysisById, noScrims, roster)!;
    expect(crown.why).toBe('not-roster');
    expect(crown.mvp.of).toBe(2);
  });

  it('crowns nobody when no game carries figures', () => {
    const { f, analysisById } = finishedOf([game('a', 1, true), game('a', 2, true)], []);
    expect(crownOf(f, analysisById, noScrims, roster)).toBeNull();
  });
});

describe('seriesCrowns', () => {
  it('finds the finished series and what each crowns in one call, keeping an uncrowned one as null', () => {
    const tournaments = [tournament('cup')];
    const all = [series('a', 'cup', 1, 0), series('b', 'cup', 1, 1)];
    const players = [{ id: 'p-adc', name: 'SkilledScarecrow' }];
    const analysis = [{ matchId: 'm1', date: 5, players: [{ name: 'SkilledScarecrow', position: 'BOTTOM', champion: 'Jinx', kills: 9, deaths: 1, assists: 3, damage: 20_000, killParticipation: 0.7 }], kills: { ours: 12, theirs: 4 } }] as unknown as AnalysisGame[];
    const out = seriesCrowns({ tournaments, series: all, seriesGames: [game('a', 1, true, { matchId: 'm1' }), game('b', 1, false)], analysis, scrims: [], players });
    expect(out.finished.map((f) => f.series.id)).toEqual(['a', 'b']);
    expect(out.crowns.map((c) => c.playerId)).toEqual(['p-adc']);
    expect(out.crownBySeries.get('b')).toBeNull();
  });

  it('crowns nobody for a sandbox series, however well its games read', () => {
    const tournaments = [tournament('cup')];
    const players = [{ id: 'p-adc', name: 'SkilledScarecrow' }];
    const analysis = [{ matchId: 'm1', date: 5, players: [{ name: 'SkilledScarecrow', position: 'BOTTOM', champion: 'Jinx', kills: 9, deaths: 1, assists: 3, damage: 20_000, killParticipation: 0.7 }], kills: { ours: 12, theirs: 4 } }] as unknown as AnalysisGame[];
    const out = seriesCrowns({ tournaments, series: [series('test', 'cup', 1, 0, { sandbox: true })], seriesGames: [game('test', 1, true, { matchId: 'm1' })], analysis, scrims: [], players });
    expect(out.finished).toEqual([]);
    expect(out.crowns).toEqual([]);
    expect(out.crownBySeries.size).toBe(0);
  });
});
