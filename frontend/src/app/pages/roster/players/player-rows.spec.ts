import { describe, expect, it } from 'vitest';
import { Player } from '../../../models/team.models';
import { defaultQueue, playerRow, queueLabel, visionNote } from './player-rows';

const rank = (tier: string, division: string) => ({ queueType: 'RANKED_SOLO_5x5', tier, rank: division, leaguePoints: 64, wins: 120, losses: 98, winRate: 55 });
const matches = (over: Record<string, unknown> = {}) => ({
  games: 202, wins: 95, losses: 107, winRate: 47, avgKills: 5, avgDeaths: 5, avgAssists: 7, avgKda: 2.4, avgCsPerMin: 6.1,
  avgKillParticipation: 0.48, avgDamageShare: 0.22, avgTankShare: 0.2, avgBuildingDamage: 3000, avgVisionScore: 18,
  playstyle: '', strengths: [], weaknesses: [], top3: [], bans: [], ...over
});
const player = (queueStats: Player['queueStats']) => ({ id: 'p', name: 'Zac', role: 'Top', top3: [], strengths: [], weaknesses: [], bans: [], queueStats }) as unknown as Player;

describe('the Players table figures', () => {
  it('reads one queue: rank in words, the season record, and the sample with its band', () => {
    const row = playerRow(player({ solo: { rank: rank('GOLD', 'II'), matches: matches() } } as never), 'solo');
    expect(row).toMatchObject({ rank: 'Gold II', lp: 64, season: { wins: 120, losses: 98 }, sample: { games: 202, wins: 95, losses: 107, winRate: 47, band: 'is-poor' }, kda: 2.4, csPerMin: 6.1, kp: 0.48, dmgShare: 0.22 });
    expect(row.vision).toEqual({ value: 18, samples: 202, of: 202 });
  });

  it('prints an apex tier without a division, and gives Clash no ladder', () => {
    expect(playerRow(player({ solo: { rank: rank('MASTER', 'I') } } as never), 'solo').rank).toBe('Master');
    const clash = playerRow(player({ clash: { rank: rank('GOLD', 'I'), matches: matches() } } as never), 'clash');
    expect(clash.rank).toBeNull();
    expect(clash.sample?.games).toBe(202);
  });

  it('is nothing for a queue with no games, and says when vision was only partly recorded', () => {
    expect(playerRow(player({ flex: { matches: matches({ games: 0 }) } } as never), 'flex').sample).toBeNull();
    expect(playerRow(undefined, 'solo')).toMatchObject({ rank: null, sample: null, kda: null, vision: null });
    const partial = playerRow(player({ solo: { matches: matches({ visionSamples: 40 }) } } as never), 'solo');
    expect(visionNote(partial)).toBe('Vision score over the 40 of 202 games that recorded one.');
    expect(visionNote(playerRow(player({ solo: { matches: matches({ visionSamples: 0 }) } } as never), 'solo'))).toMatch(/^No vision score/);
  });

  it('defaults to solo when anyone is ranked there, and names the queues as the team does', () => {
    expect(defaultQueue([player({ flex: { rank: rank('GOLD', 'I') } } as never), player({ solo: { rank: rank('SILVER', 'I') } } as never)])).toBe('solo');
    expect(defaultQueue([player({ flex: { rank: rank('GOLD', 'I') } } as never)])).toBe('flex');
    expect([queueLabel('solo'), queueLabel('flex'), queueLabel('clash')]).toEqual(['Solo/Duo', 'Flex', 'Clash']);
  });
});
