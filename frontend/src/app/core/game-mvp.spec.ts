import { describe, expect, it } from 'vitest';
import { Scrim } from '../models/team.models';
import { GameMvp, MvpGame, MvpPlayer, mvpGameFromScrim, mvpOf, mvpSeatOf, SeriesMvp, seriesMvpOf } from './game-mvp';

/** A seat's line, Riot's way round: everything the analysis carries. */
const riot = (position: string, champion: string, name: string, kills: number, deaths: number, assists: number, damage: number, killParticipation: number): MvpPlayer => ({
  name,
  position,
  champion,
  kills,
  deaths,
  assists,
  damage,
  killParticipation
});

/** A seat's line off a replay: no damage figures and no kill participation. */
const replay = (position: string, champion: string, kills: number, deaths: number, assists: number): MvpPlayer => ({ position, champion, kills, deaths, assists });

/** The lead's own example: Jinx on 52.5k damage, 38 percent of ours, on 14 of 20 kills, dead twice. */
const ANALYSED: MvpGame = {
  kills: { ours: 20, theirs: 35 },
  players: [
    riot('TOP', 'Aatrox', 'Bom', 4, 5, 3, 24000, 0.5),
    riot('JUNGLE', 'Vi', 'Go10x', 5, 4, 9, 22000, 0.7),
    riot('MIDDLE', 'Ahri', 'Kez', 6, 3, 6, 32000, 0.6),
    riot('BOTTOM', 'Jinx', 'Rhu', 9, 2, 5, 52500, 0.7),
    riot('UTILITY', 'Leona', 'Sen', 0, 6, 11, 8000, 0.55)
  ]
};

/** The same five out of a replay: no damage figures at all, no participation, our seat words rather than Riot's. */
const REPLAYED: MvpGame = {
  players: [replay('Top', 'Aatrox', 2, 3, 4), replay('Jungle', 'Vi', 7, 2, 5), replay('Mid', 'Ahri', 3, 4, 6), replay('ADC', 'Jinx', 6, 1, 4), replay('Support', 'Leona', 1, 5, 9)]
};

describe('mvpOf', () => {
  it("names the seat that carried it and the terms that carried it, in the lead's own words", () => {
    const mvp = mvpOf(ANALYSED) as GameMvp;
    expect(mvp.seat).toBe('ADC');
    expect(mvp.name).toBe('Rhu');
    expect(mvp.champion).toBe('Jinx');
    expect(mvp.why).toEqual(['52.5k damage, 38% of ours', 'on 14 of 20 kills', 'died twice']);
  });

  it("picks the same seat the film's poster picks, since the weights are the poster's", () => {
    expect(mvpSeatOf(ANALYSED)).toBe('ADC');
    expect(mvpSeatOf(REPLAYED)).toBe('Jungle');
    expect(mvpSeatOf(undefined)).toBeUndefined();
    expect(mvpSeatOf({ players: [] })).toBeUndefined();
  });

  it('claims no damage term on a game with no damage figures, and counts the kills it does carry', () => {
    // A replay knows kills, deaths and assists and nothing else; "0 damage, 0% of ours" would be a finding about the player rather than about the file.
    const mvp = mvpOf(REPLAYED) as GameMvp;
    expect(mvp.seat).toBe('Jungle');
    expect(mvp.champion).toBe('Vi');
    expect(mvp.name).toBeUndefined();
    // Nineteen kills between the five, and Vi was in on seven of her own and five of theirs.
    expect(mvp.why).toEqual(['on 12 of 19 kills', 'died twice']);
    expect(mvp.why.join(' ')).not.toContain('damage');
  });

  it('reads a seat with no kills of its own by the kills it was in on', () => {
    // A support can carry a game without taking a kill: the term is what they were on, never "0 kills".
    const support = mvpOf({
      players: [replay('Top', 'Ornn', 2, 3, 5), replay('Jungle', 'Vi', 3, 3, 6), replay('Mid', 'Ahri', 3, 2, 7), replay('ADC', 'Jinx', 4, 3, 6), replay('Support', 'Leona', 0, 0, 12)]
    }) as GameMvp;
    expect(support.seat).toBe('Support');
    expect(support.why).toEqual(['on 12 of 12 kills', 'never died']);
  });

  it('falls back to the kills and assists when the game counted no kills at all', () => {
    const quiet = mvpOf({ players: [{ position: 'Top', champion: 'Ornn', kills: 0, deaths: 0, assists: 0 }] }) as GameMvp;
    expect(quiet.why).toEqual(['no kills or assists', 'never died']);
    const assisted = mvpOf({ players: [{ position: 'Support', champion: 'Leona', kills: 0, deaths: 1, assists: 6 }] }) as GameMvp;
    expect(assisted.why).toEqual(['6 assists', 'died once']);
    const dead = mvpOf({ players: [{ position: 'Top', champion: 'Ornn', kills: 0, deaths: 7, assists: 0 }] }) as GameMvp;
    expect(dead.why).toEqual(['no kills or assists', 'died 7 times']);
  });

  it('reads a participation share when the game counted no kills of its own', () => {
    const mvp = mvpOf({ kills: { ours: 0, theirs: 4 }, players: [{ position: 'Mid', champion: 'Ahri', kills: 0, deaths: 2, assists: 0, killParticipation: 0.75 }] }) as GameMvp;
    expect(mvp.why).toEqual(['in on 75% of our kills', 'died twice']);
  });

  it('hands back nothing for a game with nobody in a seat it knows', () => {
    expect(mvpOf(null)).toBeNull();
    expect(mvpOf({ players: [] })).toBeNull();
    expect(mvpOf({ players: [{ position: 'AFK', champion: 'Teemo', kills: 9, deaths: 0, assists: 9 }] })).toBeNull();
  });

  it('ties to lane order, the way the poster tied', () => {
    const twins: MvpPlayer[] = [replay('Jungle', 'Vi', 5, 1, 5), replay('Top', 'Aatrox', 5, 1, 5)];
    expect(mvpOf({ players: twins })?.seat).toBe('Top');
    expect(mvpOf({ players: twins.slice().reverse() })?.seat).toBe('Top');
  });
});

