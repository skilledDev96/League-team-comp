import { describe, expect, it } from 'vitest';
import {
  CRAWL_BUDGET,
  CrawledMatch,
  ENTRIES_PER_PAGE,
  EXPECTED_IDS_PER_PLAYER,
  FIRST_CURSOR,
  LadderCursor,
  NIGHT_CRAWL_BUDGET,
  PENDING_LOW_WATER,
  TIERS,
  crawlBudgetAt,
  divisionsFor,
  isApex,
  ladderPath,
  laneMatchups,
  matchupKey,
  mergeMatchups,
  mergeTallies,
  nextCursor,
  patchOf,
  planRun,
  sampleLadder,
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

  it('still routes an apex tier on a later page', () => {
    // It must not go quiet after page 1: the cursor passes each apex page-1
    // exactly once, so skipping the rest meant never collecting those tiers.
    expect(ladderPath({ tier: 'CHALLENGER', division: 'I', page: 4 })).toContain('challengerleagues');
  });

  it('keeps paging the divisioned tiers, which do not arrive whole', () => {
    expect(ladderPath({ tier: 'GOLD', division: 'IV', page: 7 })).toContain('page=7');
  });

  it('has a route for every tier', () => {
    for (const tier of TIERS) {
      expect(ladderPath({ tier, division: 'I', page: 1 })).toContain('/lol/league/v4/');
    }
  });
});

