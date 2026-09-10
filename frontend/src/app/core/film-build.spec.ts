import { describe, expect, it } from 'vitest';
import { AnalysisGame, GameReview, MatchTimeline, TeamObjectives, TimelineDeath } from '../models/team.models';
import { buildFilm, FILM_CHAPTER_COUNT, lessonCalls, optionsOf, placeOurDeath, railGroups, reelTallyOf, splitOptions, tapeEventsOf } from './film-build';
import { styleFor } from './film-style';
import { objectivePit, regionFor } from './rift-zones';
import { seedOf } from './seed';

const side = (o: Partial<TeamObjectives>): TeamObjectives => ({ firstBlood: false, firstTower: false, dragons: 0, barons: 0, heralds: 0, grubs: 0, towers: 0, inhibitors: 0, ...o });

const game = {
  matchId: 'EUW1_7000000001',
  date: 1757400000000,
  queue: 'Flex',
  win: false,
  durationSec: 34 * 60 + 13,
  kills: { ours: 14, theirs: 35 },
  objectives: { ours: side({ towers: 6, dragons: 2, barons: 1, grubs: 4 }), theirs: side({ firstBlood: true, firstTower: true, towers: 9, dragons: 3, barons: 1, heralds: 1 }) },
  players: [
    { name: 'Go10x#EUW', position: 'JUNGLE', champion: 'Trundle', kills: 3, deaths: 1, assists: 6, cs: 223, damage: 1, killParticipation: 0.64, visionScore: 34 },
    { name: 'Rhu#BOM', position: 'BOTTOM', champion: 'Jinx', kills: 8, deaths: 3, assists: 2, cs: 312, damage: 1, killParticipation: 0.71, visionScore: 12 },
    { name: 'Nia#BOM', position: 'UTILITY', champion: 'Leona', kills: 1, deaths: 2, assists: 9, cs: 30, damage: 1, killParticipation: 0.7, visionScore: 61 }
  ]
} as unknown as AnalysisGame;

const point = (text: string, theme?: string, minute: number | null = null) => ({ text, evidence: 'kills 14-35', minute, theme });

const review = {
  matchId: 'EUW1_7000000001',
  reviewedAt: '2026-09-09T20:00:00.000Z',
  reviewVersion: 3,
  tier: 'timeline',
  trigger: 'manual',
  models: { team: 'x', players: 'x' },
  compId: null,
  compName: 'Front to back',
  team: {
    headline: 'Bled 35 kills while farming even',
    summary: 'The team matched on CS but gave up the fights. Bot fed first and the map followed. Grubs went well.',
    workOn: [
      point('Jinx died three times before ten; either play safer trades before towers fall or ask for jungle pressure earlier.', 'fights', 9),
      point('Trade the third grub for dragon tempo.', 'objectives')
    ],
    keepDoing: [point('Farm held up across the map, so keep the wave states clean.', 'lanes')],
    compVerdict: 'off plan',
    compWhy: 'The comp wanted a slow game and the fights came early.',
    moments: [
      { minute: 8, text: 'Dragon at 8 with all five nearby.', swing: 'us' },
      { minute: 12, text: 'Jinx caught again in bot.', swing: 'them' },
      { minute: 28, text: 'A quiet stretch nobody used.', swing: 'even' },
      { minute: 33, text: 'The last fight went the same way.', swing: 'them' }
    ]
  },
  players: [
    { name: 'Rhu', seat: 'ADC', champion: 'Jinx', strength: point('Farmed 312.'), workOn: point('Died early, so hold the wave under tower.'), more: [point('Ward the river bush.', 'vision')] },
    { name: 'Go10x', seat: 'Jungle', champion: 'Trundle', strength: point('Grubs went 4-0.'), workOn: point('Path bot after the first clear.') },
    { name: 'Nia', seat: 'Support', champion: 'Leona', strength: point('Vision score 61.'), workOn: point('Engage only with Jinx in range.') }
  ],
  usage: { team: { input: 0, cachedInput: 0, output: 0 }, players: { input: 0, cachedInput: 0, output: 0 }, costUsd: 0, tookMs: 0 }
} as unknown as GameReview;

const death = (minute: number, seat: string, could: string[], line: string, zone = 'bot', how = 'gank') => ({ minute, seat, zone, how, could, line });

const fell = (sec: number, seat: string, zone: string, extra: Partial<TimelineDeath> = {}): TimelineDeath =>
  ({ sec, minute: Math.floor(sec / 60), seat, zone, theirSide: false, killers: 2, executed: false, warded: false, ...extra }) as TimelineDeath;

/** Ours minus theirs, a figure a minute for 35 minutes: a small early lead, then a slide to 9k down at 30. */
const GOLD_DIFF = [0, 50, 150, 300, 400, 200, -100, -600, -1200, -1800, -2200, -2900, -3400, -3800, -4300, -4800, -5200, -5600, -6000, -6400, -6800, -7200, -7500, -7800, -8100, -8400, -8600, -8800, -8900, -8950, -9000, -8800, -8600, -8400, -8200];

const timeline = {
  matchId: 'EUW1_7000000001',
  timelineVersion: 2,
  builtAt: '2026-09-09T06:30:00.000Z',
  ourSide: 'blue',
  durationSec: 34 * 60 + 13,
  frameSec: 60,
  goldDiff: GOLD_DIFF,
  curve: { leadAt: {}, biggestLead: { gold: 400, minute: 4 }, biggestDeficit: { gold: -9000, minute: 30 } },
  lanes: [
    { seat: 'Mid', champion: 'Ahri', theirChampion: 'Syndra', flippedAt: 14 },
    { seat: 'ADC', champion: 'Jinx', theirChampion: 'Caitlyn', flippedAt: 11 }
  ],
  firsts: { blood: { minute: 4, side: 'them' }, tower: { minute: 9, side: 'them', lane: 'bot' } },
  objectives: [
    { minute: 6, type: 'grubs', side: 'us', ourInvolved: ['Jungle'], ourNear: ['Jungle'] },
    { minute: 8, type: 'dragon', side: 'us', ourInvolved: ['Jungle', 'ADC'], ourNear: ['Jungle', 'ADC', 'Support'] },
    { minute: 20, type: 'dragon', subType: 'infernal', side: 'them', ourInvolved: [], ourNear: ['Support'] },
    { minute: 27, type: 'baron', side: 'them', ourInvolved: [], ourNear: [] },
    { minute: 31, type: 'dragon', subType: 'mountain', side: 'them', ourInvolved: [], ourNear: [] }
  ],
  plates: { ours: { top: 1, mid: 0, bot: 0 }, theirs: { top: 0, mid: 0, bot: 2 } },
  deaths: [
    fell(252, 'ADC', 'bot'),
    fell(450, 'ADC', 'bot', { theirSide: true }),
    fell(545, 'Support', 'bot', { killers: 3 }),
    fell(760, 'ADC', 'bot', { theirSide: true, killers: 1, warded: true }),
    fell(1210, 'Support', 'river', { killers: 4, warded: true, objectiveNear: true }),
    fell(1473, 'Jungle', 'theirJungle', { theirSide: true, killers: 1 })
  ],
  theirDeaths: [
    { sec: 380, minute: 6, zone: 'ourJungle', ourInvolved: ['Jungle'] },
    { sec: 1215, minute: 20, zone: 'river', ourInvolved: ['Jungle', 'ADC'] },
    // Trundle was on this kill, so it is the same fight as his own death at 24:33 in their jungle (the reads ask where, not only when).
    { sec: 1500, minute: 25, zone: 'mid', ourInvolved: ['Jungle'] }
  ],
  vision: [],
  spend: [
    { seat: 'ADC', firstItemMinute: 11, backs: [5, 11, 16] },
    { seat: 'Jungle', backs: [4] }
  ],
  facts: {
    factsVersion: 2,
    tier: 'timeline',
    result: 'loss',
    durationMin: 34,
    curve: { shape: 'trailed throughout' },
    lanes: [
      { seat: 'Top', champion: 'Ornn', theirChampion: 'Aatrox', verdict: 'even', line: 'Top stayed even.' },
      { seat: 'Mid', champion: 'Ahri', theirChampion: 'Syndra', verdict: 'lost', flippedAt: 14, line: 'Mid changed hands at 14.' },
      { seat: 'ADC', champion: 'Jinx', theirChampion: 'Caitlyn', verdict: 'lost', flippedAt: 11, line: 'Bot changed hands at 11 after two deaths.' }
    ],
    firsts: { blood: { minute: 4, side: 'them' }, tower: { minute: 9, side: 'them', lane: 'bot' } },
    objectives: [{ minute: 20, type: 'dragon', subType: 'infernal', side: 'them', ourNearCount: 1, ourInvolved: [], setup: 'uncontested', line: 'Minute 20: their dragon (infernal), uncontested.' }],
    deathClusters: [{ fromMinute: 19, toMinute: 21, zone: 'river', ours: 3, theirs: 1, seats: ['Support', 'ADC', 'Jungle'], line: 'Minutes 19 to 21: three of ours fell in the river for one of theirs.' }],
    soloDeaths: [],
    vision: [],
    spend: [],
    ledger: [
      death(4, 'ADC', ['ward', 'call'], 'Minute 4: Jinx to a gank in bot lane with no ward nearby.'),
      death(7, 'ADC', ['ward'], 'Minute 7: Jinx to a gank in bot lane with no ward nearby.'),
      death(9, 'Support', ['ward', 'jungle'], 'Minute 9: Leona in bot lane with no ward nearby.'),
      death(12, 'ADC', ['call'], 'Minute 12: Jinx, their jungler was already close.'),
      death(20, 'Support', [], 'Minute 20: Leona in a fight.', 'river', 'fight'),
      death(24, 'Jungle', ['position'], 'Minute 24: Trundle alone on their side.', 'theirJungle', 'solo')
    ],
    ledgerSummary: { deaths: 6, ganks: 3, dark: 3, inReach: 1, alone: 1 },
    presence: { kills: 9, ofKills: 14, before15: 3, ofBefore15: 5, line: 'Trundle was on 9 of our 14 kills.' },
    lines: ['They took the first tower at 9 min, bot, after two ganks.']
  },
  bytes: 0
} as unknown as MatchTimeline;

const previous = {
  review: { ...review, matchId: 'EUW1_6999999999', team: { ...review.team, workOn: [point('Bot got caught in the dark twice; ward the river bush before every dragon.', 'vision')] } } as GameReview
};

const RIOT_TAG = /#[A-Z0-9]{2,5}/;

/** Every key the tape stands on: its beats' own and the deaths folded into them. Every pin of the map must be in here (10 Sep 2026). */
const beatCoverage = (film: ReturnType<typeof buildFilm>): Set<string> => new Set(film.tape!.beats.flatMap((b) => [b.key, ...(b.deaths ?? [])]));

