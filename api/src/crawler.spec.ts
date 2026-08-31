import { describe, expect, it } from 'vitest';
import {
  CRAWL_BUDGET,
  CrawledMatch,
  FIRST_CURSOR,
  LadderCursor,
  TIERS,
  divisionsFor,
  isApex,
  ladderPath,
  nextCursor,
  patchOf,
  planRun,
  statsDocPath,
  tallyMatch,
  winRateOf
} from './crawler';

function match(over: Partial<CrawledMatch['info']> = {}): CrawledMatch {
  const participants = Array.from({ length: 10 }, (_, i) => ({
    championName: `Champ${i}`,
    win: i < 5
  }));
  return { info: { gameVersion: '15.17.704.1234', gameDuration: 1800, queueId: 420, participants, ...over } };
}

describe('divisionsFor', () => {
  it('gives the apex tiers a single division', () => {
    // Asking Challenger for division IV returns an empty page forever.
    for (const tier of ['CHALLENGER', 'GRANDMASTER', 'MASTER'] as const) {
      expect(divisionsFor(tier)).toEqual(['I']);
    }
  });

  it('splits the rest four ways', () => {
    expect(divisionsFor('EMERALD')).toEqual(['I', 'II', 'III', 'IV']);
  });
});

describe('ladderPath', () => {
  it('sends the divisioned tiers to the entries endpoint', () => {
    expect(ladderPath({ tier: 'DIAMOND', division: 'I', page: 1 })).toBe(
      '/lol/league/v4/entries/RANKED_SOLO_5x5/DIAMOND/I?page=1'
    );
  });

  it('sends the apex tiers to their own endpoints', () => {
    // Measured: /entries/RANKED_SOLO_5x5/CHALLENGER/I answers 400, and every
    // tick that asked for it burned its one ladder request on the error.
    expect(ladderPath({ tier: 'CHALLENGER', division: 'I', page: 1 })).toBe(
      '/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5'
    );
    expect(ladderPath({ tier: 'GRANDMASTER', division: 'I', page: 1 })).toBe(
      '/lol/league/v4/grandmasterleagues/by-queue/RANKED_SOLO_5x5'
    );
    expect(ladderPath({ tier: 'MASTER', division: 'I', page: 1 })).toBe(
      '/lol/league/v4/masterleagues/by-queue/RANKED_SOLO_5x5'
    );
  });

  it('has nothing to ask for on a second apex page', () => {
    // The apex ladder arrives whole, so page 2 would be the same 300 players.
    for (const tier of ['CHALLENGER', 'GRANDMASTER', 'MASTER'] as const) {
      expect(ladderPath({ tier, division: 'I', page: 2 })).toBeNull();
    }
  });

  it('keeps paging the divisioned tiers, which do not arrive whole', () => {
    expect(ladderPath({ tier: 'GOLD', division: 'IV', page: 7 })).toContain('page=7');
  });

  it('agrees with isApex about which tiers are which', () => {
    for (const tier of TIERS) {
      expect(ladderPath({ tier, division: 'I', page: 2 }) === null).toBe(isApex(tier));
    }
  });
});

describe('nextCursor', () => {
  it('walks divisions before moving tier', () => {
    expect(nextCursor({ tier: 'EMERALD', division: 'I', page: 1 })).toEqual({
      tier: 'EMERALD',
      division: 'II',
      page: 1
    });
  });

  it('moves to the next tier once a tier is exhausted', () => {
    expect(nextCursor({ tier: 'CHALLENGER', division: 'I', page: 1 })).toEqual({
      tier: 'GRANDMASTER',
      division: 'I',
      page: 1
    });
  });

  it('goes one page deeper only after every tier has had this page', () => {
    // The whole point: no tier is drained before another is started.
    const last: LadderCursor = { tier: TIERS[TIERS.length - 1], division: 'IV', page: 1 };
    expect(nextCursor(last)).toEqual({ tier: TIERS[0], division: 'I', page: 2 });
  });

  it('covers every tier within one page of walking', () => {
    const seen = new Set<string>();
    let cursor = FIRST_CURSOR;
    for (let i = 0; i < 200 && cursor.page === 1; i += 1) {
      seen.add(cursor.tier);
      cursor = nextCursor(cursor);
    }
    expect(seen.size).toBe(TIERS.length);
  });

  it('recovers from an unrecognised tier rather than stalling', () => {
    const odd = nextCursor({ tier: 'EMERALDD' as never, division: 'IV', page: 1 });
    expect(TIERS).toContain(odd.tier);
  });
});

