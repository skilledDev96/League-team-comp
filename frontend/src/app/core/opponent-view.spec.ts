import { describe, expect, it } from 'vitest';
import { OpponentPlayer } from '../models/team.models';
import {
  appendToRoster,
  orderedRoster,
  poolFor,
  queueRows,
  rateBand,
  recentForSeat,
  recentHidden,
  reseatOpponent,
  scoutedAgo
} from './opponent-view';

const p = (name: string, role: OpponentPlayer['role'], extra: Partial<OpponentPlayer> = {}): OpponentPlayer => ({
  name,
  role,
  riotTag: 'EUW',
  ...extra
});

describe('orderedRoster', () => {
  it('reads top to support whatever order the link was pasted in', () => {
    const roster = [p('c', 'Support'), p('a', 'Top'), p('b', 'Jungle')];
    expect(orderedRoster(roster).map((x) => x.name)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input', () => {
    const roster = [p('c', 'Support'), p('a', 'Top')];
    orderedRoster(roster);
    expect(roster[0].name).toBe('c');
  });
});

describe('reseatOpponent', () => {
  it('swaps seats so five players still hold five seats', () => {
    const roster = [p('top', 'Top'), p('adc', 'ADC')];
    const next = reseatOpponent(roster, roster[1], 'Top')!;
    expect(next.find((x) => x.name === 'adc')!.role).toBe('Top');
    expect(next.find((x) => x.name === 'top')!.role).toBe('ADC');
  });

  it('finds the player by identity, not by position in a sorted view', () => {
    // The stored order is not the display order. Moving "adc" must move "adc".
    const roster = [p('sup', 'Support'), p('adc', 'ADC'), p('top', 'Top')];
    const next = reseatOpponent(roster, roster[1], 'Mid')!;
    expect(next.find((x) => x.name === 'adc')!.role).toBe('Mid');
    expect(next.find((x) => x.name === 'sup')!.role).toBe('Support');
  });

  it('returns null when nothing would change, so the caller can skip the write', () => {
    const roster = [p('top', 'Top')];
    expect(reseatOpponent(roster, roster[0], 'Top')).toBeNull();
    expect(reseatOpponent(roster, p('stranger', 'Mid'), 'Top')).toBeNull();
  });
});

describe('reseatOpponent with subs', () => {
  it('just sets the seat when the roster has more than five, without displacing anyone', () => {
    const roster = [p('top', 'Top'), p('jg', 'Jungle'), p('mid', 'Mid'), p('adc', 'ADC'), p('sup', 'Support'), p('sub', 'Support')];
    const next = reseatOpponent(roster, roster[5], 'Top')!;
    expect(next.find((x) => x.name === 'sub')!.role).toBe('Top');
    // The starter Top keeps Top; two players now legitimately hold it.
    expect(next.find((x) => x.name === 'top')!.role).toBe('Top');
  });
});

describe('appendToRoster', () => {
  const five = [p('top', 'Top'), p('jg', 'Jungle'), p('mid', 'Mid'), p('adc', 'ADC'), p('sup', 'Support')];

  it('appends a new player and keeps everyone already there', () => {
    const next = appendToRoster([{ name: 'sub', tag: 'EUW' }], five);
    expect(next).toHaveLength(6);
    expect(next.slice(0, 5)).toEqual(five);
    expect(next[5].name).toBe('sub');
  });

  it('skips anyone already on the roster, so pasting the same link twice is harmless', () => {
    const next = appendToRoster([{ name: 'top', tag: 'EUW' }, { name: 'new', tag: 'EUW' }], five);
    expect(next.map((x) => x.name)).toEqual(['top', 'jg', 'mid', 'adc', 'sup', 'new']);
  });

  it('seats a sub on the least-held role, top-to-support on a tie', () => {
    const next = appendToRoster([{ name: 's1', tag: 'EUW' }, { name: 's2', tag: 'EUW' }], five);
    // All five roles held once; ties break top-first, so the first sub takes
    // Top and the second the next least-held, Jungle.
    expect(next[5].role).toBe('Top');
    expect(next[6].role).toBe('Jungle');
  });

  it('returns the roster unchanged for nothing new', () => {
    expect(appendToRoster([], five)).toEqual(five);
  });
});

describe('scoutedAgo', () => {
  const day = 86_400_000;
  const now = Date.parse('2026-09-03T12:00:00Z');

  it('says today, yesterday, then counts days', () => {
    expect(scoutedAgo([p('a', 'Top', { scoutedAt: new Date(now - 1000).toISOString() })], now)).toBe('today');
    expect(scoutedAgo([p('a', 'Top', { scoutedAt: new Date(now - day - 1000).toISOString() })], now)).toBe('yesterday');
    expect(scoutedAgo([p('a', 'Top', { scoutedAt: new Date(now - 5 * day - 1000).toISOString() })], now)).toBe('5 days ago');
  });

  it('uses the most recent stamp across the roster', () => {
    const roster = [
      p('a', 'Top', { scoutedAt: new Date(now - 9 * day).toISOString() }),
      p('b', 'Mid', { scoutedAt: new Date(now - 1000).toISOString() })
    ];
    expect(scoutedAgo(roster, now)).toBe('today');
  });

  it('is empty when nobody has been scouted', () => {
    expect(scoutedAgo([p('a', 'Top')], now)).toBe('');
  });
});

describe('poolFor', () => {
  it('prefers the seat they hold over their history at large', () => {
    const player = p('a', 'Top', {
      poolByRole: { Top: [{ champion: 'Sett', games: 3, wins: 2 }] },
      championRecords: [{ champion: 'Jinx', games: 30, wins: 15 }]
    });
    expect(poolFor(player).map((r) => r.champion)).toEqual(['Sett']);
  });

  it('falls back to names only for rosters scouted before records existed', () => {
    expect(poolFor(p('a', 'Top', { top3: ['Sett', 'Ornn'] }))).toEqual([
      { champion: 'Sett', games: 0, wins: 0 },
      { champion: 'Ornn', games: 0, wins: 0 }
    ]);
  });
});

describe('queueRows', () => {
  it('renders one row for a player scouted before the queue split', () => {
    const rows = queueRows(p('a', 'Top', { soloRank: 'GOLD II', top3: ['Sett'] }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'all', rank: 'GOLD II' });
  });

  it('renders solo then flex once byQueue is present', () => {
    const rows = queueRows(
      p('a', 'Top', {
        soloRank: 'GOLD II',
        flexRank: 'SILVER IV',
        byQueue: {
          solo: { poolByRole: { Top: [{ champion: 'Sett', games: 5, wins: 3 }] } },
          flex: { poolByRole: { Top: [{ champion: 'Ornn', games: 2, wins: 1 }] } }
        }
      })
    );
    expect(rows.map((r) => [r.key, r.rank, r.pool[0]?.champion])).toEqual([
      ['solo', 'GOLD II', 'Sett'],
      ['flex', 'SILVER IV', 'Ornn']
    ]);
  });
});

describe('rateBand', () => {
  it('bands a record the way the draft panel does', () => {
    expect(rateBand({ champion: 'x', games: 10, wins: 7 })).toBe('is-good');
    expect(rateBand({ champion: 'x', games: 10, wins: 6 })).toBe('is-ok');
    expect(rateBand({ champion: 'x', games: 10, wins: 5 })).toBe('is-even');
    expect(rateBand({ champion: 'x', games: 10, wins: 2 })).toBe('is-poor');
    expect(rateBand({ champion: 'x', games: 0, wins: 0 })).toBe('');
  });
});

describe('recentForSeat / recentHidden', () => {
  it('narrows a top laner to top champions and counts what it hid', () => {
    const player = p('a', 'Top', { recentChampions: ['Ashe', 'Sett', 'Thresh', 'Gragas'] });
    expect(recentForSeat(player)).toEqual(['Sett', 'Gragas']);
    expect(recentHidden(player)).toBe(2);
  });

  it('shows everything and hides nothing when the seat filter would empty the list', () => {
    const player = p('a', 'Top', { recentChampions: ['Ashe', 'Thresh'] });
    expect(recentForSeat(player)).toEqual(['Ashe', 'Thresh']);
    expect(recentHidden(player)).toBe(0);
  });
});
