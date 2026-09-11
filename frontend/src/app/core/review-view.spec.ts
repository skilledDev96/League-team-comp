import { describe, expect, it } from 'vitest';
import { AnalysisGame, DRAFT_GAINS, GameReview, ReviewDraft, TeamObjectives } from '../models/team.models';
import { FILM_GLYPHS } from '../shared/film/film-glyph.component';
import { alternativesPhrase, askOf, decidedByOf, evidenceChips, GAIN_LABELS, gamePlayerFor, ledgerLine, playerStatLine, reviewAsText, reviewSource, scoreline, seatOf, THEME_GLYPHS, THEME_WORDS } from './review-view';

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

  it('adds one line on the deaths when the ledger is there, and none without deaths', () => {
    expect(ledgerLine({ deaths: 11, ganks: 2, dark: 6, inReach: 3, alone: 0 })).toBe('💀 11 deaths · 2 to ganks · 6 with no ward nearby · 3 with the jungle a screen away');
    expect(ledgerLine({ deaths: 1, ganks: 1, dark: 0, inReach: 0, alone: 1 })).toBe('💀 1 death · 1 to a gank · 1 alone on their side');
    expect(ledgerLine({ deaths: 0, ganks: 0, dark: 0, inReach: 0, alone: 0 })).toBe('');
    expect(ledgerLine(undefined)).toBe('');
    const lines = reviewAsText(review, game, 'MOSS 2', undefined, { deaths: 3, ganks: 0, dark: 2, inReach: 0, alone: 0 }).split('\n');
    expect(lines[2]).toBe('-# 💀 3 deaths · 2 with no ward nearby');
    expect(reviewAsText(review, game, 'MOSS 2').split('\n')[2]).toBe('');
  });

  it('ends on the film room link, under the Games link, when the film has one', () => {
    const lines = reviewAsText(review, game, 'MOSS 2', 'https://example.test/League-team-comp/games?match=m1&tab=games', undefined, { filmLink: 'https://example.test/League-team-comp/film/m1' }).split('\n');
    expect(lines.at(-2)).toBe('-# Full review with the figures: <https://example.test/League-team-comp/games?match=m1&tab=games>');
    expect(lines.at(-1)).toBe('-# Watch the film room: <https://example.test/League-team-comp/film/m1>');
    expect(reviewAsText(review, game, 'MOSS 2', undefined, undefined, {}).split('\n').at(-1)).toBe('-# The full review, with the figures behind every line, is on the Games page.');
  });

  it('prints the commitment under the scoreline lines, and nothing for a blank one', () => {
    const lines = reviewAsText(review, game, 'MOSS 2', undefined, { deaths: 3, ganks: 0, dark: 2, inReach: 0, alone: 0 }, { commitment: 'Commit only when Jinx is in range' }).split('\n');
    expect(lines[2]).toBe('-# 💀 3 deaths · 2 with no ward nearby');
    expect(lines[3]).toBe('-# We committed to: Commit only when Jinx is in range');
    expect(lines[4]).toBe('');
    expect(reviewAsText(review, game, 'MOSS 2', undefined, undefined, { commitment: '  ' })).not.toContain('We committed to');
  });

  it('adds one Note line per team note after the asks, with the initials the caller put in front, skipping empty ones', () => {
    const text = reviewAsText(review, game, 'MOSS 2', undefined, undefined, { notes: ['(RH) Bot lane backed at 13 with dragon up', '', '(GO) Ask for the tempo call earlier'] });
    expect(text).toContain('• **Go10x** (Trundle) — Path safer.\n\n-# Note (RH) Bot lane backed at 13 with dragon up\n-# Note (GO) Ask for the tempo call earlier\n\n-# The full review');
    expect(reviewAsText(review, game, 'MOSS 2', undefined, undefined, { notes: [] })).not.toContain('-# Note');
  });

  it('writes the deaths line from the film\'s reads when the caller has them, over the ledger\'s counts', () => {
    const ledger = { deaths: 11, ganks: 2, dark: 6, inReach: 3, alone: 0 };
    const lines = reviewAsText(review, game, 'MOSS 2', undefined, ledger, { reads: { avoidable: 6, traded: 2, bought: 1, clean: 2 } }).split('\n');
    expect(lines[2]).toBe('-# 💀 11 deaths: 6 avoidable, 2 traded, 1 bought an objective, 2 clean.');
    expect(lines.join('\n')).not.toContain('with no ward nearby');
    // Reads that add up to nothing write no line, like a ledger without deaths.
    expect(reviewAsText(review, game, 'MOSS 2', undefined, ledger, { reads: { avoidable: 0, traded: 0, bought: 0, clean: 0 } }).split('\n')[2]).toBe('');
    // Without reads the ledger's own line stands.
    expect(reviewAsText(review, game, 'MOSS 2', undefined, ledger, {}).split('\n')[2]).toBe('-# 💀 11 deaths · 2 to ganks · 6 with no ward nearby · 3 with the jungle a screen away');
  });

  it('adds a Draft line per swap after the asks, with the gains in words, or the verdict alone when the draft held', () => {
    const draft: ReviewDraft = {
      verdict: 'The comp wanted a slow game and the fights came early.',
      swaps: [
        { seat: 'Support', out: 'Leona', in: 'Nautilus', why: 'Peel for Jinx instead of an engage she could not follow.', gains: ['peel', 'pick'] },
        { seat: 'Jungle', out: 'Trundle', in: 'Sejuani', why: 'A frontline that starts the fight.', gains: [] }
      ]
    };
    const text = reviewAsText(review, game, 'MOSS 2', undefined, undefined, { draft, notes: ['(RH) Bot backed at 13'] });
    expect(text).toContain(
      '• **Go10x** (Trundle) — Path safer.\n\n-# Draft: Nautilus for Leona (Peel, Pick): Peel for Jinx instead of an engage she could not follow.\n-# Draft: Sejuani for Trundle: A frontline that starts the fight.\n\n-# Note (RH) Bot backed at 13'
    );
    expect(text).not.toContain('The comp wanted a slow game');
    // A swap's out is Riot's id; with the caller's resolver the line says it the display way, so it never reads "Wukong for MonkeyKing".
    const riot: ReviewDraft = { verdict: 'v', swaps: [{ seat: 'Jungle', out: 'MonkeyKing', in: 'Sejuani', why: 'A frontline.', gains: [] }] };
    expect(reviewAsText(review, game, 'MOSS 2', undefined, undefined, { draft: riot, championName: (n) => (n === 'MonkeyKing' ? 'Wukong' : n) })).toContain('-# Draft: Sejuani for Wukong: A frontline.');
    expect(reviewAsText(review, game, 'MOSS 2', undefined, undefined, { draft: riot })).toContain('-# Draft: Sejuani for MonkeyKing: A frontline.');
    const held = reviewAsText(review, game, 'MOSS 2', undefined, undefined, { draft: { verdict: 'The draft held; the fights were lost on the calls.', swaps: [] } });
    expect(held).toContain('Path safer.\n\n-# Draft: The draft held; the fights were lost on the calls.\n\n-# The full review');
    expect(reviewAsText(review, game, 'MOSS 2', undefined, undefined, { draft: { verdict: '  ', swaps: [] } })).not.toContain('-# Draft');
    expect(reviewAsText(review, game, 'MOSS 2')).not.toContain('-# Draft');
  });

  it('names a swap\'s other options in brackets and adds one Lacked line off a version 6 review, and neither off a version 5 one', () => {
    const v6: ReviewDraft = {
      verdict: 'The comp had no one to start a fight and no one to stop one.',
      swaps: [
        { seat: 'Support', out: 'Leona', in: 'Nautilus', why: 'Peel for Jinx.', gains: ['peel'], alternatives: ['Braum', 'Alistar'] },
        { seat: 'Jungle', out: 'MonkeyKing', in: 'Sejuani', why: 'A frontline.', gains: [], alternatives: ['Zac'] },
        // Blank entries and an empty list print nothing: no "(or )".
        { seat: 'Mid', out: 'Ahri', in: 'Orianna', why: 'Wave clear.', gains: ['waveclear'], alternatives: [' ', ''] }
      ],
      lacked: [
        { gain: 'frontline', why: 'Ornn was the only tank and died first in every fight from 14.' },
        // The why's own full stop comes off inside the brackets; a why with none is left as it is.
        { gain: 'peel', why: 'Jinx had no one between her and the dive' },
        // A gain the table does not know is dropped rather than printed as a code.
        { gain: 'tank' as unknown as 'peel', why: 'never' },
        // A gap with no why is the word alone.
        { gain: 'waveclear', why: '  ' }
      ]
    };
    const text = reviewAsText(review, game, 'MOSS 2', undefined, undefined, { draft: v6, championName: (n) => (n === 'MonkeyKing' ? 'Wukong' : n), notes: ['(RH) Bot backed at 13'] });
    expect(text).toContain(
      '• **Go10x** (Trundle) — Path safer.\n\n' +
        '-# Draft: Nautilus (or Braum, or Alistar) for Leona (Peel): Peel for Jinx.\n' +
        '-# Draft: Sejuani (or Zac) for Wukong: A frontline.\n' +
        '-# Draft: Orianna for Ahri (Wave clear): Wave clear.\n' +
        '-# Lacked: frontline (Ornn was the only tank and died first in every fight from 14); peel (Jinx had no one between her and the dive); wave clear\n\n' +
        '-# Note (RH) Bot backed at 13'
    );
    expect(text).not.toContain('(or )');
    expect(text).not.toContain('tank (');
    expect(text).not.toContain('never');
    // The draft held on the swaps but the review still says what the five lacked: the verdict line, then the gaps.
    const heldButLacking = reviewAsText(review, game, 'MOSS 2', undefined, undefined, { draft: { verdict: 'No swap fixes it.', swaps: [], lacked: [{ gain: 'engage', why: 'Nobody could start the fight.' }] } });
    expect(heldButLacking).toContain('Path safer.\n\n-# Draft: No swap fixes it.\n-# Lacked: engage (Nobody could start the fight)\n\n-# The full review');
    // A version 5 draft, or a version 6 one with the lists empty, prints the lines it always did and no Lacked line.
    const v5 = reviewAsText(review, game, 'MOSS 2', undefined, undefined, { draft: { verdict: 'v', swaps: [{ seat: 'Support', out: 'Leona', in: 'Nautilus', why: 'Peel for Jinx.', gains: ['peel'] }] } });
    expect(v5).toContain('-# Draft: Nautilus for Leona (Peel): Peel for Jinx.');
    expect(v5).not.toContain('Lacked');
    expect(reviewAsText(review, game, 'MOSS 2', undefined, undefined, { draft: { verdict: 'v', swaps: [], lacked: [] } })).not.toContain('Lacked');
  });

  it('phrases a swap\'s other options as "or X, or Y", dropping blanks, and nothing without any', () => {
    expect(alternativesPhrase(['Braum', 'Alistar'])).toBe('or Braum, or Alistar');
    expect(alternativesPhrase([' Zac '])).toBe('or Zac');
    expect(alternativesPhrase(['', '  ', 'Braum'])).toBe('or Braum');
    expect(alternativesPhrase([])).toBe('');
    expect(alternativesPhrase(undefined)).toBe('');
  });

  it('has a word for every gain a swap can buy', () => {
    for (const gain of DRAFT_GAINS) expect(GAIN_LABELS[gain]).toMatch(/^[A-Z][a-z]+( [a-z]+)?$/);
    expect(GAIN_LABELS.splitpush).toBe('Split push');
    expect(GAIN_LABELS.waveclear).toBe('Wave clear');
    expect(Object.keys(GAIN_LABELS).sort()).toEqual([...DRAFT_GAINS].sort());
  });

  // `tier` says where the totals came from; only `recorded` (review version 7)
  // says whether the minutes did. Before it, a game the recorder had walked
  // minute by minute came back labelled "Totals only, nothing here is timed",
  // and the moment strip drew a dot where each minute should have been.
  it('names the road a review came down, and calls a recorded review timed', () => {
    expect(reviewSource({ ...review, tier: 'timeline' } as GameReview)).toMatchObject({ tag: 'From the timeline', timed: true });
    expect(reviewSource({ ...review, tier: 'endOfGame', recorded: true } as GameReview)).toMatchObject({ tag: 'From the recorder', timed: true });
    expect(reviewSource({ ...review, tier: 'endOfGame', recorded: true } as GameReview).tip).toContain('replay recorder');
    // A replay nobody recorded, and every review written before version 7.
    expect(reviewSource({ ...review, tier: 'endOfGame' } as GameReview)).toMatchObject({ tag: 'Totals only', timed: false });
    expect(reviewSource(undefined)).toMatchObject({ tag: 'Totals only', timed: false });
    // A timeline review keeps its label whatever else is stored beside it.
    expect(reviewSource({ ...review, tier: 'timeline', recorded: true } as GameReview).tag).toBe('From the timeline');
  });

  it('titles a review from before the headline with the summary’s first sentence, and has no scoreline without a game', () => {
    const old = { ...review, team: { ...review.team, headline: undefined } } as GameReview;
    const lines = reviewAsText(old, undefined).split('\n');
    expect(lines[0]).toBe('## The team matched on CS but gave up the fights.');
    expect(lines[1]).toBe('');
  });
});

