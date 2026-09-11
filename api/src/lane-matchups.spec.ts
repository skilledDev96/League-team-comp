import { describe, expect, it } from 'vitest';
import { displayChampionName, riotChampionId } from './champion-names';
import { LaneMatchup, matchupFor, matchupLines, MatchupIndexDoc, MIN_BASELINE_GAMES, MIN_MATCHUP_GAMES, normalise, SOLID_MATCHUP_GAMES } from './lane-matchups';

/**
 * The rates the review reads off `matchupIndex`. The draft room reads the same documents through
 * `MatchupStatsService`, so the two must agree on every rule here — a coach who is told one number
 * in the draft and a different one in the review stops believing both.
 */

function doc(patch: string, pairs: Record<string, { games: number; winsA: number }>): MatchupIndexDoc {
  return { patch, lane: 'UTILITY', pairs };
}

describe('matchupFor', () => {
  it('reads the rate as OURS, flipping it when our champion sorted second', () => {
    // The one that must never be wrong. `winsA` counts wins for whichever champion sorted FIRST,
    // so reading it as ours when it is theirs turns a 40% hard counter into a 60% free lane — and
    // it fails in the direction that would have a coach defend the draft that lost them the game.
    // Nautilus sorts before Rell, so a Nautilus/Rell document counts Nautilus's wins.
    const pairs = { Nautilus_Rell: { games: 597, winsA: 242 } };

    const asNautilus = matchupFor('Support', 'Nautilus', 'Rell', [doc('16.17', pairs)]);
    expect(asNautilus?.winRate).toBe(40.5);

    const asRell = matchupFor('Support', 'Rell', 'Nautilus', [doc('16.17', pairs)]);
    expect(asRell?.winRate).toBe(59.5);

    // Both read the same 597 games; only the side changes.
    expect(asNautilus?.games).toBe(597);
    expect(asRell?.games).toBe(597);
    expect((asNautilus?.winRate ?? 0) + (asRell?.winRate ?? 0)).toBeCloseTo(100, 1);
  });

  it('takes the current patch alone once it is solid, and says so', () => {
    const docs = [doc('16.18', { Nautilus_Rell: { games: SOLID_MATCHUP_GAMES, winsA: 100 } }), doc('16.17', { Nautilus_Rell: { games: 900, winsA: 300 } })];
    const rate = matchupFor('Support', 'Nautilus', 'Rell', docs);
    // The older patch's 900 games are NOT added: this patch can answer on its own, and it is the
    // more truthful answer to a question about the game as it is now.
    expect(rate?.games).toBe(SOLID_MATCHUP_GAMES);
    expect(rate?.winRate).toBe(50);
    expect(rate?.combined).toBe(false);
    expect(rate?.patches).toEqual(['16.18']);
    expect(rate?.thin).toBe(false);
  });

  it('adds the patch before when this one is too thin on its own, and flags it as two patches', () => {
    const docs = [doc('16.18', { Nautilus_Rell: { games: 60, winsA: 20 } }), doc('16.17', { Nautilus_Rell: { games: 120, winsA: 40 } })];
    const rate = matchupFor('Support', 'Nautilus', 'Rell', docs);
    expect(rate?.games).toBe(180);
    expect(rate?.winRate).toBe(33.3);
    expect(rate?.combined).toBe(true);
    expect(rate?.patches).toEqual(['16.18', '16.17']);
    // Still under the honesty threshold, so it carries its own doubt.
    expect(rate?.thin).toBe(true);
    expect(rate?.margin).toBeGreaterThan(0);
  });

  it('says nothing at all below the floor, however tempting the number looks', () => {
    // A rate off forty games is noise, and noise printed beside real figures reads as a fact.
    const docs = [doc('16.18', { Nautilus_Rell: { games: MIN_MATCHUP_GAMES - 1, winsA: 5 } })];
    expect(matchupFor('Support', 'Nautilus', 'Rell', docs)).toBe(null);
    expect(matchupFor('Support', 'Nautilus', 'Rell', [])).toBe(null);
    expect(matchupFor('Support', 'Nautilus', 'Rell', [doc('16.18', {})])).toBe(null);
  });

  it('refuses a tally that cannot be true rather than printing a rate over 100', () => {
    const broken = [doc('16.18', { Nautilus_Rell: { games: 300, winsA: 400 } })];
    expect(matchupFor('Support', 'Nautilus', 'Rell', broken)).toBe(null);
    const negative = [doc('16.18', { Nautilus_Rell: { games: 300, winsA: -1 } })];
    expect(matchupFor('Support', 'Nautilus', 'Rell', negative)).toBe(null);
  });

  it('keys on Riot ids the way the crawler does, punctuation and all', () => {
    // The crawler strips to letters and digits, so Kai'Sa is stored as Kaisa and the key is built
    // from the id and never the display name.
    const pairs = { Kaisa_MissFortune: { games: 400, winsA: 240 } };
    const rate = matchupFor('ADC', riotChampionId("Kai'Sa"), riotChampionId('Miss Fortune'), [doc('16.18', pairs)]);
    expect(rate?.winRate).toBe(60);
    expect(rate?.ours).toBe('Kaisa');
  });
});

