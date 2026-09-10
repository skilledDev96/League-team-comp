import { describe, expect, it } from 'vitest';
import { FilmFramePlace, FilmWard } from './film-model';
import {
  areaWords,
  dangerAt,
  gridShade,
  LabCircle,
  LabReach,
  MAP_MAX,
  placedWard,
  pctToUnits,
  reachOf,
  REACH_MAX_UNITS,
  REACH_MIN_UNITS,
  REACH_SECONDS,
  readingOf,
  safeAt,
  shadeAt,
  SIGHT_PCT,
  SIGHT_UNITS,
  sightOf,
  STEALTH_WARD_SEC,
  unitsToPct,
  WALK_UNITS_PER_SEC
} from './position-lab';
import { unitsToPercent } from './rift-zones';

/** Units to percent the way the Rift draws them, fit included, so the lab's circles match the film's own wards. */
const pct = (units: number) => unitsToPercent(units);

const place = (seat: FilmFramePlace['seat'], x: number, y: number, champion?: string): FilmFramePlace => ({ seat, x, y, champion });

describe('reachOf', () => {
  it('sizes a reach as eight seconds of walking, further only when the pace over the two frames beats a walk, and caps it (10 Sep 2026, second fix pass)', () => {
    expect(REACH_SECONDS).toBe(8);
    expect(REACH_MIN_UNITS).toBe(WALK_UNITS_PER_SEC * REACH_SECONDS);
    const now = [place('Jungle', 40, 40, 'Vi'), place('Mid', 46, 46), place('Top', 80, 80)];
    const before = [place('Jungle', 20, 20), place('Mid', 40, 40), place('Top', 10, 10)];
    const reaches = reachOf(now, before);
    expect(reaches.map((r) => r.seat)).toEqual(['Jungle', 'Mid', 'Top']);
    // Twenty percent each way is about 4400 units over a minute: 73 a second, a fifth of a walk. The floor stands; the pace and the frame before are still read.
    const jg = reaches[0];
    expect(jg.champion).toBe('Vi');
    expect(jg.x).toBe(40);
    expect(jg.from).toEqual({ x: 20, y: 20 });
    expect(jg.speed).toBeCloseTo(pctToUnits(Math.hypot(20, 20)) / 60, 3);
    expect(jg.speed).toBeLessThan(WALK_UNITS_PER_SEC);
    expect(jg.r).toBeCloseTo(pct(REACH_MIN_UNITS), 6);
    // Six percent each way is a crawl: the floor.
    expect(reaches[1].r).toBeCloseTo(pct(REACH_MIN_UNITS), 6);
    // Seventy percent each way in a minute is a walk's worth of net ground: still the floor, since net displacement never overstates a walk.
    expect(reaches[2].speed).toBeLessThan(WALK_UNITS_PER_SEC);
    expect(reaches[2].r).toBeCloseTo(pct(REACH_MIN_UNITS), 6);
    // The same crossing in twelve seconds is a teleport: the pace beats a walk, and the cap holds the circle.
    const tp = reachOf([now[2]], [before[2]], REACH_SECONDS, 12)[0];
    expect(tp.speed).toBeGreaterThan(WALK_UNITS_PER_SEC);
    expect(tp.r).toBeCloseTo(pct(REACH_MAX_UNITS), 6);
    // In thirty seconds it beats a walk without reaching the cap: eight seconds of that pace.
    const fast = reachOf([now[2]], [before[2]], REACH_SECONDS, 30)[0];
    expect(fast.speed).toBeGreaterThan(WALK_UNITS_PER_SEC);
    expect(fast.r).toBeCloseTo(pct(fast.speed * REACH_SECONDS), 6);
    expect(fast.r).toBeGreaterThan(pct(REACH_MIN_UNITS));
    expect(fast.r).toBeLessThan(pct(REACH_MAX_UNITS));
  });

  it('gives the floor to a seat without a frame before, and to the first frame', () => {
    const now = [place('ADC', 60, 60), place('Support', 62, 62)];
    expect(reachOf(now, null).map((r) => r.r)).toEqual([pct(REACH_MIN_UNITS), pct(REACH_MIN_UNITS)]);
    // A frame before at a walking pace or under: the floor for both, and the pace and the frame before read for the one that has them.
    const partial = reachOf(now, [place('ADC', 30, 30)]);
    expect(partial[0].r).toBe(pct(REACH_MIN_UNITS));
    expect(partial[0].from).toEqual({ x: 30, y: 30 });
    expect(partial[0].speed).toBeGreaterThan(0);
    expect(partial[1].r).toBe(pct(REACH_MIN_UNITS));
    expect(partial[1].from).toBeNull();
    expect(partial[1].speed).toBe(0);
  });

  it('reads the pace off the real gap between the frames, and a gap of nothing as no pace', () => {
    const now = [place('Jungle', 40, 40)];
    const before = [place('Jungle', 30, 30)];
    const minute = reachOf(now, before)[0];
    const half = reachOf(now, before, REACH_SECONDS, 30)[0];
    expect(half.speed).toBeCloseTo(minute.speed * 2, 6);
    // Both under a walk: the floor for both. Five seconds for the same ground is a dash the circle grows for.
    expect(half.r).toBe(minute.r);
    const dash = reachOf(now, before, REACH_SECONDS, 5)[0];
    expect(dash.speed).toBeGreaterThan(WALK_UNITS_PER_SEC);
    expect(dash.r).toBeGreaterThan(minute.r);
    expect(reachOf(now, before, REACH_SECONDS, 0)[0].speed).toBe(0);
    expect(reachOf(now, before, REACH_SECONDS, 0)[0].r).toBe(pct(REACH_MIN_UNITS));
  });

  it('converts between units and percent both ways, with the Rift fit', () => {
    expect(unitsToPct(SIGHT_UNITS)).toBeCloseTo(unitsToPercent(SIGHT_UNITS), 9);
    expect(pctToUnits(unitsToPct(MAP_MAX))).toBeCloseTo(MAP_MAX, 6);
    expect(pctToUnits(unitsToPct(1200))).toBeCloseTo(1200, 6);
    expect(SIGHT_PCT).toBeCloseTo(pct(SIGHT_UNITS), 2);
  });
});