/**
 * The panel's own helpers (12 Sep 2026). The review panel is being rebuilt to show figures and fold
 * the prose, and these are the three pure pieces that rebuild rests on.
 */
describe('askOf with a cap', () => {
  /** Real sentences from a stored review, including the one with neither marker. */
  const CORPUS = [
    'The late fights were taken while men were still on the floor — at 33:05 our Jungle, ADC and Support were all dead, so either hold and reset off the respawn clock or force the Baron fight only when all five are up.',
    'Mordekaiser kept dying alone in the side; hold the wave and group instead.',
    'Nautilus went 0/9/15 and sat on 20 cs from minute 12 to 27 while their Support climbed from 7 to 12',
    ''
  ];

  it('is byte-identical to the uncapped call for every caller that does not ask for a cap', () => {
    // Four of the five callers want it whole: the Discord message, and the Before-you-play
    // reminder's one thing, own ask and further asks. Capping in place would have silently
    // shortened a chat message and a reminder card, which is why the cap is a parameter.
    for (const text of CORPUS) expect(askOf(text, 0)).toBe(askOf(text));
  });

  it('cuts on a word boundary and says it was cut', () => {
    const long = askOf(CORPUS[0]);
    const short = askOf(CORPUS[0], 40);
    expect(short.length).toBeLessThanOrEqual(41);
    expect(short.endsWith('…')).toBe(true);
    // Never mid-word: a clause cut at "posi" reads as a bug rather than a trim.
    expect(long.startsWith(short.slice(0, -1))).toBe(true);
    expect(short).not.toMatch(/[ ,;:.]…$/);
  });

  it('leaves a clause already inside the cap exactly alone', () => {
    const short = askOf(CORPUS[1]);
    expect(askOf(CORPUS[1], 400)).toBe(short);
    expect(askOf(CORPUS[1], 400)).not.toContain('…');
  });
});

