import { describe, expect, it } from 'vitest';
import { DeathVerdict, MatchTimeline, TimelineDeath, TimelineObjective } from '../models/team.models';
import { COST_MINUTES, couldGlyphs, DEATH_READS, OBJECTIVE_WINDOW_SEC, OBJECTIVE_ZONES, readCounts, readDeath, readsLine, TRADE_WINDOW_SEC } from './death-reads';

type Slice = Pick<MatchTimeline, 'deaths' | 'theirDeaths' | 'objectives' | 'goldDiff'>;

const row = (minute: number, seat: string, could: string[], how = 'gank', zone = 'bot'): DeathVerdict => ({ minute, seat, zone, how, could, line: `Around minute ${minute}: someone died.` }) as DeathVerdict;

const fell = (sec: number, seat: string, extra: Partial<TimelineDeath> = {}): TimelineDeath =>
  ({ sec, minute: Math.floor(sec / 60), seat, zone: 'bot', theirSide: false, killers: 2, executed: false, warded: false, ...extra }) as TimelineDeath;

const theirs = (sec: number, zone: MatchTimeline['theirDeaths'][number]['zone'] = 'bot', ourInvolved?: string[]) =>
  ({ sec, minute: Math.floor(sec / 60), zone, ...(ourInvolved && { ourInvolved }) }) as MatchTimeline['theirDeaths'][number];

const objective = (minute: number, side: 'us' | 'them', type: TimelineObjective['type'] = 'dragon', subType?: string, involved: string[] = []): TimelineObjective =>
  ({ minute, type, side, ourInvolved: involved, ourNear: [], ...(subType && { subType }) }) as TimelineObjective;

/** A minute a figure, ours minus theirs, for thirty minutes: down 300 a minute from minute five. */
const GOLD = Array.from({ length: 31 }, (_, m) => (m < 5 ? 0 : -(m - 4) * 300));

const slice = (o: Partial<Slice> = {}): Slice => ({ deaths: [], theirDeaths: [], objectives: [], goldDiff: GOLD, ...o });

