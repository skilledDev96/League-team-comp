import { describe, expect, it } from 'vitest';
import { AnalysisGame, GameObjectives, LossFactor } from '../../models/team.models';
import { commonestFactor, formatDuration, summariseLosses, summariseWins } from './loss-patterns.util';

const OBJECTIVES: GameObjectives = {
  ours: { firstBlood: false, firstTower: false, dragons: 1, barons: 0, heralds: 0, grubs: 0, towers: 2, inhibitors: 0 },
  theirs: { firstBlood: true, firstTower: true, dragons: 4, barons: 1, heralds: 1, grubs: 3, towers: 9, inhibitors: 2 }
};

function factor(code: LossFactor['code'], label: string): LossFactor {
  return { code, label, detail: '' };
}

function game(over: Partial<AnalysisGame> = {}): AnalysisGame {
  return {
    matchId: 'EUW1_1',
    compId: null,
    compName: null,
    win: false,
    queue: 'Flex',
    date: 0,
    players: [],
    objectives: OBJECTIVES,
    durationSec: 1800,
    lossFactors: [],
    ...over
  };
}

describe('summariseLosses', () => {
  it('ignores wins entirely', () => {
    const summary = summariseLosses([
      game({ win: true, lossFactors: [factor('early_game', 'Lost the early game')] })
    ]);
    expect(summary).toEqual({ analysed: 0, pending: 0, patterns: [] });
  });

  it('counts a factor as a share of the analysed losses', () => {
    const early = game({ lossFactors: [factor('early_game', 'Lost the early game')] });
    const summary = summariseLosses([early, early, early, game()]);
    expect(summary.patterns[0]).toEqual({
      code: 'early_game',
      label: 'Lost the early game',
      games: 3,
      share: 75
    });
  });

  it('counts losses without objectives as pending, not as a clean loss', () => {
    // Otherwise a half-migrated cache would quietly deflate every share.
    const summary = summariseLosses([
      game({ lossFactors: [factor('baron_control', 'Lost baron control')] }),
      game({ objectives: undefined, durationSec: undefined, lossFactors: undefined })
    ]);
    expect(summary.analysed).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.patterns[0].share).toBe(100);
  });

  it('puts the most frequent problem first', () => {
    const summary = summariseLosses([
      game({ lossFactors: [factor('map_control', 'Lost the map')] }),
      game({ lossFactors: [factor('map_control', 'Lost the map'), factor('early_game', 'Lost the early game')] }),
      game({ lossFactors: [factor('early_game', 'Lost the early game')] }),
      game({ lossFactors: [factor('early_game', 'Lost the early game')] })
    ]);
    expect(summary.patterns.map((p) => p.code)).toEqual(['early_game', 'map_control']);
  });
});

describe('formatDuration', () => {
  it('pads seconds so times line up in a column', () => {
    expect(formatDuration(1847)).toBe('30:47');
    expect(formatDuration(1805)).toBe('30:05');
  });

  it('shows a dash rather than 0:00 for a match with no duration cached', () => {
    expect(formatDuration(undefined)).toBe('--');
    expect(formatDuration(0)).toBe('--');
  });
});

describe('commonestFactor', () => {
  it('names the problem that recurs across a comp losses', () => {
    expect(
      commonestFactor([
        game({ lossFactors: [factor('map_control', 'Lost the map')] }),
        game({ lossFactors: [factor('map_control', 'Lost the map')] }),
        game({ lossFactors: [factor('early_game', 'Lost the early game')] })
      ])
    ).toBe('Lost the map');
  });

  it('stays silent when nothing has happened twice', () => {
    // One occurrence is an anecdote. Billing it as the comp's problem would
    // put a confident label on a single game.
    expect(
      commonestFactor([
        game({ lossFactors: [factor('map_control', 'Lost the map')] }),
        game({ lossFactors: [factor('early_game', 'Lost the early game')] })
      ])
    ).toBeNull();
  });

  it('has nothing to say about no losses at all', () => {
    expect(commonestFactor([])).toBeNull();
  });
});

describe('summariseWins', () => {
  const win = (over: Partial<AnalysisGame> = {}) => game({ win: true, ...over });

  it('counts what the wins had in common', () => {
    const summary = summariseWins([
      win({ winFactors: [{ code: 'early_lead', label: 'Won the early game', detail: '' }] }),
      win({ winFactors: [{ code: 'early_lead', label: 'Won the early game', detail: '' }] }),
      win({ winFactors: [{ code: 'comeback', label: 'Won from behind', detail: '' }] })
    ]);
    expect(summary.analysed).toBe(3);
    expect(summary.patterns[0]).toMatchObject({ code: 'early_lead', games: 2, share: 67 });
  });

  it('ignores the losses entirely', () => {
    // The two sides share one implementation, so the risk is a filter that
    // leaks: a loss counted into the wins would quietly inflate every share.
    const summary = summariseWins([
      win({ winFactors: [{ code: 'closed_fast', label: 'Closed it out early', detail: '' }] }),
      game({ lossFactors: [factor('map_control', 'Lost the map')] })
    ]);
    expect(summary.analysed).toBe(1);
    expect(summary.patterns).toHaveLength(1);
  });

  it('reports wins still waiting on objective data separately', () => {
    const summary = summariseWins([
      win({ winFactors: [{ code: 'closed_fast', label: 'Closed it out early', detail: '' }] }),
      win({ objectives: undefined })
    ]);
    expect(summary).toMatchObject({ analysed: 1, pending: 1 });
  });

  it('leaves summariseLosses looking at the other side', () => {
    const games = [win({ winFactors: [{ code: 'comeback', label: 'Won from behind', detail: '' }] })];
    expect(summariseLosses(games).analysed).toBe(0);
  });
});
