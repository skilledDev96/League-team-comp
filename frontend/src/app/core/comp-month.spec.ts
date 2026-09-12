import { describe, expect, it } from 'vitest';
import { Comp } from '../models/team.models';
import { GameRow } from '../pages/games/game-rows';
import { COMP_MONTH_DAYS, COMP_MONTH_MIN_GAMES, compOfTheMonth } from './comp-month';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 13, 12, 0, 0);

const comp = (id: string, name = `Comp ${id}`): Comp =>
  ({ id, name, picks: { Top: 'Ornn', Jungle: 'Vi', Mid: 'Ahri', ADC: 'Jinx', Support: 'Leona' }, order: 0 }) as unknown as Comp;

/** One game of a comp, `daysAgo` days before NOW. */
const row = (compId: string | undefined, daysAgo: number, win: boolean, over: Partial<GameRow> = {}): GameRow =>
  ({
    id: `riot-${compId ?? 'none'}-${daysAgo}-${win}`,
    source: 'riot',
    label: 'Flex',
    date: NOW - daysAgo * DAY,
    win,
    ours: [],
    theirs: [],
    ...(compId ? { compId, compName: 'The name the row captured' } : {}),
    ...over
  }) as unknown as GameRow;

/** `wins` wins and `losses` losses of one comp, all on the same day. */
const played = (compId: string, wins: number, losses: number, daysAgo = 1): GameRow[] => [
  ...Array.from({ length: wins }, () => row(compId, daysAgo, true)),
  ...Array.from({ length: losses }, () => row(compId, daysAgo, false))
];

describe('compOfTheMonth', () => {
  it('looks back thirty days and asks for three games by default', () => {
    expect(COMP_MONTH_DAYS).toBe(30);
    expect(COMP_MONTH_MIN_GAMES).toBe(3);
  });

  it('answers nothing for no games, for games with no comp, and for no comps', () => {
    expect(compOfTheMonth([], [], NOW)).toEqual({ best: null, nearest: null });
    expect(compOfTheMonth([row(undefined, 1, true), row(undefined, 2, true), row(undefined, 3, true)], [comp('a')], NOW)).toEqual({ best: null, nearest: null });
    expect(compOfTheMonth(played('a', 3, 0), [], NOW)).toEqual({ best: null, nearest: null });
  });

  it('names the comp with its saved name and picks, and counts its record', () => {
    const a = comp('a', 'Dive');
    const { best, nearest } = compOfTheMonth(played('a', 3, 1), [a], NOW);
    expect(best).toEqual({ compId: 'a', name: 'Dive', picks: a.picks, games: 4, wins: 3, losses: 1, winRate: 75 });
    expect(nearest).toBeNull();
  });

  it('keeps a game thirty days back and drops one thirty-one days back, one in the future and one undated', () => {
    const rows = [
      row('a', 1, true),
      row('a', 10, true),
      row('a', 30, true),
      row('a', 31, false),
      row('a', 0, false, { date: NOW + 60_000 }),
      row('a', 0, false, { date: 0 })
    ];
    expect(compOfTheMonth(rows, [comp('a')], NOW).best).toMatchObject({ games: 3, wins: 3, losses: 0, winRate: 100 });
  });

  it('takes a shorter window when asked', () => {
    const rows = [row('a', 1, true), row('a', 2, true), row('a', 8, false)];
    expect(compOfTheMonth(rows, [comp('a')], NOW, { days: 7, minGames: 2 }).best).toMatchObject({ games: 2, wins: 2 });
  });

  it('will not name a comp under the floor, however well it went', () => {
    const rows = [...played('a', 2, 0), ...played('b', 1, 2)];
    expect(compOfTheMonth(rows, [comp('a'), comp('b')], NOW).best).toMatchObject({ compId: 'b', winRate: 33 });
    expect(compOfTheMonth(played('a', 2, 0), [comp('a')], NOW).best).toBeNull();
    expect(compOfTheMonth(rows, [comp('a'), comp('b')], NOW, { minGames: 2 }).best).toMatchObject({ compId: 'a', winRate: 100 });
  });

  it('names the higher win rate first', () => {
    const rows = [...played('a', 2, 1), ...played('b', 3, 0)];
    expect(compOfTheMonth(rows, [comp('a'), comp('b')], NOW).best?.compId).toBe('b');
  });

  it('breaks a tie on the rounded rate toward more games, even when the raw rate is lower', () => {
    // 2 of 3 and 4 of 6 are both 67; 5 of 7 is 71.4 and 12 of 17 is 70.6, both 71.
    expect(compOfTheMonth([...played('a', 2, 1), ...played('b', 4, 2)], [comp('a'), comp('b')], NOW).best?.compId).toBe('b');
    const rows = [...played('a', 5, 2), ...played('b', 12, 5)];
    expect(compOfTheMonth(rows, [comp('a'), comp('b')], NOW).best).toMatchObject({ compId: 'b', games: 17, winRate: 71 });
  });

  it('breaks a tie on rate and games toward the comp played most recently', () => {
    const rows = [...played('a', 3, 0, 5), ...played('b', 2, 0, 9), row('b', 2, true)];
    expect(compOfTheMonth(rows, [comp('a'), comp('b')], NOW).best?.compId).toBe('b');
  });

  it('breaks a tie on rate, games and date by name, whatever order the rows and comps came in', () => {
    const rows = [...played('z', 3, 0, 4), ...played('m', 3, 0, 4)];
    expect(compOfTheMonth(rows, [comp('z', 'Zed poke'), comp('m', 'Anchor')], NOW).best?.name).toBe('Anchor');
  });

  it('ignores the games of a comp that has since been deleted', () => {
    const rows = [...played('gone', 5, 0), ...played('a', 2, 1)];
    expect(compOfTheMonth(rows, [comp('a')], NOW).best).toMatchObject({ compId: 'a', games: 3, winRate: 67 });
    expect(compOfTheMonth(played('gone', 5, 0), [comp('a')], NOW)).toEqual({ best: null, nearest: null });
  });

  it('offers the comp nearest the floor only when none is named, most games first, then most recent', () => {
    const rows = [row('a', 10, true), row('a', 12, false), row('b', 3, false), row('b', 6, true), row('c', 1, true)];
    expect(compOfTheMonth(rows, [comp('a', 'Dive'), comp('b', 'Poke'), comp('c', 'Protect')], NOW)).toEqual({
      best: null,
      nearest: { name: 'Poke', games: 2 }
    });
  });
});
