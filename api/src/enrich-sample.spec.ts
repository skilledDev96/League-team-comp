import { describe, expect, it } from 'vitest';
import {
  MAX_ENRICH_FETCHES,
  SampleMatch,
  SampleParticipant,
  cachedToMatch,
  planSample
} from './enrich-sample';
import { summarizeMatches } from './match-stats';

const ME = 'me-puuid';

function participant(over: Partial<SampleParticipant> = {}): SampleParticipant {
  return {
    puuid: 'other',
    championName: 'Ahri',
    win: true,
    teamId: 100,
    teamPosition: 'MIDDLE',
    kills: 0,
    deaths: 0,
    assists: 0,
    cs: 0,
    damage: 0,
    ...over
  };
}

function cached(over: Partial<SampleMatch> = {}): SampleMatch {
  return {
    cacheVersion: 4,
    queueId: 440,
    gameCreation: 1,
    durationSec: 1800,
    participants: [participant({ puuid: ME })],
    ...over
  };
}

describe('planSample', () => {
  it('takes everything the cache already answers and asks Riot for the rest', () => {
    const plan = planSample(['a', 'b', 'c'], new Map([['b', cached()]]));
    expect(plan.usable).toHaveLength(1);
    expect(plan.toFetch).toEqual(['a', 'c']);
    expect(plan.skipped).toBe(0);
  });

  it('spends no calls at all when the cache covers the window', () => {
    // The whole point: a warm queue costs one id lookup and nothing more.
    const all = new Map([['a', cached()], ['b', cached()]]);
    const plan = planSample(['a', 'b'], all);
    expect(plan.toFetch).toEqual([]);
    expect(plan.usable).toHaveLength(2);
  });

  it('keeps a stale entry rather than spending a call to complete two averages', () => {
    // A v3 entry has no vision or building damage but still carries the kills,
    // the champion and the result — most of the card, for free.
    const plan = planSample(['a'], new Map([['a', cached({ cacheVersion: 3 })]]));
    expect(plan.usable).toHaveLength(1);
    expect(plan.toFetch).toEqual([]);
  });

  it('treats an entry with no participants as missing', () => {
    // Nothing can be read off it, so it is worth the call.
    const plan = planSample(['a'], new Map([['a', cached({ participants: [] })]]));
    expect(plan.usable).toEqual([]);
    expect(plan.toFetch).toEqual(['a']);
  });

  it('caps the fetches at the budget and reports what it left', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `m${i}`);
    const plan = planSample(ids, new Map(), 5);
    expect(plan.toFetch).toHaveLength(5);
    expect(plan.skipped).toBe(35);
  });

  it('defaults to the old fixed sample size, so a cold cache is no worse than before', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `m${i}`);
    expect(planSample(ids, new Map()).toFetch).toHaveLength(MAX_ENRICH_FETCHES);
  });

  it('fetches nothing on a zero budget rather than going negative', () => {
    const plan = planSample(['a', 'b'], new Map(), 0);
    expect(plan.toFetch).toEqual([]);
    expect(plan.skipped).toBe(2);
  });
});

describe('cachedToMatch', () => {
  it('puts the cached fields where the summariser looks for them', () => {
    const adapted = cachedToMatch(
      cached({
        participants: [participant({ puuid: ME, kills: 5, cs: 200, damage: 1000, damageTaken: 500 })]
      })
    );
    expect(adapted.info.gameDuration).toBe(1800);
    expect(adapted.info.participants[0]).toMatchObject({
      puuid: ME,
      kills: 5,
      totalMinionsKilled: 200,
      neutralMinionsKilled: 0,
      totalDamageDealtToChampions: 1000,
      totalDamageTaken: 500
    });
  });

  it('leaves vision and building damage absent on a pre-v4 entry', () => {
    // Not zero. A zero is indistinguishable from a real one and would read as a
    // player who stopped warding for as long as the backfill takes.
    const adapted = cachedToMatch(cached({ cacheVersion: 3 }));
    expect(adapted.info.participants[0].visionScore).toBeUndefined();
    expect(adapted.info.participants[0].damageDealtToBuildings).toBeUndefined();
  });

  it('reports an unknown duration as zero, which the summariser skips', () => {
    const adapted = cachedToMatch(cached({ durationSec: undefined }));
    expect(adapted.info.gameDuration).toBe(0);
  });
});

describe('a sample mixing cache versions', () => {
  const v4 = cached({
    participants: [participant({ puuid: ME, kills: 4, cs: 180, visionScore: 30, buildingDamage: 2000 })]
  });
  const v3 = cached({
    cacheVersion: 3,
    participants: [participant({ puuid: ME, kills: 4, cs: 180 })]
  });

  it('averages vision over the games that recorded it, not over all of them', () => {
    const summary = summarizeMatches([v4, v3].map(cachedToMatch), ME)!;
    expect(summary.games).toBe(2);
    // 30 over the one game that has it — not 15, which is what counting the
    // other as a zero would give.
    expect(summary.avgVisionScore).toBe(30);
    expect(summary.visionSamples).toBe(1);
    expect(summary.buildingSamples).toBe(1);
  });

  it('still counts both games for everything the older entry does carry', () => {
    const summary = summarizeMatches([v4, v3].map(cachedToMatch), ME)!;
    expect(summary.avgKills).toBe(4);
    expect(summary.games).toBe(2);
  });

  it('reports no vision sample at all when nothing in the window has one', () => {
    // The card can then say so rather than showing a confident zero.
    const summary = summarizeMatches([v3].map(cachedToMatch), ME)!;
    expect(summary.avgVisionScore).toBe(0);
    expect(summary.visionSamples).toBe(0);
  });

  it('leaves a game with no duration out of CS per minute', () => {
    // Treating an unknown duration as one minute reported ten times the rate.
    const noDuration = cached({ durationSec: undefined, participants: [participant({ puuid: ME, cs: 180 })] });
    const summary = summarizeMatches([v4, noDuration].map(cachedToMatch), ME)!;
    expect(summary.csSamples).toBe(1);
    expect(summary.avgCsPerMin).toBeCloseTo(6, 5);
  });
});
