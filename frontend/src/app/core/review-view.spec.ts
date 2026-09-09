import { describe, expect, it } from 'vitest';
import { AnalysisGame, GameReview, TeamObjectives } from '../models/team.models';
import { askOf, evidenceChips, playerStatLine, reviewAsText, scoreline } from './review-view';

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

describe('askOf', () => {
  it('keeps the clause after the last semicolon or ", so", capitalised, and the whole note otherwise', () => {
    expect(askOf('Eight deaths is the second-highest on the team; either play safer trades before towers fall or ask for jungle pressure earlier.')).toBe('Either play safer trades before towers fall or ask for jungle pressure earlier.');
    expect(askOf('First tower went early, so next time play the first ten minutes for level.')).toBe('Play the first ten minutes for level.');
    expect(askOf('Path safer.')).toBe('Path safer.');
  });
});

describe('reviewAsText', () => {
  it('is a short Discord message: heading, scoreline subtext, the first thing, one Keep doing, an ask per player', () => {
    const text = reviewAsText(review, game, 'MOSS 2');
    const lines = text.split('\n');
    expect(lines[0]).toBe('## Bled 35 kills while farming even');
    expect(lines[1]).toBe('-# ❌ Loss 14–35 · 34 min · vs MOSS 2 · 🏰 6–9 · 🐉 2–3 · 🟣 1–1 · 🐛 3–0 · 👁️ 0–1');
    expect(text).toContain('**🎯 First thing next game** · fights\nCommit only when Jinx is in range.');
    expect(text).toContain('**✅ Keep doing** · lanes\nFarm held up.');
    expect(text).toContain('**👥 One ask each**\n• **Go10x** (Trundle) — Path safer.');
    expect(text).not.toContain('kills 14-35 · Leona 1/9/7');
    expect(text).not.toContain('Trade the third grub');
    expect(lines.at(-1)).toBe('-# The full review, with the figures behind every line, is on the Games page.');
    expect(reviewAsText(review, game, 'MOSS 2', 'https://example.test/League-team-comp/games?match=m1&tab=games').split('\n').at(-1)).toBe(
      '-# Full review with the figures: <https://example.test/League-team-comp/games?match=m1&tab=games>'
    );
  });

  it('titles a review from before the headline with the summary’s first sentence, and has no scoreline without a game', () => {
    const old = { ...review, team: { ...review.team, headline: undefined } } as GameReview;
    const lines = reviewAsText(old, undefined).split('\n');
    expect(lines[0]).toBe('## The team matched on CS but gave up the fights.');
    expect(lines[1]).toBe('');
  });
});
