import { describe, expect, it } from 'vitest';
import { MatchTimeline, TimelineObjective } from '../models/team.models';
import { MvpGame } from './game-mvp';
import { influenceOf, INFLUENCE_MINUTES, INFLUENCE_NO_TIMELINE, INFLUENCE_NOTHING, INFLUENCE_TIP, InfluenceTimeline, swingText } from './influence';

const ours = (sec: number, seat: string) => ({ sec, minute: Math.floor(sec / 60), seat, zone: 'mid', theirSide: false, killers: 2, executed: false, warded: false }) as MatchTimeline['deaths'][number];

const theirs = (sec: number, ourInvolved: string[]) => ({ sec, minute: Math.floor(sec / 60), zone: 'mid', ourInvolved }) as MatchTimeline['theirDeaths'][number];

const objective = (minute: number, type: TimelineObjective['type'], subType?: string): TimelineObjective =>
  ({ minute, type, side: 'us', ourInvolved: [], ourNear: [], ...(subType && { subType }) }) as TimelineObjective;

/**
 * A minute a figure, ours minus theirs: level to eleven, a thousand up by
 * twelve, then four thousand more the minute after the herald at twenty. The
 * curve stops at twenty-four, so an event at twenty-four has no two minutes
 * after it.
 */
const GOLD = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 500, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 5100, 5100, 5100, 5100];

const TIMELINE: InfluenceTimeline = {
  goldDiff: GOLD,
  // The mid and the support were on the kill at ten; the jungler on the one at twenty, which was the herald fight; the jungler died at thirteen for nothing; the ADC died at twenty-four, past the curve.
  theirDeaths: [theirs(600, ['Mid', 'Support']), theirs(1200, ['Jungle'])],
  deaths: [ours(780, 'Jungle'), ours(1440, 'ADC')],
  objectives: [objective(20, 'herald')]
};

const GAME: MvpGame = {
  players: [
    { position: 'TOP', champion: 'Ornn', name: 'Bom', kills: 1, deaths: 2, assists: 3 },
    { position: 'JUNGLE', champion: 'Vi', name: 'Go10x', kills: 4, deaths: 1, assists: 5 },
    { position: 'MIDDLE', champion: 'Ahri', name: 'Kez', kills: 3, deaths: 2, assists: 4 },
    { position: 'BOTTOM', champion: 'Jinx', name: 'Rhu', kills: 5, deaths: 3, assists: 2 },
    { position: 'UTILITY', champion: 'Leona', name: 'Sen', kills: 0, deaths: 4, assists: 8 }
  ]
};

