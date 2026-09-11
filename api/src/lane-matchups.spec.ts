import { describe, expect, it } from 'vitest';
import { displayChampionName, riotChampionId } from './champion-names';
import { LaneMatchup, matchupFor, matchupLines, MatchupIndexDoc, MIN_MATCHUP_GAMES, SOLID_MATCHUP_GAMES } from './lane-matchups';

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
    expect(lines[1]).toContain('Never report one of these as something a player of ours did');
    // And the separation a coach actually needs: draft problem versus play problem.
    expect(lines[1]).toContain('a lane lost at 41% is a draft problem as much as a play problem');
  });

  it('reads a losing lane as one, with the sample it rests on', () => {
    const [, , line] = matchupLines([rate({})]);
    expect(line).toBe('- Our Support Nautilus into their Rell: 40.5% over 597 games on patch 16.17 — a losing lane before anyone played it, badly.');
  });

  it('calls an even lane even rather than inventing an edge from half a point', () => {
    expect(matchupLines([rate({ winRate: 48.9, ours: 'Akali', theirs: 'Yasuo', seat: 'Mid', games: 650 })])[2]).toContain('even on paper');
    expect(matchupLines([rate({ winRate: 51.3 })])[2]).toContain('even on paper');
    expect(matchupLines([rate({ winRate: 56 })])[2]).toContain('a lane we were favoured in');
    expect(matchupLines([rate({ winRate: 61 })])[2]).toContain('strongly');
  });

  it('carries its own doubt when the sample is thin, and says when it spans two patches', () => {
    const [, , line] = matchupLines([rate({ games: 120, thin: true, margin: 8.9, combined: true, patches: ['16.18', '16.17'] })]);
    expect(line).toContain('over 120 games on patches 16.18 and 16.17');
    expect(line).toContain('thin, ±8.9 points, so treat it as a hint and not a fact');
  });

  it('prints display names, so nobody reads MonkeyKing in a coaching sentence', () => {
    const [, , line] = matchupLines([rate({ ours: 'MonkeyKing', theirs: 'Kaisa' })], displayChampionName);
    expect(line).toContain('Our Support Wukong into their Kai’Sa'.replace('’', "'"));
  });

  it('prints nothing at all when no lane cleared the floor, rather than an empty heading', () => {
    expect(matchupLines([])).toEqual([]);
  });
});