describe('sightOf and placedWard', () => {
  const trinket: FilmWard = { sec: 100, untilSec: 190, seat: 'Support', type: 'trinket', x: 70, y: 75, r: 6 };
  const control: FilmWard = { sec: 300, untilSec: 1800, seat: 'Jungle', type: 'control', x: 30, y: 30, r: 6 };

  it('keeps only the wards live at the second: placed by then and not yet gone', () => {
    expect(sightOf([trinket, control], 99)).toEqual([]);
    expect(sightOf([trinket, control], 100).map((s) => s.seat)).toEqual(['Support']);
    expect(sightOf([trinket, control], 189).map((s) => s.seat)).toEqual(['Support']);
    expect(sightOf([trinket, control], 190)).toEqual([]);
    expect(sightOf([trinket, control], 400)).toEqual([{ x: 30, y: 30, r: 6, seat: 'Jungle', type: 'control' }]);
  });

  it('places a trinket for ninety seconds and a control ward until the game ends', () => {
    const t = placedWard('trinket', 40, 55, 600);
    expect(t).toEqual({ sec: 600, untilSec: 600 + STEALTH_WARD_SEC, type: 'trinket', x: 40, y: 55, r: SIGHT_PCT });
    expect(placedWard('other', 40, 55, 600).untilSec).toBe(690);
    const c = placedWard('control', 40, 55, 600);
    expect(c.untilSec).toBe(Number.POSITIVE_INFINITY);
    expect(sightOf([c], 600 + 3600).length).toBe(1);
    expect(sightOf([t], 700)).toEqual([]);
  });
});

