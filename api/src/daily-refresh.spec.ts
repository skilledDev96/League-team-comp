import { describe, expect, it } from 'vitest';
import {
  analysisRequestFrom,
  championOfLine,
  MAX_TIMELINE_FETCHES,
  mergeChampionPool,
  mergePlayer,
  refreshOrder,
  seatsOfComp,
  StoredPlayer,
  timelineCandidates
} from './daily-refresh';

describe('championOfLine', () => {
  it('takes the champion off a "Champion - note" line', () => {
    expect(championOfLine('Ornn - engage, hold ult')).toBe('Ornn');
  });

  it('passes a bare champion through and blanks nothing', () => {
    expect(championOfLine('  Ahri ')).toBe('Ahri');
    expect(championOfLine(undefined)).toBe('');
  });

  it('keeps hyphenated names that are not the separator', () => {
    expect(championOfLine("Kai'Sa-ish")).toBe("Kai'Sa-ish");
  });

  it('answers exactly what the browser answers, note-only lines included', () => {
    // `UiService.parseCompLine` and `championOf` in `core/comp-seats.ts` both look for the
    // separator in the raw line; this trimmed first, which turned a note-only pick into a champion
    // here and nowhere else. The pair below is the whole difference (20 Sep 2026).
    expect(championOfLine(' - note only')).toBe('');
    expect(championOfLine('- note only')).toBe('- note only');
  });
});

describe('analysisRequestFrom', () => {
  const players: StoredPlayer[] = [
    { id: 'p1', name: 'One', profile: { region: 'euw', riotTag: 'EUW' } },
    { id: '', name: 'Ghost' }
  ];

  it('builds the same request the Analysis page sends', () => {
    const request = analysisRequestFrom(
      players,
      [
        { id: 'c1', name: 'Engage', picks: { Top: 'Ornn - tank', Jungle: 'Jarvan IV', Mid: '', ADC: 'Jinx', Support: 'Rakan' } },
        { id: '', name: 'Broken' },
        { id: 'c2', countsUnder: 'c1' }
      ],
      [{ matchId: 'EUW1_1', compId: 'c1' }, { matchId: 'EUW1_2' }, { compId: 'c2' }]
    );
    expect(request.players).toEqual([{ id: 'p1', name: 'One', riotTag: 'EUW', region: 'euw' }]);
    expect(request.comps).toEqual([
      { id: 'c1', name: 'Engage', champions: ['Ornn', 'Jarvan IV', 'Jinx', 'Rakan'], countsUnder: null },
      { id: 'c2', name: 'Comp', champions: [], countsUnder: 'c1' }
    ]);
    expect(request.overrides).toEqual({ EUW1_1: 'c1' });
  });

  // 20 Sep 2026: the morning run keeps its own copy of the comp shape, so a field added to the comp
  // and not added here would leave the afternoon Refresh and the 06:30 run attributing games
  // differently — with nothing on any screen saying so.
  it('sends a seat its fallbacks, priority first', () => {
    const request = analysisRequestFrom(
      [],
      [
        {
          id: 'c1',
          name: 'Dive',
          picks: { Top: 'Vladimir', Jungle: 'Diana', Mid: 'Yasuo', ADC: 'Tristana', Support: 'Nautilus - engage' },
          fallbacks: { Support: ['Leona - if Naut is gone'], Mid: ['Ahri'] }
        }
      ],
      []
    );
    expect(request.comps[0].champions).toEqual(['Vladimir', 'Diana', 'Yasuo', 'Tristana', 'Nautilus']);
    expect(request.comps[0].seats).toEqual([
      ['Vladimir'],
      ['Diana'],
      ['Yasuo', 'Ahri'],
      ['Tristana'],
      ['Nautilus', 'Leona']
    ]);
  });

  it('leaves seats off a comp that holds no fallback at all', () => {
    const request = analysisRequestFrom(
      [],
      [
        { id: 'c1', name: 'Engage', picks: { Top: 'Ornn', Jungle: 'Vi' } },
        { id: 'c2', name: 'Empty stored', picks: { Top: 'Ornn' }, fallbacks: { Top: [] } }
      ],
      []
    );
    // Absent is the value the matcher reads as "score this comp the way it was scored yesterday",
    // so on the day this shipped not one comp takes the new path.
    for (const comp of request.comps) expect(comp.seats).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(request.comps[0], 'seats')).toBe(false);
  });
});

