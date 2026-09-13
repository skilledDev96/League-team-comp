import { describe, expect, it } from 'vitest';
import { Scrim } from '../models/team.models';
import { GameMvp, isRemake, MVP_BASELINES, MVP_TERMS, MvpGame, MvpPlayer, mvpGameFromRow, mvpGameFromScrim, mvpGameOfSeriesGame, mvpOf, mvpSeatOf, SeriesMvp, seriesMvpOf, seriesMvpOfGames } from './game-mvp';

/** A seat's full end-of-game line, the way a replay or a refreshed analysis carries it. */
const seat = (position: string, champion: string, kills: number, deaths: number, assists: number, damage: number, damageTaken: number, visionScore: number, cs: number, name?: string): MvpPlayer => ({
  ...(name ? { name } : {}),
  position,
  champion,
  kills,
  deaths,
  assists,
  damage,
  damageTaken,
  visionScore,
  cs
});

/**
 * The game the lead asked about (13 Sep 2026): a support who lived, warded and was in on everything, beside an ADC
 * with a perfectly good line. Thirty minutes, eighteen kills. Worked by hand against the frozen usuals:
 * - Support: participation 21/18 → 100% (+2.5 spreads, clamped), 3.0 vision a minute (+0.69), 20 assists in 30 min
 *   (+1.25), two deaths (+1.61) → 1.51.
 * - ADC: 11/18 = 61% (+0.85), 29% of the damage (+1.07), 7.0 CS a minute (+0.43), four deaths (+0.72) → 0.77.
 * Under the old line the ADC won it outright: 18 + 7.5 − 8 + 3.5 + 3.7 against the support's 3 + 30 − 4 + 0.9 + 6.
 */
const SUPPORT_CARRY: MvpGame = {
  durationSec: 1800,
  kills: { ours: 18, theirs: 12 },
  players: [
    seat('TOP', 'Ornn', 2, 5, 6, 14000, 30000, 20, 180, 'Bom'),
    seat('JUNGLE', 'Vi', 4, 6, 8, 14000, 25000, 30, 150, 'Go10x'),
    seat('MIDDLE', 'Ahri', 5, 5, 6, 20000, 20000, 20, 200, 'Kez'),
    seat('BOTTOM', 'Jinx', 6, 4, 5, 22000, 15000, 20, 210, 'Rhu'),
    seat('UTILITY', 'Leona', 1, 2, 20, 6000, 18000, 90, 30, 'Sen')
  ]
};

/** A Riot analysis game before its length was cached: participation and damage, nothing per minute. */
const NO_LENGTH: MvpGame = {
  kills: { ours: 20, theirs: 35 },
  players: [
    { name: 'Bom', position: 'TOP', champion: 'Aatrox', kills: 4, deaths: 5, assists: 3, damage: 24000, killParticipation: 0.35 },
    { name: 'Go10x', position: 'JUNGLE', champion: 'Vi', kills: 5, deaths: 4, assists: 9, damage: 22000, killParticipation: 0.7 },
    { name: 'Kez', position: 'MIDDLE', champion: 'Ahri', kills: 6, deaths: 3, assists: 6, damage: 32000, killParticipation: 0.6 },
    { name: 'Rhu', position: 'BOTTOM', champion: 'Jinx', kills: 9, deaths: 2, assists: 5, damage: 52500, killParticipation: 0.7 },
    { name: 'Sen', position: 'UTILITY', champion: 'Leona', kills: 0, deaths: 6, assists: 11, damage: 8000, killParticipation: 0.55 }
  ]
};