describe('sampleLadder', () => {
  const apex = (n: number) => Array.from({ length: n }, (_, i) => i);

  it('takes a divisioned page whole', () => {
    expect(sampleLadder([1, 2, 3], { tier: 'GOLD', division: 'I', page: 1 })).toEqual([1, 2, 3]);
  });

  it('cuts a big apex ladder down to one page', () => {
    // 4,000 Master players seeded at once would weigh as much as twenty Gold
    // pages, and the crawl would describe the top of the ladder.
    const out = sampleLadder(apex(4000), { tier: 'MASTER', division: 'I', page: 1 });
    expect(out).toHaveLength(ENTRIES_PER_PAGE);
  });

  it('cuts Challenger too — 300 is still more than a page', () => {
    expect(sampleLadder(apex(300), { tier: 'CHALLENGER', division: 'I', page: 1 })).toHaveLength(
      ENTRIES_PER_PAGE
    );
  });

  it('leaves an apex ladder smaller than a page alone', () => {
    expect(sampleLadder(apex(150), { tier: 'CHALLENGER', division: 'I', page: 1 })).toHaveLength(150);
  });

  it('walks further into the ladder on later pages', () => {
    const first = sampleLadder(apex(4000), { tier: 'MASTER', division: 'I', page: 1 });
    const second = sampleLadder(apex(4000), { tier: 'MASTER', division: 'I', page: 2 });
    expect(second[0]).not.toBe(first[0]);
    expect(new Set([...first, ...second]).size).toBe(ENTRIES_PER_PAGE * 2);
  });

  it('wraps around the end rather than returning a short page', () => {
    const out = sampleLadder(apex(300), { tier: 'MASTER', division: 'I', page: 2 });
    expect(out).toHaveLength(ENTRIES_PER_PAGE);
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

describe('crawlBudgetAt', () => {
  it('spends most of the key between midnight and six in Amsterdam', () => {
    // 01:00Z in September is 03:00 in Amsterdam (CEST).
    expect(crawlBudgetAt(new Date('2026-09-05T01:00:00Z'))).toBe(NIGHT_CRAWL_BUDGET);
    expect(crawlBudgetAt(new Date('2026-09-05T22:30:00Z'))).toBe(NIGHT_CRAWL_BUDGET); // 00:30 next day
  });

  it('leaves the daytime half alone, including the morning refresh window', () => {
    expect(crawlBudgetAt(new Date('2026-09-05T04:30:00Z'))).toBe(CRAWL_BUDGET); // 06:30, refresh running
    expect(crawlBudgetAt(new Date('2026-09-05T10:00:00Z'))).toBe(CRAWL_BUDGET); // midday
    expect(crawlBudgetAt(new Date('2026-09-05T19:00:00Z'))).toBe(CRAWL_BUDGET); // 21:00, match night
  });

  it('the night budget still leaves headroom under the key\'s hundred', () => {
    expect(NIGHT_CRAWL_BUDGET).toBeLessThan(100);
    expect(NIGHT_CRAWL_BUDGET).toBeGreaterThan(CRAWL_BUDGET);
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

  it('sizes lookups on what they yield, not what they ask for', () => {
    // Budgeting as though every player returns twenty ids left the queue empty
    // and a third of the run unspent, because the time window filters most out.
    const plan = planRun(0, 500);
    expect(plan.idLookups).toBeGreaterThanOrEqual(Math.ceil(PENDING_LOW_WATER / EXPECTED_IDS_PER_PLAYER));
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

describe('mergeTallies', () => {
  const tally = (patch: string, tier: Tier, champs: Record<string, [number, number]>) => ({
    patch,
    tier,
    champions: new Map(Object.entries(champs).map(([k, [g, w]]) => [k, { games: g, wins: w }]))
  });

  it('folds a run into one update per bucket instead of one per match', () => {
    // Fifty matches used to mean a hundred writes into the same few documents,
    // and Firestore bills every one of them.
    const runs = Array.from({ length: 50 }, () => tally('16.17', 'GOLD', { Ahri: [1, 1] }));
    expect(mergeTallies(runs)).toHaveLength(2); // GOLD and ALL
  });

  it('sums the matches and the champion counters', () => {
    const merged = mergeTallies([
      tally('16.17', 'GOLD', { Ahri: [1, 1], Jinx: [1, 0] }),
      tally('16.17', 'GOLD', { Ahri: [2, 1] })
    ]);
    const gold = merged.find((b) => b.tier === 'GOLD')!;
    expect(gold.matches).toBe(2);
    expect(gold.champions.get('Ahri')).toEqual({ games: 3, wins: 2 });
    expect(gold.champions.get('Jinx')).toEqual({ games: 1, wins: 0 });
  });

  it('puts every match in the rollup as well as its own tier', () => {
    const merged = mergeTallies([
      tally('16.17', 'GOLD', { Ahri: [1, 1] }),
      tally('16.17', 'IRON', { Ahri: [1, 0] })
    ]);
    const all = merged.find((b) => b.tier === 'ALL')!;
    expect(all.matches).toBe(2);
    expect(all.champions.get('Ahri')).toEqual({ games: 2, wins: 1 });
  });

  it('never merges two patches into one bucket', () => {
    const merged = mergeTallies([
      tally('16.17', 'GOLD', { Ahri: [1, 1] }),
      tally('16.16', 'GOLD', { Ahri: [1, 0] })
    ]);
    expect(merged.filter((b) => b.tier === 'ALL').map((b) => b.patch).sort()).toEqual(['16.16', '16.17']);
  });

  it('has nothing to write for a run that tallied nothing', () => {
    expect(mergeTallies([])).toEqual([]);
  });
});

describe('laneMatchups', () => {
  const lanes = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  const full = (over: Partial<Record<string, unknown>> = {}) => ({
    info: {
      gameVersion: '15.17.704.1234', gameDuration: 1800, queueId: 420,
      participants: [
        ...lanes.map((teamPosition, i) => ({ championName: `Blue${i}`, win: true, teamPosition, teamId: 100 })),
        ...lanes.map((teamPosition, i) => ({ championName: `Red${i}`, win: false, teamPosition, teamId: 200 }))
      ],
      ...over
    }
  }) as CrawledMatch;

  it('finds one pairing per lane', () => {
    expect(laneMatchups(full())).toHaveLength(5);
  });

  it('pairs across sides, never within one', () => {
    for (const m of laneMatchups(full())) {
      expect([m.a, m.b].some((c) => c.startsWith('Blue'))).toBe(true);
      expect([m.a, m.b].some((c) => c.startsWith('Red'))).toBe(true);
    }
  });

  it('orders the pair alphabetically, so both orderings are one cell', () => {
    // Otherwise Ahri-into-Syndra and Syndra-into-Ahri fill two half-empty cells.
    for (const m of laneMatchups(full())) expect(m.a.localeCompare(m.b)).toBeLessThanOrEqual(0);
  });

  it('records which side of the pair won', () => {
    const mid = laneMatchups(full()).find((m) => m.lane === 'MIDDLE')!;
    // Blue won this game, so aWon is true exactly when a is the blue champion.
    expect(mid.aWon).toBe(mid.a.startsWith('Blue'));
  });

  it('skips a lane that is not exactly two players', () => {
    // Riot leaves teamPosition empty on remakes; a lane with one or three
    // claimants is not a matchup, and filing it anyway puts a jungler at top.
    const odd = full();
    odd.info.participants = odd.info.participants.filter((p) => p.teamPosition !== 'TOP');
    expect(laneMatchups(odd).some((m) => m.lane === 'TOP')).toBe(false);
    expect(laneMatchups(odd)).toHaveLength(4);
  });

  it('skips two players on the same side in one lane', () => {
    const odd = full();
    odd.info.participants = odd.info.participants.map((p) =>
      p.teamPosition === 'JUNGLE' ? { ...p, teamId: 100 } : p
    );
    expect(laneMatchups(odd).some((m) => m.lane === 'JUNGLE')).toBe(false);
  });

  it('ignores participants with no position at all', () => {
    const odd = full();
    odd.info.participants = odd.info.participants.map((p) => ({ ...p, teamPosition: '' }));
    expect(laneMatchups(odd)).toEqual([]);
  });
});

describe('matchupKey', () => {
  it('strips punctuation, since a dot would split the Firestore field path', () => {
    expect(matchupKey("Kai'Sa", 'Dr. Mundo')).toBe('KaiSa_DrMundo');
  });
});

describe('mergeMatchups', () => {
  const tally = (patch: string, matchups: { lane: string; a: string; b: string; aWon: boolean }[]) =>
    ({ patch, tier: 'GOLD' as const, champions: new Map(), matchups });

  it('folds a run into one update per lane', () => {
    // Fifty matches make 250 pairings across five lanes; five documents carry
    // what 250 writes otherwise would.
    const runs = Array.from({ length: 50 }, () =>
      tally('16.17', [{ lane: 'MIDDLE', a: 'Ahri', b: 'Syndra', aWon: true }])
    );
    const merged = mergeMatchups(runs);
    expect(merged).toHaveLength(1);
    expect(merged[0].pairs.get('Ahri_Syndra')).toEqual({ games: 50, winsA: 50 });
  });

  it('counts wins for the first champion only', () => {
    const merged = mergeMatchups([
      tally('16.17', [{ lane: 'MIDDLE', a: 'Ahri', b: 'Syndra', aWon: true }]),
      tally('16.17', [{ lane: 'MIDDLE', a: 'Ahri', b: 'Syndra', aWon: false }])
    ]);
    expect(merged[0].pairs.get('Ahri_Syndra')).toEqual({ games: 2, winsA: 1 });
  });

  it('keeps lanes and patches apart', () => {
    const merged = mergeMatchups([
      tally('16.17', [{ lane: 'MIDDLE', a: 'Ahri', b: 'Syndra', aWon: true }]),
      tally('16.17', [{ lane: 'TOP', a: 'Ahri', b: 'Syndra', aWon: true }]),
      tally('16.16', [{ lane: 'MIDDLE', a: 'Ahri', b: 'Syndra', aWon: true }])
    ]);
    expect(merged).toHaveLength(3);
  });

  it('has nothing to write for a run with no pairings', () => {
    expect(mergeMatchups([])).toEqual([]);
    expect(mergeMatchups([tally('16.17', [])])).toEqual([]);
  });
});