describe('seatsOfComp', () => {
  it('drops a seat holding a fallback and no priority', () => {
    // The invariant `core/comp-seats.ts` enforces on read, applied to the stored document too: a
    // hand-edited comp cannot make an empty seat count by parking something in its fallbacks.
    expect(seatsOfComp({ id: 'c', picks: { Top: '   ' }, fallbacks: { Top: ['Leona'] } })).toBeUndefined();
    expect(seatsOfComp({ id: 'c', fallbacks: { Top: ['Leona'] } })).toBeUndefined();
  });

  it('drops a seat whose pick line is only a note, exactly as the browser drops it', () => {
    // The reachable state: Admin › Comps edits a pick line as free text and `saveComp` spreads the
    // stored comp and replaces only `picks`, so blanking the Support champion leaves
    // ' - need engage' with that seat's fallbacks still under it. `championOf` in
    // `core/comp-seats.ts` reads that line as no champion and the browser drops the seat; trimming
    // before the separator check made this path keep it, so a game playing Leona scored one seat
    // more on the 06:30 run than on an afternoon Refresh and the comp's record flipped on whichever
    // went last (20 Sep 2026).
    expect(championOfLine(' - need engage')).toBe('');
    const odd = { id: 'c', picks: { Top: 'Ornn', Support: ' - need engage' }, fallbacks: { Support: ['Leona'] } };
    expect(seatsOfComp(odd)).toEqual([['Ornn']]);
    expect(analysisRequestFrom([], [odd], []).comps[0].champions).toEqual(['Ornn']);
    // On its own it is no seat at all, rather than a seat Leona can fill.
    expect(seatsOfComp({ id: 'c', picks: { Support: ' - need engage' }, fallbacks: { Support: ['Leona'] } })).toBeUndefined();
  });

  it('reads a priority line with the very function the flat list reads it with', () => {
    // The strict generalisation rests on this: `champions` and `seats` must never disagree about
    // what a line names, so `seatsOfComp` calls `championOfLine` and is never cleverer than it. A
    // line holding no ' - ' at all is a champion however odd it looks — on this path and on the
    // browser's, which is the only thing that matters (20 Sep 2026).
    const odd = { id: 'c', picks: { Top: '- note only' }, fallbacks: { Top: ['Leona'] } };
    expect(championOfLine('- note only')).toBe('- note only');
    expect(seatsOfComp(odd)).toEqual([[championOfLine('- note only'), 'Leona']]);
    expect(analysisRequestFrom([], [odd], []).comps[0].champions).toEqual([championOfLine('- note only')]);
  });

  it('takes the champion off every line, priority and fallback alike', () => {
    expect(
      seatsOfComp({ id: 'c', picks: { Top: 'Ornn - tank' }, fallbacks: { Top: ['Sion - if Ornn is banned', ''] } })
    ).toEqual([['Ornn', 'Sion']]);
  });

  it('dedupes within a seat and caps it, whatever the document holds', () => {
    expect(
      seatsOfComp({ id: 'c', picks: { Top: 'Ornn' }, fallbacks: { Top: ['ornn', 'Sion', 'Malphite', 'Shen', 'Poppy'] } })
    ).toEqual([['Ornn', 'Sion', 'Malphite', 'Shen']]);
  });

  it('counts one champion once however it is spelled, and cuts the tail where the browser cuts it', () => {
    // MonkeyKing is Wukong. `core/comp-seats.ts` dedupes on `canonicalChampion` and applies the cap
    // **after** the dedupe, so a key that did not know the alias kept MonkeyKing, spent a slot on it
    // and lost Shen off the end — one seat of difference between the morning run and a Refresh,
    // which is enough to cross the threshold. The array asserted here is the one `compSeats`
    // asserts in `frontend/src/app/core/comp-alias.spec.ts`; keep the two identical (20 Sep 2026).
    expect(
      seatsOfComp({ id: 'c', picks: { Top: 'Wukong' }, fallbacks: { Top: ['MonkeyKing', 'Sion', 'Malphite', 'Shen', 'Poppy'] } })
    ).toEqual([['Wukong', 'Sion', 'Malphite', 'Shen']]);
    // The sharper case: a pick retyped as the Riot id with the display name still in its fallbacks
    // is one champion, so the seat holds one — and the request then carries no seats at all, which
    // is what the browser sends for it too.
    const odd = { id: 'c', name: 'C', picks: { Top: 'MonkeyKing' }, fallbacks: { Top: ['Wukong'] } };
    expect(seatsOfComp(odd)).toEqual([['MonkeyKing']]);
    expect(analysisRequestFrom([], [odd], []).comps[0].seats).toBeUndefined();
  });
});

