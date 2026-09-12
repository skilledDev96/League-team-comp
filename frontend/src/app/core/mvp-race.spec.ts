import { describe, expect, it } from 'vitest';
import { Player, Role } from '../models/team.models';
import { lastCrown, mvpRace, podium, RaceEntry } from './mvp-race';
import { FinishedSeries, SeriesCrown } from './series-results';

const player = (id: string, name: string, role: Role, over: Partial<Player> = {}) => ({ id, name, role, order: 0, top3: [], ...over }) as unknown as Player;

interface CrownOptions {
  playerId?: string;
  counts?: boolean;
  champion?: string;
  seat?: Role;
  name?: string;
  endedAt?: number | null;
  result?: FinishedSeries['result'];
}

const crown = (seriesId: string, options: CrownOptions = {}) =>
  ({
    finished: { series: { id: seriesId, opponent: `Team ${seriesId}` }, result: options.result ?? 'won', endedAt: options.endedAt ?? null },
    mvp: { seat: options.seat ?? 'Mid', champion: options.champion ?? 'Ahri', ...(options.name ? { name: options.name } : {}) },
    ...(options.playerId ? { playerId: options.playerId } : {}),
    counts: options.counts ?? true,
    ...(options.counts === false ? { why: options.playerId ? 'thin' : 'no-name' } : {})
  }) as unknown as SeriesCrown;

const AUG_20 = Date.UTC(2026, 7, 20, 19, 0);
const AUG_27 = Date.UTC(2026, 7, 27, 19, 0);
const SEP_3 = Date.UTC(2026, 8, 3, 19, 0);

const roster = [
  player('p-sup', 'Maple', 'Support'),
  player('p-top', 'Oakheart', 'Top', { icon: 'https://example.test/oak.png' }),
  player('p-mid', 'Go10x', 'Mid'),
  player('p-adc', 'SkilledScarecrow', 'ADC'),
  player('p-jg', 'Birch', 'Jungle'),
  player('p-sub', 'Willow', 'Mid', { sub: true })
];

describe('mvpRace', () => {
  it('lists every starter at zero in lane order before any series has crowned anyone, and leaves the sub out', () => {
    const race = mvpRace([], roster);
    expect(race.map((e) => e.playerId)).toEqual(['p-top', 'p-jg', 'p-mid', 'p-adc', 'p-sup']);
    expect(race.every((e) => e.titles === 0 && e.provisional === 0 && !('lastTitle' in e))).toBe(true);
    expect(race[0].icon).toBe('https://example.test/oak.png');
    expect('icon' in race[1]).toBe(false);
  });

  it('lists a sub once a counting crown names them, and puts the title first', () => {
    const race = mvpRace([crown('s1', { playerId: 'p-sub', champion: 'Orianna', endedAt: AUG_20 })], roster);
    expect(race).toHaveLength(6);
    expect(race[0]).toEqual({
      playerId: 'p-sub',
      name: 'Willow',
      role: 'Mid',
      titles: 1,
      provisional: 0,
      lastTitle: { seriesId: 's1', opponent: 'Team s1', champion: 'Orianna', at: AUG_20 }
    });
  });

  it('counts a thin mark on a roster player as provisional, never a title, and a mark naming nobody as nothing', () => {
    const crowns = [crown('s1', { playerId: 'p-adc', counts: false }), crown('s2', { counts: false }), crown('s3', { playerId: 'p-sub', counts: false })];
    const race = mvpRace(crowns, roster);
    const adc = race.find((e) => e.playerId === 'p-adc')!;
    expect([adc.titles, adc.provisional, 'lastTitle' in adc]).toEqual([0, 1, false]);
    expect(race.find((e) => e.playerId === 'p-sub')?.provisional).toBe(1);
    expect(race.reduce((sum, e) => sum + e.provisional, 0)).toBe(2);
    // Nobody has a title, so a provisional mark moves nobody: lane order, and the two in Mid by name.
    expect(race.map((e) => e.playerId)).toEqual(['p-top', 'p-jg', 'p-mid', 'p-sub', 'p-adc', 'p-sup']);
  });

  it('ranks by titles, then by the later last title in schedule order rather than by date, then lane order', () => {
    const crowns = [
      crown('s1', { playerId: 'p-adc', endedAt: AUG_20 }),
      crown('s2', { playerId: 'p-top', endedAt: AUG_20 }),
      crown('s3', { playerId: 'p-mid', endedAt: AUG_27 }),
      crown('s4', { playerId: 'p-adc', champion: 'Jinx', endedAt: SEP_3 }),
      crown('s5', { playerId: 'p-top', champion: 'Gnar', endedAt: null }),
      crown('s6', { playerId: 'p-jg', counts: false })
    ];
    const race = mvpRace(crowns, roster);
    expect(race.map((e) => [e.playerId, e.titles, e.provisional])).toEqual([
      ['p-top', 2, 0],
      ['p-adc', 2, 0],
      ['p-mid', 1, 0],
      ['p-jg', 0, 1],
      ['p-sup', 0, 0]
    ]);
    expect(race[0].lastTitle).toEqual({ seriesId: 's5', opponent: 'Team s5', champion: 'Gnar', at: null });
    expect(race[1].lastTitle).toEqual({ seriesId: 's4', opponent: 'Team s4', champion: 'Jinx', at: SEP_3 });
  });

  it('breaks a tie in the same seat by name', () => {
    const shared = [player('b', 'Zelkova', 'Top'), player('a', 'Aspen', 'Top')];
    expect(mvpRace([], shared).map((e) => e.name)).toEqual(['Aspen', 'Zelkova']);
  });

  it('ignores a crown naming a player the roster no longer carries', () => {
    const race = mvpRace([crown('s1', { playerId: 'p-gone' })], roster);
    expect(race.map((e) => e.playerId)).not.toContain('p-gone');
    expect(race.every((e) => e.titles === 0)).toBe(true);
  });
});

