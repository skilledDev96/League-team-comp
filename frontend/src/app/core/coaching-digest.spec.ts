import { describe, expect, it } from 'vitest';
import { digestNotes } from './coaching-digest';

describe('digestNotes', () => {
  const notes = [
    { win: true, date: 3, strength: 'Won lane clearly into Samira, up 388 gold at ten.', workOn: 'Five of six deaths had no ward nearby; a control ward or two is one option.' },
    { win: false, date: 2, strength: 'Kept farming through a lost lane.', workOn: 'Caught alone in the river twice with no vision.' },
    { win: false, date: 1, strength: 'Highest damage on the team.', workOn: 'Worth asking whether to group earlier for the dragon fights.' }
  ];

  it('counts the themes each note touches, most often first', () => {
    const d = digestNotes(notes);
    expect(d.games).toBe(3);
    expect(d.wins).toBe(1);
    expect(d.workOn[0]).toEqual({ key: 'vision', label: 'Vision', games: 2 });
    expect(d.workOn.map((t) => t.key)).toContain('caught');
    expect(d.workOn.map((t) => t.key)).toContain('objectives');
    expect(d.strengths.map((t) => t.key)).toEqual(expect.arrayContaining(['lane', 'damage']));
  });

  it('carries the newest note as the quickest read', () => {
    const d = digestNotes(notes);
    expect(d.latestWorkOn).toMatch(/^Five of six deaths/);
    expect(d.latestStrength).toMatch(/^Won lane/);
  });

  it('is empty on no notes, and leaves out themes nobody touched', () => {
    const d = digestNotes([]);
    expect(d).toEqual({ games: 0, wins: 0, workOn: [], strengths: [] });
    expect(digestNotes([{ win: true, date: 1, strength: '', workOn: 'Nothing in particular.' }]).workOn).toEqual([]);
  });
});
