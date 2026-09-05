import { describe, expect, it } from 'vitest';
import {
  analysisRequestFrom,
  championOfLine,
  mergeChampionPool,
  mergePlayer,
  refreshOrder,
  StoredPlayer
} from './daily-refresh';

describe('championOfLine', () => {
  it('takes the champion off a "Champion - note" line', () => {
    expect(championOfLine('Ornn - engage, hold ult')).toBe('Ornn');
  });

  it('passes a bare champion through and blanks nothing', () => {
    expect(championOfLine('  Ahri ')).toBe('Ahri');
    expect(championOfLine(undefined)).toBe('');
  });

  it('keeps hyphenated names that are not the separator', () => {
    expect(championOfLine("Kai'Sa-ish")).toBe("Kai'Sa-ish");
  });
});

describe('analysisRequestFrom', () => {
  const players: StoredPlayer[] = [
    { id: 'p1', name: 'One', profile: { region: 'euw', riotTag: 'EUW' } },
    { id: '', name: 'Ghost' }
  ];

  it('builds the same request the Analysis page sends', () => {
    const request = analysisRequestFrom(
      players,
      [
        { id: 'c1', name: 'Engage', picks: { Top: 'Ornn - tank', Jungle: 'Jarvan IV', Mid: '', ADC: 'Jinx', Support: 'Rakan' } },
        { id: '', name: 'Broken' },
        { id: 'c2', countsUnder: 'c1' }
      ],
      [{ matchId: 'EUW1_1', compId: 'c1' }, { matchId: 'EUW1_2' }, { compId: 'c2' }]
    );
    expect(request.players).toEqual([{ id: 'p1', name: 'One', riotTag: 'EUW', region: 'euw' }]);
    expect(request.comps).toEqual([
      { id: 'c1', name: 'Engage', champions: ['Ornn', 'Jarvan IV', 'Jinx', 'Rakan'], countsUnder: null },
      { id: 'c2', name: 'Comp', champions: [], countsUnder: 'c1' }
    ]);
    expect(request.overrides).toEqual({ EUW1_1: 'c1' });
  });
});

describe('mergeChampionPool', () => {
  it('keeps the curated order and appends what is new', () => {
    expect(mergeChampionPool(['Ornn', 'Sion'], ['sion', 'K’Sante', 'Ornn'])).toEqual(['Ornn', 'Sion', 'K’Sante']);
  });
});

describe('mergePlayer', () => {
  const player: StoredPlayer = {
    id: 'p1',
    name: 'One',
    role: 'Top',
    strengths: ['old'],
    weaknesses: [],
    top3: ['Ornn'],
    bans: ['Fiora']
  };

  it('refuses a template result rather than storing invented text', () => {
    expect(mergePlayer(player, { source: 'template', strengths: ['made up'] }, '2026-09-05T05:00:00Z')).toBeNull();
  });

  it('merges a provider result the way the roster page does, and stamps the time', () => {
    const merged = mergePlayer(
      player,
      { source: 'provider', role: 'Top', top3: ['Sion'], bans: [], strengths: [], queueStats: { solo: {} } },
      '2026-09-05T05:00:00Z'
    );
    expect(merged).toMatchObject({
      id: 'p1',
      top3: ['Ornn', 'Sion'],
      bans: ['Fiora'],
      strengths: ['old'],
      queueStats: { solo: {} },
      refreshedAt: '2026-09-05T05:00:00Z'
    });
  });
});

describe('refreshOrder', () => {
  it('puts the never-refreshed first, then the oldest, then by roster order', () => {
    const out = refreshOrder([
      { id: 'b', refreshedAt: '2026-09-04T05:00:00Z', order: 2 },
      { id: 'a', order: 1 },
      { id: 'c', refreshedAt: '2026-09-01T05:00:00Z', order: 3 },
      { id: 'd', order: 0 }
    ]);
    expect(out.map((p) => p.id)).toEqual(['d', 'a', 'c', 'b']);
  });
});