describe('the role-aware model', () => {
  it('judges every role on four figures, counted equally, deaths against', () => {
    for (const [role, terms] of Object.entries(MVP_TERMS)) {
      const weights = Object.values(terms);
      expect(weights, role).toHaveLength(4);
      expect(terms.kp, role).toBe(1);
      expect(terms.deathsPerMin, role).toBe(-1);
      // Every term has a usual to be measured against.
      for (const metric of Object.keys(terms)) expect(MVP_BASELINES[role as keyof typeof MVP_BASELINES][metric as keyof typeof terms], `${role} ${metric}`).toBeDefined();
    }
  });

  it('lets a support carry a game, and says why against what supports usually do', () => {
    const mvp = mvpOf(SUPPORT_CARRY) as GameMvp;
    expect(mvp.seat).toBe('Support');
    expect(mvp.name).toBe('Sen');
    expect(mvp.champion).toBe('Leona');
    expect(mvp.points).toBeCloseTo(1.51, 1);
    expect(mvp.why).toEqual(['in on 100% of our kills (supports usually 52%)', '20 assists (supports usually 13)', 'died twice in 30 min (supports usually die 7)']);
    expect(mvp.why.join(' ')).not.toMatch(/score/i);
  });

  it("names the same seat for the film's poster as for the chip", () => {
    expect(mvpSeatOf(SUPPORT_CARRY)).toBe(mvpOf(SUPPORT_CARRY)?.seat);
    expect(mvpSeatOf(NO_LENGTH)).toBe(mvpOf(NO_LENGTH)?.seat);
    expect(mvpSeatOf(undefined)).toBeUndefined();
    expect(mvpSeatOf({ players: [] })).toBeUndefined();
  });

  it('claims nothing per minute without a game length, and still reads the shares it has', () => {
    const mvp = mvpOf(NO_LENGTH) as GameMvp;
    // Jinx: 70% participation (+1.47) and 38% of the damage (+2.4) on two terms.
    expect(mvp.seat).toBe('ADC');
    expect(mvp.why).toEqual(['38% of our damage (ADCs usually 22%)', 'in on 70% of our kills (ADCs usually 49%)']);
    expect(mvp.why.join(' ')).not.toMatch(/minute| min /);
  });

  it('drops a figure for every seat when any one seat lacks it', () => {
    // Leona's vision would be her best figure; with the jungler's missing, nobody is judged on vision.
    const blind: MvpGame = { ...SUPPORT_CARRY, players: SUPPORT_CARRY.players.map((p) => (p.position === 'JUNGLE' ? { ...p, visionScore: undefined } : p)) };
    const mvp = mvpOf(blind) as GameMvp;
    expect(mvp.seat).toBe('Support');
    expect(mvp.why.join(' ')).not.toContain('vision');
    // A zero team total is no share at all, not a share of zero.
    const noDamage: MvpGame = { ...SUPPORT_CARRY, players: SUPPORT_CARRY.players.map((p) => ({ ...p, damage: 0 })) };
    expect((mvpOf(noDamage) as GameMvp).why.join(' ')).not.toContain('damage');
  });

  it('gives a remake no MVP, and leaves it out of a series', () => {
    const remake: MvpGame = { ...SUPPORT_CARRY, durationSec: 240 };
    expect(isRemake(remake)).toBe(true);
    expect(isRemake({})).toBe(false);
    expect(mvpOf(remake)).toBeNull();
    expect(mvpSeatOf(remake)).toBeUndefined();
    const series = seriesMvpOf([
      { label: 'Game 1', game: remake },
      { label: 'Game 2', game: SUPPORT_CARRY }
    ]) as SeriesMvp;
    expect(series.read).toBe(1);
    expect(series.games).toBe(1);
  });

  it('never offers many deaths as a reason, and falls back to the K/D/A when too little lifted the seat', () => {
    // Three seats, all below their usual: the top laner edges it on participation alone, a fraction of a spread.
    const grim: MvpGame = {
      kills: { ours: 10, theirs: 30 },
      players: [
        { position: 'TOP', champion: 'Ornn', kills: 2, deaths: 3, assists: 2, damage: 20000 },
        { position: 'MIDDLE', champion: 'Ahri', kills: 1, deaths: 7, assists: 0, damage: 10000 },
        { position: 'BOTTOM', champion: 'Jinx', kills: 0, deaths: 9, assists: 0, damage: 70000 }
      ]
    };
    const mvp = mvpOf(grim) as GameMvp;
    expect(mvp.seat).toBe('Top');
    expect(mvp.why).toEqual(['in on 40% of our kills (tops usually 36%)', '2/3/2']);
    expect(mvpOf({ ...SUPPORT_CARRY, players: SUPPORT_CARRY.players.map((p) => ({ ...p, deaths: 8 })) })?.why.join(' ')).not.toContain('died');
  });

  it('hands back nothing for a game with nobody in a seat it knows', () => {
    expect(mvpOf(null)).toBeNull();
    expect(mvpOf({ players: [] })).toBeNull();
    expect(mvpOf({ players: [{ position: 'AFK', champion: 'Teemo', kills: 9, deaths: 0, assists: 9 }] })).toBeNull();
  });

  it('reads a game row with the figures the row carries, never zeros for the ones it does not', () => {
    const row = {
      durationSec: 1800,
      kills: { ours: 18, theirs: 12 },
      ours: SUPPORT_CARRY.players.map((p) => ({
        role: p.position,
        champion: p.champion,
        player: p.name ?? null,
        stats: { kills: p.kills, deaths: p.deaths, assists: p.assists, cs: p.cs, damage: p.damage, damageTaken: p.damageTaken, vision: p.visionScore }
      }))
    };
    const game = mvpGameFromRow(row);
    expect(game.durationSec).toBe(1800);
    expect(game.players[4]).toMatchObject({ visionScore: 90, cs: 30, damageTaken: 18000 });
    expect(mvpOf(game)?.seat).toBe('Support');
    // A typed-in game carries no figures on anyone: no line, no chip.
    expect(mvpGameFromRow({ ours: [{ role: 'ADC', champion: 'Jinx', player: 'Rhu' }] }).players).toEqual([]);
  });
});

