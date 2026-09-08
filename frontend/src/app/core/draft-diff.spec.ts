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
});
