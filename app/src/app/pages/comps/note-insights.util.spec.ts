import { describe, expect, it } from 'vitest';
import { championMentions, NoteEntry, rollupNotes } from './note-insights.util';

const CHAMPS = ['Vi', 'Sejuani', "Kai'Sa", 'Miss Fortune', 'Lee Sin', 'Karma'];

function note(text: string, win = false, date?: number): NoteEntry {
  return { matchId: text.slice(0, 8), text, win, date };
}

describe('championMentions', () => {
  it('finds champions named in the notes', () => {
    const mentions = championMentions([note('Swap Sejuani for Vi')], CHAMPS);
    expect(mentions.map((m) => m.champion).sort()).toEqual(['Sejuani', 'Vi']);
  });

  it('does not match a short name inside an ordinary word', () => {
    const mentions = championMentions([note('Vision was bad, no ward on pit')], CHAMPS);
    expect(mentions).toEqual([]);
  });

  it('matches a punctuation-free spelling of the name', () => {
    const mentions = championMentions([note('kaisa had no frontline')], CHAMPS);
    expect(mentions[0].champion).toBe("Kai'Sa");
  });

  it('matches multi-word names', () => {
    const mentions = championMentions([note('Lee Sin kept missing Q')], CHAMPS);
    expect(mentions[0].champion).toBe('Lee Sin');
  });

  it('counts a champion once per note, not once per occurrence', () => {
    const mentions = championMentions([note('Sejuani, Sejuani, Sejuani')], CHAMPS);
    expect(mentions[0].count).toBe(1);
  });

  it('tracks how many mentions came from losses', () => {
    const mentions = championMentions(
      [note('Sejuani too slow', false), note('Sejuani was fine', true), note('Sejuani ulti whiffed', false)],
      CHAMPS
    );
    expect(mentions[0]).toEqual({ champion: 'Sejuani', count: 3, losses: 2 });
  });

  it('ranks the most-blamed champion first', () => {
    const notes = [
      note('Karma roams late', false),
      note('Sejuani too slow', false),
      note('Sejuani engage bad', false),
      note('Vi looked good', true)
    ];
    expect(championMentions(notes, CHAMPS).map((m) => m.champion)).toEqual(['Sejuani', 'Karma', 'Vi']);
  });

  it('ignores champions nobody mentioned', () => {
    expect(championMentions([note('draft was fine')], CHAMPS)).toEqual([]);
  });

  it('handles no notes at all', () => {
    expect(championMentions([], CHAMPS)).toEqual([]);
  });
});

describe('rollupNotes', () => {
  it('orders notes newest first and counts the record', () => {
    const rollup = rollupNotes(
      [note('old', true, 1_000), note('new', false, 3_000), note('mid', false, 2_000)],
      CHAMPS
    );
    expect(rollup.notes.map((n) => n.text)).toEqual(['new', 'mid', 'old']);
    expect(rollup.wins).toBe(1);
    expect(rollup.losses).toBe(2);
  });

  it('survives notes with no date', () => {
    const rollup = rollupNotes([note('a', true), note('b', false)], CHAMPS);
    expect(rollup.notes).toHaveLength(2);
  });
});
