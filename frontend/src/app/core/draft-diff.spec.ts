import { describe, expect, it } from 'vitest';
import { SeriesGame } from '../models/team.models';
import { describeGameChange } from './draft-diff';

const game = (over: Partial<SeriesGame> = {}): SeriesGame => ({
  id: 'g1',
  seriesId: 's1',
  gameNumber: 1,
  order: 1,
  ourChampions: [],
  theirChampions: [],
  ...over
});

const notes = (b: SeriesGame | undefined, a: SeriesGame) => describeGameChange(b, a).map((c) => c.note);

describe('describeGameChange', () => {
  it('says nothing for a hold, which changes every second', () => {
    expect(notes(game({ holding: 'Ahri' }), game({ holding: 'Zed' }))).toEqual([]);
  });

  it('names a ban and a pick by seat, and the step they landed on', () => {
    const b = game({ draftStep: 5, bans: ['Zed'] });
    expect(notes(b, { ...b, bans: ['Zed', 'Ahri'], draftStep: 6 })).toEqual(['Ban 2: Ahri']);
    const c = game({ draftStep: 6, ourChampions: [] });
    expect(notes(c, { ...c, ourChampions: ['', '', '', 'Jinx', ''], draftStep: 7 })).toEqual(['Our ADC: Jinx']);
  });

  it('reads a ban nobody saw as not seen, never as a champion called "-" (17 Sep 2026)', () => {
    const b = game({ draftStep: 2, bans: ['Zed', 'Ahri'] });
    expect(notes(b, { ...b, bans: ['Zed', 'Ahri', '-'], draftStep: 3 })).toEqual(['Ban 3: not seen']);
    // Rest of phase not seen: the four bans left, in one save.
    expect(notes(b, { ...b, bans: ['Zed', 'Ahri', '-', '-', '-', '-'], draftStep: 6 })).toEqual([
      'Ban 3: not seen',
      'Ban 4: not seen',
      'Ban 5: not seen',
      'Ban 6: not seen'
    ]);
    const unseen = game({ draftStep: 3, bans: ['Zed', 'Ahri', '-'] });
    expect(notes(unseen, { ...unseen, bans: ['Zed', 'Ahri', 'Leona'] })).toEqual(['Replaced the not-seen ban 3 with Leona']);
    expect(notes(unseen, { ...unseen, bans: ['Zed', 'Ahri'], draftStep: 2 })).toEqual(['Undo: removed the not-seen ban 3']);
  });

  it('reads an undo as a removal walked back', () => {
    const b = game({ draftStep: 7, ourChampions: ['', '', '', 'Jinx', ''] });
    expect(notes(b, { ...b, ourChampions: ['', '', '', '', ''], draftStep: 6 })).toEqual(['Undo: removed our ADC Jinx']);
  });

  it('reads a replace in place, and a swap of two seats', () => {
    const b = game({ draftStep: 9, theirChampions: ['Aatrox', '', 'Ahri', '', ''] });
    expect(notes(b, { ...b, theirChampions: ['Aatrox', '', 'Syndra', '', ''] })).toEqual(['Replaced their Mid Ahri with Syndra']);
    expect(notes(b, { ...b, theirChampions: ['Ahri', '', 'Aatrox', '', ''] })).toEqual(['Swapped their Aatrox and Ahri']);
  });

  it('reads a reset, a side, a result and a skip', () => {
    const b = game({ draftStep: 8, bans: ['Zed'], ourChampions: ['Aatrox'], ourSide: 'blue' });
    expect(notes(b, game({ ourSide: undefined }))).toEqual(['Reset: every ban and pick cleared']);
    expect(notes(game(), game({ ourSide: 'red', draftStep: 0 }))).toEqual(['Side set to red']);
    expect(notes(b, { ...b, win: true })).toEqual(['Result: win']);
    expect(notes(game({ draftStep: 0 }), game({ draftStep: 6 }))).toEqual(['Skipped from step 1 to 7']);
  });

  it('records an answer from the advisor once, by the moment it was asked', () => {
    const advice = { summary: '', picks: [{ champion: 'Vi', seat: null, why: '', confidence: 'high' as const }], bans: [], watch: [], step: 6, action: 'pick' as const, askedAt: 't1' };
    const b = game({ draftStep: 6 });
    expect(notes(b, { ...b, advice })).toEqual(['Advisor answered at step 7: Vi']);
    expect(notes({ ...b, advice }, { ...b, advice })).toEqual([]);
  });

  it('says which replay a game took on and gave up, first', () => {
    // MAD Synergy game 1 on 12 Sep 2026: the unlink and the import were two writes whose only
    // trace was ten picks changing, with nothing to say a replay was involved.
    const typed = game({
      draftStep: 20,
      ourSide: 'blue',
      win: true,
      ourChampions: ['Mordekaiser', 'JarvanIV', 'Ahri', 'Tristana', 'Nautilus'],
      theirChampions: ['Garen', 'Vi', 'Taliyah', 'Sivir', 'Braum']
    });
    const linked = {
      ...typed,
      matchId: 'EUW1-7977500462',
      win: false,
      ourChampions: ['Kled', 'MonkeyKing', 'Ahri', 'Tristana', 'Seraphine'],
      theirChampions: ['Malphite', 'Nocturne', 'Syndra', 'Draven', 'Pantheon']
    };
    const link = notes(typed, linked);
    expect(link[0]).toBe('Linked replay EUW1-7977500462');
    expect(link).toContain('Result: loss');
    const unlink = notes(linked, typed);
    expect(unlink[0]).toBe('Unlinked replay EUW1-7977500462');
    expect(unlink).toContain('Result: win');
  });

  it('logs a link that changes nothing else, and a replay swapped for another', () => {
    const b = game({ draftStep: 20 });
    expect(notes(b, { ...b, matchId: 'EUW1-1' })).toEqual(['Linked replay EUW1-1']);
    expect(notes({ ...b, matchId: 'EUW1-1' }, { ...b, matchId: 'EUW1-2' })).toEqual(['Unlinked replay EUW1-1', 'Linked replay EUW1-2']);
    expect(notes({ ...b, matchId: 'EUW1-1' }, { ...b, matchId: 'EUW1-1' })).toEqual([]);
  });

  it('names the replay on a game created from one', () => {
    expect(notes(undefined, game({ gameNumber: 3, matchId: 'EUW1-9' }))).toEqual(['Game 3 created', 'Linked replay EUW1-9']);
    expect(notes(undefined, game({ gameNumber: 3 }))).toEqual(['Game 3 created']);
  });
});