describe('influenceOf', () => {
  it('sums the swing over the two minutes after every kill they were in on and every death of theirs, most first', () => {
    const rows = influenceOf(GAME, TIMELINE);
    expect(rows.map((r) => [r.seat, r.swing])).toEqual([
      ['Jungle', 4100],
      ['Mid', 1000],
      ['Support', 1000],
      ['ADC', 0]
    ]);
    // The window is the map's own: gold at the minute plus two, minus gold at the minute.
    expect(INFLUENCE_MINUTES).toBe(2);
    const jungle = rows[0];
    expect(jungle.kills).toBe(1);
    expect(jungle.deaths).toBe(1);
    expect(jungle.unpriced).toBe(0);
  });

  it("writes the lead's sentence for the one who swung it most, and names the biggest by what it was about", () => {
    const [jungle, mid] = influenceOf(GAME, TIMELINE);
    expect(jungle.best).toEqual({ minute: 20, swing: 4100, what: 'the herald' });
    // The biggest carries its own figure and its sign, so a baron that lost the game cannot read like one that won it.
    expect(jungle.line).toBe('Vi swung the game most: +4.1k across the fights they were in, and the biggest was +4.1k on the herald at 20 min.');
    expect(jungle.terms).toEqual(['+4.1k across the fights they were in', 'the biggest was +4.1k on the herald at 20 min']);
    // Everyone under the first is named and read off, with no verb, and a fight with no objective near it is just a kill.
    expect(mid.best).toEqual({ minute: 10, swing: 1000, what: 'a kill' });
    expect(mid.line).toBe('Ahri: +1.0k across the fights they were in, and the biggest was +1.0k on a kill at 10 min.');
  });

  it('says what the curve does not reach rather than counting it as nothing', () => {
    const adc = influenceOf(GAME, TIMELINE)[3];
    expect(adc.unpriced).toBe(1);
    expect(adc.deaths).toBe(0);
    expect(adc.terms).toEqual(['even across the fights they were in', 'the curve stops before 1 more']);
    expect(adc.line).toBe('Jinx: even across the fights they were in, and the curve stops before 1 more.');
  });

  it('leaves out a seat the timeline never saw in a fight, rather than showing it at nothing', () => {
    expect(influenceOf(GAME, TIMELINE).map((r) => r.seat)).not.toContain('Top');
  });

  it('adds a death as its own swing: negative when it cost us, positive when it bought something', () => {
    const cost: InfluenceTimeline = { goldDiff: [0, 0, 0, 0, 0, -2000, -2000, -2000], deaths: [ours(180, 'Top')], theirDeaths: [], objectives: [] };
    const [top] = influenceOf(GAME, cost);
    expect(top.swing).toBe(-2000);
    expect(top.deaths).toBe(1);
    expect(top.line).toBe('Ornn swung the game most: -2.0k across the fights they were in, and the biggest was -2.0k on a death at 3 min.');

    const bought: InfluenceTimeline = {
      goldDiff: [0, 0, 0, 0, 0, 1800, 1800, 1800],
      deaths: [ours(180, 'Top')],
      theirDeaths: [],
      objectives: [objective(3, 'dragon', 'infernal')]
    };
    const [traded] = influenceOf(GAME, bought);
    expect(traded.swing).toBe(1800);
    expect(traded.best?.what).toBe('the infernal dragon');
  });

  it('is absent without a timeline, and says so rather than guessing', () => {
    expect(influenceOf(GAME, null)).toEqual([]);
    expect(influenceOf(GAME, undefined)).toEqual([]);
    expect(INFLUENCE_NO_TIMELINE).toBe('Who swung it most needs the timeline, and this game has none.');
    // A timeline with nothing in it to price is a different sentence: saying the game has no timeline would be false.
    expect(influenceOf(GAME, { goldDiff: GOLD, deaths: [], theirDeaths: [], objectives: [] })).toEqual([]);
    expect(INFLUENCE_NOTHING).not.toBe(INFLUENCE_NO_TIMELINE);
    // Every surface closes with what a minute's resolution cannot see.
    expect(INFLUENCE_TIP).toContain('a minute at a time');
  });

  it('falls back to the seat when no game names the champion in it', () => {
    const [jungle] = influenceOf(undefined, TIMELINE);
    expect(jungle.champion).toBeUndefined();
    expect(jungle.name).toBeUndefined();
    expect(jungle.line).toBe('Jungle swung the game most: +4.1k across the fights they were in, and the biggest was +4.1k on the herald at 20 min.');
  });

  it('counts one seat once per kill it was in on, and prices the minute those kills fell in once', () => {
    // Two of ours on the same kill each carry the kill; the same seat on two kills in the same minute counts both
    // kills and the minute's gold once, because the curve moved once (11 Sep 2026, second fix pass).
    const twice: InfluenceTimeline = { goldDiff: GOLD, theirDeaths: [theirs(600, ['Mid']), theirs(610, ['Mid'])], deaths: [], objectives: [] };
    const [mid] = influenceOf(GAME, twice);
    expect(mid.kills).toBe(2);
    expect(mid.swing).toBe(1000);
    // Two minutes apart is two windows, and then both are added.
    const apart: InfluenceTimeline = { goldDiff: GOLD, theirDeaths: [theirs(600, ['Mid']), theirs(660, ['Mid'])], deaths: [], objectives: [] };
    expect(influenceOf(GAME, apart)[0].swing).toBe(1000 + 500);
  });

  it('prices an ace once, whoever was in on how much of it, and still counts the kills and the death', () => {
    // The lead's own case: one fight at minute 10, our ADC in on all five kills and dying in it. The two minutes after
    // moved 1.0k; the seat carries 1.0k, not five times over, and the sentence is a figure that can be checked on the curve.
    const ace: InfluenceTimeline = {
      goldDiff: GOLD,
      theirDeaths: [600, 604, 608, 612, 616].map((sec) => theirs(sec, ['ADC'])),
      deaths: [ours(610, 'ADC')],
      objectives: []
    };
    const [adc] = influenceOf(GAME, ace);
    expect(adc.kills).toBe(5);
    expect(adc.deaths).toBe(1);
    expect(adc.swing).toBe(1000);
    expect(adc.terms[0]).toBe('+1.0k across the fights they were in');
  });

  it('ranks by the size of the swing either way, so a game we lost names the seat it moved most around', () => {
    // Every window negative: the old signed sort put the seat that lost the least on top and called it the most influential.
    const lost: InfluenceTimeline = {
      goldDiff: [0, 0, 0, -3000, -3000, -3500, -3500, -3500],
      deaths: [ours(60, 'Top'), ours(180, 'Mid')],
      theirDeaths: [],
      objectives: []
    };
    const rows = influenceOf(GAME, lost);
    expect(rows.map((r) => [r.seat, r.swing])).toEqual([
      ['Top', -3000],
      ['Mid', -500]
    ]);
    expect(rows[0].line).toBe('Ornn swung the game most: -3.0k across the fights they were in, and the biggest was -3.0k on a death at 1 min.');
  });
});

describe('swingText', () => {
  it('signs every figure and says even for a minute that came out level', () => {
    expect(swingText(4100)).toBe('+4.1k');
    expect(swingText(-2400)).toBe('-2.4k');
    expect(swingText(800)).toBe('+800');
    expect(swingText(-40)).toBe('-40');
    expect(swingText(0)).toBe('even');
  });
});