describe('buildFilm on the timeline tier', () => {
  const film = buildFilm(review, game, timeline, previous, 'MOSS 2');

  it('lists the six chapters in order, the tape before the map under eight deaths, and seeds by the match id', () => {
    expect(film.chapters.map((c) => c.kind)).toEqual(['title', 'tape', 'map', 'one-thing', 'seat', 'card']);
    expect(film.chapters.map((c) => c.title)).toEqual(['The game', 'The tape', 'The map', 'The one thing', 'Your seat', 'The card']);
    expect(film.seed).toBe(360062704);
    expect(film.tier).toBe('timeline');
    expect(film.board).toBeUndefined();
    // A version 3 review wrote no draft, so there is no draft chapter; the fullest film has one more.
    expect(film.draft).toBeUndefined();
    expect(FILM_CHAPTER_COUNT).toBe(7);
  });

  it('carries the style drawn from the seed and the result, and another id draws another look', () => {
    expect(film.style).toEqual(styleFor(film.seed, false));
    expect(film.title.win).toBe(false);
    const won = buildFilm(review, { ...game, win: true } as AnalysisGame, timeline, previous);
    expect(won.style).toEqual(styleFor(film.seed, true));
    // The seed is the match id: a different id, a different draw somewhere in the style.
    const ids = ['EUW1_7000000002', 'EUW1_7000000003', 'EUW1_7000000004', 'EUW1_7000000005'];
    const styles = ids.map((matchId) => JSON.stringify(buildFilm({ ...review, matchId } as GameReview, game, null, null).style));
    expect(new Set([JSON.stringify(film.style), ...styles]).size).toBeGreaterThan(1);
  });

  it('puts the map before the tape from eight deaths, and drops the map without a ledger', () => {
    const facts = timeline.facts!;
    const eight = { ...timeline, facts: { ...facts, ledger: [...facts.ledger!, death(27, 'Jungle', [], 'Minute 27: Trundle in a fight.'), death(31, 'ADC', ['ward'], 'Minute 31: Jinx in the dark.')] } } as MatchTimeline;
    expect(buildFilm(review, game, eight, previous).chapters.map((c) => c.kind)).toEqual(['title', 'map', 'tape', 'one-thing', 'seat', 'card']);
    const { ledger: _ledger, ledgerSummary: _summary, ...noLedger } = facts;
    const bare = buildFilm(review, game, { ...timeline, facts: noLedger } as MatchTimeline, previous);
    expect(bare.chapters.map((c) => c.kind)).toEqual(['title', 'tape', 'one-thing', 'seat', 'card']);
    expect(bare.map).toBeUndefined();
    expect(bare.tape).toBeDefined();
  });

  it('fronts the film with our MVP: the champion the headline names, else the best line', () => {
    const named = buildFilm({ ...review, team: { ...review.team, headline: "Leona's engages gave the fights away" } } as GameReview, game, timeline, previous, 'MOSS 2');
    expect(named.title.protagonist).toEqual({ seat: 'Support', champion: 'Leona', name: 'Nia' });
    const kaisa = buildFilm({ ...review, team: { ...review.team, headline: 'KaiSa carried' }, players: [...review.players, { name: 'Max', seat: 'Mid', champion: "Kai'Sa", strength: point('x'), workOn: point('y') }] } as unknown as GameReview, game, timeline, previous);
    expect(kaisa.title.protagonist.seat).toBe('Mid');
  });

  it('titles the film with the headline, the loss, and the MVP by the line', () => {
    expect(film.title.headline).toBe('Bled 35 kills while farming even');
    expect(film.title.win).toBe(false);
    expect(film.title.protagonist).toEqual({ seat: 'ADC', champion: 'Jinx', name: 'Rhu' });
    expect(film.title.lowerThird).toEqual({
      date: 1757400000000,
      opponent: 'MOSS 2',
      durationMin: 34,
      kills: { ours: 14, theirs: 35 },
      compName: 'Front to back',
      compVerdict: 'off plan',
      compWhy: 'The comp wanted a slow game and the fights came early.',
      tier: 'timeline'
    });
  });

  it('asks what decided the game with the right theme among four, never another work-on theme', () => {
    const call = film.title.call!;
    expect(call.key).toBe('title');
    expect(call.question).toBe('What decided this game?');
    expect(call.options).toHaveLength(4);
    expect(new Set(call.options).size).toBe(4);
    expect(call.options[call.answer]).toBe('fights');
    expect(call.options).not.toContain('objectives');
    expect(call.why).toBe(review.team.workOn[0].text);
    expect(call.theme).toBe('fights');
  });

  it('carries the previous one thing and counts its recurrence off this ledger', () => {
    expect(film.title.lastTime).toEqual({
      matchId: 'EUW1_6999999999',
      text: 'Ward the river bush before every dragon.',
      recurrence: 'This game: 3 deaths with no ward nearby'
    });
  });

  it('splits the first work-on into A and B and keeps the rest behind it', () => {
    expect(film.oneThing.point).toBe(review.team.workOn[0]);
    expect(film.oneThing.options).toEqual(['Play safer trades before towers fall', 'Ask for jungle pressure earlier']);
    expect(film.oneThing.rest.map((r) => [r.kind, r.point.text])).toEqual([
      ['workOn', 'Trade the third grub for dragon tempo.'],
      ['keepDoing', 'Farm held up across the map, so keep the wave states clean.']
    ]);
  });

  it('builds a seat per reviewed player in role order with the stat line, the deaths and the presence', () => {
    expect(film.seats.map((s) => s.seat)).toEqual(['Jungle', 'ADC', 'Support']);
    const adc = film.seats[1];
    expect(adc.statLine).toBe('8/3/2 · 312 CS · vision 12 · 71% KP');
    expect(adc.deaths.map((d) => d.minute)).toEqual([4, 7, 12]);
    expect(adc.more).toHaveLength(1);
    expect(adc.presence).toBeUndefined();
    expect(film.seats[0].presence).toEqual({ kills: 9, ofKills: 14, line: 'Trundle was on 9 of our 14 kills.' });
    expect(film.seats[0].deaths.map((d) => d.minute)).toEqual([24]);
  });

  it('writes the card from the asks', () => {
    expect(film.card.headline).toBe('Bled 35 kills while farming even');
    expect(film.card.scoreline.map((c) => c.label)).toEqual(['Loss', 'Length', 'Kills', 'Towers', 'Dragons', 'Barons', 'Grubs', 'Heralds']);
    expect(film.card.oneThing).toBe('Either play safer trades before towers fall or ask for jungle pressure earlier.');
    expect(film.card.asks).toEqual([
      { name: 'Go10x', seat: 'Jungle', champion: 'Trundle', ask: 'Path bot after the first clear.' },
      { name: 'Rhu', seat: 'ADC', champion: 'Jinx', ask: 'Hold the wave under tower.' },
      { name: 'Nia', seat: 'Support', champion: 'Leona', ask: 'Engage only with Jinx in range.' }
    ]);
    expect(film.card.keepDoing).toBe('Farm held up across the map, so keep the wave states clean.');
  });

  it('is the same film every time', () => {
    expect(JSON.stringify(buildFilm(review, game, timeline, previous, 'MOSS 2'))).toBe(JSON.stringify(film));
  });

  it('carries no lessons and no seats on a version 3 review', () => {
    expect(film.lessons).toBeUndefined();
    expect(film.tape!.moments.every((m) => m.seats === undefined)).toBe(true);
  });
});

describe('buildFilm on a version 4 review', () => {
  const lessons = [
    { question: 'How many of our deaths before ten had no ward nearby?', options: ['One', 'Two', 'Three'], answer: 2, why: 'Three of the four early deaths fell in the dark, minutes 4 to 9.', theme: 'vision' },
    { question: 'Whose dragon was the one at 20?', options: ['Ours', 'Theirs', 'Nobody took it'], answer: 1, why: 'Their infernal at minute 20 went uncontested.' }
  ];
  const v4 = {
    ...review,
    reviewVersion: 4,
    team: {
      ...review.team,
      oneThing: 'Trade safer early, or bring the jungler bot?',
      lessons,
      workOn: [{ ...review.team.workOn[0], options: ['Trade safer before towers fall', 'Bring the jungler bot before ten'] }, review.team.workOn[1]],
      moments: [{ ...review.team.moments![0], seats: ['Jungle', 'ADC'] }, ...review.team.moments!.slice(1)]
    }
  } as unknown as GameReview;
  const film = buildFilm(v4, game, timeline, previous, 'MOSS 2');

  it('puts the model\'s one thing on the card, over the ask of the first work-on', () => {
    expect(film.card.oneThing).toBe('Trade safer early, or bring the jungler bot?');
    const blank = buildFilm({ ...v4, team: { ...v4.team, oneThing: '  ' } } as GameReview, game, timeline, previous);
    expect(blank.card.oneThing).toBe('Either play safer trades before towers fall or ask for jungle pressure earlier.');
  });

  it('splits the one thing on the model\'s own options first, and falls back to the sentence', () => {
    expect(film.oneThing.options).toEqual(['Trade safer before towers fall', 'Bring the jungler bot before ten']);
    expect(optionsOf({ text: 'Either ward the river bush or ask for a gank.', evidence: '', minute: null, options: ['Only one'] as unknown as [string, string] })).toEqual(['Ward the river bush', 'Ask for a gank']);
    expect(optionsOf({ text: 'Trade the third grub for dragon tempo.', evidence: '', minute: null, options: ['A', ''] })).toBeUndefined();
    expect(optionsOf(undefined)).toBeUndefined();
  });

  it('carries the seats of a moment through to the tape and the board', () => {
    expect(film.tape!.moments[0].seats).toEqual(['Jungle', 'ADC']);
    expect(film.tape!.moments[1].seats).toBeUndefined();
    const board = buildFilm({ ...v4, tier: 'endOfGame' } as GameReview, game, null, null).board!;
    expect(board.moments[0].seats).toEqual(['Jungle', 'ADC']);
  });

  it('builds the lessons as calls keyed by index, the options shuffled by the seed with the answer following', () => {
    expect(film.lessons).toHaveLength(2);
    film.lessons!.forEach((call, i) => {
      expect(call.key).toBe('lesson:' + i);
      expect(call.question).toBe(lessons[i].question);
      expect(call.options.slice().sort()).toEqual(lessons[i].options.slice().sort());
      expect(call.options[call.answer]).toBe(lessons[i].options[lessons[i].answer]);
      expect(call.why).toBe(lessons[i].why);
    });
    expect(film.lessons![0].theme).toBe('vision');
    expect(film.lessons![1].theme).toBeUndefined();
    expect(lessonCalls(v4.team.lessons, film.seed)).toEqual(film.lessons);
    // Another match id, another order for at least one of the two (the seed is what moves them).
    const orders = [360062704, 1, 2, 3, 4, 5].map((s) => lessonCalls(v4.team.lessons, s).map((c) => c.options.join('|')).join('/'));
    expect(new Set(orders).size).toBeGreaterThan(1);
  });

  it('skips a lesson with no right answer and gives nothing without any', () => {
    const broken = [{ question: 'Q', options: ['A', 'B', 'C'], answer: 3, why: 'w' }, { question: '', options: ['A', 'B'], answer: 0, why: 'w' }, { question: 'Ok', options: ['A', 'B'], answer: 1, why: 'w' }] as unknown as GameReview['team']['lessons'];
    const calls = lessonCalls(broken, 7);
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('lesson:2');
    expect(calls[0].options[calls[0].answer]).toBe('B');
    expect(lessonCalls(undefined, 7)).toEqual([]);
    expect(buildFilm({ ...v4, team: { ...v4.team, lessons: [] } } as GameReview, game, timeline, previous).lessons).toBeUndefined();
  });
});

