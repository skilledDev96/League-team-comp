import { describe, expect, it } from 'vitest';
import { AnalysisGame, GameReview, MatchTimeline, TeamObjectives } from '../models/team.models';
import { buildFilm, splitOptions } from './film-build';

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
    compWhy: 'The comp wanted a slow game and the fights came early.'
  },
  players: [
    { name: 'Rhu', seat: 'ADC', champion: 'Jinx', strength: point('Farmed 312.'), workOn: point('Died early, so hold the wave under tower.'), more: [point('Ward the river bush.', 'vision')] },
    { name: 'Go10x', seat: 'Jungle', champion: 'Trundle', strength: point('Grubs went 4-0.'), workOn: point('Path bot after the first clear.') },
    { name: 'Nia', seat: 'Support', champion: 'Leona', strength: point('Vision score 61.'), workOn: point('Engage only with Jinx in range.') }
  ],
  usage: { team: { input: 0, cachedInput: 0, output: 0 }, players: { input: 0, cachedInput: 0, output: 0 }, costUsd: 0, tookMs: 0 }
} as unknown as GameReview;

const death = (minute: number, seat: string, could: string[], line: string) => ({ minute, seat, zone: 'bot', how: 'gank', could, line });

const timeline = {
  matchId: 'EUW1_7000000001',
  timelineVersion: 2,
  builtAt: '2026-09-09T06:30:00.000Z',
  ourSide: 'blue',
  durationSec: 34 * 60 + 13,
  frameSec: 60,
  goldDiff: [],
  curve: { leadAt: {}, biggestLead: { gold: 400, minute: 4 }, biggestDeficit: { gold: -9000, minute: 30 } },
  lanes: [],
  firsts: { tower: { minute: 9, side: 'them', lane: 'bot' } },
  objectives: [
    { minute: 6, type: 'grubs', side: 'us', ourInvolved: ['Jungle'], ourNear: ['Jungle'] },
    { minute: 8, type: 'dragon', side: 'us', ourInvolved: ['Jungle', 'ADC'], ourNear: ['Jungle', 'ADC', 'Support'] }
  ],
  plates: { ours: { top: 0, mid: 0, bot: 0 }, theirs: { top: 0, mid: 0, bot: 0 } },
  deaths: [],
  theirDeaths: [],
  vision: [],
  spend: [],
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
    firsts: { tower: { minute: 9, side: 'them', lane: 'bot' } },
    objectives: [],
    deathClusters: [],
    soloDeaths: [],
    vision: [],
    spend: [],
    ledger: [
      death(4, 'ADC', ['ward', 'call'], 'Minute 4: Jinx to a gank in bot lane with no ward nearby.'),
      death(7, 'ADC', ['ward'], 'Minute 7: Jinx to a gank in bot lane with no ward nearby.'),
      death(9, 'Support', ['ward', 'jungle'], 'Minute 9: Leona in bot lane with no ward nearby.'),
      death(12, 'ADC', ['call'], 'Minute 12: Jinx, their jungler was already close.'),
      death(20, 'Support', [], 'Minute 20: Leona in a fight.'),
      death(24, 'Jungle', ['position'], 'Minute 24: Trundle alone on their side.')
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

  it('lists the four chapters in order and seeds by the match id', () => {
    expect(film.chapters.map((c) => c.kind)).toEqual(['title', 'one-thing', 'seat', 'card']);
    expect(film.seed).toBe(360062704);
    expect(film.tier).toBe('timeline');
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
  const bare = { ...review, team: { ...review.team, headline: undefined, workOn: [], keepDoing: [], compWhy: '' }, players: [] } as unknown as GameReview;
  const film = buildFilm(bare, undefined, null, null);

  it('titles from the summary, calls nothing on the title, and commits to nothing', () => {
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
