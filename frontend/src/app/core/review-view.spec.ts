import { describe, expect, it } from 'vitest';
import { AnalysisGame, GameReview, TeamObjectives } from '../models/team.models';
import { evidenceChips, playerStatLine, reviewAsText, scoreline } from './review-view';

const side = (o: Partial<TeamObjectives>): TeamObjectives => ({ firstBlood: false, firstTower: false, dragons: 0, barons: 0, heralds: 0, grubs: 0, towers: 0, inhibitors: 0, ...o });
const objectives = (ours: Partial<TeamObjectives>, theirs: Partial<TeamObjectives>) => ({ ours: side(ours), theirs: side({ firstBlood: true, firstTower: true, ...theirs }) });

const game = {
  matchId: 'm1',
  date: 1,
  queue: 'Scrim',
  win: false,
  durationSec: 34 * 60 + 13,
  kills: { ours: 14, theirs: 35 },
  objectives: objectives({ towers: 6, dragons: 2, barons: 1, grubs: 3, heralds: 0 }, { towers: 9, dragons: 3, barons: 1, grubs: 0, heralds: 1 }),
  players: [{ name: 'Go10x', position: 'Jungle', champion: 'Trundle', kills: 3, deaths: 8, assists: 2, cs: 223, damage: 1, killParticipation: 0.36, visionScore: 34 }]
} as unknown as AnalysisGame;

const review = {
  matchId: 'm1',
  team: {
    headline: 'Bled 35 kills while farming even',
    summary: 'The team matched on CS but gave up the fights.',
    workOn: [
      { text: 'Commit only when Jinx is in range.', evidence: 'kills 14-35 · Leona 1/9/7', minute: null, theme: 'fights' },
      { text: 'Trade the third grub for dragon tempo.', evidence: 'grubs 3-0 · dragons 2-3', minute: null, theme: 'objectives' }
    ],
    keepDoing: [{ text: 'Farm held up.', evidence: 'Jinx 232, Trundle 223', minute: null, theme: 'lanes' }],
    compVerdict: 'unclear',
    compWhy: ''
  },
  players: [
    { name: 'Go10x', seat: 'Jungle', champion: 'Trundle', strength: { text: 'Grubs went 3-0.', evidence: '', minute: null }, workOn: { text: 'Path safer.', evidence: '', minute: null } }
  ]
} as unknown as GameReview;

describe('scoreline', () => {
  it('reads result, length, kills and the objectives ours first, and colours the better side', () => {
    const chips = scoreline(game);
    expect(chips.map((c) => c.label)).toEqual(['Loss', 'Length', 'Kills', 'Towers', 'Dragons', 'Barons', 'Grubs', 'Heralds']);
    expect(chips[0].good).toBe(false);
    expect(chips[1].ours).toBe('34 min');
    expect(chips.find((c) => c.label === 'Kills')).toEqual({ label: 'Kills', ours: '14', theirs: '35', good: false });
    expect(chips.find((c) => c.label === 'Grubs')?.good).toBe(true);
    expect(chips.find((c) => c.label === 'Barons')?.good).toBeUndefined();
  });

  it('is empty without a game, and skips what a game does not carry', () => {
    expect(scoreline(undefined)).toEqual([]);
    expect(scoreline({ ...game, kills: undefined, objectives: undefined, durationSec: undefined } as AnalysisGame)).toEqual([{ label: 'Loss', ours: '', good: false }]);
  });
});

describe('evidenceChips', () => {
  it('splits figures on the separators the prompt uses, and leaves a sentence whole', () => {
    expect(evidenceChips('kills 14-35 · Leona 1/9/7 · Heimerdinger 3/8/3')).toEqual(['kills 14-35', 'Leona 1/9/7', 'Heimerdinger 3/8/3']);
    expect(evidenceChips('Jinx 232, Trundle 223, Heimerdinger 218 CS.')).toEqual(['Jinx 232', 'Trundle 223', 'Heimerdinger 218 CS']);
    expect(evidenceChips('Conceded both first blood and first tower')).toEqual(['Conceded both first blood and first tower']);
    expect(evidenceChips('a · b · c · d · e · f · g')).toEqual(['a · b · c · d · e · f · g']);
    expect(evidenceChips('  ')).toEqual([]);
  });
});

describe('playerStatLine', () => {
  it('joins the figures the game carries', () => {
    expect(playerStatLine(game.players[0])).toBe('3/8/2 · 223 CS · vision 34 · 36% KP');
    expect(playerStatLine({ ...game.players[0], visionScore: undefined, killParticipation: undefined })).toBe('3/8/2 · 223 CS');
    expect(playerStatLine(undefined)).toBe('');
  });
});

describe('reviewAsText', () => {
  it('writes the title line, the first thing, the rest and a line per player', () => {
    const text = reviewAsText(review, game, 'MOSS 2');
    expect(text.split('\n')[0]).toBe('**Bled 35 kills while farming even** — Loss 14-35 in 34 min vs MOSS 2');
    expect(text).toContain('**First thing next game:** Commit only when Jinx is in range. (kills 14-35 · Leona 1/9/7)');
    expect(text).toContain('**Work on:**\n• Trade the third grub for dragon tempo. (grubs 3-0 · dragons 2-3)');
    expect(text).toContain('**Keep doing:**\n• Farm held up. (Jinx 232, Trundle 223)');
    expect(text).toContain('• Go10x (Jungle, Trundle) — + Grubs went 3-0. / − Path safer.');
  });

  it('titles a review from before the headline with the summary’s first sentence', () => {
    const old = { ...review, team: { ...review.team, headline: undefined } } as GameReview;
    const text = reviewAsText(old, undefined);
    expect(text.split('\n')[0]).toBe('**The team matched on CS but gave up the fights.**');
    expect(text).not.toContain('The team matched on CS but gave up the fights.\n**');
  });
});