describe('the tape', () => {
  const film = buildFilm(review, game, timeline, previous, 'MOSS 2');
  const tape = film.tape!;

  it('carries the clock, the side and the curve from the timeline', () => {
    expect(tape.durationSec).toBe(34 * 60 + 13);
    expect(tape.ourSide).toBe('blue');
    expect(tape.goldDiff).toEqual(GOLD_DIFF);
    expect(tape.goldDiff).not.toBe(GOLD_DIFF);
  });

  it('turns where the gold changed hands for good, the earliest lane flip on a swing, and nowhere on a flat game', () => {
    // The fixture leads by 400 until minute 5 and never recovers: a loss that was behind for good after five.
    expect(tape.turn).toEqual({ minute: 5, why: 'Behind for good after minute 5, from 400 up' });
    // The same curve as a win never gets back in front, so it has no turn.
    const won = buildFilm(review, { ...game, win: true }, timeline, previous).tape!;
    expect(won.turn).toBeNull();
    const comeback = buildFilm(review, { ...game, win: true }, { ...timeline, goldDiff: [0, -500, -1000, -1500, -1200, -600, -100, 300, 800, 1500] } as MatchTimeline, previous).tape!;
    expect(comeback.turn).toEqual({ minute: 6, why: 'In front for good after minute 6, from 1.5k down' });
    const stomp = buildFilm(review, { ...game, win: true }, { ...timeline, goldDiff: [0, 200, 600, 1100, 1500] } as MatchTimeline, previous).tape!;
    expect(stomp.turn).toEqual({ minute: 3, why: 'Never behind; it broke open around minute 3, up 1.1k' });
    // Twenty gold up at minute one is level, not in front: the game broke open later, and that is the turn.
    const level = buildFilm(review, { ...game, win: false }, { ...timeline, goldDiff: [0, 20, -200, -600, -1200, -1500] } as MatchTimeline, previous).tape!;
    expect(level.turn).toEqual({ minute: 4, why: 'Level early; it broke open around minute 4, down 1.2k' });
    const swung = buildFilm(review, game, { ...timeline, facts: { ...timeline.facts!, curve: { shape: 'swung' } } } as MatchTimeline, previous).tape!;
    expect(swung.turn?.minute).toBe(11);
    expect(swung.turn?.why).toContain('ADC');
    const flat = buildFilm(review, game, { ...timeline, goldDiff: [0, 100, -100, 50] } as MatchTimeline, previous).tape!;
    expect(flat.turn).toBeNull();
  });

  it('writes the consequence of a moment off the gold three minutes on, and says about even under 300', () => {
    expect(tape.moments.map((m) => m.consequence)).toEqual([
      'Over the next three minutes: -1.7k',
      'Over the next three minutes: -1.4k',
      'Over the next three minutes: about even',
      undefined
    ]);
    expect(tape.moments.map((m) => [m.minute, m.swing])).toEqual([
      [8, 'us'],
      [12, 'them'],
      [28, 'even'],
      [33, 'them']
    ]);
    const up = buildFilm(review, game, { ...timeline, goldDiff: GOLD_DIFF.map((g) => -g) } as MatchTimeline, previous).tape!;
    expect(up.moments[0].consequence).toBe('Over the next three minutes: +1.7k');
  });

  it('lists every event in time order', () => {
    const secs = tape.events.map((e) => e.sec);
    expect(secs).toEqual(secs.slice().sort((a, b) => a - b));
    expect(tape.events.length).toBeGreaterThanOrEqual(6 + 3 + 5 + 2 + 2 + 4);
  });

  it('plays the same events off the timeline alone, before a review exists, with the seat standing in for a name', () => {
    expect(tapeEventsOf(timeline, review.players)).toEqual(tape.events);
    const bare = tapeEventsOf(timeline);
    expect(bare.map((e) => ({ sec: e.sec, kind: e.kind, x: e.x, y: e.y }))).toEqual(tape.events.map((e) => ({ sec: e.sec, kind: e.kind, x: e.x, y: e.y })));
    const ours = bare.filter((e) => e.kind === 'ourDeath');
    expect(ours.map((e) => e.label)).toEqual(['ADC died', 'ADC died', 'Support died', 'ADC died', 'Support died', 'Jungle died']);
    expect(ours.map((e) => e.champion)).toEqual(['Jinx', 'Jinx', undefined, 'Jinx', undefined, undefined]);
  });

  it('tallies the reel counters by the second, off the ledger where it has the death and off the flags where it does not', () => {
    expect(reelTallyOf(timeline, 0)).toEqual({ deaths: 0, dark: 0, close: 0 });
    expect(reelTallyOf(timeline, 252)).toEqual({ deaths: 1, dark: 1, close: 1 });
    expect(reelTallyOf(timeline, 760)).toEqual({ deaths: 4, dark: 3, close: 2 });
    expect(reelTallyOf(timeline, 9999)).toEqual({ deaths: 6, dark: 3, close: 2 });
    const noFacts = { ...timeline, facts: undefined, deaths: [fell(100, 'Top', 'top'), fell(200, 'Mid', 'mid', { warded: true, theirJungleIn: true })] } as unknown as MatchTimeline;
    expect(reelTallyOf(noFacts, 300)).toEqual({ deaths: 2, dark: 1, close: 1 });
  });

  it('places our deaths inside their zone with the ledger key, the name and the champion', () => {
    const ours = tape.events.filter((e) => e.kind === 'ourDeath');
    expect(ours.map((e) => e.key)).toEqual(['d:4:ADC', 'd:7:ADC', 'd:9:Support', 'd:12:ADC', 'd:20:Support', 'd:24:Jungle']);
    expect(ours.map((e) => e.label)).toEqual(['Rhu died', 'Rhu died', 'Nia died', 'Rhu died', 'Nia died', 'Go10x died']);
    expect(ours[0]).toMatchObject({ sec: 252, side: 'us', seat: 'ADC', champion: 'Jinx', zone: 'bot' });
    for (const e of ours) expect(regionFor(e.zone!, 'blue').inside(e.x, e.y)).toBe(true);
    // Three in bot lane, three different spots.
    const bot = ours.filter((e) => e.zone === 'bot').map((e) => `${e.x},${e.y}`);
    expect(new Set(bot).size).toBe(bot.length);
    expect(ours.map((e) => e.label).join(' ')).not.toMatch(RIOT_TAG);
  });

  it('places their deaths as plain dots in the zone the timeline named, with no seat and no champion', () => {
    const theirs = tape.events.filter((e) => e.kind === 'theirDeath');
    expect(theirs.map((e) => e.sec)).toEqual([380, 1215, 1500]);
    for (const e of theirs) {
      expect(e.label).toBe('One of theirs died');
      expect(e.seat).toBeUndefined();
      expect(e.champion).toBeUndefined();
      expect(e.key).toBeUndefined();
      expect(regionFor(e.zone!, 'blue').inside(e.x, e.y)).toBe(true);
    }
  });

  it('drops objectives on their pit, firsts and plates on the lane that lost them, backs at our base', () => {
    const objectives = tape.events.filter((e) => e.kind === 'objective');
    expect(objectives.map((e) => e.label)).toEqual(['Our grubs, 1 of ours near', 'Our dragon, 3 of ours near', 'Their dragon (infernal), 1 of ours near', 'Their baron', 'Their dragon (mountain)']);
    expect(objectives[0]).toMatchObject({ sec: 360, side: 'us', ...objectivePit('grubs') });
    expect(objectives[3]).toMatchObject({ sec: 27 * 60, side: 'them', ...objectivePit('baron') });
    const firsts = tape.events.filter((e) => e.kind === 'first');
    expect(firsts.map((e) => [e.sec, e.label])).toEqual([
      [240, 'First blood, theirs'],
      [540, 'First tower, theirs']
    ]);
    expect(firsts[0]).toMatchObject(regionFor('mid', 'blue').centroid);
    // Their first tower was ours, in bot, so it sits on our bot spot.
    expect(firsts[1]).toMatchObject({ x: 62, y: 87 });
    const plates = tape.events.filter((e) => e.kind === 'plate');
    expect(plates.map((e) => [e.sec, e.label, e.side])).toEqual([
      [14 * 60, 'Plate down, top, by 14 min', 'us'],
      [14 * 60, '2 plates down, bot, by 14 min', 'them']
    ]);
    expect(plates[0]).toMatchObject({ x: 30, y: 12 });
    expect(plates[1]).toMatchObject({ x: 62, y: 87 });
    const backs = tape.events.filter((e) => e.kind === 'back');
    expect(backs.map((e) => [e.sec, e.label])).toEqual([
      [240, 'Jungle backed'],
      [300, 'ADC backed'],
      [660, 'ADC backed'],
      [960, 'ADC backed']
    ]);
    for (const b of backs) expect(regionFor('ourBase', 'blue').inside(b.x, b.y)).toBe(true);
  });

  it('caps the backs at twenty-four', () => {
    const many = { ...timeline, spend: [{ seat: 'Top', backs: Array.from({ length: 30 }, (_, i) => i + 2) }] } as MatchTimeline;
    expect(buildFilm(review, game, many, previous).tape!.events.filter((e) => e.kind === 'back')).toHaveLength(24);
  });

  it('stops on the beats in time order: the firsts, every death not inside something else, the turn, the objectives, the moments and the fight, keyed by kind and second', () => {
    expect(tape.beats.map((b) => [b.sec, b.kind, b.key])).toEqual([
      [240, 'first', 'b:first:240'],
      [252, 'death', 'd:4:ADC'],
      [300, 'turn', 'b:turn:300'],
      [360, 'objective', 'b:objective:360'],
      [480, 'moment', 'b:moment:480'],
      [540, 'first', 'b:first:540'],
      [545, 'death', 'd:9:Support'],
      [720, 'moment', 'b:moment:720'],
      [1200, 'objective', 'b:objective:1200'],
      [1473, 'death', 'd:24:Jungle'],
      [1620, 'objective', 'b:objective:1620'],
      [1680, 'moment', 'b:moment:1680'],
      [1860, 'objective', 'b:objective:1860'],
      [1980, 'moment', 'b:moment:1980']
    ]);
    expect(tape.beats).toHaveLength(14);
    expect(new Set(tape.beats.map((b) => b.key)).size).toBe(14);
    expect((tape as unknown as { calls?: unknown }).calls).toBeUndefined();
  });

  it('stands on every death of the map: as a beat of its own, or listed under the moment, objective or fight it fell in', () => {
    const covered = beatCoverage(film);
    for (const pin of film.map!.pins) expect(covered.has(pin.key)).toBe(true);
    // Three stand alone; Jinx at 7 is the dragon moment's, at 12 the moment she was caught in, Leona at 20 the infernal dragon's.
    expect(tape.beats.filter((b) => b.kind === 'death').map((b) => b.key)).toEqual(['d:4:ADC', 'd:9:Support', 'd:24:Jungle']);
    expect(tape.beats.find((b) => b.key === 'b:moment:480')!.deaths).toEqual(['d:7:ADC']);
    expect(tape.beats.find((b) => b.key === 'b:moment:720')!.deaths).toEqual(['d:12:ADC']);
    expect(tape.beats.find((b) => b.key === 'b:objective:1200')!.deaths).toEqual(['d:20:Support']);
    // A death beat never lists deaths, and a beat nothing fell in carries no list at all.
    for (const b of tape.beats) if (b.kind === 'death') expect(b.deaths).toBeUndefined();
    expect(tape.beats.find((b) => b.key === 'b:turn:300')!.deaths).toBeUndefined();
    // One death a minute for the whole game: thirty-four pins, every one still accounted for.
    const seats = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'] as const;
    const steady = Array.from({ length: 34 }, (_, i) => fell((i + 1) * 60 + 10, seats[i % 5], 'mid', { killers: 1 }));
    const ledger = steady.map((d) => death(d.minute, d.seat, d.minute % 2 ? ['ward'] : [], `Minute ${d.minute}: ${d.seat} fell.`, 'mid', d.minute % 2 ? 'gank' : 'solo'));
    const long = buildFilm(review, game, { ...timeline, deaths: steady, facts: { ...timeline.facts!, ledger, deathClusters: [] } } as MatchTimeline, previous);
    expect(long.map!.pins).toHaveLength(34);
    expect(long.tape!.beats.length).toBeLessThanOrEqual(40);
    const all = beatCoverage(long);
    for (const pin of long.map!.pins) expect(all.has(pin.key)).toBe(true);
  });

  it('titles every death by its read, with the swing and the glyph to match: avoidable, traded, bought an objective, clean', () => {
    // Nothing to fold into: no moments, no fights, no firsts, a flat curve and so no turn; one dragon at 8 that Jinx was on,
    // fifty-five seconds after her death at 7:05, so the death bought it (within a minute) and yet is not the same beat (past 45 s).
    const lonely = {
      ...timeline,
      goldDiff: [0, 100, -100, 50],
      firsts: {},
      deaths: timeline.deaths.map((d) => (d.sec === 450 ? { ...d, sec: 425 } : d)),
      objectives: [timeline.objectives[1]],
      facts: { ...timeline.facts!, objectives: [], deathClusters: [], ledger: [...timeline.facts!.ledger!, death(27, 'Top', [], 'Minute 27: Ornn in a fight.', 'mid', 'fight')] }
    } as MatchTimeline;
    const quiet = { ...review, team: { ...review.team, moments: [] } } as GameReview;
    const beats = buildFilm(quiet, game, lonely, previous).tape!.beats;
    expect(beats.map((b) => [b.key, b.kind, b.title, b.swing, b.glyph])).toEqual([
      ['d:4:ADC', 'death', 'Rhu falls, avoidable', 'them', 'ward-off'],
      ['d:7:ADC', 'death', 'Rhu falls, bought an objective', 'us', 'dragon'],
      ['b:objective:480', 'objective', 'Our dragon', 'us', 'dragon'],
      ['d:9:Support', 'death', 'Nia falls, avoidable', 'them', 'ward-off'],
      ['d:12:ADC', 'death', 'Rhu falls, avoidable', 'them', 'horn'],
      ['d:20:Support', 'death', 'Nia falls, traded', 'even', 'swords'],
      ['d:24:Jungle', 'death', 'Go10x falls, avoidable', 'them', 'footsteps'],
      // No player of ours reviewed in Top, so the seat stands for the name.
      ['d:27:Top', 'death', 'Top falls, clean', 'them', 'check']
    ]);
    expect(beats.find((b) => b.key === 'd:7:ADC')).toMatchObject({ text: 'Bought the dragon: it fell to us within a minute.', seats: ['ADC'], champions: ['Jinx'] });
    expect(beats.find((b) => b.key === 'd:20:Support')).toMatchObject({ text: 'Traded: one of theirs fell in the same fight.', seats: ['Support'], champions: ['Leona'] });
    expect(beats.find((b) => b.key === 'd:27:Top')).toMatchObject({ text: 'Clean: nothing on the map would have stopped this one.', seats: ['Top'] });
    expect(beats.find((b) => b.key === 'd:27:Top')!.champions).toBeUndefined();
    for (const b of beats) expect(b.title).not.toMatch(/\?|drill|quiz|score/i);
  });

  it('folds a fight over an objective into the objective, a death in a fight into the fight, and a first tower taken with an objective into it', () => {
    const t = {
      ...timeline,
      objectives: [{ minute: 9, type: 'grubs', side: 'them', ourInvolved: [], ourNear: [] }],
      firsts: { ...timeline.firsts, tower: { minute: 9, side: 'them', lane: 'bot' } },
      facts: {
        ...timeline.facts!,
        objectives: [{ minute: 9, type: 'grubs', side: 'them', ourNearCount: 0, ourInvolved: [], setup: 'traded', line: 'Minute 9: their grubs, traded for one of ours.' }],
        deathClusters: [{ fromMinute: 9, toMinute: 9, zone: 'river', ours: 1, theirs: 1, seats: ['Support'], line: 'Minute 9: one for one in the river.' }]
      }
    } as MatchTimeline;
    const beats = buildFilm(review, game, t, previous).tape!.beats.filter((b) => b.sec >= 500 && b.sec <= 600);
    // The grubs host the fight, the first tower and the Support's death at 545: one chip at minute 9, not four.
    expect(beats).toHaveLength(1);
    expect(beats[0]).toMatchObject({ kind: 'objective', title: 'Their grubs', glyph: 'grubs', seats: ['Support'] });
    expect(beats[0].text).toContain('Minute 9: their grubs, traded for one of ours.');
    expect(beats[0].text).toContain('Minute 9: one for one in the river.');
    expect(beats[0].text).toContain('The first tower fell in bot lane around minute 9, to them.');
    // The death in it is listed, not repeated in the text: the tape draws its tile and read under the card.
    expect(beats[0].deaths).toEqual(['d:9:Support']);
    expect(beats[0].text).not.toContain('Avoidable');
  });

  it('writes each beat in the facts\' own words, with its glyph, its swing and the champions it was about', () => {
    const by = (key: string) => tape.beats.find((b) => b.key === key)!;
    expect(by('b:first:240')).toMatchObject({ title: 'First blood, theirs', swing: 'them', glyph: 'blood', text: 'The first kill of the game went their way, around minute 4.' });
    expect(by('b:first:540')).toMatchObject({ title: 'First tower, bot, theirs', swing: 'them', glyph: 'tower', text: 'The first tower fell in bot lane around minute 9, to them.' });
    expect(by('b:turn:300')).toMatchObject({ title: 'Where it turned', text: 'Behind for good after minute 5, from 400 up', swing: 'them', glyph: 'coin' });
    // An objective without a facts line falls back to its label and minute; with one, the facts speak.
    expect(by('b:objective:360')).toMatchObject({ title: 'Our grubs', text: 'Our grubs at minute 6.', swing: 'us', glyph: 'grubs', seats: ['Jungle'], champions: ['Trundle'] });
    // The fight in the river ten seconds after the dragon is the fight over it: one card, the dragon's words first, the fight's after, the fight's seats along.
    expect(by('b:objective:1200')).toMatchObject({
      title: 'Their dragon (infernal)',
      text: 'Minute 20: their dragon (infernal), uncontested. Minutes 19 to 21: three of ours fell in the river for one of theirs.',
      swing: 'them',
      glyph: 'dragon',
      seats: ['Support', 'ADC', 'Jungle'],
      champions: ['Leona', 'Jinx', 'Trundle'],
      deaths: ['d:20:Support']
    });
    expect(by('b:objective:1620')).toMatchObject({ title: 'Their baron', text: 'Their baron at minute 27.', glyph: 'baron' });
    expect(tape.beats.find((b) => b.key === 'b:fight:1210')).toBeUndefined();
    // The deaths, titled by the name and the read, with the read as the line and the first glyph as the card's.
    expect(by('d:4:ADC')).toMatchObject({
      title: 'Rhu falls, avoidable',
      text: 'Avoidable: two came in and no ward had gone down nearby, and their jungler had been on this side a minute earlier.',
      swing: 'them',
      glyph: 'ward-off',
      seats: ['ADC'],
      champions: ['Jinx']
    });
    expect(by('d:9:Support')).toMatchObject({ title: 'Nia falls, avoidable', glyph: 'ward-off', champions: ['Leona'] });
    expect(by('d:24:Jungle')).toMatchObject({ title: 'Go10x falls, avoidable', text: 'Avoidable: alone on their side of the map, though one of theirs fell too.', swing: 'them', glyph: 'footsteps', seats: ['Jungle'], champions: ['Trundle'] });
    // The moments are titled by their swing, never "Minute N", and carry the consequence.
    expect(by('b:moment:1680')).toMatchObject({ title: 'Even', text: 'A quiet stretch nobody used.', swing: 'even', glyph: 'flag', consequence: 'Over the next three minutes: about even' });
    expect(by('b:moment:1980')).toMatchObject({ title: 'Their way', glyph: 'flag' });
    expect(by('b:moment:1980').consequence).toBeUndefined();
    for (const b of tape.beats) expect(b.title).not.toMatch(/^Minute \d/);
    for (const b of tape.beats) expect(b.text).not.toMatch(/\?$/);
  });

  it('folds a first, an objective, a fight or a death within 45 s into the coach\'s moment, which takes its glyph and its champions', () => {
    const keys = tape.beats.map((b) => b.key);
    // The dragon at 8 is the moment at 8; Jinx falling at 12:40 is the moment at 12.
    expect(keys).not.toContain('b:objective:480');
    expect(keys).not.toContain('d:12:ADC');
    const dragon = tape.beats.find((b) => b.key === 'b:moment:480')!;
    expect(dragon).toMatchObject({ title: 'Our way', text: 'Dragon at 8 with all five nearby.', swing: 'us', glyph: 'dragon', seats: ['Jungle', 'ADC'], champions: ['Trundle', 'Jinx'], consequence: 'Over the next three minutes: -1.7k', deaths: ['d:7:ADC'] });
    const caught = tape.beats.find((b) => b.key === 'b:moment:720')!;
    expect(caught).toMatchObject({ title: 'Their way', text: 'Jinx caught again in bot.', glyph: 'horn', seats: ['ADC'], champions: ['Jinx'], deaths: ['d:12:ADC'] });
    // A moment that already took a glyph keeps it, and the champions stay at three.
    const crowded = { ...timeline, objectives: [...timeline.objectives, { minute: 8, type: 'herald', side: 'us', ourInvolved: ['Support', 'Top', 'Mid'], ourNear: [] }] } as MatchTimeline;
    const v4 = { ...review, team: { ...review.team, moments: [{ ...review.team.moments![0], seats: ['Jungle'] }, ...review.team.moments!.slice(1)] } } as GameReview;
    const both = buildFilm(v4, game, crowded, previous).tape!.beats.find((b) => b.key === 'b:moment:480')!;
    expect(both.glyph).toBe('dragon');
    expect(both.seats).toEqual(['Jungle', 'ADC', 'Support']);
    expect(both.champions).toEqual(['Trundle', 'Jinx', 'Leona']);
    // The turn never folds: it is the game's, not an event.
    const near = buildFilm({ ...review, team: { ...review.team, moments: [{ minute: 5, text: 'Slid here.', swing: 'them' }] } } as GameReview, game, timeline, previous).tape!.beats;
    expect(near.map((b) => b.key)).toContain('b:turn:300');
    expect(near.map((b) => b.key)).toContain('b:moment:300');
  });

  it('makes a fight of a cluster with two or more in it, stops it on our first death in it, and folds that death into the fight', () => {
    const facts = timeline.facts!;
    const busy = {
      ...timeline,
      facts: {
        ...facts,
        deathClusters: [
          ...facts.deathClusters,
          { fromMinute: 10, toMinute: 11, zone: 'bot', ours: 1, theirs: 0, seats: ['ADC'], line: 'One.' },
          { fromMinute: 23, toMinute: 25, zone: 'mid', ours: 2, theirs: 2, seats: ['Mid', 'Top'], line: 'Two.' },
          { fromMinute: 29, toMinute: 30, zone: 'theirBase', ours: 4, theirs: 0, seats: ['Mid', 'Top', 'ADC', 'Support'], line: 'Four.' }
        ]
      }
    } as MatchTimeline;
    const film = buildFilm(review, game, busy, previous);
    const beats = film.tape!.beats;
    // Under the cap nothing is dropped: the fourteen of the base fixture, less Trundle's death (now the mid fight's), plus the two fights.
    expect(beats).toHaveLength(15);
    expect(beats.map((b) => b.sec)).toEqual(beats.map((b) => b.sec).sort((a, b) => a - b));
    expect(beats.filter((b) => b.kind === 'first').map((b) => b.key)).toEqual(['b:first:240', 'b:first:540']);
    expect(beats.filter((b) => b.kind === 'moment')).toHaveLength(4);
    // A cluster with one death in it is not a fight; the even one at 23 stops on our first death in it, the one-sided one on its minute.
    expect(beats.filter((b) => b.kind === 'fight').map((b) => [b.key, b.swing, b.title])).toEqual([
      ['b:fight:1473', 'even', 'Fight in mid lane'],
      ['b:fight:1740', 'them', 'Fight in their base']
    ]);
    expect(beats.find((b) => b.key === 'b:fight:1473')).toMatchObject({ deaths: ['d:24:Jungle'], seats: ['Mid', 'Top', 'Jungle'], text: 'Two.' });
    expect(beats.filter((b) => b.kind === 'death').map((b) => b.key)).toEqual(['d:4:ADC', 'd:9:Support']);
    const covered = beatCoverage(film);
    for (const pin of film.map!.pins) expect(covered.has(pin.key)).toBe(true);
    // The mid fight at 24:33 is the fight over grubs at 25: folded into the objective, which then carries the fight's words and its death.
    const busier = { ...busy, objectives: [...busy.objectives, { minute: 14, type: 'herald', side: 'them', ourInvolved: [], ourNear: [] }, { minute: 25, type: 'grubs', side: 'us', ourInvolved: [], ourNear: [] }] } as MatchTimeline;
    const more = buildFilm(review, game, busier, previous).tape!.beats;
    expect(more).toHaveLength(16);
    expect(more.filter((b) => b.kind === 'fight').map((b) => b.key)).toEqual(['b:fight:1740']);
    expect(more.find((b) => b.key === 'b:objective:1500')).toMatchObject({ deaths: ['d:24:Jungle'] });
    expect(more.find((b) => b.key === 'b:objective:1500')!.text).toContain('Two.');
    expect(more.filter((b) => b.kind === 'objective')).toHaveLength(6);
  });

  it('caps the beats at forty, dropping the firsts first and then the latest deaths, and never a moment, the turn, an objective or a fight', () => {
    // Two of ours fall every minute from 1 to 34: sixty-eight deaths, each with its ledger row, on top of the fixture's moments, objectives, firsts and turn.
    const deaths = Array.from({ length: 34 }, (_, i) => i + 1).flatMap((m) => (['Top', 'Mid'] as const).map((seat) => fell(m * 60 + 10, seat, seat === 'Top' ? 'top' : 'mid', { killers: 1 })));
    const ledger = deaths.map((d) => death(d.minute, d.seat, d.seat === 'Top' ? ['ward'] : [], `Minute ${d.minute}: ${d.seat} fell.`, d.zone, d.seat === 'Top' ? 'gank' : 'solo'));
    const crowded = { ...timeline, deaths, facts: { ...timeline.facts!, ledger, deathClusters: [], ledgerSummary: undefined } } as unknown as MatchTimeline;
    const film = buildFilm(review, game, crowded, previous);
    expect(film.map!.pins).toHaveLength(68);
    const beats = film.tape!.beats;
    expect(beats).toHaveLength(40);
    expect(beats.map((b) => b.sec)).toEqual(beats.map((b) => b.sec).sort((a, b) => a - b));
    expect(new Set(beats.map((b) => b.key)).size).toBe(40);
    expect(beats.filter((b) => b.kind === 'first')).toHaveLength(0);
    expect(beats.filter((b) => b.kind === 'moment')).toHaveLength(4);
    expect(beats.filter((b) => b.kind === 'turn')).toHaveLength(1);
    // Grubs at 6, the infernal at 20, the baron and the mountain; the dragon at 8 is the moment's.
    expect(beats.filter((b) => b.kind === 'objective')).toHaveLength(4);
    // The two deaths in the turn's minute, in each moment's and in each objective's fold into those (eighteen); of the fifty left the earliest thirty-one stand.
    const standing = beats.filter((b) => b.kind === 'death');
    expect(standing).toHaveLength(31);
    expect(standing[0].key).toBe('d:1:Top');
    expect(standing[standing.length - 1].sec).toBeLessThan(deaths[deaths.length - 1].sec);
    for (const key of ['b:turn:300', 'b:moment:480', 'b:moment:720', 'b:objective:1200', 'b:moment:1680', 'b:objective:1860', 'b:moment:1980']) {
      expect(beats.find((b) => b.key === key)!.deaths).toHaveLength(2);
    }
    // The cap costs the latest deaths their beat, and only them: everything before the first dropped one is covered.
    const covered = beatCoverage(film);
    const firstDropped = film.map!.pins.filter((p) => !covered.has(p.key)).sort((a, b) => a.sec - b.sec)[0];
    expect(firstDropped).toBeDefined();
    for (const pin of film.map!.pins) if (pin.sec < firstDropped.sec) expect(covered.has(pin.key)).toBe(true);
  });

  it('makes three grubs in one minute one beat, and two different objectives in one minute two', () => {
    const grubs = { ...timeline, objectives: [...timeline.objectives, { minute: 6, type: 'grubs', side: 'us', ourInvolved: ['Jungle'], ourNear: ['Jungle'] }, { minute: 6, type: 'grubs', side: 'us', ourInvolved: ['Jungle'], ourNear: ['Jungle'] }] } as MatchTimeline;
    const at6 = buildFilm(review, game, grubs, previous).tape!.beats.filter((b) => b.sec === 360);
    expect(at6).toHaveLength(1);
    expect(at6[0]).toMatchObject({ kind: 'objective', title: 'Our grubs', key: 'b:objective:360' });
  });

  it('gives two beats of one kind in the same second their own keys', () => {
    const twice = { ...timeline, objectives: [...timeline.objectives, { minute: 6, type: 'herald', side: 'them', ourInvolved: [], ourNear: [] }] } as MatchTimeline;
    const keys = buildFilm(review, game, twice, previous).tape!.beats.map((b) => b.key);
    expect(keys).toContain('b:objective:360');
    expect(keys).toContain('b:objective:360:2');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has no turn beat on a flat game', () => {
    const flat = buildFilm(review, game, { ...timeline, goldDiff: [0, 100, -100, 50] } as MatchTimeline, previous).tape!;
    expect(flat.turn).toBeNull();
    expect(flat.beats.some((b) => b.kind === 'turn')).toBe(false);
  });
});