describe('seriesMvpOf', () => {
  /** Five out of a replay with one seat's line handed in, so the team's kills move with it the way they would. */
  const five = (seat: string, champion: string, kills: number, deaths: number, assists: number): MvpGame => ({
    players: [replay('Top', 'Ornn', 1, 3, 2), replay('Jungle', 'Vi', 2, 3, 4), replay('Mid', 'Ahri', 3, 2, 5), replay('ADC', 'Jinx', 2, 3, 3), replay('Support', 'Leona', 0, 4, 6)].map(
      (p) => (p.position === seat ? { position: seat, champion, kills, deaths, assists } : p)
    )
  });

  it('takes the best average per game, names the champion of the best game, and says what the average is over', () => {
    const mvp = seriesMvpOf([
      { label: 'Game 1', game: five('ADC', 'Jinx', 8, 1, 4) },
      { label: 'Game 2', game: five('ADC', "Kai'Sa", 6, 2, 6) },
      { label: 'Game 3', game: five('ADC', 'Ashe', 2, 4, 3) }
    ]) as SeriesMvp;
    expect(mvp.seat).toBe('ADC');
    expect(mvp.games).toBe(3);
    // The tile shows the champion of the best of the three, not the last one played.
    expect(mvp.champion).toBe('Jinx');
    expect(mvp.read).toBe(3);
    expect(mvp.of).toBe(3);
    expect(mvp.line).toBe('Best line per game across all 3 games.');
    expect(mvp.why).toEqual([
      'Game 1 on Jinx: on 12 of 14 kills · died once',
      "Game 2 on Kai'Sa: on 12 of 12 kills · died twice",
      'Game 3 on Ashe: on 5 of 8 kills · died four times'
    ]);
  });

  it('judges a seat on the games it played, and says so when that is one', () => {
    const mvp = seriesMvpOf([{ label: 'Game 1', game: five('Mid', 'Ahri', 9, 0, 5) }]) as SeriesMvp;
    expect(mvp.seat).toBe('Mid');
    expect(mvp.games).toBe(1);
    expect(mvp.read).toBe(1);
    expect(mvp.of).toBe(1);
    expect(mvp.line).toBe('The one game of this series so far — the same answer as that game’s own MVP.');
  });

  /**
   * The mark is an average, and nothing on screen used to say what it was an average OF
   * (12 Sep 2026). A tournament game only carries figures once its replay is imported, so a Bo3
   * with one .rofl dropped in produced a "Series MVP" that was — correctly and invisibly — that
   * one game's MVP. It read as a bug because the chip could not tell the reader otherwise.
   */
  it('says how many of the series’ games it could actually read', () => {
    const played = [{ label: 'Game 1', game: five('ADC', 'Jinx', 8, 1, 4) }];
    const mvp = seriesMvpOf(played, 3) as SeriesMvp;
    expect(mvp.read).toBe(1);
    expect(mvp.of).toBe(3);
    expect(mvp.line).toBe('Averaged over the 1 of 3 games that carry figures. 2 games have no replay imported yet, so this may move.');
  });

  it('counts one missing game in the singular, and never claims fewer games than it read', () => {
    const two = [
      { label: 'Game 1', game: five('ADC', 'Jinx', 8, 1, 4) },
      { label: 'Game 2', game: five('ADC', 'Ashe', 6, 2, 5) }
    ];
    expect((seriesMvpOf(two, 3) as SeriesMvp).line).toContain('1 game has no replay imported yet');
    // A caller that under-reports the series length cannot make the mark lie about what it read.
    const bad = seriesMvpOf(two, 1) as SeriesMvp;
    expect(bad.of).toBe(2);
    expect(bad.read).toBe(2);
  });

  it('divides by the games that seat played, so a seat that sat one out is not marked down for it', () => {
    const withoutAdc: MvpGame = { players: five('Mid', 'Ahri', 3, 2, 5).players.filter((p) => p.position !== 'ADC') };
    const series = seriesMvpOf([{ label: 'Game 1', game: five('ADC', 'Jinx', 9, 1, 5) }, { label: 'Game 2', game: withoutAdc }]) as SeriesMvp;
    expect(series.seat).toBe('ADC');
    expect(series.games).toBe(1);
    // Two games were played and both could be read; the ADC only appeared in one of them. The old
    // wording said "the one game played so far", which read as if the series had one game.
    expect(series.read).toBe(2);
    expect(series.of).toBe(2);
    expect(series.line).toBe('Best line per game across all 2 games, of which this seat played 1.');
    expect(series.why).toEqual(['Game 1 on Jinx: on 14 of 15 kills · died once']);
  });

  it('ties to the better damage share', () => {
    // The same kills, deaths and assists in both seats, so the points come out level and the damage decides.
    const level: MvpGame = {
      players: [
        { position: 'Mid', champion: 'Ahri', kills: 5, deaths: 2, assists: 5, damage: 30000 },
        { position: 'Top', champion: 'Ornn', kills: 5, deaths: 2, assists: 5, damage: 12000 }
      ]
    };
    expect(seriesMvpOf([{ label: 'Game 1', game: level }])?.seat).toBe('Mid');
    const swapped: MvpGame = { players: [{ ...level.players[0], damage: 12000 }, { ...level.players[1], damage: 30000 }] };
    expect(seriesMvpOf([{ label: 'Game 1', game: swapped }])?.seat).toBe('Top');
  });

  it('names the person only while one of them held the seat, so a sub is never credited with the other\'s games', () => {
    // 11 Sep 2026, second fix pass: the name used to be the last game's, so a Bo3 with a sub in the final game named
    // whoever played it over an average built from both.
    const named = (name: string, kills: number, deaths: number, assists: number): MvpGame => ({
      players: [{ name, position: 'Mid', champion: 'Ahri', kills, deaths, assists }, replay('Top', 'Ornn', 1, 4, 2)]
    });
    const one = seriesMvpOf([
      { label: 'Game 1', game: named('Kez', 9, 0, 5) },
      { label: 'Game 2', game: named('Kez', 7, 1, 4) }
    ]) as SeriesMvp;
    expect(one.seat).toBe('Mid');
    expect(one.name).toBe('Kez');
    const shared = seriesMvpOf([
      { label: 'Game 1', game: named('Kez', 9, 0, 5) },
      { label: 'Game 2', game: named('Sen', 7, 1, 4) }
    ]) as SeriesMvp;
    expect(shared.seat).toBe('Mid');
    expect(shared.name).toBeUndefined();
    // The champion of the best game still carries the chip, and the per-game lines still say what each game was.
    expect(shared.champion).toBe('Ahri');
    expect(shared.games).toBe(2);
  });

  it('hands back nothing for a series with no games, or with no figures in them', () => {
    expect(seriesMvpOf([])).toBeNull();
    expect(seriesMvpOf([{ label: 'Game 1', game: { players: [] } }])).toBeNull();
  });
});

