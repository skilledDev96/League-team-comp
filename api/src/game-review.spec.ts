import { describe, expect, it } from 'vitest';
import { endOfGameFacts, GameFacts } from './game-facts';
import {
  buildPlayerPrompt,
  buildTeamPrompt,
  costUsd,
  DRAFT_GAINS,
  MAX_AUTO_REVIEWS,
  parseGameReviewRequest,
  parsePlayerNotes,
  parseTeamReview,
  PLAYER_SCHEMA,
  REVIEW_VERSION,
  reviewCandidates,
  ReviewContext,
  reviewPlayers,
  TEAM_SCHEMA,
  TEAM_SYSTEM
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
    { name: 'Dan', position: 'Mid', champion: 'Ahri', kills: 5, deaths: 2, assists: 6, cs: 210, visionScore: 25 },
    { name: 'Jay', position: 'Jungle', champion: 'LeeSin', kills: 3, deaths: 3, assists: 8, cs: 150, damage: 12400, damageTaken: 25100, ccTime: 40, buildingDamage: 1800 }
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
  ledger: [
    { minute: 12, seat: 'Top', name: 'Ruan', zone: 'theirJungle', how: 'solo', could: ['jungle', 'position'], line: 'Around minute 12: Ruan (Top) died to one of them in their jungle — our jungler was 2.1k away in the river; alone on their side of the map.' },
    { minute: 20, seat: 'Jungle', name: 'Jay', zone: 'river', how: 'fight', could: ['ward'], line: 'Around minute 20: Jay (Jungle) died in a fight against 3 in the river — no ward nearby.' }
  ],
  ledgerSummary: { deaths: 2, ganks: 0, dark: 1, inReach: 1, alone: 1 },
  presence: { kills: 4, ofKills: 9, before15: 2, ofBefore15: 5, line: 'Jay (Jungle) was on 4 of 9 kills, 2 of 5 before fifteen.' },
  lines: ['Lost in 31 minutes, behind all game: the worst deficit was 6k at 29.', 'Ruan (Top) on Ornn lost the lane into Darius down 900 at ten, and the lead changed hands at 6.', 'Minute 8: their dragon (infernal), nobody of ours near.', 'Minute 12: Ruan (Top) died alone in their jungle, with no ward nearby.']
};