describe('mergeChampionPool', () => {
  it('keeps the curated order and appends what is new', () => {
    expect(mergeChampionPool(['Ornn', 'Sion'], ['sion', 'K’Sante', 'Ornn'])).toEqual(['Ornn', 'Sion', 'K’Sante']);
  });
});

describe('mergePlayer', () => {
  const player: StoredPlayer = {
    id: 'p1',
    name: 'One',
    role: 'Top',
    strengths: ['old'],
    weaknesses: [],
    top3: ['Ornn'],
    bans: ['Fiora']
  };

  it('refuses a template result rather than storing invented text', () => {
    expect(mergePlayer(player, { source: 'template', strengths: ['made up'] }, '2026-09-05T05:00:00Z')).toBeNull();
  });

  it('merges a provider result the way the roster page does, and stamps the time', () => {
    const merged = mergePlayer(
      player,
      { source: 'provider', role: 'Top', top3: ['Sion'], bans: [], strengths: [], queueStats: { solo: {} } },
      '2026-09-05T05:00:00Z'
    );
    expect(merged).toMatchObject({
      id: 'p1',
      top3: ['Ornn', 'Sion'],
      bans: ['Fiora'],
      strengths: ['old'],
      queueStats: { solo: {} },
      refreshedAt: '2026-09-05T05:00:00Z'
    });
  });

  it('keeps a hand-edited player as saved, and still takes the stats and the time', () => {
    const curated: StoredPlayer = {
      ...player,
      curated: true,
      playstyle: 'Split pusher',
      strengths: ['Lane bully'],
      top3: ['Ornn', 'Lillia'],
      icon: 'ours.webp'
    };
    const merged = mergePlayer(
      curated,
      {
        source: 'provider',
        role: 'Jungle',
        iconUrl: 'riot.jpg',
        playstyle: 'Teamfighter',
        strengths: ['generated'],
        top3: ['Sion'],
        bans: ['Zed'],
        queueStats: { solo: { games: 3 } }
      },
      '2026-09-06T05:00:00Z'
    );
    expect(merged).toMatchObject({
      role: 'Top',
      playstyle: 'Split pusher',
      strengths: ['Lane bully'],
      top3: ['Ornn', 'Lillia'],
      bans: ['Fiora'],
      icon: 'ours.webp',
      queueStats: { solo: { games: 3 } },
      refreshedAt: '2026-09-06T05:00:00Z'
    });
  });
});

describe('timelineCandidates', () => {
  const g = (matchId: string, date: number, over: Partial<{ queue: string; timelineData: 'riot' | 'none' }> = {}) => ({
    matchId,
    date,
    queue: 'Flex',
    ...over
  });

  it('wants Riot games without a current timeline, newest first, practice games left out, capped', () => {
    const games = [
      g('old', 1),
      g('new', 5),
      g('done', 4, { timelineData: 'riot' }),
      g('replay', 3, { queue: 'Scrim', timelineData: 'none' }),
      g('practice', 6),
      g('mid', 2)
    ];
    expect(timelineCandidates(games, new Set(['practice'])).map((x) => x.matchId)).toEqual(['new', 'mid', 'old']);
    expect(timelineCandidates(games, new Set(['practice']), 2).map((x) => x.matchId)).toEqual(['new', 'mid']);
  });

  it('caps at twenty by default', () => {
    const games = Array.from({ length: 30 }, (_, i) => g(`m${i}`, i));
    expect(timelineCandidates(games, new Set())).toHaveLength(MAX_TIMELINE_FETCHES);
    expect(MAX_TIMELINE_FETCHES).toBe(20);
  });
});

describe('refreshOrder', () => {
  it('puts the never-refreshed first, then the oldest, then by roster order', () => {
    const out = refreshOrder([
      { id: 'b', refreshedAt: '2026-09-04T05:00:00Z', order: 2 },
      { id: 'a', order: 1 },
      { id: 'c', refreshedAt: '2026-09-01T05:00:00Z', order: 3 },
      { id: 'd', order: 0 }
    ]);
    expect(out.map((p) => p.id)).toEqual(['d', 'a', 'c', 'b']);
  });
});
