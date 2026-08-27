import { describe, expect, it } from 'vitest';
import { killParticipation, killShare, tallyKills } from './fights';

const p = (teamId: number, kills: number, assists = 0) => ({ teamId, kills, assists });

describe('tallyKills', () => {
  it('splits the scoreline by side', () => {
    expect(
      tallyKills([p(100, 5), p(100, 3), p(200, 2), p(200, 9)], 100)
    ).toEqual({ ours: 8, theirs: 11 });
  });

  it('reads the same match from the other side', () => {
    const parts = [p(100, 5), p(200, 2)];
    expect(tallyKills(parts, 200)).toEqual({ ours: 2, theirs: 5 });
  });

  it('handles a game where nobody died', () => {
    expect(tallyKills([p(100, 0), p(200, 0)], 100)).toEqual({ ours: 0, theirs: 0 });
  });
});

describe('killShare', () => {
  it('reports the share of kills that went our way', () => {
    expect(killShare({ ours: 30, theirs: 10 })).toBe(0.75);
  });

  it('stays silent on a game with too few kills to mean anything', () => {
    // 3-1 is the same share as 30-10 and nothing like the same claim.
    expect(killShare({ ours: 3, theirs: 1 })).toBeNull();
  });

  it('is not fooled by a big margin in a long game', () => {
    // Eight kills up is a rout at twenty minutes and noise at fifty, which is
    // why this is a share and not a margin.
    const share = killShare({ ours: 29, theirs: 21 });
    expect(share).toBeCloseTo(0.58, 2);
  });

  it('has nothing to say about a scoreless game', () => {
    expect(killShare({ ours: 0, theirs: 0 })).toBeNull();
  });
});

describe('killParticipation', () => {
  it('counts kills and assists against the team total', () => {
    expect(killParticipation(3, 5, 16)).toBe(0.5);
  });

  it('caps at 1 rather than reporting more than everything', () => {
    // Riot's own totals can disagree slightly; a player cannot be in on 110%
    // of the fights, and showing that would just look broken.
    expect(killParticipation(8, 5, 10)).toBe(1);
  });

  it('returns null when the team took no kills at all', () => {
    expect(killParticipation(0, 0, 0)).toBeNull();
  });
});
