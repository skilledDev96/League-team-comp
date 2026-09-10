import { describe, expect, it } from 'vitest';
import { EnemyParticipant, enemyStats, trimAnalysisPayload, TrimmableResponse } from './analysis-payload';

// Ten cached participants the way the assembly sees them: the figures grow with
// the seat so every side and seat is telling. Blue is 100, red is 200.
const participant = (i: number, over: Partial<EnemyParticipant> = {}) => ({
  teamId: i < 5 ? 100 : 200,
  kills: i,
  deaths: 1,
  assists: 2,
  cs: 100 + i,
  damage: 1000 * i,
  ...over
});

describe('enemyStats', () => {
  it('reads the enemy seats off the cached participants, sharing their own kills the way ours are shared', () => {
    const parts = Array.from({ length: 10 }, (_, i) => participant(i, { damageTaken: 500, visionScore: 20 }));
    const rosterTeamId = 100;
    const enemies = parts.filter((p) => p.teamId !== rosterTeamId);
    const theirKills = enemies.reduce((n, p) => n + p.kills, 0); // 5+6+7+8+9 = 35
    const stats = enemies.map((p) => enemyStats(p, theirKills));
    expect(stats[0]).toEqual({ kills: 5, deaths: 1, assists: 2, cs: 105, damage: 5000, damageTaken: 500, visionScore: 20, killParticipation: 7 / 35 });
    expect(stats[4]).toMatchObject({ kills: 9, damage: 9000, killParticipation: 11 / 35 });
  });

  it('leaves a figure the cache entry lacks absent, never a zero', () => {
    const stats = enemyStats(participant(7), 0);
    expect(stats).toEqual({ kills: 7, deaths: 1, assists: 2, cs: 107, damage: 7000 });
    expect('damageTaken' in stats).toBe(false);
    expect('visionScore' in stats).toBe(false);
    // No kills on their side means no share to speak of, not a share of nothing.
    expect('killParticipation' in stats).toBe(false);
  });

  it('caps the share at one, as ours is capped', () => {
    expect(enemyStats(participant(9, { assists: 40 }), 10).killParticipation).toBe(1);
  });
});

describe('trimAnalysisPayload', () => {
  // Games newest first, each with a lane read and facts on one player and figures on one enemy seat.
  const game = () => ({
    players: [{ lane: { verdict: 'won', padding: 'x'.repeat(200) }, facts: { soloKills: 1 } }],
    enemies: [{ stats: { kills: 5, deaths: 1, assists: 2, cs: 105, damage: 5000, damageTaken: 500, visionScore: 20, killParticipation: 0.2 } }]
  });
  const response = (n: number): TrimmableResponse => ({ games: Array.from({ length: n }, game) });

  it('touches nothing under the guard, reports the size and writes no count', () => {
    const r = response(4);
    const before = JSON.stringify(r);
    expect(trimAnalysisPayload(r, 100_000, 2)).toBe(before.length);
    expect(JSON.stringify(r)).toBe(before);
    // Absent, not zero: Firestore refuses undefined and the page reads nothing into a missing field.
    expect('payloadTrimmed' in r).toBe(false);
  });

  it('takes the enemy figures off the oldest games first and keeps their lane reads when that is enough', () => {
    const r = response(4);
    const full = JSON.stringify(r).length;
    // A guard the enemy figures alone clear: two old games' stats are about 250 bytes.
    const bytes = trimAnalysisPayload(r, full - 100, 2);
    expect(bytes).toBeLessThanOrEqual(full - 100);
    expect(r.games[0].enemies?.[0].stats).toBeDefined();
    expect(r.games[1].enemies?.[0].stats).toBeDefined();
    expect(r.games[2].enemies?.[0]).toEqual({});
    expect(r.games[3].enemies?.[0]).toEqual({});
    for (const g of r.games) expect(g.players[0].lane).toBeDefined();
    expect(r.payloadTrimmed).toBe(2);
  });

  it('takes the lane reads off the same old games only when the figures were not enough, and never off the newest', () => {
    const r = response(4);
    const full = JSON.stringify(r).length;
    // Past what the enemy figures can save, so the lane reads go too.
    const bytes = trimAnalysisPayload(r, full - 400, 2);
    expect(bytes).toBeLessThanOrEqual(full - 400);
    expect(r.games[2].players[0]).toEqual({});
    expect(r.games[3].players[0]).toEqual({});
    expect(r.games[2].enemies?.[0]).toEqual({});
    expect(r.games[0].players[0].lane).toBeDefined();
    expect(r.games[0].enemies?.[0].stats).toBeDefined();
    expect(r.games[1].players[0].facts).toBeDefined();
    expect(r.payloadTrimmed).toBe(2);
  });

  it('strips every game, figures first and then lane reads, once the old ones are not enough (10 Sep 2026)', () => {
    // Every game is among the newest, so the two old-end stages have nothing to cut.
    const r = response(4);
    const full = JSON.stringify(r).length;
    const perStats = JSON.stringify(game().enemies[0]).length - '{}'.length;
    // A guard only every game's figures clear (the count the trim writes costs a few bytes, hence the slack), leaving every lane read.
    const bytes = trimAnalysisPayload(r, full - 4 * perStats + 30, 4);
    expect(bytes).toBeLessThanOrEqual(full - 4 * perStats + 30);
    for (const g of r.games) {
      expect(g.enemies?.[0]).toEqual({});
      expect(g.players[0].lane).toBeDefined();
      expect(g.players[0].facts).toBeDefined();
    }
    expect(r.payloadTrimmed).toBe(4);

    // A guard nothing clears: the lane reads go off every game too, and the size is what is left, reported honestly.
    const bare = response(4);
    const left = trimAnalysisPayload(bare, 10, 4);
    for (const g of bare.games) {
      expect(g.enemies?.[0]).toEqual({});
      expect(g.players[0]).toEqual({});
    }
    expect(left).toBe(JSON.stringify(bare).length);
    expect(left).toBeGreaterThan(10);
    expect(bare.payloadTrimmed).toBe(4);
  });

  it('copes with a game that has no enemies block, such as one written before the roles were kept', () => {
    const r: TrimmableResponse = { games: [game(), { players: [{ lane: 'x'.repeat(300) }] }] };
    expect(() => trimAnalysisPayload(r, 10, 0)).not.toThrow();
    expect(r.games[1].players[0]).toEqual({});
    expect(r.payloadTrimmed).toBe(2);
  });
});