describe('dangerAt, safeAt and shadeAt', () => {
  const reach: LabCircle = { x: 50, y: 50, r: 10 };
  const sight: LabCircle = { x: 80, y: 80, r: 6 };
  const overlap: LabCircle = { x: 55, y: 50, r: 6 };

  it('reads a point by the circles it sits in', () => {
    expect(dangerAt({ x: 55, y: 50 }, [reach])).toBe(true);
    expect(dangerAt({ x: 61, y: 50 }, [reach])).toBe(false);
    expect(dangerAt({ x: 60, y: 50 }, [reach])).toBe(true);
    expect(safeAt({ x: 81, y: 80 }, [sight], [reach])).toBe(true);
    expect(safeAt({ x: 90, y: 90 }, [sight], [reach])).toBe(false);
    expect(safeAt({ x: 55, y: 50 }, [overlap], [reach])).toBe(false);
  });

  it('shades safe where seen and out of reach, dark where reached and unseen, seen where both hold, and none elsewhere', () => {
    expect(shadeAt({ x: 81, y: 80 }, [sight], [reach])).toBe('safe');
    expect(shadeAt({ x: 45, y: 50 }, [sight], [reach])).toBe('danger');
    expect(shadeAt({ x: 55, y: 50 }, [overlap], [reach])).toBe('sight');
    expect(shadeAt({ x: 5, y: 5 }, [sight], [reach])).toBe('none');
    expect(shadeAt({ x: 5, y: 5 }, [], [])).toBe('none');
  });
});

describe('gridShade', () => {
  it('tags each cell of the grid by its centre, and covers the map exactly once', () => {
    const cells = gridShade([{ x: 75, y: 75, r: 10 }], [{ x: 25, y: 25, r: 10 }], 50);
    expect(cells.length).toBe(4);
    expect(cells.map((c) => c.tag)).toEqual(['danger', 'none', 'none', 'safe']);
    expect(cells[0]).toEqual({ x: 0, y: 0, w: 50, h: 50, tag: 'danger' });
    expect(cells[3]).toEqual({ x: 50, y: 50, w: 50, h: 50, tag: 'safe' });
    const fine = gridShade([], [], 4);
    expect(fine.length).toBe(625);
    expect(fine.every((c) => c.tag === 'none')).toBe(true);
    expect(fine[fine.length - 1]).toEqual({ x: 96, y: 96, w: 4, h: 4, tag: 'none' });
  });

  it('closes the last column and row when the step does not divide the map', () => {
    const cells = gridShade([], [], 30);
    expect(cells.length).toBe(16);
    expect(cells[3]).toEqual({ x: 90, y: 0, w: 10, h: 30, tag: 'none' });
    expect(cells[15]).toEqual({ x: 90, y: 90, w: 10, h: 10, tag: 'none' });
    expect(gridShade([], [], 0)).toEqual([]);
  });

  it('marks the overlap of a sight and a reach as seen', () => {
    const cells = gridShade([{ x: 25, y: 25, r: 10 }], [{ x: 25, y: 25, r: 30 }], 50);
    expect(cells[0].tag).toBe('sight');
  });
});

describe('areaWords', () => {
  it('names the lanes and the river as they are and resolves the jungles and the bases by our side', () => {
    expect(areaWords('top', 'blue')).toBe('top lane');
    expect(areaWords('mid', 'red')).toBe('mid lane');
    expect(areaWords('bot', 'blue')).toBe('bot lane');
    expect(areaWords('river', 'blue')).toBe('the river');
    expect(areaWords('blueJungle', 'blue')).toBe('our jungle');
    expect(areaWords('blueJungle', 'red')).toBe('their jungle');
    expect(areaWords('redJungle', 'blue')).toBe('their jungle');
    expect(areaWords('redBase', 'red')).toBe('our base');
    expect(areaWords('blueBase', 'red')).toBe('their base');
    expect(areaWords(null, 'blue')).toBeNull();
  });
});