describe('planRun', () => {
  it('spends almost everything on matches once the pipeline is full', () => {
    const plan = planRun(500, 500);
    expect(plan.ladderPages).toBe(0);
    expect(plan.idLookups).toBe(0);
    expect(plan.matchFetches).toBe(CRAWL_BUDGET);
  });

  it('buys a ladder page when it is running out of players', () => {
    expect(planRun(500, 0).ladderPages).toBe(1);
  });

  it('looks up more ids when the match queue runs dry', () => {
    const plan = planRun(0, 500);
    expect(plan.idLookups).toBeGreaterThan(0);
    expect(plan.matchFetches).toBeGreaterThan(0);
  });

  it('never spends a whole run on refills', () => {
    // A run that fetches no matches produces no data, however empty the queue.
    const plan = planRun(0, 0);
    expect(plan.matchFetches).toBeGreaterThan(0);
  });

  it('cannot look up more players than it knows about', () => {
    expect(planRun(0, 2).idLookups).toBeLessThanOrEqual(2);
  });

  it('never exceeds the budget it was given', () => {
    for (const [pending, pool] of [[0, 0], [0, 500], [500, 0], [500, 500], [10, 10]]) {
      const plan = planRun(pending, pool);
      expect(plan.ladderPages + plan.idLookups + plan.matchFetches).toBeLessThanOrEqual(CRAWL_BUDGET);
    }
  });

  it('leaves half the rate limit for the app', () => {
    // A user pressing Refresh must not queue behind a background job.
    expect(CRAWL_BUDGET).toBeLessThanOrEqual(50);
  });

  it('does nothing on a spent budget rather than going negative', () => {
    const plan = planRun(0, 0, 0);
    expect(plan).toEqual({ ladderPages: 0, idLookups: 0, matchFetches: 0 });
  });
});

describe('patchOf', () => {
  it('keeps major and minor, drops the build', () => {
    expect(patchOf('15.17.704.1234')).toBe('15.17');
  });

  it('never merges two patches into one bucket', () => {
    expect(patchOf('15.17.704.1234')).not.toBe(patchOf('15.18.704.1234'));
  });

  it('has somewhere to put a match with no version', () => {
    expect(patchOf(undefined)).toBe('unknown');
    expect(patchOf('15')).toBe('15');
  });
});

describe('tallyMatch', () => {
  it('counts all ten champions, five of them winners', () => {
    const tally = tallyMatch(match(), 'EMERALD')!;
    expect(tally.champions.size).toBe(10);
    expect([...tally.champions.values()].reduce((n, c) => n + c.games, 0)).toBe(10);
    expect([...tally.champions.values()].reduce((n, c) => n + c.wins, 0)).toBe(5);
  });

  it('files the tally under the seed player rank and the match patch', () => {
    const tally = tallyMatch(match(), 'GOLD')!;
    expect(tally.tier).toBe('GOLD');
    expect(tally.patch).toBe('15.17');
  });

  it('drops a remake rather than recording five losses nobody played', () => {
    expect(tallyMatch(match({ gameDuration: 200 }), 'GOLD')).toBeNull();
  });

  it('drops anything that is not ranked solo', () => {
    // ARAM win rates would quietly contaminate a Summoner's Rift bucket.
    expect(tallyMatch(match({ queueId: 450 }), 'GOLD')).toBeNull();
  });

  it('drops a lobby that is not ten players', () => {
    expect(tallyMatch(match({ participants: [] }), 'GOLD')).toBeNull();
  });

  it('drops a lobby with a nameless participant instead of counting nine', () => {
    const parts = match().info.participants;
    parts[3] = { championName: '', win: true };
    expect(tallyMatch(match({ participants: parts }), 'GOLD')).toBeNull();
  });

  it('counts a champion twice when both teams picked it', () => {
    const parts = match().info.participants.map((p) => ({ ...p, championName: 'Ahri' }));
    const tally = tallyMatch(match({ participants: parts }), 'GOLD')!;
    expect(tally.champions.get('Ahri')).toEqual({ games: 10, wins: 5 });
  });
});

describe('statsDocPath', () => {
  it('keeps every patch and tier in its own bucket', () => {
    expect(statsDocPath('15.17', 'EMERALD')).toBe('championStats/15.17_EMERALD');
    expect(statsDocPath('15.17', 'GOLD')).not.toBe(statsDocPath('15.18', 'GOLD'));
  });
});

describe('winRateOf', () => {
  it('quotes one decimal place', () => {
    expect(winRateOf({ games: 1000, wins: 523 })).toBe(52.3);
  });

  it('says nothing at all below the sample floor', () => {
    // The mistake this whole project exists to avoid: a confident number from
    // twelve games.
    expect(winRateOf({ games: 12, wins: 9 })).toBeUndefined();
    expect(winRateOf({ games: 199, wins: 100 })).toBeUndefined();
    expect(winRateOf({ games: 200, wins: 100 })).toBe(50);
  });
});