describe('normalise', () => {
  const base = (winRate: number, games = 20_000) => ({ games, winRate });

  it('splits a rate into the pairing and the two picks, Bradley-Terry on the odds', () => {
    // The real figures: Nautilus 49.29% overall, Rell 51.95%, the pairing observed at 40.5%. Their
    // own strength alone predicts 47.4%, so the pairing costs a further ~6.9 and the rest is Rell
    // simply being the stronger pick this patch — a different conversation with the player.
    const split = normalise(40.5, base(49.3), base(51.9));
    expect(split?.expected).toBeCloseTo(47.4, 1);
    expect(split?.delta).toBeCloseTo(-6.9, 1);
  });

  it('reproduces the published normalisation from the same inputs, which is why this method and not another', () => {
    // lolalytics gives Nautilus 51.79% / Rell 53.2% / observed 45.8% and publishes -2.79. If our
    // arithmetic did not land on their answer from their numbers, one of us would be wrong and it
    // would be silent.
    const split = normalise(45.8, base(51.79), base(53.2));
    expect(split?.expected).toBeCloseTo(48.6, 1);
    expect(split?.delta).toBeCloseTo(-2.8, 1);
  });

  it('reads two evenly-matched picks as an even expectation', () => {
    expect(normalise(50, base(50), base(50))?.expected).toBe(50);
    expect(normalise(50, base(50), base(50))?.delta).toBe(0);
    // And a stronger champion opposite drags the expectation down even with no matchup effect.
    expect(normalise(45, base(48), base(54))?.expected ?? 0).toBeLessThan(50);
  });

  it('says nothing rather than guess when either champion has too thin a record', () => {
    // A wrong split is worse than none: it would move a coaching point from the draft to the player
    // or back on the strength of forty games.
    expect(normalise(40.5, base(49.3, MIN_BASELINE_GAMES - 1), base(51.9))).toBe(null);
    expect(normalise(40.5, base(49.3), base(51.9, 10))).toBe(null);
    expect(normalise(40.5, null, base(51.9))).toBe(null);
    expect(normalise(40.5, base(49.3), null)).toBe(null);
  });

  it('survives a champion at the extremes rather than dividing by zero', () => {
    expect(Number.isFinite(normalise(50, base(0), base(50))?.expected ?? NaN)).toBe(true);
    expect(Number.isFinite(normalise(50, base(100), base(50))?.expected ?? NaN)).toBe(true);
  });
});

describe('riotChampionId', () => {
  it('turns a display name back into the id the counters are under', () => {
    // The Wukong case: a review reading the display name finds nothing, and a missing rate looks
    // exactly like one below the sample floor, which is how three champions went unnoticed for
    // weeks the last time this was got wrong.
    expect(riotChampionId('Wukong')).toBe('MonkeyKing');
    expect(riotChampionId('Nunu & Willump')).toBe('Nunu');
    expect(riotChampionId('Renata Glasc')).toBe('Renata');
    expect(riotChampionId("Kai'Sa")).toBe('Kaisa');
    // A champion the table does not carry is already its own id.
    expect(riotChampionId('Akali')).toBe('Akali');
    expect(riotChampionId('LeeSin')).toBe('LeeSin');
    // And it is the exact inverse of the map the match reader uses.
    for (const id of ['MonkeyKing', 'Nunu', 'Renata', 'Kaisa', 'DrMundo', 'Akali']) expect(riotChampionId(displayChampionName(id))).toBe(id);
  });
});