describe('readingOf', () => {
  const reach = (seat: LabReach['seat'], x: number, y: number, r = 8): LabReach => ({ seat, x, y, r, speed: 0, from: null });
  const circle = (x: number, y: number, r = SIGHT_PCT): LabCircle => ({ x, y, r });
  const base = { ourSide: 'blue' as const, theirs: [] as FilmFramePlace[], previous: null, sights: [], placed: [], reaches: [] as LabReach[], moved: [] };

  it('reads a placed ward that covers the way one of theirs came, naming where from, and the champion when the frame carries it', () => {
    // Their jungler walked from the river (40, 40; the crossing at 50, 50 reads as mid) into our jungle (30, 60); a ward at (35, 50) sits on that line.
    const theirs = [place('Jungle', 30, 60, 'Vi')];
    const previous = [place('Jungle', 40, 40)];
    const ward = circle(35, 50);
    expect(readingOf({ ...base, theirs, previous, sights: [ward], placed: [ward] })).toBe("From here, their Vi's path from the river would have been in sight");
    // A ward that covers only where they stand now still covers the end of the path.
    const end = circle(30, 60);
    expect(readingOf({ ...base, theirs, previous, sights: [end], placed: [end] })).toBe("From here, their Vi's path from the river would have been in sight");
    // Without the champion the seat stands in; never a name.
    expect(readingOf({ ...base, theirs: [place('Jungle', 30, 60)], previous, sights: [end], placed: [end] })).toBe("From here, their Jungle's path from the river would have been in sight");
    // The game's own ward is not "from here": only a placed one reads.
    expect(readingOf({ ...base, theirs, previous, sights: [ward], placed: [] })).toBe('Drag one of ours, or put a ward down, and this line reads the difference');
  });

  it('reads the standing spot without a frame before, and drops the place when the frame before is off the ground', () => {
    const theirs = [place('Jungle', 40, 55)];
    const ward = circle(41, 56);
    expect(readingOf({ ...base, theirs, sights: [ward], placed: [ward] })).toBe('From here, their Jungle would have been in sight');
    const top = [place('Top', 10, 50)];
    const off = [place('Top', 4, 50)];
    const edge = circle(8, 50);
    expect(readingOf({ ...base, theirs: top, previous: off, sights: [edge], placed: [edge] })).toBe("From here, their Top's path would have been in sight");
  });

  it('reads their jungler before anyone else, and our side resolves whose jungle it was', () => {
    // Both in the red jungle (off the mid line, which x + y within 94 to 106 would read as), both covered by one wide ward.
    const theirs = [place('Top', 70, 40), place('Jungle', 60, 30)];
    const previous = [place('Top', 72, 42), place('Jungle', 62, 28)];
    const ward = circle(61, 29, 16);
    expect(readingOf({ ...base, theirs, previous, sights: [ward], placed: [ward] })).toBe("From here, their Jungle's path from their jungle would have been in sight");
    expect(readingOf({ ...base, ourSide: 'red', theirs, previous, sights: [ward], placed: [ward] })).toBe("From here, their Jungle's path from our jungle would have been in sight");
  });

  it('reads the last moved token of ours against the reaches and the sights', () => {
    const reaches = [reach('Jungle', 50, 50, 10), reach('Mid', 58, 50, 10)];
    // Inside both: the nearer one is named, by champion when the reach carries one.
    expect(readingOf({ ...base, reaches, moved: [{ seat: 'ADC', x: 56, y: 50 }] })).toBe("Still inside their Mid's reach");
    expect(readingOf({ ...base, reaches, moved: [{ seat: 'ADC', x: 52, y: 50 }] })).toBe("Still inside their Jungle's reach");
    expect(readingOf({ ...base, reaches: [{ ...reaches[1], champion: 'Syndra' }], moved: [{ seat: 'ADC', x: 56, y: 50 }] })).toBe("Still inside their Syndra's reach");
    expect(readingOf({ ...base, reaches, sights: [circle(80, 80)], moved: [{ seat: 'ADC', x: 81, y: 80 }] })).toBe('Out of reach and in sight');
    expect(readingOf({ ...base, reaches, sights: [circle(80, 80)], moved: [{ seat: 'ADC', x: 20, y: 80 }] })).toBe('Out of reach, but nothing sees the way in');
    // The last move is the one read.
    expect(readingOf({ ...base, reaches, moved: [{ seat: 'ADC', x: 52, y: 50 }, { seat: 'Support', x: 20, y: 80 }] })).toBe('Out of reach, but nothing sees the way in');
  });

  it('says when a placed ward sees nobody, and nudges when nothing was changed', () => {
    const theirs = [place('Jungle', 40, 55)];
    const far = circle(80, 80);
    expect(readingOf({ ...base, theirs, sights: [far], placed: [far] })).toBe('That ward sees none of theirs at this minute');
    expect(readingOf({ ...base, theirs })).toBe('Drag one of ours, or put a ward down, and this line reads the difference');
  });
});