describe('seriesMvpOf', () => {
  /** The support-carry game with the support's line swapped for another game's. */
  const withSupport = (champion: string, assists: number, deaths: number): MvpGame => ({
    ...SUPPORT_CARRY,
    players: SUPPORT_CARRY.players.map((p) => (p.position === 'UTILITY' ? { ...p, champion, assists, deaths } : p))
  });

  it('takes the best average per game, names the champion of the best game, and says what the average is over', () => {
    // Leona 1.51, Nautilus 0.68, Rell 1.27: an average of 1.15 against the ADC's steady 0.77.
    const mvp = seriesMvpOf([
      { label: 'Game 1', game: SUPPORT_CARRY },
      { label: 'Game 2', game: withSupport('Nautilus', 12, 5) },
      { label: 'Game 3', game: withSupport('Rell', 16, 3) }
    ]) as SeriesMvp;
    expect(mvp.seat).toBe('Support');
    expect(mvp.name).toBe('Sen');
    expect(mvp.games).toBe(3);
    // The tile shows the champion of the best of the three, not the last one played.
    expect(mvp.champion).toBe('Leona');
    expect(mvp.points).toBeCloseTo(1.15, 1);
    expect(mvp.read).toBe(3);
    expect(mvp.of).toBe(3);
    expect(mvp.line).toBe('Best line per game across all 3 games.');
    expect(mvp.why).toHaveLength(3);
    expect(mvp.why[0]).toBe('Game 1 on Leona: in on 100% of our kills (supports usually 52%) · 20 assists (supports usually 13) · died twice in 30 min (supports usually die 7)');
  });

  it('judges a seat on the games it played, and names the same seat as the game when it is one', () => {
    const mvp = seriesMvpOf([{ label: 'Game 1', game: SUPPORT_CARRY }]) as SeriesMvp;
    expect(mvp.seat).toBe(mvpOf(SUPPORT_CARRY)?.seat);
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
    const mvp = seriesMvpOf([{ label: 'Game 1', game: SUPPORT_CARRY }], 3) as SeriesMvp;
    expect(mvp.read).toBe(1);
    expect(mvp.of).toBe(3);
    expect(mvp.line).toBe('Averaged over the 1 of 3 games that carry figures. 2 games have no replay imported yet, so this may move.');
  });

  it('counts one missing game in the singular, and never claims fewer games than it read', () => {
    const two = [
      { label: 'Game 1', game: SUPPORT_CARRY },
      { label: 'Game 2', game: withSupport('Rell', 16, 3) }
    ];
    expect((seriesMvpOf(two, 3) as SeriesMvp).line).toContain('1 game has no replay imported yet');
    // A caller that under-reports the series length cannot make the mark lie about what it read.
    const bad = seriesMvpOf(two, 1) as SeriesMvp;
    expect(bad.of).toBe(2);
    expect(bad.read).toBe(2);
  });

  it('divides by the games that seat played, so a seat that sat one out is not marked down for it', () => {
    const withoutSupport: MvpGame = { ...SUPPORT_CARRY, players: SUPPORT_CARRY.players.filter((p) => p.position !== 'UTILITY') };
    const series = seriesMvpOf([{ label: 'Game 1', game: SUPPORT_CARRY }, { label: 'Game 2', game: withoutSupport }]) as SeriesMvp;
    expect(series.seat).toBe('Support');
    expect(series.games).toBe(1);
    // Two games were played and both could be read; the support only appeared in one of them.
    expect(series.read).toBe(2);
    expect(series.of).toBe(2);
    expect(series.line).toBe('Best line per game across all 2 games, of which this seat played 1.');
    expect(series.why).toHaveLength(1);
    expect(series.why[0]).toMatch(/^Game 1 on Leona: /);
  });

  it('names the person only while one of them held the seat, so a sub is never credited with the other\'s games', () => {
    // 11 Sep 2026, second fix pass: the name used to be the last game's, so a Bo3 with a sub in the final game named
    // whoever played it over an average built from both.
    const named = (name: string, kills: number, deaths: number, assists: number): MvpGame => ({
      players: [{ name, position: 'Mid', champion: 'Ahri', kills, deaths, assists }, { position: 'Top', champion: 'Ornn', kills: 1, deaths: 4, assists: 2 }]
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

  it('reads our five off the side the replay knows, with the kills, the length and every figure the file carries', () => {
    const game = mvpGameFromScrim(scrim('blue')) as MvpGame;
    expect(game.players.map((p) => p.champion)).toEqual(['Jinx', 'Aatrox']);
    expect(game.kills).toEqual({ ours: 11, theirs: 5 });
    expect(game.durationSec).toBe(1800);
    expect(game.players[0]).toMatchObject({ cs: 0, damageTaken: 0, visionScore: 0 });
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

/** Moved from Prep & Draft on 13 Sep 2026 so Home crowns exactly the person Prep does. */
describe('reading a series game', () => {
  const riotGame: MvpGame = { players: [{ name: 'Ours', position: 'BOTTOM', champion: 'Jinx', kills: 9, deaths: 1, assists: 4, damage: 20_000, killParticipation: 0.7 }], kills: { ours: 20, theirs: 8 } };
  const replay = {
    id: 'r1', playedOn: '2026-09-01T18:00:00.000Z', durationSec: 1500, blueWon: true, order: 0,
    players: [
      { name: 'Ours', tag: 'X', champion: 'Leona', team: 100, win: true, position: 'UTILITY', kills: 1, deaths: 2, assists: 14, gold: 8000, damage: 6000, damageToBuildings: 0, damageTaken: 20000, visionScore: 60, cs: 30 },
      { name: 'Theirs', tag: 'Y', champion: 'Ahri', team: 200, win: false, position: 'MIDDLE', kills: 3, deaths: 4, assists: 1, gold: 9000, damage: 12000, damageToBuildings: 0, damageTaken: 9000, visionScore: 10, cs: 200 }
    ]
  } as unknown as Scrim;

  it('prefers the Riot game, falls back to the replay on the side the game recorded, and reads nothing without a side', () => {
    const analysis = new Map([['m1', riotGame]]);
    const scrims = new Map([['r1', replay]]);
    expect(mvpGameOfSeriesGame({ matchId: 'm1' }, analysis, scrims)).toBe(riotGame);
    expect(mvpGameOfSeriesGame({ matchId: 'r1', ourSide: 'blue' }, analysis, scrims)?.players.map((p) => p.champion)).toEqual(['Leona']);
    expect(mvpGameOfSeriesGame({ matchId: 'r1' }, analysis, scrims)).toBeNull();
    expect(mvpGameOfSeriesGame({}, analysis, scrims)).toBeNull();
  });

  it('labels each game and passes the series length, so the mark knows it read 1 of 2', () => {
    const mvp = seriesMvpOfGames([{ gameNumber: 1, matchId: 'm1' }, { gameNumber: 2 }], new Map([['m1', riotGame]]), new Map())!;
    expect(mvp.read).toBe(1);
    expect(mvp.of).toBe(2);
    expect(mvp.why[0]).toMatch(/^Game 1 on Jinx/);
  });
});
