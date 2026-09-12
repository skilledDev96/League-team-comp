import { describe, expect, it } from 'vitest';
import { Player } from '../models/team.models';
import { GameRow, PlayerLine } from '../pages/games/game-rows';
import { dayPart, welcomeFor } from './home-welcome';

const player = (id: string, name: string, role: string, order: number, over: Partial<Player> = {}) =>
  ({ id, name, role, order, strengths: [], weaknesses: [], top3: [], bans: [], ...over }) as unknown as Player;

const starters = [player('p-top', 'Zac', 'Top', 0), player('p-jg', 'Go10x', 'Jungle', 1), player('p-adc', 'SkilledScarecrow', 'ADC', 3)];

const line = (name: string, games: number) => ({ name, role: 'Jungle', games, wins: 1, winRate: 50, statGames: 0, kills: 0, deaths: 0, assists: 0, kda: 0, champions: [] }) as unknown as PlayerLine;

const row = (id: string, date: number, win: boolean, ourNames: (string | null)[], over: Partial<GameRow> = {}) =>
  ({
    id,
    source: 'riot',
    label: 'Flex',
    date,
    win,
    ours: ourNames.map((name, i) => ({ role: ['Top', 'Jungle', 'Mid', 'ADC', 'Support'][i] ?? '', champion: `Champ${i}`, player: name })),
    theirs: [],
    ...over
  }) as unknown as GameRow;

const base = {
  starters,
  lines: [line('Zac', 4), line('Go10x', 6)],
  titlesByPlayerId: new Map([['p-jg', 2]]),
  rows: [] as GameRow[],
  hour: 9,
  dismissed: false
};

describe('dayPart', () => {
  it('reads 5 to 11 as morning, 12 to 17 as afternoon, and the rest as evening', () => {
    expect([0, 4, 5, 11, 12, 17, 18, 23].map(dayPart)).toEqual(['Evening', 'Evening', 'Morning', 'Morning', 'Afternoon', 'Afternoon', 'Evening', 'Evening']);
  });
});

describe('welcomeFor', () => {
  it('greets the starter in the seat by name, with their line and their titles', () => {
    const w = welcomeFor({ ...base, seat: 'Jungle', hour: 14 });
    expect(w.greeting).toBe('Afternoon, Go10x');
    expect(w.player?.id).toBe('p-jg');
    expect(w.needsSeat).toBe(false);
    expect(w.line?.games).toBe(6);
    expect(w.titles).toBe(2);
  });

  it('takes the first by roster order when two starters share the seat', () => {
    const shared = [player('p-late', 'Later', 'Mid', 5), player('p-early', 'Earlier', 'Mid', 2)];
    const w = welcomeFor({ ...base, starters: shared, seat: 'Mid' });
    expect(w.player?.id).toBe('p-early');
    expect(w.greeting).toBe('Morning, Earlier');
    // The input is not reordered in place.
    expect(shared.map((p) => p.id)).toEqual(['p-late', 'p-early']);
  });

  it('reads the form from the five newest rows our player was in, newest first', () => {
    const t = 1_788_000_000_000;
    const rows = [
      row('r1', t, true, ['Zac', 'Go10x']),
      row('r2', t - 1, false, ['Zac', null]),
      row('r3', t - 2, false, ['Zac', 'Go10x']),
      row('r4', t - 3, true, ['Zac', 'Go10x']),
      row('r5', t - 4, true, ['Zac', 'Go10x']),
      row('r6', t - 5, false, ['Zac', 'Go10x']),
      row('r7', t - 6, true, ['Zac', 'Go10x'])
    ];
    const w = welcomeFor({ ...base, rows, seat: 'Jungle' });
    expect(w.form).toEqual(['W', 'L', 'W', 'W', 'L']);
    expect(welcomeFor({ ...base, rows: rows.slice(0, 2), seat: 'Top' }).form).toEqual(['W', 'L']);
  });

  it("never reads the other side's seats, even if one somehow carried a name", () => {
    // By construction the other side is champions only; this row breaks that on purpose to prove it is not read.
    const stray = row('r1', 1_788_000_000_000, true, [null], { theirs: [{ role: 'Jungle', champion: 'Vi', player: 'Go10x' }] });
    expect(welcomeFor({ ...base, rows: [stray], seat: 'Jungle' }).form).toEqual([]);
  });

  it('leaves the line out and counts no titles when the reader has neither', () => {
    const w = welcomeFor({ ...base, seat: 'ADC', hour: 20 });
    expect(w.greeting).toBe('Evening, SkilledScarecrow');
    expect('line' in w).toBe(false);
    expect(w.titles).toBe(0);
    expect(w.form).toEqual([]);
  });

  it('greets with the part of the day alone and asks for a seat when nobody is named, unless waved away', () => {
    const noSeat = welcomeFor({ ...base, hour: 6 });
    expect(noSeat).toEqual({ greeting: 'Morning', player: null, needsSeat: true, titles: 0, form: [] });
    const empty = welcomeFor({ ...base, seat: 'Support', hour: 23 });
    expect(empty.greeting).toBe('Evening');
    expect(empty.player).toBeNull();
    expect(empty.needsSeat).toBe(true);
    expect(welcomeFor({ ...base, dismissed: true }).needsSeat).toBe(false);
  });
});