describe('readDeath', () => {
  it('reads a death with a tag as avoidable, led by the word, without the name or the minute', () => {
    const read = readDeath(row(12, 'ADC', ['call']), slice({ deaths: [fell(730, 'ADC', { killers: 1 })] }));
    expect(read.kind).toBe('avoidable');
    expect(read.line).toBe('Avoidable: their jungler had been on this side a minute earlier.');
    expect(read.glyphs).toEqual(['horn']);
    expect(read.traded).toBe(0);
    expect(read.objective).toBeUndefined();
    expect(read.line).not.toMatch(/12|ADC/);
  });

  it('puts every tag in words, one, two and three, in the ledger\'s order', () => {
    const tl = slice();
    expect(readDeath(row(6, 'Top', ['ward']), tl).line).toBe('Avoidable: no ward had gone down nearby.');
    expect(readDeath(row(6, 'Top', ['jungle']), tl).line).toBe('Avoidable: our jungler was about a screen away.');
    expect(readDeath(row(6, 'Top', ['position']), tl).line).toBe('Avoidable: alone on their side of the map.');
    expect(readDeath(row(6, 'Top', ['jungle', 'position']), tl).line).toBe('Avoidable: our jungler was about a screen away, and alone on their side of the map.');
    expect(readDeath(row(6, 'Top', ['jungle', 'ward', 'call']), tl).line).toBe(
      'Avoidable: our jungler was about a screen away, no ward had gone down nearby, and their jungler had been on this side a minute earlier.'
    );
    expect(readDeath(row(6, 'Top', ['jungle', 'ward', 'call']), tl).glyphs).toEqual(['jungler-far', 'ward-off', 'horn']);
  });

  it('leads with how many came in when the timeline knows and a ward is among at most two tags', () => {
    const two = slice({ deaths: [fell(252, 'ADC')] });
    expect(readDeath(row(4, 'ADC', ['ward']), two).line).toBe('Avoidable: two came in and no ward had gone down nearby.');
    expect(readDeath(row(4, 'ADC', ['ward', 'call']), two).line).toBe('Avoidable: two came in and no ward had gone down nearby, and their jungler had been on this side a minute earlier.');
    // The ward clause leads even when the ledger listed the jungler first, so the count opens the sentence.
    expect(readDeath(row(4, 'ADC', ['jungle', 'ward']), slice({ deaths: [fell(252, 'ADC', { killers: 3 })] })).line).toBe(
      'Avoidable: three came in and no ward had gone down nearby, and our jungler was about a screen away.'
    );
    // Three tags have no room for the count; one killer is not a "came in"; no timeline row, no count.
    expect(readDeath(row(4, 'ADC', ['jungle', 'ward', 'call']), two).line).not.toContain('came in');
    expect(readDeath(row(4, 'ADC', ['ward']), slice({ deaths: [fell(252, 'ADC', { killers: 1 })] })).line).toBe('Avoidable: no ward had gone down nearby.');
    expect(readDeath(row(4, 'ADC', ['ward']), slice()).line).toBe('Avoidable: no ward had gone down nearby.');
    // Four tags name three, so the line stays near 140 characters, and the glyphs agree.
    const four = readDeath(row(4, 'ADC', ['jungle', 'ward', 'call', 'position']), two);
    expect(four.glyphs).toEqual(['jungler-far', 'ward-off', 'horn']);
    expect(four.line).not.toContain('alone');
    expect(four.line.length).toBeLessThanOrEqual(145);
  });

  it('keeps a tagged death avoidable when theirs fell too, and says so at the end', () => {
    const tl = slice({ deaths: [fell(1473, 'Jungle', { killers: 1 })], theirDeaths: [theirs(1500)] });
    const read = readDeath(row(24, 'Jungle', ['position'], 'solo'), tl);
    expect(read.kind).toBe('avoidable');
    expect(read.traded).toBe(1);
    expect(read.line).toBe('Avoidable: alone on their side of the map, though one of theirs fell too.');
    const twice = readDeath(row(24, 'Jungle', ['position'], 'solo'), slice({ deaths: [fell(1473, 'Jungle', { killers: 1 })], theirDeaths: [theirs(1500), theirs(1450)] }));
    expect(twice.line).toBe('Avoidable: alone on their side of the map, though two of theirs fell too.');
  });

  it('reads a trade when at least as many of theirs fell within the window, exactly thirty seconds in, not thirty-one', () => {
    const at = (gap: number) => readDeath(row(20, 'Support', [], 'fight'), slice({ deaths: [fell(1210, 'Support', { killers: 4 })], theirDeaths: [theirs(1210 + gap)] }));
    expect(TRADE_WINDOW_SEC).toBe(30);
    expect(at(30).kind).toBe('traded');
    expect(at(-30).kind).toBe('traded');
    expect(at(30).line).toBe('Traded: one of theirs fell in the same fight.');
    expect(at(30).glyphs).toEqual(['swords']);
    expect(at(31).kind).toBe('clean');
    expect(at(-31).kind).toBe('clean');
    expect(at(31).traded).toBe(0);
  });

  it('compares theirs in the window with ours in the same window, this death included', () => {
    // Two of theirs for two of ours is a trade; one of theirs for three of ours is not.
    const even = slice({ deaths: [fell(1210, 'Support', { killers: 4 }), fell(1220, 'ADC')], theirDeaths: [theirs(1215), theirs(1230)] });
    expect(readDeath(row(20, 'Support', [], 'fight'), even).line).toBe('Traded: two of theirs fell in the same fight.');
    const lost = slice({ deaths: [fell(1210, 'Support', { killers: 4 }), fell(1220, 'ADC'), fell(1225, 'Mid')], theirDeaths: [theirs(1215)] });
    const read = readDeath(row(20, 'Support', [], 'fight'), lost);
    expect(read.kind).toBe('clean');
    expect(read.traded).toBe(1);
    // A ledger row the timeline has no death for still counts itself as one of ours.
    const unmatched = slice({ deaths: [], theirDeaths: [theirs(1215)] });
    expect(readDeath(row(20, 'Support', [], 'fight'), unmatched).kind).toBe('traded');
    const unmatchedTwo = slice({ deaths: [fell(1190, 'ADC')], theirDeaths: [theirs(1215)] });
    expect(readDeath(row(20, 'Support', [], 'fight'), unmatchedTwo).kind).toBe('clean');
  });

  it('reads a death that bought an objective of ours, whatever the tags say, exactly sixty seconds out and not sixty-one', () => {
    expect(OBJECTIVE_WINDOW_SEC).toBe(60);
    const at = (sec: number, could: string[] = ['ward', 'call']) =>
      readDeath(row(Math.floor(sec / 60), 'ADC', could), slice({ deaths: [fell(sec, 'ADC', { zone: 'river' })], objectives: [objective(8, 'us', 'dragon', 'infernal')] }));
    const before = at(420);
    expect(before.kind).toBe('bought');
    expect(before.line).toBe('Bought the infernal dragon: it fell to us within a minute.');
    expect(before.glyphs).toEqual(['dragon']);
    expect(before.objective).toEqual({ type: 'dragon', ours: true });
    expect(at(540).kind).toBe('bought');
    expect(at(419).kind).toBe('avoidable');
    expect(at(541).kind).toBe('avoidable');
    // A trade would also have read as bought.
    expect(readDeath(row(7, 'ADC', []), slice({ deaths: [fell(450, 'ADC', { zone: 'river' })], theirDeaths: [theirs(455, 'river')], objectives: [objective(8, 'us')] })).kind).toBe('bought');
  });

  it('asks where as well as when: a death in lane bought nothing unless the victim was on the take', () => {
    expect([...OBJECTIVE_ZONES]).toEqual(['river', 'ourJungle', 'theirJungle']);
    // Top dies alone in top lane at 14:40 while the other four take the dragon at 15: the tags stand, and the read is a warning, not a good death.
    const dragon = objective(15, 'us', 'dragon', 'infernal', ['Jungle', 'Mid', 'ADC', 'Support']);
    const top = readDeath(row(14, 'Top', ['ward', 'position'], 'solo', 'top'), slice({ deaths: [fell(880, 'Top', { zone: 'top', killers: 1, theirSide: true })], objectives: [dragon] }));
    expect(top.kind).toBe('avoidable');
    expect(top.line).toBe('Avoidable: no ward had gone down nearby, and alone on their side of the map.');
    expect(top.glyphs).toEqual(['ward-off', 'footsteps']);
    // The scene still knows what was up.
    expect(top.objective).toEqual({ type: 'dragon', ours: true });
    // Untagged, the same death is clean, not bought.
    expect(readDeath(row(14, 'Top', [], 'solo', 'top'), slice({ deaths: [fell(880, 'Top', { zone: 'top', killers: 1 })], objectives: [dragon] })).kind).toBe('clean');
    // Either jungle counts as the fight over the pit; a lane does not, unless the victim was on the take or near it.
    expect(readDeath(row(14, 'Top', ['ward'], 'gank', 'theirJungle'), slice({ deaths: [fell(880, 'Top', { zone: 'theirJungle' })], objectives: [dragon] })).kind).toBe('bought');
    expect(readDeath(row(14, 'Top', ['ward'], 'gank', 'ourJungle'), slice({ deaths: [fell(880, 'Top', { zone: 'ourJungle' })], objectives: [dragon] })).kind).toBe('bought');
    const onIt = objective(15, 'us', 'dragon', 'infernal', ['Top']);
    expect(readDeath(row(14, 'Top', ['ward'], 'gank', 'bot'), slice({ deaths: [fell(880, 'Top', { zone: 'bot' })], objectives: [onIt] })).kind).toBe('bought');
    const nearIt = { ...objective(15, 'us', 'dragon', 'infernal'), ourNear: ['Top'] } as TimelineObjective;
    expect(readDeath(row(14, 'Top', ['ward'], 'gank', 'bot'), slice({ deaths: [fell(880, 'Top', { zone: 'bot' })], objectives: [nearIt] })).kind).toBe('bought');
    // A ledger row the timeline has no death for is placed by the ledger's own zone.
    expect(readDeath(row(14, 'Top', ['ward'], 'gank', 'river'), slice({ objectives: [dragon] })).kind).toBe('bought');
    expect(readDeath(row(14, 'Top', ['ward'], 'gank', 'mid'), slice({ objectives: [dragon] })).kind).toBe('avoidable');
  });

  it('counts a death of theirs as the same fight only in the same zone, or with the victim on the kill', () => {
    // A 1v1 death top at 20:10 while bot kills their ADC at 20:30 is not a trade; the same kill with the top laner on it is.
    const apart = slice({ deaths: [fell(1210, 'Top', { zone: 'top', killers: 1 })], theirDeaths: [theirs(1230, 'bot')] });
    const read = readDeath(row(20, 'Top', [], 'solo', 'top'), apart);
    expect(read.kind).toBe('clean');
    expect(read.traded).toBe(0);
    const onIt = slice({ deaths: [fell(1210, 'Top', { zone: 'top', killers: 1 })], theirDeaths: [theirs(1230, 'bot', ['Top', 'ADC'])] });
    expect(readDeath(row(20, 'Top', [], 'solo', 'top'), onIt).kind).toBe('traded');
    // A tagged death says nothing of a kill elsewhere.
    expect(readDeath(row(20, 'Top', ['position'], 'solo', 'top'), apart).line).toBe('Avoidable: alone on their side of the map.');
  });

  it('names what fell: the dragon by its element, the elder, the herald, the grubs, the baron, Atakhan', () => {
    const bought = (type: TimelineObjective['type'], subType?: string) => readDeath(row(8, 'ADC', []), slice({ deaths: [fell(480, 'ADC', { zone: 'river' })], objectives: [objective(8, 'us', type, subType)] }));
    expect(bought('dragon').line).toBe('Bought the dragon: it fell to us within a minute.');
    expect(bought('dragon', 'mountain').line).toBe('Bought the mountain dragon: it fell to us within a minute.');
    expect(bought('elder').line).toBe('Bought the elder dragon: it fell to us within a minute.');
    expect(bought('herald').line).toBe('Bought the herald: it fell to us within a minute.');
    expect(bought('grubs').line).toBe('Bought the grubs: it fell to us within a minute.');
    expect(bought('baron').line).toBe('Bought the baron: it fell to us within a minute.');
    expect(bought('atakhan').line).toBe('Bought the Atakhan: it fell to us within a minute.');
    expect(bought('baron').glyphs).toEqual(['baron']);
    expect(bought('elder').glyphs).toEqual(['dragon']);
    expect(bought('grubs').glyphs).toEqual(['grubs']);
  });

  it('records an objective of theirs in the window without reading the death as bought, and prefers ours when both fell', () => {
    const theirsOnly = readDeath(row(20, 'Support', [], 'fight'), slice({ deaths: [fell(1210, 'Support', { killers: 4 })], objectives: [objective(20, 'them', 'dragon', 'infernal')] }));
    expect(theirsOnly.kind).toBe('clean');
    expect(theirsOnly.objective).toEqual({ type: 'dragon', ours: false });
    const both = readDeath(row(20, 'Support', [], 'fight'), slice({ deaths: [fell(1210, 'Support', { zone: 'river' })], objectives: [objective(20, 'them', 'dragon'), objective(21, 'us', 'herald')] }));
    expect(both.kind).toBe('bought');
    expect(both.objective).toEqual({ type: 'herald', ours: true });
  });

  it('reads clean when nothing stopped it, nothing was bought and nothing traded', () => {
    const read = readDeath(row(15, 'Mid', [], 'solo'), slice({ deaths: [fell(900, 'Mid', { killers: 1 })] }));
    expect(read.kind).toBe('clean');
    expect(read.line).toBe('Clean: nothing on the map would have stopped this one.');
    expect(read.glyphs).toEqual(['check']);
  });

  it('adds the tower glyph to an execution when there is room', () => {
    const executed = { executed: true, killers: 0 };
    expect(readDeath(row(15, 'Mid', [], 'executed'), slice({ deaths: [fell(900, 'Mid', executed)] })).glyphs).toEqual(['check', 'tower']);
    expect(readDeath(row(15, 'Mid', ['position'], 'executed'), slice({ deaths: [fell(900, 'Mid', executed)] })).glyphs).toEqual(['footsteps', 'tower']);
    expect(readDeath(row(15, 'Mid', ['jungle', 'ward', 'call'], 'executed'), slice({ deaths: [fell(900, 'Mid', executed)] })).glyphs).toEqual(['jungler-far', 'ward-off', 'horn']);
    // Without a timeline row the ledger's own word says it was an execution.
    expect(readDeath(row(15, 'Mid', [], 'executed'), slice()).glyphs).toEqual(['check', 'tower']);
    expect(readDeath(row(15, 'Mid', [], 'solo'), slice()).glyphs).toEqual(['check']);
  });

  it('reads the cost off the curve two minutes on, and leaves it absent where the curve ends', () => {
    expect(COST_MINUTES).toBe(2);
    const tl = slice({ deaths: [fell(600, 'Mid')] });
    expect(readDeath(row(10, 'Mid', []), tl).cost).toBe(GOLD[12] - GOLD[10]);
    expect(readDeath(row(10, 'Mid', []), tl).cost).toBe(-600);
    expect(readDeath(row(28, 'Mid', []), tl).cost).toBe(-600);
    expect(readDeath(row(29, 'Mid', []), tl).cost).toBeUndefined();
    expect(readDeath(row(30, 'Mid', []), tl).cost).toBeUndefined();
    expect('cost' in readDeath(row(30, 'Mid', []), tl)).toBe(false);
    // A gain after the death is a positive cost: it did not cost us.
    expect(readDeath(row(3, 'Mid', []), slice({ goldDiff: [0, 100, 200, 300, 600, 900] })).cost).toBe(600);
  });

  it('uses the timeline row the caller matched over its own search', () => {
    const own = fell(1250, 'Support', { killers: 4 });
    const tl = slice({ deaths: [fell(1200, 'Support', { killers: 1 }), own], theirDeaths: [theirs(1275)] });
    // The row at 1200 is the first match by minute and seat; the caller's own row at 1250 puts their death inside the window and the earlier row outside it.
    expect(readDeath(row(20, 'Support', [], 'fight'), tl).kind).toBe('clean');
    expect(readDeath(row(20, 'Support', [], 'fight'), tl, own).kind).toBe('traded');
  });
});

