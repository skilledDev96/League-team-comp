import { describe, expect, it } from 'vitest';
import { AnalysisGame } from '../models/team.models';
import { playerFigures } from './game-figures';

const base = (players: AnalysisGame['players']): AnalysisGame => ({
  matchId: 'm', compId: null, compName: null, win: true, queue: 'Flex', date: 0, players
});

describe('playerFigures', () => {
  it('shows every figure a v5 game carries, in the fixed column order', () => {
    const g = base([
      { name: 'a', position: 'Top', champion: 'Sion', kills: 1, deaths: 2, assists: 3, cs: 200, damage: 9000, visionScore: 20, killParticipation: 0.5, facts: { goldPerMin: 400, damageShare: 0.25, csAt10: 70, tpTakedowns: 1 }, lane: { position: 'Top', theirChampion: 'Aatrox', verdict: 'lost', goldPerMinDiff: -30 } }
    ]);
    const { columns, rows } = playerFigures(g);
    expect(columns.map((c) => c.key)).toEqual(['kills', 'deaths', 'assists', 'cs', 'damage', 'visionScore', 'kp', 'goldPerMin', 'damageShare', 'csAt10', 'tp', 'lane', 'goldDiff']);
    expect(rows[0].cells).toEqual([1, 2, 3, 200, 9000, 20, '50%', 400, '25%', 70, 1, 'lost vs Aatrox', -30]);
  });

  it('drops a column no player carries, so a replay reads short, and never writes a zero for absent', () => {
    const g = base([
      { name: 'a', position: 'Top', champion: 'Sion', kills: 1, deaths: 2, assists: 3, cs: 200, damage: 9000 },
      { name: 'b', position: 'Mid', champion: 'Ahri', kills: 4, deaths: 0, assists: 1, cs: 180, damage: 12000, damageTaken: 5000 }
    ]);
    const { columns, rows } = playerFigures(g);
    expect(columns.map((c) => c.key)).toEqual(['kills', 'deaths', 'assists', 'cs', 'damage', 'damageTaken']);
    expect(rows[0].cells[5]).toBeUndefined();
    expect(rows[1].cells[5]).toBe(5000);
  });
});