describe('THEME_GLYPHS', () => {
  it('gives every theme a glyph that is actually drawn', () => {
    // The one that catches a typo: a name the type accepts but FILM_GLYPHS has no shape for renders
    // an empty SVG, on screen, with nothing failing anywhere else.
    for (const theme of Object.keys(THEME_GLYPHS) as (keyof typeof THEME_GLYPHS)[]) {
      expect(FILM_GLYPHS[THEME_GLYPHS[theme]], theme).toBeDefined();
      expect(THEME_WORDS[theme], theme).toBeTruthy();
    }
  });

  it('gives each theme its own glyph, so two never read alike', () => {
    const used = Object.values(THEME_GLYPHS);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe('decidedByOf', () => {
  const withTeam = (team: object) => ({ team, players: [] }) as unknown as GameReview;

  it("takes the model's own answer when a version 8 review carries one", () => {
    const r = withTeam({ decidedBy: { theme: 'fights', why: 'Four late fights taken a man down' }, workOn: [{ text: 'x', evidence: '', minute: null, theme: 'lanes' }] });
    expect(decidedByOf(r)).toEqual({ glyph: 'swords', word: 'Fights', tip: 'Four late fights taken a man down' });
  });

  it("falls back to the first work-on's theme on a version 7 review", () => {
    // Eleven of these exist and must keep rendering.
    const r = withTeam({ workOn: [{ text: 'x', evidence: '', minute: null, theme: 'macro' }] });
    expect(decidedByOf(r)?.glyph).toBe('map');
    expect(decidedByOf(r)?.word).toBe('Macro');
    // The standing meaning, since the model wrote no sentence of its own.
    expect(decidedByOf(r)?.tip).toContain('map');
  });

  it('answers nothing when there is no theme to read, so the panel draws no row', () => {
    // A blank glyph over an empty word reads as a thing that failed to load.
    expect(decidedByOf(withTeam({ workOn: [] }))).toBeUndefined();
    expect(decidedByOf(withTeam({ workOn: [{ text: 'x', evidence: '', minute: null }] }))).toBeUndefined();
    expect(decidedByOf(withTeam({ decidedBy: { theme: 'nonsense' } }))).toBeUndefined();
    expect(decidedByOf(undefined)).toBeUndefined();
  });
});

describe('the seat pairing, moved here from film-build', () => {
  const player = (position: string, name: string, champion: string) => ({ position, name, champion, kills: 1, deaths: 2, assists: 3, cs: 100 });
  const g = { players: [player('BOTTOM', 'Rhu', 'Jinx'), player('Support', 'Nia', 'Leona')] } as unknown as AnalysisGame;

  it('reads both spellings of a position, because both reach us', () => {
    expect(seatOf(player('BOTTOM', '', '') as never)).toBe('ADC');
    expect(seatOf(player('ADC', '', '') as never)).toBe('ADC');
    expect(seatOf(player('UTILITY', '', '') as never)).toBe('Support');
    expect(seatOf(player('nonsense', '', '') as never)).toBeUndefined();
  });

  it("finds the seat's player by position, then by name, then by champion", () => {
    expect(gamePlayerFor(g, 'ADC', 'Rhu', 'Jinx')?.name).toBe('Rhu');
    // No Mid in the game, but the name matches.
    expect(gamePlayerFor(g, 'Mid', 'Nia', 'Nobody')?.name).toBe('Nia');
    // Neither position nor name, but the champion is there.
    expect(gamePlayerFor(g, 'Mid', 'Nobody', 'Jinx')?.name).toBe('Rhu');
    expect(gamePlayerFor(g, 'Mid', 'Nobody', 'Nobody')).toBeUndefined();
    expect(gamePlayerFor(undefined, 'ADC', 'Rhu', 'Jinx')).toBeUndefined();
  });
});
