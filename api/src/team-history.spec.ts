import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DAYS,
  HistoryMatch,
  HistoryParticipant,
  MAX_DAYS,
  gameTogether,
  gamesTogether,
  parseTeamHistoryRequest,
  sinceSeconds,
  summariseTogether
} from './team-history';

const five = ['p-top', 'p-jg', 'p-mid', 'p-adc', 'p-sup'];
const names = new Map(five.map((p) => [p, p.slice(2)]));

const part = (puuid: string, teamId: number, pos: string, champ: string, win: boolean): HistoryParticipant => ({
  puuid,
  teamId,
  teamPosition: pos,
  championName: champ,
  win
});

/** A full game: `ours` of the five on blue, strangers filling the rest. */
function match(ours: number, win = true, queueId = 440): HistoryMatch {
  const positions = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  const blue = positions.map((pos, i) => part(i < ours ? five[i] : 'stranger-' + i, 100, pos, 'B' + i, win));
  const red = positions.map((pos, i) => part('enemy-' + i, 200, pos, 'R' + i, !win));
  return { queueId, gameCreation: Date.UTC(2026, 8, 1 + ours), participants: [...blue, ...red] };
}

describe('parseTeamHistoryRequest', () => {
  const players = [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }];

  it('defaults and clamps the window', () => {
    expect(parseTeamHistoryRequest({ players }).days).toBe(DEFAULT_DAYS);
    expect(parseTeamHistoryRequest({ players, days: 500 }).days).toBe(MAX_DAYS);
    expect(parseTeamHistoryRequest({ players, days: 1 }).days).toBe(7);
    expect(parseTeamHistoryRequest({ players, days: '30' }).days).toBe(DEFAULT_DAYS);
  });

  it('still validates the players like a synergy request', () => {
    expect(() => parseTeamHistoryRequest({ players: [] })).toThrow();
  });
});

describe('sinceSeconds', () => {
  it('is epoch seconds, days back', () => {
    expect(sinceSeconds(30, Date.UTC(2026, 8, 4))).toBe(Math.floor(Date.UTC(2026, 7, 5) / 1000));
  });
});

describe('gameTogether', () => {
  it('reads the side with the most of them, in seat order, naming only the five', () => {
    const g = gameTogether('m1', match(4), names)!;
    expect(g.together).toBe(4);
    expect(g.side).toBe('blue');
    expect(g.win).toBe(true);
    expect(g.queue).toBe('Flex');
    expect(g.picks.map((p) => p.role)).toEqual(['Top', 'Jungle', 'Mid', 'ADC', 'Support']);
    expect(g.picks.map((p) => p.player)).toEqual(['top', 'jg', 'mid', 'adc', null]);
    expect(g.enemies.every((p) => p.player === null)).toBe(true);
  });

  it('is null below the floor, and two of them on opposite sides do not add up', () => {
    expect(gameTogether('m2', match(2), names)).toBeNull();
    const split = match(2);
    // Move a third roster member onto the enemy side: still only two together.
    split.participants[5] = part(five[4], 200, 'TOP', 'R0', false);
    expect(gameTogether('m3', split, names)).toBeNull();
  });

  it('labels an unknown queue by number rather than dropping the game', () => {
    expect(gameTogether('m4', match(5, true, 9999), names)!.queue).toBe('9999');
  });
});

describe('gamesTogether / summariseTogether', () => {
  it('keeps the games that count, newest first, and tallies the picks', () => {
    const games = gamesTogether(
      [
        { id: 'a', match: match(3, true) },
        { id: 'b', match: match(5, false) },
        { id: 'c', match: match(2, true) },
        { id: 'd', match: match(5, true) }
      ],
      names
    );
    expect(games.map((g) => g.matchId)).toEqual(['b', 'd', 'a']);
    const s = summariseTogether(games);
    expect(s).toMatchObject({ games: 3, wins: 2, losses: 1, fullStacks: 2 });
    // The top laner's B0 appears in all three; a stranger's pick never counts.
    expect(s.picks[0]).toEqual({ champion: 'B0', role: 'Top', games: 3, wins: 2, winRate: 67 });
    expect(s.picks.find((p) => p.champion === 'B4')!.games).toBe(2);
  });

  it('is empty for no games', () => {
    expect(summariseTogether([])).toEqual({ games: 0, wins: 0, losses: 0, fullStacks: 0, picks: [] });
  });
});
