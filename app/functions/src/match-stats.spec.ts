import { describe, expect, it } from 'vitest';
import { Match, MatchParticipant, summarizeMatches } from './match-stats';

const ME = 'me-puuid';

function participant(over: Partial<MatchParticipant> = {}): MatchParticipant {
  return {
    puuid: 'other',
    championName: 'Ahri',
    win: true,
    teamId: 100,
    teamPosition: 'MIDDLE',
    kills: 0,
    deaths: 0,
    assists: 0,
    totalMinionsKilled: 0,
    neutralMinionsKilled: 0,
    totalDamageDealtToChampions: 0,
    damageDealtToBuildings: 0,
    totalDamageTaken: 0,
    visionScore: 0,
    ...over
  };
}

/** One match with our player plus a filler teammate and a lane opponent. */
function match(mine: Partial<MatchParticipant>, extras: Partial<MatchParticipant>[] = [], durationSec = 1800): Match {
  return {
    info: {
      gameDuration: durationSec,
      gameCreation: 0,
      queueId: 420,
      participants: [participant({ puuid: ME, ...mine }), ...extras.map((e) => participant(e))]
    }
  };
}

describe('summarizeMatches', () => {
  it('returns null when the player is in none of the matches', () => {
    expect(summarizeMatches([match({ puuid: 'someone-else' })], ME)).toBeNull();
    expect(summarizeMatches([], ME)).toBeNull();
  });

  it('ignores matches the player did not appear in', () => {
    const summary = summarizeMatches(
      [match({ win: true }), { info: { gameDuration: 1800, gameCreation: 0, queueId: 420, participants: [] } }],
      ME
    )!;
    expect(summary.games).toBe(1);
  });

  it('counts wins, losses and win rate', () => {
    const summary = summarizeMatches([match({ win: true }), match({ win: true }), match({ win: false })], ME)!;
    expect(summary).toMatchObject({ games: 3, wins: 2, losses: 1, winRate: 67 });
  });

  it('averages kills, deaths and assists over games', () => {
    const summary = summarizeMatches(
      [match({ kills: 10, deaths: 2, assists: 4 }), match({ kills: 0, deaths: 4, assists: 0 })],
      ME
    )!;
    expect(summary.avgKills).toBe(5);
    expect(summary.avgDeaths).toBe(3);
    expect(summary.avgAssists).toBe(2);
  });

  it('computes KDA from the averages', () => {
    const summary = summarizeMatches([match({ kills: 6, deaths: 2, assists: 4 })], ME)!;
    expect(summary.avgKda).toBe(5); // (6 + 4) / 2
  });

  it('treats a deathless record as kills plus assists, not a division by zero', () => {
    const summary = summarizeMatches([match({ kills: 3, deaths: 0, assists: 2 })], ME)!;
    expect(summary.avgKda).toBe(5);
    expect(Number.isFinite(summary.avgKda)).toBe(true);
  });

  it('scales CS by game length', () => {
    // 300 CS over 30 minutes is 10/min.
    const summary = summarizeMatches([match({ totalMinionsKilled: 250, neutralMinionsKilled: 50 }, [], 1800)], ME)!;
    expect(summary.avgCsPerMin).toBe(10);
  });

  it('does not let a remake report an absurd CS rate', () => {
    // Duration under a minute is floored at one, not divided by a fraction.
    const summary = summarizeMatches([match({ totalMinionsKilled: 10 }, [], 12)], ME)!;
    expect(summary.avgCsPerMin).toBe(10);
  });

  it('measures kill participation against the player’s own team', () => {
    const summary = summarizeMatches(
      [match({ kills: 2, assists: 3 }, [{ teamId: 100, kills: 5 }, { teamId: 200, kills: 100 }])],
      ME
    )!;
    // 5 of the team's 7 kills; the enemy team's kills are irrelevant.
    expect(summary.avgKillParticipation).toBeCloseTo(5 / 7);
  });

  it('skips a game with no team kills rather than counting it as zero', () => {
    const summary = summarizeMatches(
      [
        match({ kills: 2, assists: 2 }, [{ teamId: 100, kills: 4 }]),
        match({ kills: 0, assists: 0 }, [{ teamId: 100, kills: 0 }])
      ],
      ME
    )!;
    // Only the first game is a usable sample, so the average is its value.
    expect(summary.avgKillParticipation).toBeCloseTo(4 / 6);
  });

  it('measures damage and tank share the same way', () => {
    const summary = summarizeMatches(
      [
        match(
          { totalDamageDealtToChampions: 30000, totalDamageTaken: 10000 },
          [{ teamId: 100, totalDamageDealtToChampions: 10000, totalDamageTaken: 30000 }]
        )
      ],
      ME
    )!;
    expect(summary.avgDamageShare).toBeCloseTo(0.75);
    expect(summary.avgTankShare).toBeCloseTo(0.25);
  });

  it('ranks champions by games played and caps the pool at five', () => {
    const games = [
      ...Array(3).fill(null).map(() => match({ championName: 'Ahri' })),
      ...Array(2).fill(null).map(() => match({ championName: 'Zed' })),
      match({ championName: 'Sylas' }),
      match({ championName: 'Viktor' }),
      match({ championName: 'Orianna' }),
      match({ championName: 'Azir' })
    ];
    const summary = summarizeMatches(games, ME)!;
    expect(summary.topChampions[0]).toBe('Ahri');
    expect(summary.topChampions[1]).toBe('Zed');
    expect(summary.topChampions).toHaveLength(5);
  });

  it('suggests bans only from losses, and only the lane opponent', () => {
    const summary = summarizeMatches(
      [
        match({ win: false, teamPosition: 'MIDDLE' }, [
          { teamId: 200, teamPosition: 'MIDDLE', championName: 'Fizz' },
          { teamId: 200, teamPosition: 'TOP', championName: 'Sion' }
        ]),
        match({ win: true, teamPosition: 'MIDDLE' }, [
          { teamId: 200, teamPosition: 'MIDDLE', championName: 'Syndra' }
        ])
      ],
      ME
    )!;
    expect(summary.banCandidates).toEqual(['Fizz']);
  });

  it('reports the position played most often', () => {
    const summary = summarizeMatches(
      [match({ teamPosition: 'JUNGLE' }), match({ teamPosition: 'JUNGLE' }), match({ teamPosition: 'TOP' })],
      ME
    )!;
    expect(summary.mainPosition).toBe('JUNGLE');
  });

  it('copes with no position ever being reported', () => {
    expect(summarizeMatches([match({ teamPosition: '' })], ME)!.mainPosition).toBe('');
  });

  it('renames champions through the mapping it is given', () => {
    const summary = summarizeMatches([match({ championName: 'MonkeyKing' })], ME, (n) =>
      n === 'MonkeyKing' ? 'Wukong' : n
    )!;
    expect(summary.topChampions).toEqual(['Wukong']);
  });
});