describe('mvpGameFromScrim', () => {
  const player = (team: number, position: string, champion: string, name: string, kills: number, deaths: number, assists: number, damage: number) =>
    ({ team, position, champion, name, tag: 'EUW', win: team === 100, kills, deaths, assists, damage, gold: 0, damageToBuildings: 0, damageTaken: 0, visionScore: 0, cs: 0 }) as Scrim['players'][number];

  const scrim = (ourSide?: 'blue' | 'red'): Scrim =>
    ({
      id: 'EUW1_1',
      playedOn: '2026-09-10T18:00:00.000Z',
      durationSec: 1800,
      blueWon: true,
      ...(ourSide ? { ourSide } : {}),
      players: [
        player(100, 'BOTTOM', 'Jinx', 'Rhu', 9, 2, 5, 52500),
        player(100, 'TOP', 'Aatrox', 'Bom', 2, 4, 3, 18000),
        player(200, 'BOTTOM', 'Caitlyn', 'Them', 4, 6, 2, 30000),
        player(200, 'TOP', 'Gnar', 'Them2', 1, 3, 4, 12000)
      ],
      order: 0
    }) as Scrim;

  it('reads our five off the side the replay knows, with the kills counted from the file', () => {
    const game = mvpGameFromScrim(scrim('blue')) as MvpGame;
    expect(game.players.map((p) => p.champion)).toEqual(['Jinx', 'Aatrox']);
    expect(game.kills).toEqual({ ours: 11, theirs: 5 });
    expect(mvpOf(game)?.champion).toBe('Jinx');
  });

  it("takes the series game's answer when the replay has not been told which side we were", () => {
    expect(mvpGameFromScrim(scrim(), 'red')?.players.map((p) => p.champion)).toEqual(['Caitlyn', 'Gnar']);
    // The replay's own answer wins: it was set on the file, not guessed on the game.
    expect(mvpGameFromScrim(scrim('blue'), 'red')?.players.map((p) => p.champion)).toEqual(['Jinx', 'Aatrox']);
  });

  it('guesses nothing when nobody has said which side we were', () => {
    expect(mvpGameFromScrim(scrim())).toBeNull();
  });
});