describe('podium', () => {
  const entry = (playerId: string, titles: number): RaceEntry => ({ playerId, name: playerId, role: 'Mid', titles, provisional: 0 });

  it('ranks densely, so two players sharing first leave the next count second', () => {
    const race = [entry('a', 3), entry('b', 3), entry('c', 2), entry('d', 1), entry('e', 0)];
    expect(podium(race).map((p) => [p.place, p.entry.playerId])).toEqual([
      [1, 'a'],
      [1, 'b'],
      [2, 'c'],
      [3, 'd']
    ]);
  });

  it('cuts after third place and leaves out anyone without a title', () => {
    const race = [entry('a', 4), entry('b', 3), entry('c', 2), entry('d', 2), entry('e', 1), entry('f', 0)];
    expect(podium(race).map((p) => [p.place, p.entry.playerId])).toEqual([
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
      [3, 'd']
    ]);
  });

  it('is empty when nobody has a title', () => {
    expect(podium([entry('a', 0), entry('b', 0)])).toEqual([]);
  });
});

describe('lastCrown', () => {
  it('skips a newer mark that does not count and reads the newest one that does', () => {
    const crowns = [
      crown('s1', { playerId: 'p-top', champion: 'Gnar', seat: 'Top', endedAt: AUG_20 }),
      crown('s2', { playerId: 'p-adc', name: 'SkilledScarecrow', champion: 'Jinx', seat: 'ADC', result: 'lost', endedAt: AUG_27 }),
      crown('s3', { playerId: 'p-mid', counts: false, endedAt: SEP_3 })
    ];
    expect(lastCrown(crowns)).toEqual({
      seriesId: 's2',
      opponent: 'Team s2',
      result: 'lost',
      at: AUG_27,
      playerId: 'p-adc',
      name: 'SkilledScarecrow',
      champion: 'Jinx',
      seat: 'ADC'
    });
  });

  it('is null when no crown counts', () => {
    expect(lastCrown([])).toBeNull();
    expect(lastCrown([crown('s1', { playerId: 'p-top', counts: false })])).toBeNull();
  });

  it('leaves off a name the series did not carry and keeps an unknown end as null', () => {
    const crowned = lastCrown([crown('s1', { playerId: 'p-top', champion: 'Gnar', seat: 'Top' })])!;
    expect('name' in crowned).toBe(false);
    expect(crowned.at).toBeNull();
    expect(crowned.seat).toBe('Top');
  });
});