describe('railGroups', () => {
  const film = buildFilm(review, game, timeline, previous, 'MOSS 2');

  it('groups the beats by game minute in time order, so a minute with several stops is one chip with a count', () => {
    const groups = railGroups(film.tape!.beats);
    expect(groups.map((g) => [g.minute, g.beats.map((b) => b.key)])).toEqual([
      [4, ['b:first:240', 'd:4:ADC']],
      [5, ['b:turn:300']],
      [6, ['b:objective:360']],
      [8, ['b:moment:480']],
      [9, ['b:first:540', 'd:9:Support']],
      [12, ['b:moment:720']],
      [20, ['b:objective:1200']],
      [24, ['d:24:Jungle']],
      [27, ['b:objective:1620']],
      [28, ['b:moment:1680']],
      [31, ['b:objective:1860']],
      [33, ['b:moment:1980']]
    ]);
    // Every beat lands in exactly one group, the groups climb, and each group's beats do too.
    expect(groups.flatMap((g) => g.beats)).toHaveLength(film.tape!.beats.length);
    expect(groups.map((g) => g.minute)).toEqual(groups.map((g) => g.minute).slice().sort((a, b) => a - b));
    for (const g of groups) expect(g.beats.map((b) => b.sec)).toEqual(g.beats.map((b) => b.sec).slice().sort((a, b) => a - b));
    // The same groups whatever order the beats come in, and none from nothing.
    expect(railGroups(film.tape!.beats.slice().reverse())).toEqual(groups);
    expect(railGroups([])).toEqual([]);
  });

  it('puts a moment before a death in the same second, as the tape does', () => {
    const beats = film.tape!.beats;
    const moment = beats.find((b) => b.key === 'b:moment:480')!;
    const same = { ...beats.find((b) => b.key === 'd:4:ADC')!, sec: 480, key: 'd:8:ADC' };
    expect(railGroups([same, moment]).map((g) => [g.minute, g.beats.map((b) => b.key)])).toEqual([[8, ['b:moment:480', 'd:8:ADC']]]);
  });
});