const ctx: ReviewContext = {
  teamName: 'Bom Squad',
  tier: 'timeline',
  game,
  facts,
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
    expect(p).toContain('DAMAGE TO CHAMPIONS, dealt / taken: Jungle 12.4k dealt / 25.1k taken.');
    expect(p).toContain('OUR DEATHS, ONE BY ONE');
    expect(p).toContain(facts.ledger![1].line);
  });

  it('give each player a block with the lane read, the habits and the deaths', () => {
    const p = buildPlayerPrompt(ctx);
    expect(p).toContain('- Ruan (Top, Ornn): 1/4/3, 180 CS, vision 20.');
    expect(p).toContain('Lane lost into Darius: -45 gold/min vs lane, -12 CS at ten vs lane.');
    expect(p).toContain('Habits: 360 gold/min, 60 CS at ten, 2 control wards, 0 solo kills, 3 min dead, 1 Teleport takedowns.');
    expect(p).toContain(`  Deaths, one by one:\n    ${facts.ledger![0].line}`);
    expect(p).toContain('- Dan (Mid, Ahri): 5/2/6, 210 CS, vision 25.');
    expect(p).toContain('- Jay (Jungle, LeeSin): 3/3/8, 150 CS, 12.4k damage to champions, 25.1k taken, 40 s of crowd control, 1.8k to buildings.');
    expect(p).toContain(`  Laners' deaths within your reach, about a screen away at the nearest frame:\n    ${facts.ledger![0].line}`);
    expect(p).toContain('  Jay (Jungle) was on 4 of 9 kills, 2 of 5 before fifteen.');
    // The full ledger is the team prompt's; the player prompt has it per seat.
    expect(p).not.toContain('OUR DEATHS, ONE BY ONE');
  });

  it('tell the jungler when nobody died within reach, and nothing on the replay tier', () => {
    const quiet: ReviewContext = { ...ctx, facts: { ...facts, ledger: [facts.ledger![1]] } };
    expect(buildPlayerPrompt(quiet)).toContain('  No laner died within your reach.');
    const scrim: ReviewContext = { ...ctx, tier: 'endOfGame', facts: endOfGameFacts({ ...game, queue: 'Scrim' }) };
    expect(buildPlayerPrompt(scrim)).not.toContain('within your reach');
  });

  it('say totals only on the replay tier', () => {
    const scrim: ReviewContext = { ...ctx, tier: 'endOfGame', facts: endOfGameFacts({ ...game, queue: 'Scrim' }) };
    expect(buildTeamPrompt(scrim)).toContain('TIER: totals only, from a replay file.');
  });

  it('ask the team question for the version 4 fields, one sentence each', () => {
    expect(TEAM_SYSTEM).toContain('A moment\'s "seats" names the seats of ours it is about, at most three');
    expect(TEAM_SYSTEM).toContain('carries its two choices again in "options" as short imperatives');
    expect(TEAM_SYSTEM).toContain('"lessons" is at most three things a player should be able to answer tomorrow, each on a fact already used by "workOn" or "keepDoing" and about OUR play only');
    expect(TEAM_SYSTEM).toContain('"oneThing" is the one thing to watch for next game in at most twelve words, a choice not an order.');
  });

  it('ask the team question for the draft with hindsight, and keep the swap about our draft', () => {
    expect(REVIEW_VERSION).toBe(5);
    expect(TEAM_SYSTEM).toContain('"draft" is one sentence ("verdict") on whether the five we drafted fit the game that was played');
    expect(TEAM_SYSTEM).toContain('"swaps" is at most two changes to OUR draft the coach would make with hindsight');
    expect(TEAM_SYSTEM).toContain('("out", exactly as given in OUR PLAYERS)');
    expect(TEAM_SYSTEM).toContain('("in", from CHAMPIONS A SWAP MAY NAME');
    expect(TEAM_SYSTEM).toContain('a Malphite for the all-in with Miss Fortune, or a Nautilus for the peel on a hypercarry');
    expect(TEAM_SYSTEM).toContain('Swaps are empty when the draft held.');
    expect(TEAM_SYSTEM).toContain("A swap is about OUR draft. The other team's champions may be named as the matchup they posed");
    expect(TEAM_SYSTEM).toContain('never a person.');
  });

  it('list the champions a swap may name only when given, after the comp and before what happened', () => {
    const bare = buildTeamPrompt(ctx);
    expect(bare).toContain('THE DRAFT WITH HINDSIGHT');
    expect(bare).not.toContain('CHAMPIONS A SWAP MAY NAME');
    expect(bare).toContain('No champion list is available for this review, so leave the swaps empty.');
    expect(buildTeamPrompt({ ...ctx, championNames: [] })).not.toContain('CHAMPIONS A SWAP MAY NAME');
    const listed = buildTeamPrompt({ ...ctx, championNames: ["Kai'Sa", 'Miss Fortune', 'Wukong'] });
    expect(listed).toContain("CHAMPIONS A SWAP MAY NAME (Data Dragon spelling): Kai'Sa, Miss Fortune, Wukong");
    expect(listed).not.toContain('No champion list is available');
    expect(listed.indexOf('THE COMP')).toBeLessThan(listed.indexOf('THE DRAFT WITH HINDSIGHT'));
    expect(listed.indexOf('THE DRAFT WITH HINDSIGHT')).toBeLessThan(listed.indexOf('WHAT HAPPENED'));
    // The player prompt has no draft field and asks nothing about one.
    expect(buildPlayerPrompt({ ...ctx, championNames: ['Wukong'] })).not.toContain('THE DRAFT WITH HINDSIGHT');
    expect(buildPlayerPrompt({ ...ctx, championNames: ['Wukong'] })).not.toContain('CHAMPIONS A SWAP MAY NAME');
  });
});

