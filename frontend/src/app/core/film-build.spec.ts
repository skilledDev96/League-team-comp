import { describe, expect, it } from 'vitest';
import { AnalysisGame, GameReview, MatchTimeline, TeamObjectives, TimelineDeath } from '../models/team.models';
import { buildFilm, placeOurDeath, reelTallyOf, splitOptions, tapeEventsOf } from './film-build';
import { objectivePit, regionFor } from './rift-zones';
import { pick } from './seed';

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
    { sec: 1500, minute: 25, zone: 'mid' }
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

describe('buildFilm on the timeline tier', () => {
  const film = buildFilm(review, game, timeline, previous, 'MOSS 2');

  it('lists the six chapters in order, the tape before the map under eight deaths, and seeds by the match id', () => {
    expect(film.chapters.map((c) => c.kind)).toEqual(['title', 'tape', 'map', 'one-thing', 'seat', 'card']);
    expect(film.chapters.map((c) => c.title)).toEqual(['The game', 'The tape', 'The map', 'The one thing', 'Your seat', 'The card']);
    expect(film.seed).toBe(360062704);
    expect(film.tier).toBe('timeline');
    expect(film.board).toBeUndefined();
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

  it('turns on the worst deficit on a loss, the biggest lead on a win, the earliest lane flip on a swing', () => {
    expect(tape.turn).toEqual({ minute: 30, why: 'The worst of it: 9k down around minute 30' });
    const won = buildFilm(review, { ...game, win: true }, timeline, previous).tape!;
    expect(won.turn).toEqual({ minute: 4, why: 'The best of it: 400 up around minute 4' });
    const swung = buildFilm(review, game, { ...timeline, facts: { ...timeline.facts!, curve: { shape: 'swung' } } } as MatchTimeline, previous).tape!;
    expect(swung.turn?.minute).toBe(11);
    expect(swung.turn?.why).toContain('ADC');
    const flat = buildFilm(review, game, { ...timeline, curve: { ...timeline.curve, biggestDeficit: { gold: 0, minute: 0 } } } as MatchTimeline, previous).tape!;
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

  it('calls the first four objectives and the fight cluster a minute early, in time order, with the answers; a cluster reveals on its first death', () => {
    expect(tape.calls.map((c) => [c.key, c.atSec, c.revealSec, c.answer])).toEqual([
      ['tape:o:6', 300, 360, 0],
      ['tape:o:8', 420, 480, 0],
      ['tape:f:19', 1080, 1210, 2],
      ['tape:o:20', 1140, 1200, 1],
      ['tape:o:27', 1560, 1620, 1]
    ]);
    expect(tape.calls[0].question).toBe('Whose grubs is this?');
    expect(tape.calls[0].options).toEqual(['Ours', 'Theirs']);
    expect(tape.calls[2].question).toBe('How many of ours fall here?');
    expect(tape.calls[2].options).toEqual(['1', '2', '3 or more']);
    expect(tape.calls[2].why).toBe('Minutes 19 to 21: three of ours fell in the river for one of theirs.');
    expect(tape.calls[3].why).toBe('Minute 20: their dragon (infernal), uncontested.');
    expect(tape.calls[4].why).toBe('Their baron at minute 27');
  });

  it('never calls more than six, and skips a cluster with one of ours', () => {
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
    const calls = buildFilm(review, game, busy, previous).tape!.calls;
    expect(calls).toHaveLength(6);
    expect(calls.map((c) => c.key)).toEqual(['tape:o:6', 'tape:o:8', 'tape:f:19', 'tape:o:20', 'tape:f:23', 'tape:o:27']);
    expect(calls[4].answer).toBe(1);
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

  it('walks the pins in the order the seed chose', () => {
    expect(map.order).toBe(pick(film.seed, ['chronological', 'worst-first'], 'map-order'));
    const minutes = map.pins.map((p) => p.minute);
    if (map.order === 'chronological') {
      expect(minutes).toEqual([4, 7, 9, 12, 20, 24]);
    } else {
      expect(minutes).toEqual([4, 9, 7, 12, 20, 24]);
    }
    // The other order on another match id.
    const otherOrder = buildFilm({ ...review, matchId: 'EUW1_7000000002' } as GameReview, game, { ...timeline, matchId: 'EUW1_7000000002' } as MatchTimeline, previous).map!.order;
    expect(['chronological', 'worst-first']).toContain(otherOrder);
  });

  it('places a ledger row the timeline has no death for on its own', () => {
    const extra = { ...timeline, facts: { ...timeline.facts!, ledger: [...timeline.facts!.ledger!, death(30, 'Top', ['ward'], 'Minute 30: Ornn in the dark.', 'top')] } } as MatchTimeline;
    const pin = buildFilm(review, game, extra, previous).map!.pins.find((p) => p.key === 'd:30:Top')!;
    expect(pin.sec).toBe(1800);
    expect(pin.name).toBeUndefined();
    expect(regionFor('top', 'blue').inside(pin.x, pin.y)).toBe(true);
    expect(pin).toMatchObject(placeOurDeath('EUW1_7000000001', 'blue', { sec: 1800, seat: 'Top', zone: 'top' }, 0));
  });

  it('draws their deaths, the clusters, the summary and the dark call', () => {
    expect(map.theirs.map((t) => t.minute)).toEqual([6, 20, 25]);
    expect(map.theirs[0]).toMatchObject({ x: tape.events.find((e) => e.kind === 'theirDeath')!.x });
    expect(map.clusters).toHaveLength(1);
    expect(map.clusters[0]).toMatchObject({ ours: 3, theirs: 1, r: 10, line: 'Minutes 19 to 21: three of ours fell in the river for one of theirs.' });
    expect(regionFor('river', 'blue').inside(map.clusters[0].x, map.clusters[0].y)).toBe(true);
    expect(map.summary).toEqual({ deaths: 6, ganks: 3, dark: 3, inReach: 1, alone: 1 });
    expect(map.darkCall).toEqual({ answer: 3, max: 6 });
  });

  it('caps a cluster blob at twelve', () => {
    const big = { ...timeline, facts: { ...timeline.facts!, deathClusters: [{ fromMinute: 30, toMinute: 32, zone: 'mid', ours: 5, theirs: 5, seats: ['Top'], line: 'Ten.' }] } } as MatchTimeline;
    expect(buildFilm(review, game, big, previous).map!.clusters[0].r).toBe(12);
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