describe('the board', () => {
  const replay = { ...review, tier: 'endOfGame' } as GameReview;
  const film = buildFilm(replay, game, null, null);
  const board = film.board!;

  it('orders the chapters title, board, one thing, seat, card, on a replay and on a timeline tier still waiting for its timeline', () => {
    expect(film.chapters.map((c) => c.kind)).toEqual(['title', 'board', 'one-thing', 'seat', 'card']);
    expect(film.chapters[1].title).toBe('The board');
    expect(film.tape).toBeUndefined();
    expect(film.map).toBeUndefined();
    const waiting = buildFilm(review, game, null, previous);
    expect(waiting.chapters.map((c) => c.kind)).toEqual(['title', 'board', 'one-thing', 'seat', 'card']);
    expect(waiting.board).toBeDefined();
  });

  it('tallies the counts both sides had something of, and asks which was furthest apart', () => {
    expect(board.tallies).toEqual([
      { label: 'Kills', ours: 14, theirs: 35 },
      { label: 'Towers', ours: 6, theirs: 9 },
      { label: 'Dragons', ours: 2, theirs: 3 },
      { label: 'Barons', ours: 1, theirs: 1 },
      { label: 'Grubs', ours: 4, theirs: 0 },
      { label: 'Heralds', ours: 0, theirs: 1 }
    ]);
    const call = board.call!;
    expect(call.key).toBe('board');
    expect(call.question).toBe('Which count was furthest apart?');
    expect(call.options.slice().sort()).toEqual(['Barons', 'Dragons', 'Grubs', 'Heralds', 'Kills', 'Towers']);
    expect(call.options[call.answer]).toBe('Kills');
    expect(call.why).toBe('Kills ended 14-35');
    expect(board.moments.map((m) => m.minute)).toEqual([8, 12, 28, 33]);
    expect(board.moments.every((m) => m.consequence === undefined)).toBe(true);
  });

  it('breaks a tie on the widest gap by the order of the tallies, and calls nothing when every count is tied', () => {
    const tied = buildFilm(replay, { ...game, kills: { ours: 10, theirs: 14 } }, null, null).board!.call!;
    expect(tied.options[tied.answer]).toBe('Kills');
    expect(tied.why).toBe('Kills ended 10-14');
    const even = buildFilm(replay, { ...game, kills: { ours: 5, theirs: 5 }, objectives: { ours: side({ towers: 3 }), theirs: side({ towers: 3 }) } }, null, null).board!;
    expect(even.tallies).toEqual([
      { label: 'Kills', ours: 5, theirs: 5 },
      { label: 'Towers', ours: 3, theirs: 3 }
    ]);
    expect(even.call).toBeNull();
  });
});

