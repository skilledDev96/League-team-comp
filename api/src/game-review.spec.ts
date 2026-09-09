import { describe, expect, it } from 'vitest';
import { endOfGameFacts, GameFacts } from './game-facts';
import {
  buildPlayerPrompt,
  buildTeamPrompt,
  costUsd,
  MAX_AUTO_REVIEWS,
  parseGameReviewRequest,
  parsePlayerNotes,
  parseTeamReview,
  reviewCandidates,
  ReviewContext,
  reviewPlayers
} from './game-review';

const game: ReviewContext['game'] = {
  queue: 'Flex',
  date: Date.UTC(2026, 8, 7),
  win: false,
  durationSec: 1860,
  side: 'blue',
  enemies: [
    { position: 'Top', champion: 'Darius' },
    { position: 'Mid', champion: 'Syndra' }
  ],
  players: [
    { name: 'Ruan', position: 'Top', champion: 'Ornn', kills: 1, deaths: 4, assists: 3, cs: 180, visionScore: 20, killParticipation: 0.4, lane: { position: 'Top', theirChampion: 'Darius', verdict: 'lost', goldPerMinDiff: -45, csAt10Diff: -12 }, facts: { goldPerMin: 360, csAt10: 60, controlWards: 2, soloKills: 0, timeDeadSec: 200, hasTeleport: true, tpTakedowns: 1 } },
    { name: 'Dan', position: 'Mid', champion: 'Ahri', kills: 5, deaths: 2, assists: 6, cs: 210, visionScore: 25 }
  ]
};

const facts: GameFacts = {
  factsVersion: 1,
  tier: 'timeline',
  result: 'loss',
  durationMin: 31,
  side: 'blue',
  curve: { at10: -1200, at15: -2000, at25: -4000, peakLead: { gold: 300, minute: 2 }, worstDeficit: { gold: -6000, minute: 29 }, shape: 'trailed throughout' },
  lanes: [{ seat: 'Top', name: 'Ruan', champion: 'Ornn', theirChampion: 'Darius', verdict: 'lost', goldAt10: -900, flippedAt: 6, line: 'Ruan (Top) on Ornn lost the lane into Darius down 900 at ten, and the lead changed hands at 6.' }],
  firsts: { blood: { minute: 4, side: 'them' } },
  objectives: [{ minute: 8, type: 'dragon', subType: 'infernal', side: 'them', ourNearCount: 0, ourInvolved: [], setup: 'uncontested', line: 'Minute 8: their dragon (infernal), nobody of ours near.' }],
  deathClusters: [],
  soloDeaths: [{ minute: 12, seat: 'Top', zone: 'theirJungle', warded: false, theirSide: true, line: 'Minute 12: Ruan (Top) died alone in their jungle, with no ward nearby.' }],
  vision: [],
  spend: [{ seat: 'Top', firstItemMinute: 11, backs: 4 }],
  lines: ['Lost in 31 minutes, behind all game: the worst deficit was 6k at 29.', 'Ruan (Top) on Ornn lost the lane into Darius down 900 at ten, and the lead changed hands at 6.', 'Minute 8: their dragon (infernal), nobody of ours near.', 'Minute 12: Ruan (Top) died alone in their jungle, with no ward nearby.']
};

const ctx: ReviewContext = {
  teamName: 'Bom Squad',
  tier: 'timeline',
  game,
  facts,
  deaths: [{ seat: 'Top', minute: 12, zone: 'theirJungle', killers: 1, warded: false, executed: false }],
  comp: { id: 'c1', name: 'Dive', expect: { early: 'high', scaling: 'low', objectives: 'mid', teamfight: 'high' }, expectSource: 'edited', gamePlan: { early: 'Play for grubs', late: 'Group and dive the carry' }, notes: 'Our comfort pick.' },
  note: 'Ons het te lank gewag by drake.',
  players: reviewPlayers(game)
};

