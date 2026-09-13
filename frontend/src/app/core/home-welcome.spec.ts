import { describe, expect, it } from 'vitest';
import { Player } from '../models/team.models';
import { dayPart, soloOf, welcomeFor } from './home-welcome';

const player = (id: string, name: string, role: string, order: number, over: Partial<Player> = {}) =>
  ({ id, name, role, order, strengths: [], weaknesses: [], top3: [], bans: [], ...over }) as unknown as Player;

const ranked = (tier: string, division: string, wins: number, losses: number) => ({ queueType: 'RANKED_SOLO_5x5', tier, rank: division, leaguePoints: 64, wins, losses, winRate: 0 });
const sample = (games: number, wins: number, avgKda: number) => ({ games, wins, losses: games - wins, winRate: Math.round((wins / games) * 100), avgKda });

const starters = [
  player('p-top', 'Zac', 'Top', 0),
  player('p-jg', 'Go10x', 'Jungle', 1, { queueStats: { solo: { rank: ranked('GOLD', 'I', 80, 70), matches: sample(155, 82, 2.9) } } } as never),
  player('p-adc', 'SkilledScarecrow', 'ADC', 3)
];

const base = {
  starters,
  titlesByPlayerId: new Map([['p-jg', 2]]),
  hour: 9,
  dismissed: false
};

describe('dayPart', () => {
  it('reads 5 to 11 as morning, 12 to 17 as afternoon, and the rest as evening', () => {
    expect([0, 4, 5, 11, 12, 17, 18, 23].map(dayPart)).toEqual(['Evening', 'Evening', 'Morning', 'Morning', 'Afternoon', 'Afternoon', 'Evening', 'Evening']);
  });
});

describe('welcomeFor', () => {
  it('greets the starter in the seat by name, with their own solo queue and their titles', () => {
    const w = welcomeFor({ ...base, seat: 'Jungle', hour: 14 });
    expect(w.greeting).toBe('Afternoon, Go10x');
    expect(w.player?.id).toBe('p-jg');
    expect(w.needsSeat).toBe(false);
    expect(w.solo).toEqual({ rank: 'Gold I', lp: 64, games: 150, wins: 80, winRate: 53, kda: 2.9, from: 'season' });
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

  it('reads the season ladder when ranked, the games Riot read when not, and nothing when it read none', () => {
    expect(soloOf(player('a', 'A', 'Mid', 0, { queueStats: { solo: { matches: sample(40, 22, 3.1) } } } as never))).toEqual({ rank: null, lp: null, games: 40, wins: 22, winRate: 55, kda: 3.1, from: 'sample' });
    expect(soloOf(player('b', 'B', 'Mid', 0, { queueStats: { solo: { rank: ranked('MASTER', 'I', 10, 10) } } } as never))).toMatchObject({ rank: 'Master', games: 20, winRate: 50, kda: null });
    expect(soloOf(player('c', 'C', 'Mid', 0, { queueStats: { flex: { rank: ranked('GOLD', 'I', 10, 10) } } } as never))).toBeNull();
  });

  it('says nothing of solo and counts no titles when the reader has neither', () => {
    const w = welcomeFor({ ...base, seat: 'ADC', hour: 20 });
    expect(w.greeting).toBe('Evening, SkilledScarecrow');
    expect(w.solo).toBeNull();
    expect(w.titles).toBe(0);
  });

  it('greets with the part of the day alone and asks for a seat when nobody is named, unless waved away', () => {
    const noSeat = welcomeFor({ ...base, hour: 6 });
    expect(noSeat).toEqual({ greeting: 'Morning', player: null, needsSeat: true, titles: 0, solo: null });
    const empty = welcomeFor({ ...base, seat: 'Support', hour: 23 });
    expect(empty.greeting).toBe('Evening');
    expect(empty.player).toBeNull();
    expect(empty.needsSeat).toBe(true);
    expect(welcomeFor({ ...base, dismissed: true }).needsSeat).toBe(false);
  });
});