describe('the map', () => {
  const film = buildFilm(review, game, timeline, previous, 'MOSS 2');
  const map = film.map!;
  const tape = film.tape!;

  it('pins every ledger row where the tape put the same death', () => {
    expect(map.pins).toHaveLength(6);
    for (const pin of map.pins) {
      const event = tape.events.find((e) => e.key === pin.key)!;
      expect(event).toBeDefined();
      expect([pin.x, pin.y, pin.sec]).toEqual([event.x, event.y, event.sec]);
      expect(regionFor(pin.zone, 'blue').inside(pin.x, pin.y)).toBe(true);
    }
    const first = map.pins.find((p) => p.key === 'd:4:ADC')!;
    expect(first).toMatchObject({ sec: 252, minute: 4, seat: 'ADC', name: 'Rhu', champion: 'Jinx', zone: 'bot', how: 'gank', could: ['ward', 'call'], line: 'Minute 4: Jinx to a gank in bot lane with no ward nearby.' });
  });

  it('walks the pins in the order the film\'s style chose', () => {
    expect(map.order).toBe(film.style.deathOrder);
    expect(map.order).toBe(styleFor(film.seed, false).deathOrder);
    const minutes = map.pins.map((p) => p.minute);
    if (map.order === 'chronological') {
      expect(minutes).toEqual([4, 7, 9, 12, 20, 24]);
    } else {
      expect(minutes).toEqual([9, 12, 4, 24, 20, 7]);
    }
    // The other order on another match id.
    const otherOrder = buildFilm({ ...review, matchId: 'EUW1_7000000002' } as GameReview, game, { ...timeline, matchId: 'EUW1_7000000002' } as MatchTimeline, previous).map!.order;
    expect(['chronological', 'worst-first']).toContain(otherOrder);
  });

  it('walks worst-first by the read and the cost: the avoidable deaths most costly first, then the trade, the clean ones, and last what bought something', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `EUW1_70000001${String(i).padStart(2, '0')}`);
    const worst = ids.find((id) => styleFor(seedOf(id), false).deathOrder === 'worst-first')!;
    const chrono = ids.find((id) => styleFor(seedOf(id), false).deathOrder === 'chronological')!;
    expect(worst).toBeDefined();
    const ordered = buildFilm({ ...review, matchId: worst } as GameReview, game, { ...timeline, matchId: worst } as MatchTimeline, previous).map!;
    expect(ordered.order).toBe('worst-first');
    expect(ordered.pins.map((p) => [p.minute, p.read, p.cost])).toEqual([
      [9, 'avoidable', -1100],
      [12, 'avoidable', -900],
      [4, 'avoidable', -500],
      [24, 'avoidable', -500],
      [20, 'traded', -700],
      [7, 'bought', -1200]
    ]);
    // A clean death sits between the trade and the buy; an avoidable one the curve does not reach comes after the priced ones.
    const late = { ...timeline, facts: { ...timeline.facts!, ledger: [...timeline.facts!.ledger!, death(27, 'Top', [], 'Minute 27: Ornn in a fight.', 'mid', 'fight'), death(34, 'Mid', ['ward'], 'Minute 34: Ahri in the dark.', 'mid')] } } as MatchTimeline;
    const withLate = buildFilm({ ...review, matchId: worst } as GameReview, game, { ...late, matchId: worst } as MatchTimeline, previous).map!;
    expect(withLate.pins.map((p) => [p.minute, p.read])).toEqual([
      [9, 'avoidable'],
      [12, 'avoidable'],
      [4, 'avoidable'],
      [24, 'avoidable'],
      [34, 'avoidable'],
      [20, 'traded'],
      [27, 'clean'],
      [7, 'bought']
    ]);
    expect(withLate.pins[4].cost).toBeUndefined();
    const plain = buildFilm({ ...review, matchId: chrono } as GameReview, game, { ...timeline, matchId: chrono } as MatchTimeline, previous).map!;
    expect(plain.pins.map((p) => p.minute)).toEqual([4, 7, 9, 12, 20, 24]);
  });

  it('reads every pin: the verdict, its line, its glyphs and what it cost over the next two minutes', () => {
    const by = (key: string) => map.pins.find((p) => p.key === key)!;
    expect(by('d:4:ADC')).toMatchObject({ read: 'avoidable', glyphs: ['ward-off', 'horn'], cost: -500, readLine: 'Avoidable: two came in and no ward had gone down nearby, and their jungler had been on this side a minute earlier.' });
    expect(by('d:7:ADC')).toMatchObject({ read: 'bought', glyphs: ['dragon'], cost: -1200, readLine: 'Bought the dragon: it fell to us within a minute.' });
    expect(by('d:9:Support')).toMatchObject({ read: 'avoidable', glyphs: ['ward-off', 'jungler-far'], cost: -1100, readLine: 'Avoidable: three came in and no ward had gone down nearby, and our jungler was about a screen away.' });
    expect(by('d:12:ADC')).toMatchObject({ read: 'avoidable', glyphs: ['horn'], cost: -900, readLine: 'Avoidable: their jungler had been on this side a minute earlier.' });
    expect(by('d:20:Support')).toMatchObject({ read: 'traded', glyphs: ['swords'], cost: -700, readLine: 'Traded: one of theirs fell in the same fight.' });
    expect(by('d:24:Jungle')).toMatchObject({ read: 'avoidable', glyphs: ['footsteps'], cost: -500, readLine: 'Avoidable: alone on their side of the map, though one of theirs fell too.' });
    // The read line never repeats the name or the minute the card already shows.
    for (const p of map.pins) {
      expect(p.readLine).not.toContain(p.name!);
      expect(p.readLine).not.toMatch(new RegExp(`\\b${p.minute}\\b`));
      expect(p.readLine.length).toBeLessThanOrEqual(145);
    }
  });

  it('draws the scene around each death: who came in, where the junglers were, what was up, whether a ward was down', () => {
    const by = (key: string) => map.pins.find((p) => p.key === key)!.scene;
    expect(by('d:4:ADC')).toEqual({
      could: ['ward', 'call'],
      killers: 2,
      executed: false,
      traded: 0,
      warded: false,
      ourJungler: { champion: 'Trundle', far: false },
      theirJungler: { close: true }
    });
    expect(by('d:9:Support')).toMatchObject({ killers: 3, ourJungler: { champion: 'Trundle', far: true } });
    expect(by('d:9:Support').theirJungler).toBeUndefined();
    expect(by('d:20:Support')).toEqual({ could: [], killers: 4, executed: false, traded: 1, warded: true, ourJungler: { champion: 'Trundle', far: false }, objective: { type: 'dragon', ours: false } });
    expect(by('d:7:ADC').objective).toEqual({ type: 'dragon', ours: true });
    // The jungler's own death has no jungler to have come.
    expect(by('d:24:Jungle').ourJungler).toBeUndefined();
    expect(by('d:24:Jungle').traded).toBe(1);
    // Their jungler is a champion in a seat off the analysed game, never a name; our jungler's zone rides along when the timeline has it.
    const enemies = [{ position: 'JUNGLE', champion: 'LeeSin' }, { position: 'BOTTOM', champion: 'Caitlyn' }];
    const placed = { ...timeline, deaths: timeline.deaths.map((d) => (d.sec === 252 ? { ...d, ourJungleZone: 'ourJungle', alliesNear: 1, theirJungleIn: true } : d)) } as MatchTimeline;
    const scene = buildFilm(review, { ...game, enemies } as AnalysisGame, placed, previous).map!.pins.find((p) => p.key === 'd:4:ADC')!.scene;
    expect(scene.ourJungler).toEqual({ champion: 'Trundle', zone: 'ourJungle', far: false });
    expect(scene.theirJungler).toEqual({ champion: 'LeeSin', close: true });
    expect(scene.alliesNear).toBe(1);
    const quiet = buildFilm(review, { ...game, enemies } as AnalysisGame, timeline, previous).map!.pins.find((p) => p.key === 'd:9:Support')!.scene;
    expect(quiet.theirJungler).toEqual({ champion: 'LeeSin', close: false });
    expect(JSON.stringify(buildFilm(review, { ...game, enemies } as AnalysisGame, timeline, previous).map)).not.toMatch(RIOT_TAG);
  });

  it('counts the reads, opens with them, and names the three costliest avoidable deaths', () => {
    expect(map.reads).toEqual({ avoidable: 4, traded: 1, bought: 1, clean: 0 });
    expect(map.opening).toBe('6 deaths: 4 avoidable, 1 traded, 1 bought an objective.');
    expect(map.costliest).toEqual(['d:9:Support', 'd:12:ADC', 'd:4:ADC']);
    // Without a curve to price them, the avoidable deaths with the most tags stand in.
    const unpriced = buildFilm(review, game, { ...timeline, goldDiff: [] } as MatchTimeline, previous).map!;
    expect(unpriced.pins.every((p) => p.cost === undefined)).toBe(true);
    expect(unpriced.costliest).toEqual(['d:4:ADC', 'd:9:Support', 'd:12:ADC']);
    // No avoidable death, nothing costliest, and the opening still counts.
    const clean = { ...timeline, facts: { ...timeline.facts!, ledger: [death(20, 'Support', [], 'Minute 20: Leona in a fight.', 'river', 'fight')] } } as MatchTimeline;
    const cleanMap = buildFilm(review, game, clean, previous).map!;
    expect(cleanMap.costliest).toEqual([]);
    expect(cleanMap.opening).toBe('1 death: 1 traded.');
    expect(cleanMap.reads).toEqual({ avoidable: 0, traded: 1, bought: 0, clean: 0 });
  });

  it('never names a death the gold rose after as one that cost most, though the tape still stops on every death', () => {
    // The same game won the other way round: every avoidable death is followed by a gain.
    const climb = GOLD_DIFF.map((g) => -g);
    const won = buildFilm({ ...review, matchId: 'EUW1_7000000003' } as GameReview, { ...game, win: true } as AnalysisGame, { ...timeline, matchId: 'EUW1_7000000003', goldDiff: climb } as MatchTimeline, previous);
    expect(won.map!.pins.filter((p) => p.read === 'avoidable').every((p) => (p.cost ?? 0) > 0)).toBe(true);
    expect(won.map!.costliest).toEqual([]);
    // The strip is about cost; the beats are about the deaths themselves (10 Sep 2026), so each still has its stop or its host.
    expect(won.tape!.beats.filter((b) => b.kind === 'death').map((b) => b.key)).toEqual(['d:4:ADC', 'd:9:Support', 'd:24:Jungle']);
    const covered = beatCoverage(won);
    for (const pin of won.map!.pins) expect(covered.has(pin.key)).toBe(true);
    // One dip among the gains: only that death is named, never padded with a plus.
    const dip = climb.slice();
    dip[14] = dip[12] - 200;
    const mixed = buildFilm(review, { ...game, win: true } as AnalysisGame, { ...timeline, goldDiff: dip } as MatchTimeline, previous).map!;
    expect(mixed.pins.find((p) => p.key === 'd:12:ADC')!.cost).toBe(-200);
    expect(mixed.costliest).toEqual(['d:12:ADC']);
    // Deaths the curve does not reach still stand in, but only those; a priced gain never does.
    const short = buildFilm(review, game, { ...timeline, goldDiff: climb.slice(0, 11) } as MatchTimeline, previous).map!;
    expect(short.pins.find((p) => p.key === 'd:4:ADC')!.cost).toBeGreaterThan(0);
    expect(short.costliest).toEqual(['d:9:Support', 'd:12:ADC', 'd:24:Jungle']);
  });

  it('keys a second death of one seat inside a minute on its own, and matches each ledger row to its own death', () => {
    // Jinx dies at 4:12 and again at 4:50 (a respawn under ten seconds, early): two rows, one minute, one seat.
    const twice = {
      ...timeline,
      deaths: [fell(252, 'ADC', 'bot'), fell(290, 'ADC', 'bot', { theirSide: true, killers: 1 }), ...timeline.deaths.slice(1)],
      facts: { ...timeline.facts!, ledger: [timeline.facts!.ledger![0], death(4, 'ADC', ['position'], 'Minute 4: Jinx alone on their side.'), ...timeline.facts!.ledger!.slice(1)] }
    } as MatchTimeline;
    const film = buildFilm(review, game, twice, previous);
    const pins = film.map!.pins.filter((p) => p.minute === 4);
    expect(pins.map((p) => [p.key, p.sec, p.could])).toEqual([
      ['d:4:ADC', 252, ['ward', 'call']],
      ['d:4:ADC:290', 290, ['position']]
    ]);
    expect(pins[0].x === pins[1].x && pins[0].y === pins[1].y).toBe(false);
    // The tape's tokens carry the same keys, so a tap on the second finds the second.
    const events = film.tape!.events.filter((e) => e.kind === 'ourDeath' && e.sec < 300);
    expect(events.map((e) => [e.key, e.sec])).toEqual([
      ['d:4:ADC', 252],
      ['d:4:ADC:290', 290]
    ]);
    // Every list that tracks by key is free of doubles: the map, each seat, the costliest strip and the beats.
    const keys = film.map!.pins.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    const adc = film.seats.find((s) => s.seat === 'ADC')!.pins!.map((p) => p.key);
    expect(new Set(adc).size).toBe(adc.length);
    expect(adc).toContain('d:4:ADC:290');
    expect(new Set(film.map!.costliest).size).toBe(film.map!.costliest.length);
    const beatKeys = film.tape!.beats.map((b) => b.key);
    expect(new Set(beatKeys).size).toBe(beatKeys.length);
  });

  it('hands each seat its own pins in time order, and none without a map', () => {
    const seats = new Map(film.seats.map((s) => [s.seat, s]));
    expect(seats.get('ADC')!.pins!.map((p) => p.key)).toEqual(['d:4:ADC', 'd:7:ADC', 'd:12:ADC']);
    expect(seats.get('Support')!.pins!.map((p) => p.key)).toEqual(['d:9:Support', 'd:20:Support']);
    expect(seats.get('Jungle')!.pins!.map((p) => p.key)).toEqual(['d:24:Jungle']);
    for (const s of film.seats) for (const p of s.pins!) expect(map.pins).toContain(p);
    const { ledger: _ledger, ledgerSummary: _summary, ...noLedger } = timeline.facts!;
    const bare = buildFilm(review, game, { ...timeline, facts: noLedger } as MatchTimeline, previous);
    expect(bare.seats.every((s) => s.pins === undefined)).toBe(true);
  });

  it('places a ledger row the timeline has no death for on its own', () => {
    const extra = { ...timeline, facts: { ...timeline.facts!, ledger: [...timeline.facts!.ledger!, death(30, 'Top', ['ward'], 'Minute 30: Ornn in the dark.', 'top')] } } as MatchTimeline;
    const pin = buildFilm(review, game, extra, previous).map!.pins.find((p) => p.key === 'd:30:Top')!;
    expect(pin.sec).toBe(1800);
    expect(pin.name).toBeUndefined();
    expect(regionFor('top', 'blue').inside(pin.x, pin.y)).toBe(true);
    expect(pin).toMatchObject(placeOurDeath('EUW1_7000000001', 'blue', { sec: 1800, seat: 'Top', zone: 'top' }, 0));
  });

  it('draws their deaths, the clusters and the summary, and asks nothing', () => {
    expect(map.theirs.map((t) => t.minute)).toEqual([6, 20, 25]);
    expect(map.theirs[0]).toMatchObject({ x: tape.events.find((e) => e.kind === 'theirDeath')!.x });
    expect(map.clusters).toHaveLength(1);
    expect(map.clusters[0]).toMatchObject({ ours: 3, theirs: 1, r: 6.2, line: 'Minutes 19 to 21: three of ours fell in the river for one of theirs.', seats: ['Support', 'ADC', 'Jungle'] });
    expect(regionFor('river', 'blue').inside(map.clusters[0].x, map.clusters[0].y)).toBe(true);
    expect(map.summary).toEqual({ deaths: 6, ganks: 3, dark: 3, inReach: 1, alone: 1 });
    expect((map as unknown as { darkCall?: unknown }).darkCall).toBeUndefined();
  });

  it('caps a cluster blob at seven', () => {
    const big = { ...timeline, facts: { ...timeline.facts!, deathClusters: [{ fromMinute: 30, toMinute: 32, zone: 'mid', ours: 5, theirs: 5, seats: ['Top'], line: 'Ten.' }] } } as MatchTimeline;
    expect(buildFilm(review, game, big, previous).map!.clusters[0].r).toBe(7);
  });

  it('is the same map and tape every time', () => {
    const again = buildFilm(review, game, timeline, previous, 'MOSS 2');
    expect(JSON.stringify(again.map)).toBe(JSON.stringify(map));
    expect(JSON.stringify(again.tape)).toBe(JSON.stringify(tape));
  });
});