describe('matchupLines', () => {
  const rate = (over: Partial<LaneMatchup>): LaneMatchup => ({
    seat: 'Support',
    ours: 'Nautilus',
    theirs: 'Rell',
    games: 597,
    winRate: 40.5,
    margin: 0.4,
    thin: false,
    combined: false,
    patches: ['16.17'],
    ...over
  });

  it('says twice over that these are not our games, because a model handed 41% will say a player did it', () => {
    const lines = matchupLines([rate({})]);
    expect(lines[0]).toContain('FROM SOLO QUEUE AT LARGE (not our games, and not this game)');
    expect(lines[1]).toContain('BEFORE anyone played it');
    // The invitation has to be its own line and not buried between two prohibitions: the first run in
    // production carried the block and the review cited none of it (12 Sep 2026).
    expect(lines[2]).toContain('SAY SO WHERE IT CHANGES THE POINT');
    expect(lines[2]).toContain('Quote the figure when you lean on it');
    expect(lines[3]).toContain('never report one as a result of theirs');
    // And the separation a coach actually needs: draft problem versus play problem.
    expect(lines[2]).toContain('the draft owns part of it');
  });

  it('reads a losing lane as one, with the sample it rests on', () => {
    const [, , , , line] = matchupLines([rate({})]);
    expect(line).toBe('- Our Support Nautilus into their Rell: 40.5% over 597 games on patch 16.17 — a losing lane before anyone played it, badly.');
  });

  it('calls an even lane even rather than inventing an edge from half a point', () => {
    expect(matchupLines([rate({ winRate: 48.9, ours: 'Akali', theirs: 'Yasuo', seat: 'Mid', games: 650 })])[4]).toContain('even on paper');
    expect(matchupLines([rate({ winRate: 51.3 })])[4]).toContain('even on paper');
    expect(matchupLines([rate({ winRate: 56 })])[4]).toContain('a lane we were favoured in');
    expect(matchupLines([rate({ winRate: 61 })])[4]).toContain('strongly');
  });

  it('carries its own doubt when the sample is thin, and says when it spans two patches', () => {
    const [, , , , line] = matchupLines([rate({ games: 120, thin: true, margin: 8.9, combined: true, patches: ['16.18', '16.17'] })]);
    expect(line).toContain('over 120 games on patches 16.18 and 16.17');
    expect(line).toContain('thin, ±8.9 points, so treat it as a hint and not a fact');
  });

  it('prints display names, so nobody reads MonkeyKing in a coaching sentence', () => {
    const [, , , , line] = matchupLines([rate({ ours: 'MonkeyKing', theirs: 'Kaisa' })], displayChampionName);
    expect(line).toContain('Our Support Wukong into their Kai’Sa'.replace('’', "'"));
  });

  it('prints nothing at all when no lane cleared the floor, rather than an empty heading', () => {
    expect(matchupLines([])).toEqual([]);
  });

  it('separates the pairing from the picks, so a bad lane and a strong opponent read differently', () => {
    // "You drafted a bad lane" and "they picked the stronger champion" call for different things:
    // one is a habit to fix and the other is the meta and nobody's mistake.
    const [, , , , line] = matchupLines([rate({ expected: 47.4, delta: -6.9, ourBase: 49.3, theirBase: 51.9 })]);
    expect(line).toContain('On strength: Nautilus wins 49.3% of their games this patch and Rell 51.9%, so on picks alone this would read 47.4%');
    expect(line).toContain('at 40.5% the pairing itself costs a further 6.9 points');
  });

  it('says outright when the pairing is worth nothing and the lane is just the champions in it', () => {
    const [, , , , line] = matchupLines([rate({ winRate: 48.9, ours: 'Akali', theirs: 'Yasuo', seat: 'Mid', expected: 48.2, delta: 0.7, ourBase: 48.6, theirBase: 50.4 })]);
    expect(line).toContain('which is where it landed, so the pairing itself is worth nothing either way');
    expect(line).not.toContain('costs a further');
  });

  it('leaves the split off entirely when the baselines were too thin to compute one', () => {
    const [, , , , line] = matchupLines([rate({})]);
    expect(line).not.toContain('On strength');
    expect(line.endsWith('badly.')).toBe(true);
  });
});
