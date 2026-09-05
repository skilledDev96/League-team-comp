import { describe, expect, it } from 'vitest';
import { ChampionTraits } from '../../models/team.models';
import { comfortOf, gamePlan, readLanes, readSeat, SeatInput } from './lane-read';

const traits = (over: Partial<ChampionTraits>): ChampionTraits => ({
  id: 'X',
  name: 'X',
  damage: 'physical',
  attack: 'melee',
  roles: [],
  cc: 1,
  mobility: 1,
  durability: 1,
  utility: 1,
  ...over
});

describe('readSeat', () => {
  it('reads nothing from an empty seat', () => {
    expect(readSeat({ role: 'Top', ours: '', theirs: 'Aatrox' })).toEqual({ score: 0, reasons: [], signals: 0 });
  });

  it('weighs the matchup above everything and says how many games it rests on', () => {
    const read = readSeat({ role: 'Top', ours: 'Ornn', theirs: 'Aatrox', matchup: { winRate: 56, games: 1200 } });
    expect(read.score).toBe(12);
    expect(read.reasons[0]).toContain('Ornn into Aatrox wins 56% over 1,200 games');
  });

  it('discounts a thin matchup and marks it', () => {
    const read = readSeat({ role: 'Top', ours: 'Ornn', theirs: 'Aatrox', matchup: { winRate: 56, games: 250 } });
    expect(read.score).toBeCloseTo(7.2);
    expect(read.reasons[0]).toContain('(thin)');
  });

  it('counts a main on their side against us, and a first-timer for us', () => {
    const read = readSeat({
      role: 'Mid',
      ours: 'Orianna',
      theirs: 'Ahri',
      theirComfort: { level: 'main', games: 34, winRate: 58 },
      ourComfort: { level: 'none' }
    });
    expect(read.score).toBe(-15);
    expect(read.reasons).toEqual([
      'Ahri is a main for them (34 games, 58%)',
      "Orianna is not in our player's recent pool"
    ]);
  });

  it('reads ranged into melee as a laning edge, but not in the jungle', () => {
    const ranged = traits({ attack: 'ranged' });
    const melee = traits({ attack: 'melee' });
    expect(readSeat({ role: 'Top', ours: 'Vayne', theirs: 'Garen', ourTraits: ranged, theirTraits: melee }).score).toBe(4);
    expect(readSeat({ role: 'Jungle', ours: 'Kindred', theirs: 'Vi', ourTraits: ranged, theirTraits: melee }).score).toBe(0);
  });
});

describe('comfortOf', () => {
  it('reads a main from twenty games, or from the top of the pool', () => {
    expect(comfortOf({ games: 24, wins: 14 }, 3, true)).toEqual({ level: 'main', games: 24, winRate: 58 });
    expect(comfortOf({ games: 6, wins: 3 }, 0, true)).toEqual({ level: 'main', games: 6, winRate: 50 });
  });

  it('is none when the pool is known and the champion is not in it, unknown otherwise', () => {
    expect(comfortOf(undefined, 0, true)).toEqual({ level: 'none' });
    expect(comfortOf(undefined, 0, false)).toBeUndefined();
  });

  it('keeps a name-only record from an old scout as pool without a count', () => {
    expect(comfortOf({ games: 0, wins: 0 }, 2, true)).toEqual({ level: 'pool', games: undefined, winRate: undefined });
  });
});

describe('readLanes', () => {
  it('averages bot lane so a duo sits on the same scale as a solo lane', () => {
    const seats: SeatInput[] = [
      { role: 'ADC', ours: 'Jinx', theirs: 'Ezreal', matchup: { winRate: 55, games: 900 } },
      { role: 'Support', ours: 'Rakan', theirs: 'Thresh', matchup: { winRate: 50, games: 900 } }
    ];
    const bot = readLanes(seats).find((r) => r.lane === 'Bot')!;
    expect(bot.score).toBe(5);
    expect(bot.ours).toEqual(['Jinx', 'Rakan']);
    expect(bot.verdict).toBe('even');
  });

  it('reads an unpicked lane as unknown rather than even', () => {
    const reads = readLanes([{ role: 'Top', ours: 'Ornn', theirs: '' }]);
    expect(reads.find((r) => r.lane === 'Top')!.verdict).toBe('unknown');
    expect(reads.find((r) => r.lane === 'Mid')!.verdict).toBe('unknown');
  });

  it('calls a lane from eight points either way', () => {
    const reads = readLanes([
      { role: 'Top', ours: 'Ornn', theirs: 'Aatrox', matchup: { winRate: 54, games: 900 } },
      { role: 'Mid', ours: 'Orianna', theirs: 'Ahri', matchup: { winRate: 46, games: 900 } }
    ]);
    expect(reads.find((r) => r.lane === 'Top')!.verdict).toBe('strong');
    expect(reads.find((r) => r.lane === 'Mid')!.verdict).toBe('weak');
  });

  it('rates confidence from how much sits behind the read', () => {
    const thin = readLanes([{ role: 'Top', ours: 'Ornn', theirs: 'Aatrox', ourSolo: 52, theirSolo: 49 }]);
    expect(thin[0].confidence).toBe('low');
    const solid = readLanes([
      {
        role: 'Top',
        ours: 'Ornn',
        theirs: 'Aatrox',
        matchup: { winRate: 54, games: 900 },
        ourSolo: 52,
        theirSolo: 49,
        theirComfort: { level: 'main', games: 30 }
      }
    ]);
    expect(solid[0].confidence).toBe('high');
  });
});

describe('gamePlan', () => {
  it('says nothing about a board with no lanes read', () => {
    expect(gamePlan(readLanes([]))).toEqual({ snowball: null, cover: null, lines: [] });
  });

  it('names the lane to snowball, the lane to cover, and what the jungle can do', () => {
    const reads = readLanes([
      { role: 'Top', ours: 'Ornn', theirs: 'Aatrox', matchup: { winRate: 56, games: 900 } },
      { role: 'Jungle', ours: 'Jarvan IV', theirs: 'Viego', matchup: { winRate: 45, games: 900 } },
      { role: 'Mid', ours: 'Orianna', theirs: 'Ahri', matchup: { winRate: 50, games: 900 } },
      { role: 'ADC', ours: 'Jinx', theirs: 'Ezreal', matchup: { winRate: 44, games: 900 } },
      { role: 'Support', ours: 'Rakan', theirs: 'Thresh', matchup: { winRate: 46, games: 900 } }
    ]);
    const plan = gamePlan(reads);
    expect(plan.snowball).toBe('Top');
    expect(plan.cover).toBe('Bot');
    expect(plan.lines.map((l) => l.strong)).toEqual(['Snowball Top', 'Cover Bot', 'Jungle is theirs']);
    expect(plan.lines[0].rest).toContain('grubs and Herald');
    expect(plan.lines[1].rest).toContain('Ezreal and Thresh');
  });

  it('says so when nothing is decided', () => {
    const plan = gamePlan(readLanes([{ role: 'Mid', ours: 'Orianna', theirs: 'Ahri', matchup: { winRate: 51, games: 900 } }]));
    expect(plan.snowball).toBeNull();
    expect(plan.lines[0].strong).toBe('No lane is decided');
  });
});