describe('buildFilm on the replay tier', () => {
  const replay = { ...review, tier: 'endOfGame' } as GameReview;
  const film = buildFilm(replay, game, null, null);

  it('has no last time, no ledger on the seats, and says the loss from the game', () => {
    expect(film.title.lastTime).toBeUndefined();
    expect(film.seats.every((s) => s.deaths.length === 0)).toBe(true);
    expect(film.title.win).toBe(false);
    expect(film.title.protagonist.seat).toBe('ADC');
  });

  it('builds no map, no tape and so no beats, and no pins on the seats', () => {
    expect(film.map).toBeUndefined();
    expect(film.tape).toBeUndefined();
    expect(film.seats.every((s) => s.pins === undefined)).toBe(true);
    // A replay tier with a timeline lying around still shows the board.
    const stray = buildFilm(replay, game, timeline, null);
    expect(stray.tape).toBeUndefined();
    expect(stray.map).toBeUndefined();
    expect(stray.chapters.map((c) => c.kind)).toEqual(['title', 'board', 'one-thing', 'seat', 'card']);
  });
});

describe('the draft, again', () => {
  const enemies = [
    { position: 'UTILITY', champion: 'Lulu' },
    { position: 'TOP', champion: 'Aatrox' },
    { position: 'JUNGLE', champion: 'LeeSin' },
    { position: 'BOTTOM', champion: 'Caitlyn' },
    { position: 'MIDDLE', champion: 'Syndra' }
  ];
  const draft = {
    verdict: 'The comp wanted a slow game and the fights came early.',
    swaps: [
      { seat: 'Support', out: 'Leona', in: 'Nautilus', why: 'Peel for Jinx instead of an engage she could not follow.', gains: ['peel', 'pick'] },
      { seat: 'Jungle', out: 'Trundle', in: 'Sejuani', why: 'A frontline that starts the fight.', gains: ['frontline', 'engage', 'disengage', 'damage'] }
    ]
  };
  const v5 = { ...review, reviewVersion: 5, team: { ...review.team, draft } } as unknown as GameReview;
  const film = buildFilm(v5, { ...game, enemies } as AnalysisGame, timeline, previous, 'MOSS 2');

  it('adds the draft chapter right after the one thing, on the timeline tier and on a replay', () => {
    expect(film.chapters.map((c) => c.kind)).toEqual(['title', 'tape', 'map', 'one-thing', 'draft', 'seat', 'card']);
    expect(film.chapters[4].title).toBe('The draft, again');
    expect(film.chapters).toHaveLength(FILM_CHAPTER_COUNT);
    const replay = buildFilm({ ...v5, tier: 'endOfGame' } as GameReview, game, null, null);
    expect(replay.chapters.map((c) => c.kind)).toEqual(['title', 'board', 'one-thing', 'draft', 'seat', 'card']);
    expect(replay.draft).toBeDefined();
  });

  it('lists our five with their names and theirs as champions in seats only, both in lane order', () => {
    expect(film.draft!.ours).toEqual([
      { seat: 'Jungle', champion: 'Trundle', name: 'Go10x' },
      { seat: 'ADC', champion: 'Jinx', name: 'Rhu' },
      { seat: 'Support', champion: 'Leona', name: 'Nia' }
    ]);
    expect(film.draft!.theirs).toEqual([
      { seat: 'Top', champion: 'Aatrox' },
      { seat: 'Jungle', champion: 'LeeSin' },
      { seat: 'Mid', champion: 'Syndra' },
      { seat: 'ADC', champion: 'Caitlyn' },
      { seat: 'Support', champion: 'Lulu' }
    ]);
    expect(film.draft!.theirs.every((t) => t.name === undefined)).toBe(true);
    expect(JSON.stringify(film.draft)).not.toMatch(RIOT_TAG);
    // Without the analysed game's enemies their side stays empty rather than guessed.
    expect(buildFilm(v5, game, timeline, previous).draft!.theirs).toEqual([]);
    expect(buildFilm(v5, undefined, timeline, previous).draft!.theirs).toEqual([]);
  });

  it('carries the verdict, the swaps with their glyphs capped at three, the comp, and a variant name off the first swap', () => {
    expect(film.draft!.verdict).toBe('The comp wanted a slow game and the fights came early.');
    expect(film.draft!.swaps).toEqual([
      { seat: 'Support', out: 'Leona', in: 'Nautilus', why: 'Peel for Jinx instead of an engage she could not follow.', gains: ['peel', 'pick'], glyphs: ['shield', 'hook'] },
      { seat: 'Jungle', out: 'Trundle', in: 'Sejuani', why: 'A frontline that starts the fight.', gains: ['frontline', 'engage', 'disengage'], glyphs: ['wall', 'fist', 'wind'] }
    ]);
    expect(film.draft!.compId).toBeNull();
    expect(film.draft!.compName).toBe('Front to back');
    expect(film.draft!.variantName).toBe('Front to back · Nautilus');
    // Off the books, the protagonist's champion names the comp.
    const loose = buildFilm({ ...v5, compName: null } as GameReview, game, timeline, previous).draft!;
    expect(loose.variantName).toBe('Jinx comp · Nautilus');
    // A swap with no gains wears the swap glyph; no swaps, no variant.
    const bare = buildFilm({ ...v5, team: { ...v5.team, draft: { verdict: 'It held.', swaps: [{ seat: 'Top', out: 'Ornn', in: 'Malphite', why: 'The all-in.', gains: [] }] } } } as unknown as GameReview, game, timeline, previous).draft!;
    expect(bare.swaps[0].glyphs).toEqual(['swap']);
    expect(bare.variantName).toBe('Front to back · Malphite');
    const held = buildFilm({ ...v5, team: { ...v5.team, draft: { verdict: 'It held.', swaps: [] } } } as unknown as GameReview, game, timeline, previous).draft!;
    expect(held.swaps).toEqual([]);
    expect(held.variantName).toBeNull();
  });

  it('carries the second options under each swap and what the comp lacked as chips off a version 6 review, capped, and none off a version 5 one', () => {
    const v6 = {
      ...v5,
      reviewVersion: 6,
      team: {
        ...v5.team,
        draft: {
          ...draft,
          swaps: [
            { ...draft.swaps[0], alternatives: ['Braum', 'Alistar'] },
            // Trimmed; the swap's own champion and the one we played are not alternatives to it; two at most.
            { ...draft.swaps[1], alternatives: [' Zac ', 'Sejuani', 'Trundle', 'Maokai', 'Amumu'] },
            { seat: 'Mid', out: 'Ahri', in: 'Orianna', why: 'Wave clear and a fight she can start.', gains: ['waveclear'], alternatives: [] },
            { seat: 'Top', out: 'Ornn', in: 'Malphite', why: 'One too many.', gains: [] }
          ],
          lacked: [
            { gain: 'frontline', why: 'Nobody could start a fight.' },
            { gain: 'waveclear', why: 'Every wave crashed under our towers.' },
            { gain: 'frontline', why: 'Said twice.' },
            { gain: 'nonsense', why: 'Not a gain the film knows.' },
            { gain: 'peel', why: ' Jinx had none. ' },
            { gain: 'poke', why: 'One too many.' }
          ]
        }
      }
    } as unknown as GameReview;
    const d = buildFilm(v6, { ...game, enemies } as AnalysisGame, timeline, previous).draft!;
    expect(d.swaps).toHaveLength(3);
    expect(d.swaps.map((s) => [s.in, s.alternatives])).toEqual([
      ['Nautilus', ['Braum', 'Alistar']],
      ['Sejuani', ['Zac', 'Maokai']],
      ['Orianna', undefined]
    ]);
    expect(d.swaps[2]).toEqual({ seat: 'Mid', out: 'Ahri', in: 'Orianna', why: 'Wave clear and a fight she can start.', gains: ['waveclear'], glyphs: ['wave'] });
    expect(d.lacked).toEqual([
      { gain: 'frontline', glyph: 'wall', why: 'Nobody could start a fight.' },
      { gain: 'waveclear', glyph: 'wave', why: 'Every wave crashed under our towers.' },
      { gain: 'peel', glyph: 'shield', why: 'Jinx had none.' }
    ]);
    expect(d.variantName).toBe('Front to back · Nautilus');
    expect(JSON.stringify(d)).not.toMatch(RIOT_TAG);
    // A version 5 review carries neither, so the chapter shows the swaps alone; an empty list is the same as none.
    expect(film.draft!.lacked).toBeUndefined();
    expect(film.draft!.swaps.every((s) => !('alternatives' in s))).toBe(true);
    const empty = buildFilm({ ...v5, team: { ...v5.team, draft: { ...draft, lacked: [], swaps: [{ ...draft.swaps[0], alternatives: ['Nautilus', 'Leona', ''] }] } } } as unknown as GameReview, game, timeline, previous).draft!;
    expect(empty.lacked).toBeUndefined();
    expect('alternatives' in empty.swaps[0]).toBe(false);
  });

  it('builds no draft, and no chapter, for a review without a verdict', () => {
    expect(buildFilm(review, game, timeline, previous).draft).toBeUndefined();
    const blank = buildFilm({ ...v5, team: { ...v5.team, draft: { verdict: '  ', swaps: draft.swaps } } } as unknown as GameReview, game, timeline, previous);
    expect(blank.draft).toBeUndefined();
    expect(blank.chapters.map((c) => c.kind)).toEqual(['title', 'tape', 'map', 'one-thing', 'seat', 'card']);
  });

  it('keeps the recurrence off when the previous theme has no ledger tag, or this game has no ledger', () => {
    const macro = { review: { ...previous.review, team: { ...previous.review.team, workOn: [point('Group before objectives, so call the rotation early.', 'macro')] } } as GameReview };
    expect(buildFilm(review, game, timeline, macro).title.lastTime?.recurrence).toBe('This game: 2 deaths their jungler was already close for');
    expect(buildFilm(review, game, null, macro).title.lastTime).toEqual({ matchId: 'EUW1_6999999999', text: 'Call the rotation early.' });
    const lanes = { review: { ...previous.review, team: { ...previous.review.team, workOn: [point('Hold the wave.', 'lanes')] } } as GameReview };
    expect(buildFilm(review, game, timeline, lanes).title.lastTime).toEqual({ matchId: 'EUW1_6999999999', text: 'Hold the wave.' });
  });
});

