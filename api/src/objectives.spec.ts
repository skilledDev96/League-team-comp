import { describe, expect, it } from 'vitest';
import { describeLoss, describeWin, GameObjectives, summariseLosses, TeamObjectives } from './objectives';

function team(over: Partial<TeamObjectives> = {}): TeamObjectives {
  return {
    firstBlood: false,
    firstTower: false,
    dragons: 0,
    barons: 0,
    heralds: 0,
    grubs: 0,
    towers: 0,
    inhibitors: 0,
    ...over
  };
}

function game(ours: Partial<TeamObjectives>, theirs: Partial<TeamObjectives>): GameObjectives {
  return { ours: team(ours), theirs: team(theirs) };
}

/** A comfortable mid-length game, past the point where leads are meaningful. */
const LONG = 35 * 60;
const SHORT = 22 * 60;

describe('describeLoss', () => {
  it('calls the early game only when both first blood and first tower were conceded', () => {
    const conceded = describeLoss(game({}, { firstBlood: true, firstTower: true }), SHORT);
    expect(conceded.map((f) => f.code)).toContain('early_game');

    const splitEarly = describeLoss(
      game({ firstBlood: true }, { firstTower: true }),
      SHORT
    );
    expect(splitEarly.map((f) => f.code)).not.toContain('early_game');
  });

  it('ignores a one-dragon gap and reports a two-dragon one', () => {
    // One dragon is variance; two is the start of a soul.
    expect(
      describeLoss(game({ dragons: 1, firstBlood: true }, { dragons: 2 }), SHORT).map((f) => f.code)
    ).not.toContain('dragon_control');
    expect(
      describeLoss(game({ dragons: 1, firstBlood: true }, { dragons: 3 }), SHORT).map((f) => f.code)
    ).toContain('dragon_control');
  });

  it('reports baron control on any deficit, since one baron decides games', () => {
    const factors = describeLoss(game({ firstBlood: true }, { barons: 1 }), LONG);
    const baron = factors.find((f) => f.code === 'baron_control');
    expect(baron?.detail).toBe('Barons 0-1');
  });

  it('names a lost lead only when the team was ahead in a long game', () => {
    const ahead = { dragons: 3, barons: 1, towers: 6, firstBlood: true, firstTower: true };
    const behind = { dragons: 1, barons: 0, towers: 4 };

    expect(describeLoss(game(ahead, behind), LONG).map((f) => f.code)).toContain('threw_lead');
    // The same objective lead 20 minutes in means little — nobody had taken much.
    expect(describeLoss(game(ahead, behind), SHORT).map((f) => f.code)).not.toContain('threw_lead');
  });

  it('orders factors by when they happened, not by severity', () => {
    const factors = describeLoss(
      game({}, { firstBlood: true, firstTower: true, dragons: 3, barons: 2, towers: 9 }),
      LONG
    );
    expect(factors.map((f) => f.code)).toEqual([
      'early_game',
      'dragon_control',
      'baron_control',
      'map_control'
    ]);
  });

  it('returns nothing rather than inventing a reason for an even loss', () => {
    const even = { firstBlood: true, firstTower: true, dragons: 2, barons: 1, towers: 5 };
    expect(describeLoss(game(even, { dragons: 2, barons: 1, towers: 5 }), SHORT)).toEqual([]);
  });
});

describe('summariseLosses', () => {
  it('has nothing to say about no losses', () => {
    expect(summariseLosses([])).toEqual([]);
  });

  it('counts a recurring factor and reports it as a share of the losses', () => {
    const dragonLoss = {
      objectives: game({ firstBlood: true }, { dragons: 3 }),
      durationSec: SHORT
    };
    const cleanLoss = {
      objectives: game({ firstBlood: true, firstTower: true }, {}),
      durationSec: SHORT
    };

    const patterns = summariseLosses([dragonLoss, dragonLoss, dragonLoss, cleanLoss]);
    expect(patterns[0]).toMatchObject({ code: 'dragon_control', games: 3, share: 75 });
  });

  it('puts the most frequent problem first', () => {
    const early = {
      objectives: game({}, { firstBlood: true, firstTower: true }),
      durationSec: SHORT
    };
    const baron = {
      objectives: game({ firstBlood: true, firstTower: true }, { barons: 1 }),
      durationSec: SHORT
    };

    const patterns = summariseLosses([early, early, baron]);
    expect(patterns.map((p) => p.code)).toEqual(['early_game', 'baron_control']);
  });
});

describe('describeWin', () => {
  const codes = (o: GameObjectives, secs: number) => describeWin(o, secs).map((f) => f.code);

  it('credits taking the early game', () => {
    expect(
      codes(game({ firstBlood: true, firstTower: true }, {}), LONG)
    ).toContain('early_lead');
  });

  it('wants both first blood and first tower before calling it', () => {
    expect(codes(game({ firstBlood: true }, {}), LONG)).not.toContain('early_lead');
  });

  it('credits dragon and baron control on the same thresholds as the loss side', () => {
    const c = codes(game({ dragons: 3, barons: 1 }, { dragons: 1, barons: 0 }), LONG);
    expect(c).toContain('dragon_control');
    expect(c).toContain('baron_control');
  });

  it('ignores a one-dragon lead, which is variance rather than control', () => {
    expect(codes(game({ dragons: 2 }, { dragons: 1 }), LONG)).not.toContain('dragon_control');
  });

  it('calls a quick win a quick win', () => {
    expect(codes(game({}, {}), SHORT)).toContain('closed_fast');
  });

  it('reads a long win from behind as a comeback', () => {
    const c = codes(game({ dragons: 1, towers: 4 }, { dragons: 3, barons: 1, towers: 6 }), LONG);
    expect(c).toContain('comeback');
  });

  it('never claims both a fast close and a comeback', () => {
    // They read opposite ends of the clock, so a game claiming both would mean
    // the thresholds had drifted into overlapping.
    for (const secs of [10 * 60, SHORT, 26 * 60, LONG, 50 * 60]) {
      const c = codes(game({ dragons: 1 }, { dragons: 3, barons: 1, towers: 9 }), secs);
      expect(c.includes('closed_fast') && c.includes('comeback')).toBe(false);
    }
  });

  it('says nothing about a long, even win rather than inventing a cause', () => {
    expect(codes(game({ dragons: 2, towers: 5 }, { dragons: 2, towers: 5 }), LONG)).toEqual([]);
  });
});