describe('readCounts and readsLine', () => {
  it('counts every read, present at zero, in the read order', () => {
    expect(DEATH_READS).toEqual(['avoidable', 'traded', 'bought', 'clean']);
    expect(readCounts([])).toEqual({ avoidable: 0, traded: 0, bought: 0, clean: 0 });
    expect(readCounts(['clean', 'avoidable', 'avoidable', 'bought'])).toEqual({ avoidable: 2, traded: 0, bought: 1, clean: 1 });
  });

  it('writes the counts as one line, leaving out zero reads, singular and plural right', () => {
    expect(readsLine({ avoidable: 6, traded: 2, bought: 1, clean: 2 })).toBe('11 deaths: 6 avoidable, 2 traded, 1 bought an objective, 2 clean.');
    expect(readsLine({ avoidable: 4, traded: 1, bought: 1, clean: 0 })).toBe('6 deaths: 4 avoidable, 1 traded, 1 bought an objective.');
    expect(readsLine({ avoidable: 0, traded: 0, bought: 0, clean: 1 })).toBe('1 death: 1 clean.');
    expect(readsLine({ avoidable: 0, traded: 0, bought: 1, clean: 0 })).toBe('1 death: 1 bought an objective.');
    expect(readsLine({ avoidable: 0, traded: 0, bought: 0, clean: 0 })).toBe('No deaths.');
  });
});

describe('couldGlyphs', () => {
  it('maps the tags to their glyphs in the ledger\'s order, at most three', () => {
    expect(couldGlyphs([])).toEqual([]);
    expect(couldGlyphs(['ward'])).toEqual(['ward-off']);
    expect(couldGlyphs(['call', 'jungle'])).toEqual(['horn', 'jungler-far']);
    expect(couldGlyphs(['jungle', 'ward', 'call', 'position'])).toEqual(['jungler-far', 'ward-off', 'horn']);
  });
});