describe('buildFilm with little to go on', () => {
  const bare = { ...review, team: { ...review.team, headline: undefined, workOn: [], keepDoing: [], compWhy: '', moments: [] }, players: [] } as unknown as GameReview;
  const film = buildFilm(bare, undefined, null, null);

  it('titles from the summary, calls nothing on the title, and commits to nothing', () => {
    expect(film.chapters.map((c) => c.kind)).toEqual(['title', 'one-thing', 'seat', 'card']);
    expect(film.board).toEqual({ tallies: [], call: null, moments: [] });
    expect(film.title.headline).toBe('The team matched on CS but gave up the fights.');
    expect(film.title.call).toBeUndefined();
    expect(film.title.win).toBe(false);
    expect(film.title.protagonist).toEqual({ seat: 'Mid', champion: '', name: undefined });
    expect(film.title.lowerThird.date).toBe(Date.parse('2026-09-09T20:00:00.000Z'));
    expect(film.oneThing.point.text).toBe('');
    expect(film.oneThing.options).toBeUndefined();
    expect(film.oneThing.rest).toEqual([]);
    expect(film.card.oneThing).toBe('');
    expect(film.card.keepDoing).toBeUndefined();
  });
});

describe('splitOptions', () => {
  it('splits either/or and ", or", and refuses a clause too short or too long', () => {
    expect(splitOptions('Eight deaths; either play safer trades before towers fall or ask for jungle pressure earlier.')).toEqual(['Play safer trades before towers fall', 'Ask for jungle pressure earlier']);
    expect(splitOptions('First tower went early, so next time play the first ten minutes for level, or send the jungler top.')).toEqual(['Play the first ten minutes for level', 'Send the jungler top']);
    expect(splitOptions('Bot fed; either ward or die.')).toBeUndefined();
    expect(splitOptions('Trade the third grub for dragon tempo.')).toBeUndefined();
    expect(splitOptions('')).toBeUndefined();
  });

  it('never splits a ", or" that sits before the "; " or ", so" boundary: that one is part of the fact', () => {
    expect(splitOptions('We took no plates, or dragons, so next time rotate bot.')).toBeUndefined();
    expect(splitOptions('We took no plates, or dragons; next time rotate bot as five.')).toBeUndefined();
    expect(splitOptions('Rotate bot as five after the first back, or send the jungler top for the plates.')).toEqual(['Rotate bot as five after the first back', 'Send the jungler top for the plates']);
  });
});

describe('every option is safe to show', () => {
  it('never carries a Riot tag, on either tier', () => {
    const films = [buildFilm(review, game, timeline, previous), buildFilm({ ...review, tier: 'endOfGame' } as GameReview, game, null, null)];
    for (const film of films) {
      const calls = [film.title.call].filter(Boolean);
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) for (const o of c!.options) expect(o).not.toMatch(RIOT_TAG);
      for (const a of film.card.asks) expect(a.name).not.toMatch(RIOT_TAG);
    }
  });
});