describe('parseGameReviewRequest', () => {
  it('takes a Riot id or a replay id, and the four axes when sent', () => {
    expect(parseGameReviewRequest({ matchId: 'EUW1_7000' })).toEqual({ matchId: 'EUW1_7000' });
    expect(parseGameReviewRequest({ matchId: 'EUW1-7000', expect: null })).toEqual({ matchId: 'EUW1-7000', expect: null });
    expect(parseGameReviewRequest({ matchId: 'EUW1_1', expect: { early: 'high', scaling: 'mid', objectives: 'low', teamfight: 'mid' } }).expect).toEqual({ early: 'high', scaling: 'mid', objectives: 'low', teamfight: 'mid' });
  });

  it('rejects a bad id and a bad axis', () => {
    expect(() => parseGameReviewRequest({ matchId: '../x' })).toThrow(/matchId/);
    expect(() => parseGameReviewRequest({ matchId: 'EUW1_1', expect: { early: 'huge' } })).toThrow(/expect/);
    expect(() => parseGameReviewRequest('nope')).toThrow(/JSON/);
  });
});

describe('the prompts', () => {
  it('carry the axes, the plan, the note and the facts, and no one from the other team', () => {
    const p = buildTeamPrompt(ctx);
    expect(p).toContain('strong early game, weak scaling, average objective control, strong teamfight (set by the team)');
    expect(p).toContain('Expected a strong early game, but was down 1.2k at ten.');
    expect(p).toContain('Game plan, early: Play for grubs');
    expect(p).toContain('Ons het te lank gewag by drake.');
    expect(p).toContain('Team gold, ours minus theirs: 10 min -1.2k, 15 min -2k, 25 min -4k.');
    expect(p).toContain('THEIR CHAMPIONS: Top: Darius, Mid: Syndra');
    expect(p).toContain('Top had a first item’s worth of gold spent by minute 11 over 4 backs');
    expect(p).not.toMatch(/#[A-Z0-9]{2,5}\b/);
    expect(p).not.toMatch(/puuid/i);
    expect(p).not.toContain('TIER:');
  });

  it('give each player a block with the lane read, the habits and the deaths', () => {
    const p = buildPlayerPrompt(ctx);
    expect(p).toContain('- Ruan (Top, Ornn): 1/4/3, 180 CS, vision 20.');
    expect(p).toContain('Lane lost into Darius: -45 gold/min vs lane, -12 CS at ten vs lane.');
    expect(p).toContain('Habits: 360 gold/min, 60 CS at ten, 2 control wards, 0 solo kills, 3 min dead, 1 Teleport takedowns.');
    expect(p).toContain('Deaths: minute 12 in their jungle alone, no ward nearby.');
    expect(p).toContain('- Dan (Mid, Ahri): 5/2/6, 210 CS, vision 25.');
  });

  it('say totals only on the replay tier', () => {
    const scrim: ReviewContext = { ...ctx, tier: 'endOfGame', deaths: undefined, facts: endOfGameFacts({ ...game, queue: 'Scrim' }) };
    expect(buildTeamPrompt(scrim)).toContain('TIER: totals only, from a replay file.');
  });
});

describe('parseTeamReview', () => {
  it('caps the lists, drops points without evidence, nulls a minute outside the game, and corrects a bad verdict', () => {
    const got = parseTeamReview(
      {
        summary: 'x'.repeat(500),
        workOn: [
          { text: 'One', evidence: 'minute 8 dragon', minute: 8 },
          { text: 'Two', evidence: '', minute: 3 },
          { text: 'Three', evidence: 'lane', minute: 99 },
          { text: 'Four', evidence: 'ok', minute: null },
          { text: 'Five', evidence: 'ok', minute: 1 }
        ],
        keepDoing: [{ text: 'A', evidence: 'b', minute: 2 }, { text: 'B', evidence: 'c', minute: -1 }, { text: 'C', evidence: 'd', minute: 3 }],
        compVerdict: 'sort of',
        compWhy: 'because'
      },
      ctx
    );
    expect(got.summary).toHaveLength(400);
    expect(got.workOn.map((w) => w.text)).toEqual(['One', 'Three', 'Four']);
    expect(got.workOn[1].minute).toBeNull();
    expect(got.keepDoing).toHaveLength(2);
    expect(got.keepDoing[1].minute).toBeNull();
    expect(got.compVerdict).toBe('unclear');
    expect(got.compWhy).toBe('because');
  });

  it('keeps the headline without its full stop and a known theme, and drops an unknown theme', () => {
    const got = parseTeamReview(
      { headline: 'Lost in the fights, not the farm.', workOn: [{ text: 'One', evidence: 'x', minute: null, theme: 'fights' }, { text: 'Two', evidence: 'y', minute: null, theme: 'vibes' }] },
      ctx
    );
    expect(got.headline).toBe('Lost in the fights, not the farm');
    expect(got.workOn[0].theme).toBe('fights');
    expect(got.workOn[1].theme).toBeUndefined();
    expect(parseTeamReview({}, ctx).headline).toBeUndefined();
  });

  it('is unclear on the comp when there was no comp, whatever the model said', () => {
    expect(parseTeamReview({ compVerdict: 'as drafted' }, { ...ctx, comp: null }).compVerdict).toBe('unclear');
    expect(parseTeamReview({ compVerdict: 'as drafted' }, ctx).compVerdict).toBe('as drafted');
  });
});

describe('parsePlayerNotes', () => {
  it('keeps only our players, once each, with the seat from the context and not from the model', () => {
    const got = parsePlayerNotes(
      {
        players: [
          { name: 'dan', seat: 'Top', strength: { text: 'Roamed well', evidence: 'minute 9 kill', minute: 9 }, workOn: { text: 'Ward river', evidence: 'no ward at 12', minute: 12 } },
          { name: 'Ruan', strength: { text: '', evidence: '' }, workOn: { text: 'Do not fight Darius early', evidence: 'down 900 at ten', minute: 10 } },
          { name: 'Ruan', strength: { text: 'dup', evidence: 'x' }, workOn: { text: 'dup', evidence: 'x' } },
          { name: 'Darius', strength: { text: 'nope', evidence: 'x' }, workOn: { text: 'nope', evidence: 'x' } }
        ]
      },
      ctx
    );
    expect(got.map((n) => [n.name, n.seat, n.champion])).toEqual([
      ['Ruan', 'Top', 'Ornn'],
      ['Dan', 'Mid', 'Ahri']
    ]);
    expect(got[0].strength.text).toBe('');
    expect(got[0].workOn.text).toBe('Do not fight Darius early');
    expect(got[1].strength.minute).toBe(9);
  });
});

describe('reviewCandidates', () => {
  const g = (matchId: string, date: number, queue = 'Flex') => ({ matchId, date, queue });

  it('wants prep Flex and Clash games with a timeline and no review, newest first, capped', () => {
    const games = [g('a', 1), g('b', 5), g('c', 4), g('d', 3, 'Scrim'), g('e', 6), g('f', 2), g('g', 7)];
    const got = reviewCandidates(games, new Set(['e']), new Set(['a', 'b', 'c', 'd', 'e', 'g']), new Set(['g']));
    expect(got.map((x) => x.matchId)).toEqual(['b', 'c', 'a']);
    expect(MAX_AUTO_REVIEWS).toBe(3);
    expect(reviewCandidates(games, new Set(), new Set(['a', 'b', 'c']), new Set(), 2).map((x) => x.matchId)).toEqual(['b', 'c']);
  });
});

describe('costUsd', () => {
  it('bills input, cached input and output at the list price', () => {
    expect(costUsd('claude-opus-5', { input: 6000, cachedInput: 2000, output: 1000 })).toBe(0.056);
    expect(costUsd('claude-sonnet-5-20260601', { input: 6000, cachedInput: 2000, output: 1000 })).toBe(0.022);
    expect(costUsd('something-else', { input: 1, cachedInput: 1, output: 1 })).toBe(0);
  });
});
