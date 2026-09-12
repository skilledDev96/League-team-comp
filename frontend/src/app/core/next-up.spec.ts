import { describe, expect, it } from 'vitest';
import { NEXT_UP_DAYS, NextUpInput, NextUpLine, nextUp } from './next-up';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-12T10:00:00Z');

const line = (text: string): NextUpLine => ({ glyph: 'flag', label: 'The one thing', text });

const input = (over: Partial<NextUpInput> = {}): NextUpInput => ({
  unwatched: [],
  reminder: null,
  unreviewed: [],
  nextSeries: null,
  canEdit: false,
  now: NOW,
  ...over
});

describe('the next thing to do', () => {
  it('renders nothing when there is nothing — no card, not an empty one', () => {
    expect(nextUp(input())).toBeNull();
  });

  it('puts an unwatched review above everything else', () => {
    const card = nextUp(
      input({
        unwatched: [{ matchId: 'm1', when: NOW - DAY, opponent: 'Sunset Wolves', headline: 'We lost the map after twenty.' }],
        reminder: { matchId: 'm2', headline: 'older', lines: [line('a')] },
        unreviewed: [{ matchId: 'm3', when: NOW }],
        nextSeries: { id: 's1', opponent: 'Iron Larks' },
        canEdit: true
      })
    );
    expect(card).toMatchObject({ kind: 'watch', matchId: 'm1', headline: 'We lost the map after twenty.' });
  });

  it('names the opponent when the review carries no headline', () => {
    const card = nextUp(input({ unwatched: [{ matchId: 'm1', when: NOW - DAY, opponent: 'Sunset Wolves' }] }));
    expect(card!.headline).toBe('The review of the Sunset Wolves game is waiting.');
  });

  it('takes the newest of several, not the first in the list', () => {
    const card = nextUp(
      input({
        unwatched: [
          { matchId: 'old', when: NOW - 5 * DAY },
          { matchId: 'new', when: NOW - DAY },
          { matchId: 'middle', when: NOW - 3 * DAY }
        ]
      })
    );
    expect(card!.matchId).toBe('new');
  });

  it('lets a game older than the window go', () => {
    // 181 games over nine months are all unwatched the day somebody signs in; without
    // the window the card is about February and stays about February.
    const stale = [{ matchId: 'm1', when: NOW - (NEXT_UP_DAYS + 1) * DAY }];
    expect(nextUp(input({ unwatched: stale }))).toBeNull();
    expect(nextUp(input({ unwatched: stale, nextSeries: { id: 's1', opponent: 'Iron Larks' } }))!.kind).toBe('draft');
  });

  it('falls to the film reminder once every review has been watched', () => {
    const card = nextUp(input({ reminder: { matchId: 'm2', headline: 'Vision went quiet.', lines: [line('a'), line('b')] } }));
    expect(card).toMatchObject({ kind: 'remind', matchId: 'm2', headline: 'Vision went quiet.' });
    expect(card!.lines).toHaveLength(2);
  });

  it('cuts the reminder to three lines, because the card is a prompt and not a page', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map(line);
    const card = nextUp(input({ reminder: { matchId: 'm2', headline: 'h', lines: five } }));
    expect(card!.lines.map((l) => l.text)).toEqual(['a', 'b', 'c']);
  });

  it('asks for a missing review only from someone who can ask', () => {
    const games = { unreviewed: [{ matchId: 'm3', when: NOW - DAY, opponent: 'Iron Larks' }] };
    expect(nextUp(input(games))).toBeNull();
    const card = nextUp(input({ ...games, canEdit: true }));
    expect(card).toMatchObject({ kind: 'ask', matchId: 'm3' });
    expect(card!.headline).toBe('The Iron Larks game has no review yet.');
  });

  it('ends on the next opponent, for an editor and a viewer alike', () => {
    const series = { nextSeries: { id: 's1', opponent: 'Night Harbour', when: 'on Sunday' } };
    for (const canEdit of [true, false]) {
      const card = nextUp(input({ ...series, canEdit }));
      expect(card).toMatchObject({ kind: 'draft', seriesId: 's1' });
      expect(card!.headline).toBe('You play Night Harbour on Sunday.');
    }
  });

  it('leaves the date out when the series has no time agreed', () => {
    expect(nextUp(input({ nextSeries: { id: 's1', opponent: 'Night Harbour' } }))!.headline).toBe('You play Night Harbour.');
  });

  it('never carries more than three lines on any rung', () => {
    const cards = [
      nextUp(input({ unwatched: [{ matchId: 'm1', when: NOW }] })),
      nextUp(input({ reminder: { matchId: 'm2', headline: 'h', lines: ['a', 'b', 'c', 'd'].map(line) } })),
      nextUp(input({ unreviewed: [{ matchId: 'm3', when: NOW }], canEdit: true })),
      nextUp(input({ nextSeries: { id: 's1', opponent: 'X' } }))
    ];
    for (const card of cards) expect(card!.lines.length).toBeLessThanOrEqual(3);
  });
});