describe('the schemas', () => {
  it('carry no cap the API rejects; the caps live in the prompt and the validators', () => {
    // The draft object rides inside TEAM_SCHEMA; it is walked on its own as well so a cap slipped into a swap is named by this test.
    for (const schema of [TEAM_SCHEMA, PLAYER_SCHEMA, TEAM_SCHEMA.properties.draft, TEAM_SCHEMA.properties.draft.properties.swaps.items]) {
      const json = JSON.stringify(schema);
      for (const word of ['maxItems', 'minItems', 'minimum', 'maximum', 'minLength', 'maxLength']) expect(json).not.toContain(word);
    }
  });

  it('require the draft with hindsight, every field of a swap, and only the gains and seats the app knows', () => {
    expect(TEAM_SCHEMA.required).toContain('draft');
    const draft = TEAM_SCHEMA.properties.draft;
    expect(draft.type).toBe('object');
    expect(draft.required).toEqual(['verdict', 'swaps']);
    expect(draft.additionalProperties).toBe(false);
    const swap = draft.properties.swaps.items;
    expect(swap.required).toEqual(['seat', 'out', 'in', 'why', 'gains']);
    expect(swap.additionalProperties).toBe(false);
    expect(swap.properties.seat.enum).toEqual(['Top', 'Jungle', 'Mid', 'ADC', 'Support']);
    expect(swap.properties.gains.items.enum).toEqual([...DRAFT_GAINS]);
    expect(DRAFT_GAINS).toEqual(['engage', 'peel', 'frontline', 'poke', 'sustain', 'splitpush', 'waveclear', 'pick', 'disengage', 'damage']);
    // Every schema object stays closed and fully required, as the rest of the schema does.
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as Record<string, unknown>;
      if (n.type === 'object' && n.properties) {
        expect(n.additionalProperties).toBe(false);
        expect([...(n.required as string[])].sort()).toEqual(Object.keys(n.properties as object).sort());
        for (const child of Object.values(n.properties as Record<string, unknown>)) walk(child);
      }
      if (n.items) walk(n.items);
    };
    walk(draft);
  });

  it('require the version 4 fields, and leave a point\'s options optional', () => {
    expect(TEAM_SCHEMA.required).toEqual(expect.arrayContaining(['lessons', 'oneThing', 'moments']));
    expect(TEAM_SCHEMA.properties.moments.items.required).toContain('seats');
    expect(TEAM_SCHEMA.properties.moments.items.properties.seats.items.enum).toEqual(['Top', 'Jungle', 'Mid', 'ADC', 'Support']);
    expect(TEAM_SCHEMA.properties.lessons.items.required).toEqual(['question', 'options', 'answer', 'why', 'theme']);
    expect(TEAM_SCHEMA.properties.workOn.items.properties.options.type).toBe('array');
    expect(TEAM_SCHEMA.properties.workOn.items.required as readonly string[]).not.toContain('options');
    expect(TEAM_SCHEMA.properties.workOn.items.additionalProperties).toBe(false);
    expect(TEAM_SCHEMA.properties.keepDoing.items.properties).not.toHaveProperty('options');
    expect(PLAYER_SCHEMA.properties.players.items.properties.more.items.properties).not.toHaveProperty('options');
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

  it('keeps at most six moments, in time order, inside the game, with a sane swing', () => {
    const got = parseTeamReview(
      {
        moments: [
          { minute: 20, text: 'Baron', swing: 'them' },
          { minute: 4, text: 'First blood', swing: 'us' },
          { minute: 99, text: 'Never', swing: 'us' },
          { minute: 9, text: '', swing: 'us' },
          { minute: 12, text: 'Dragon', swing: 'sideways' },
          { minute: 14, text: 'a', swing: 'us' },
          { minute: 16, text: 'b', swing: 'us' },
          { minute: 18, text: 'c', swing: 'us' },
          { minute: 30, text: 'd', swing: 'us' }
        ]
      },
      ctx
    );
    expect(got.moments!.map((m) => m.minute)).toEqual([4, 12, 14, 16, 18, 20]);
    expect(got.moments![1].swing).toBe('even');
    expect(parseTeamReview({}, ctx).moments).toEqual([]);
  });

  it('is unclear on the comp when there was no comp, whatever the model said', () => {
    expect(parseTeamReview({ compVerdict: 'as drafted' }, { ...ctx, comp: null }).compVerdict).toBe('unclear');
    expect(parseTeamReview({ compVerdict: 'as drafted' }, ctx).compVerdict).toBe('as drafted');
  });

  it('keeps a moment\'s seats only when they are ours, once each, at most three, and leaves them out when empty', () => {
    const got = parseTeamReview(
      {
        moments: [
          { minute: 4, text: 'Gank', swing: 'them', seats: ['Top', 'Jungle', 'Top', 'Darius', 'ADC', 'Support'] },
          { minute: 8, text: 'Dragon', swing: 'them', seats: ['ADC', 'Support'] },
          { minute: 12, text: 'Solo death', swing: 'them', seats: 'Top' },
          { minute: 16, text: 'Team fight', swing: 'us', seats: [] }
        ]
      },
      ctx
    );
    // The context knows Top, Mid and Jungle; ADC and Support are not on this roster.
    expect(got.moments![0].seats).toEqual(['Top', 'Jungle']);
    expect(got.moments![1]).not.toHaveProperty('seats');
    expect(got.moments![2]).not.toHaveProperty('seats');
    expect(got.moments![3]).not.toHaveProperty('seats');
    const five: ReviewContext = { ...ctx, players: [...ctx.players, { name: 'Kai', seat: 'ADC', champion: 'Jinx' }, { name: 'Lu', seat: 'Support', champion: 'Leona' }] };
    expect(parseTeamReview({ moments: [{ minute: 4, text: 'x', swing: 'us', seats: ['Support', 'ADC', 'Mid', 'Top'] }] }, five).moments![0].seats).toEqual(['Support', 'ADC', 'Mid']);
  });

  it('keeps a work-on\'s options only when there are exactly two and both say something', () => {
    const got = parseTeamReview(
      {
        workOn: [
          { text: 'One', evidence: 'a', minute: null, options: ['Be there by seven', 'Tell the lane to hold'] },
          { text: 'Two', evidence: 'b', minute: null, options: ['Only one'] },
          { text: 'Three', evidence: 'c', minute: null, options: ['Fine', '  '] }
        ],
        keepDoing: [{ text: 'Four', evidence: 'd', minute: null, options: ['A', 'B', 'C'] }]
      },
      ctx
    );
    expect(got.workOn[0].options).toEqual(['Be there by seven', 'Tell the lane to hold']);
    expect(got.workOn[1]).not.toHaveProperty('options');
    expect(got.workOn[2]).not.toHaveProperty('options');
    expect(got.keepDoing[0]).not.toHaveProperty('options');
    const long = parseTeamReview({ workOn: [{ text: 'x', evidence: 'y', minute: null, options: ['a'.repeat(120), 'b'] }] }, ctx);
    expect(long.workOn[0].options![0]).toHaveLength(90);
  });

  it('keeps the one thing, trimmed and capped, and leaves it out when there is none', () => {
    expect(parseTeamReview({ oneThing: '  Either ward the river or hold  the wave. ' }, ctx).oneThing).toBe('Either ward the river or hold the wave.');
    expect(parseTeamReview({ oneThing: 'x'.repeat(200) }, ctx).oneThing).toHaveLength(90);
    // Long words run past 90 characters; the cut lands between words, never through the last one.
    const twelve = 'Either contest the second dragon together or concede it and take the herald instead tonight';
    expect(twelve.length).toBeGreaterThan(90);
    expect(parseTeamReview({ oneThing: twelve }, ctx).oneThing).toBe('Either contest the second dragon together or concede it and take the herald instead');
    expect(parseTeamReview({ oneThing: 'a'.repeat(90) + ' more' }, ctx).oneThing).toBe('a'.repeat(90));
    expect(parseTeamReview({ oneThing: '' }, ctx)).not.toHaveProperty('oneThing');
    expect(parseTeamReview({ oneThing: 7 }, ctx)).not.toHaveProperty('oneThing');
    expect(parseTeamReview({}, ctx)).not.toHaveProperty('oneThing');
  });

  it('keeps at most three lessons, each whole or not at all', () => {
    const good = (n: number) => ({ question: `Q${n}`, options: ['A', 'B', 'C'], answer: 1, why: `because ${n}`, theme: 'vision' });
    const got = parseTeamReview(
      {
        lessons: [
          good(1),
          { ...good(2), options: ['A', 'a', 'B'] },
          { ...good(3), options: ['A', 'B'] },
          { ...good(4), options: ['A', 'B', 'C', 'D'] },
          { ...good(5), options: ['A', '', 'C'] },
          { ...good(6), options: ['A', 'Darius#EUW went in', 'C'] },
          { ...good(7), answer: 3 },
          { ...good(8), answer: -1 },
          { ...good(9), answer: 1.5 },
          { ...good(10), answer: '1' },
          { ...good(11), why: '' },
          { ...good(12), question: '' },
          { ...good(13), theme: 'vibes' },
          good(14),
          good(15)
        ]
      },
      ctx
    );
    expect(got.lessons!.map((l) => l.question)).toEqual(['Q1', 'Q13', 'Q14']);
    expect(got.lessons![0].theme).toBe('vision');
    expect(got.lessons![1]).not.toHaveProperty('theme');
    expect(got.lessons![0]).toEqual({ question: 'Q1', options: ['A', 'B', 'C'], answer: 1, why: 'because 1', theme: 'vision' });
  });

  it('drops a lesson naming anyone off our five by Riot id, cuts our own tags, and leaves a bare number alone', () => {
    const lesson = (options: string[]) => ({ question: 'Q', options, answer: 0, why: 'w' });
    const got = parseTeamReview(
      {
        lessons: [
          lesson(['Ruan#EUW went in', 'Group at #20', 'Hold']),
          lesson(['Darius#EUW went in', 'B', 'C']),
          lesson(['someone#euw dived', 'B', 'C']),
          lesson(['Ruan#BOM1 alone', 'B', 'C'])
        ]
      },
      ctx
    );
    expect(got.lessons!.map((l) => l.options)).toEqual([
      ['Ruan went in', 'Group at #20', 'Hold'],
      ['Ruan alone', 'B', 'C']
    ]);
  });

  it('caps a lesson\'s strings and leaves the list empty when the model sent none', () => {
    const got = parseTeamReview(
      { lessons: [{ question: 'q'.repeat(300), options: ['a'.repeat(120), 'b', 'c'], answer: 0, why: 'w'.repeat(300) }] },
      ctx
    );
    expect(got.lessons![0].question).toHaveLength(160);
    expect(got.lessons![0].options[0]).toHaveLength(90);
    expect(got.lessons![0].why).toHaveLength(200);
    expect(parseTeamReview({}, ctx).lessons).toEqual([]);
    expect(parseTeamReview({ lessons: 'none' }, ctx).lessons).toEqual([]);
  });
});

describe('parseTeamReview: the draft with hindsight', () => {
  const names = ['Ahri', 'Jinx', 'Lee Sin', 'Leona', 'Malphite', 'Miss Fortune', 'Nautilus', 'Ornn', 'Sion', 'Wukong'];
  const five: ReviewContext = {
    ...ctx,
    players: [...ctx.players, { name: 'Kai', seat: 'ADC', champion: 'Jinx' }, { name: 'Lu', seat: 'Support', champion: 'Leona' }],
    championNames: names
  };
  const swap = (over: Record<string, unknown>) => ({ seat: 'ADC', out: 'Jinx', in: 'Miss Fortune', why: 'Nobody could follow the engage around minute 24.', gains: ['damage'], ...over });
  const parse = (draft: unknown, c: ReviewContext = five) => parseTeamReview({ draft }, c).draft;

  it('keeps a valid swap and re-stamps both spellings: ours for out, Data Dragon\'s for in', () => {
    const got = parse({
      verdict: 'The five fit a game that never came: no engage to open the fights.',
      swaps: [swap({ out: 'jinx', in: 'miss fortune', gains: ['damage', 'engage'] }), swap({ seat: 'Jungle', out: 'lee sin', in: 'wukong', gains: ['engage'] })]
    });
    expect(got).toEqual({
      verdict: 'The five fit a game that never came: no engage to open the fights.',
      swaps: [
        { seat: 'ADC', out: 'Jinx', in: 'Miss Fortune', why: 'Nobody could follow the engage around minute 24.', gains: ['damage', 'engage'] },
        { seat: 'Jungle', out: 'LeeSin', in: 'Wukong', why: 'Nobody could follow the engage around minute 24.', gains: ['engage'] }
      ]
    });
  });

  it('drops an in that is not on the list, or that one of our five played', () => {
    const got = parse({
      verdict: 'v',
      swaps: [swap({ in: 'Zilean' }), swap({ in: 'lee sin' }), swap({ seat: 'Top', out: 'Ornn', in: 'ahri' }), swap({ in: 7 }), swap({ in: 'Sion' })]
    });
    expect(got!.swaps.map((s) => s.in)).toEqual(['Sion']);
    // The context spells our five Riot's way and the list Data Dragon's: Wukong is MonkeyKing, and still one of ours.
    const wukong: ReviewContext = { ...five, players: five.players.map((p) => (p.seat === 'Jungle' ? { ...p, champion: 'MonkeyKing' } : p)) };
    const played = parse({ verdict: 'v', swaps: [swap({ seat: 'Top', out: 'Ornn', in: 'Wukong' }), swap({ seat: 'Jungle', out: 'MonkeyKing', in: 'wukong' }), swap({ in: 'Sion' })] }, wukong);
    expect(played!.swaps.map((s) => [s.seat, s.in])).toEqual([['ADC', 'Sion']]);
  });

  it('drops a swap whose out is not what we played in that seat, and a seat that is not ours', () => {
    const got = parse({
      verdict: 'v',
      swaps: [
        swap({ seat: 'Top', out: 'Ahri', in: 'Sion' }),
        swap({ seat: 'Top', out: 'Darius', in: 'Sion' }),
        swap({ seat: 'Darius', out: 'Ornn', in: 'Sion' }),
        swap({ seat: undefined, out: 'Ornn', in: 'Sion' }),
        swap({ seat: 'Top', out: 4, in: 'Sion' }),
        swap({ seat: 'Top', out: 'ornn', in: 'Sion' })
      ]
    });
    expect(got!.swaps).toEqual([{ seat: 'Top', out: 'Ornn', in: 'Sion', why: 'Nobody could follow the engage around minute 24.', gains: ['damage'] }]);
    // ADC is not on the three-player roster.
    expect(parse({ verdict: 'v', swaps: [swap({})] }, { ...ctx, championNames: names })!.swaps).toEqual([]);
  });

  it('keeps at most two swaps, and the first of two in one seat', () => {
    const three = parse({
      verdict: 'v',
      swaps: [swap({ seat: 'Top', out: 'Ornn', in: 'Sion' }), swap({ seat: 'Jungle', out: 'LeeSin', in: 'Wukong' }), swap({ in: 'Miss Fortune' })]
    });
    expect(three!.swaps.map((s) => s.seat)).toEqual(['Top', 'Jungle']);
    const same = parse({ verdict: 'v', swaps: [swap({ in: 'Miss Fortune' }), swap({ in: 'Sion' }), swap({ seat: 'Top', out: 'Ornn', in: 'Malphite' })] });
    expect(same!.swaps.map((s) => [s.seat, s.in])).toEqual([
      ['ADC', 'Miss Fortune'],
      ['Top', 'Malphite']
    ]);
    // A dropped first swap does not block a valid second in the same seat.
    const second = parse({ verdict: 'v', swaps: [swap({ in: 'Zilean' }), swap({ in: 'Sion' })] });
    expect(second!.swaps.map((s) => s.in)).toEqual(['Sion']);
  });

  it('keeps the gains it knows, once each, at most three, and allows none', () => {
    const got = parse({
      verdict: 'v',
      swaps: [swap({ gains: ['peel', 'damage', 'peel', 'vibes', 'engage', 'frontline', 'poke'] }), swap({ seat: 'Top', out: 'Ornn', in: 'Sion', gains: [] }), swap({ seat: 'Jungle', out: 'LeeSin', in: 'Wukong', gains: 'engage' })]
    });
    expect(got!.swaps.map((s) => s.gains)).toEqual([['peel', 'damage', 'engage'], []]);
    expect(parse({ verdict: 'v', swaps: [swap({ gains: 'engage' })] })!.swaps[0].gains).toEqual([]);
  });

  it('needs a why, caps it, drops a swap naming anyone off our five by Riot id, and cuts our own tags', () => {
    expect(parse({ verdict: 'v', swaps: [swap({ why: '' }), swap({ why: 7 }), swap({ why: undefined })] })!.swaps).toEqual([]);
    expect(parse({ verdict: 'v', swaps: [swap({ why: 'w'.repeat(400) })] })!.swaps[0].why).toHaveLength(300);
    const got = parse({
      verdict: 'v',
      swaps: [swap({ why: 'Darius#EUW dived Kai twice before ten.' }), swap({ seat: 'Top', out: 'Ornn', in: 'Sion', why: 'Ruan#EUW was alone in their jungle at 12, Group at #20.' })]
    });
    expect(got!.swaps.map((s) => s.why)).toEqual(['Ruan was alone in their jungle at 12, Group at #20.']);
    expect(parse({ verdict: 'v', swaps: [swap({ why: 'someone#euw dived' })] })!.swaps).toEqual([]);
  });

  it('keeps the verdict but no swap when no champion list was offered', () => {
    const noList = { verdict: 'The draft held.', swaps: [swap({})] };
    expect(parse(noList, { ...five, championNames: [] })).toEqual({ verdict: 'The draft held.', swaps: [] });
    expect(parse(noList, { ...five, championNames: undefined })).toEqual({ verdict: 'The draft held.', swaps: [] });
    expect(parse({ verdict: 'The draft held.', swaps: [] })).toEqual({ verdict: 'The draft held.', swaps: [] });
    expect(parse({ verdict: 'The draft held.' })).toEqual({ verdict: 'The draft held.', swaps: [] });
    expect(parse({ verdict: 'The draft held.', swaps: 'none' })).toEqual({ verdict: 'The draft held.', swaps: [] });
  });

  it('drops the whole draft without a verdict, and caps the verdict on a word', () => {
    expect(parseTeamReview({ draft: { verdict: '', swaps: [swap({})] } }, five)).not.toHaveProperty('draft');
    expect(parseTeamReview({ draft: { verdict: '   ', swaps: [swap({})] } }, five)).not.toHaveProperty('draft');
    expect(parseTeamReview({ draft: { verdict: 9, swaps: [] } }, five)).not.toHaveProperty('draft');
    expect(parseTeamReview({ draft: { swaps: [swap({})] } }, five)).not.toHaveProperty('draft');
    expect(parseTeamReview({ draft: 'held' }, five)).not.toHaveProperty('draft');
    expect(parseTeamReview({}, five)).not.toHaveProperty('draft');
    const long = `${'word '.repeat(60)}end`;
    expect(parse({ verdict: long })!.verdict).toBe('word '.repeat(48).trim());
    expect(parse({ verdict: long })!.verdict.length).toBeLessThanOrEqual(240);
    expect(parse({ verdict: '  The  five fit. ' })!.verdict).toBe('The five fit.');
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
    expect(got[0].more).toEqual([]);
  });

  it('keeps at most three further points, each with evidence, and drops an unknown theme', () => {
    const got = parsePlayerNotes(
      {
        players: [
          {
            name: 'Jay',
            strength: { text: 'On the kills', evidence: '4 of 9', minute: null },
            workOn: { text: 'Top side by seven', evidence: 'minute 12 top death', minute: 12 },
            more: [
              { text: 'One', evidence: 'x', minute: 3, theme: 'vision' },
              { text: 'Two', evidence: '', minute: 4, theme: 'tempo' },
              { text: 'Three', evidence: 'y', minute: 5, theme: 'vibes' },
              { text: 'Four', evidence: 'z', minute: 6, theme: 'macro' },
              { text: 'Five', evidence: 'w', minute: 7, theme: 'macro' }
            ]
          }
        ]
      },
      ctx
    );
    expect(got).toHaveLength(1);
    expect(got[0].more!.map((m) => m.text)).toEqual(['One', 'Three', 'Four']);
    expect(got[0].more![0].theme).toBe('vision');
    expect(got[0].more![1].theme).toBeUndefined();
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
