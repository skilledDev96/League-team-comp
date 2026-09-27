import { describe, expect, it } from 'vitest';
import { RiotId } from '../../../core/riot-id';
import { RosterImportPreview, RosterImportRow } from '../../../services/roster-import.service';
import { importLabel, importPreviewLine, reseatReason } from './admin-players.service';

/**
 * The pure words on the Admin › Players import (27 Sep 2026): the preview line
 * under the paste box, the Import pill's label and why "Seat by Riot's roles" is
 * off. The service itself is Angular-injected and thin; these are what a reader
 * sees before and after a run.
 */

const id = (name: string, tag = 'EUW'): RiotId => ({ name, tag });

function preview(over: Partial<RosterImportPreview> = {}): RosterImportPreview {
  return { ids: [], creates: [], skips: [], dropped: 0, ...over };
}

function create(name: string, index: number, role: RosterImportRow['seat'], sub = false) {
  return {
    id: id(name),
    index,
    player: { name, role, ...(sub ? { sub: true } : {}), strengths: [], weaknesses: [], top3: [], bans: [] }
  };
}

function row(over: Partial<RosterImportRow> & { name: string }): RosterImportRow {
  const { name, ...rest } = over;
  return { id: id(name), playerId: `p-${name}`, seat: 'Top', sub: false, state: 'done', ...rest };
}

describe('importPreviewLine', () => {
  it('is empty when nothing parsed, since the refusal says that on its own line', () => {
    expect(importPreviewLine(preview({ refused: 'No Riot ID could be read.' }))).toBe('');
  });

  it('lists every create with its seat, in paste order, and marks a sub', () => {
    const p = preview({
      ids: [id('Alpha'), id('Beta'), id('Zeta')],
      creates: [create('Alpha', 0, 'Top'), create('Beta', 1, 'Jungle'), create('Zeta', 5, 'Top', true)]
    });
    expect(importPreviewLine(p)).toBe('3 players read: Alpha#EUW to Top, Beta#EUW to Jungle, Zeta#EUW to Top (sub).');
  });

  it('adds the skips and the dropped lines after semicolons', () => {
    const p = preview({
      ids: [id('Alpha'), id('Beta'), id('Gamma')],
      creates: [create('Alpha', 0, 'Top')],
      skips: [
        { id: id('Beta'), reason: 'already-on-roster' },
        { id: id('Gamma'), reason: 'already-on-roster' }
      ],
      dropped: 1
    });
    expect(importPreviewLine(p)).toBe('1 player read: Alpha#EUW to Top; 2 already on the roster; 1 line skipped, no tag or a repeat.');
  });

  it('says there is nothing new when every ID is already here', () => {
    const p = preview({ ids: [id('Beta')], skips: [{ id: id('Beta'), reason: 'already-on-roster' }], dropped: 2 });
    expect(importPreviewLine(p)).toBe('Nothing new to add; 1 already on the roster; 2 lines skipped, no tag or a repeat.');
  });

  it('keeps the creates on the line under a cap refusal, so the paste can still be checked', () => {
    const p = preview({ ids: [id('Alpha')], creates: [create('Alpha', 0, 'Top')], refused: 'That would put 11 players on the roster.' });
    expect(importPreviewLine(p)).toBe('1 player read: Alpha#EUW to Top.');
  });
});

describe('importLabel', () => {
  it('counts what the pill would add, singular and plural, and stays generic with nothing to count', () => {
    expect(importLabel(preview())).toBe('Import players');
    expect(importLabel(preview({ creates: [create('Alpha', 0, 'Top')] }))).toBe('Import 1 player');
    expect(importLabel(preview({ creates: [create('Alpha', 0, 'Top'), create('Beta', 1, 'Jungle')] }))).toBe('Import 2 players');
  });
});

describe('reseatReason', () => {
  const five: RosterImportRow[] = [
    row({ name: 'A', seat: 'Top' }),
    row({ name: 'B', seat: 'Jungle' }),
    row({ name: 'C', seat: 'Mid' }),
    row({ name: 'D', seat: 'ADC' }),
    row({ name: 'E', seat: 'Support' })
  ];

  it('is null when the service allows the reseat', () => {
    expect(reseatReason(five, false, true)).toBeNull();
  });

  it('names the import first while one runs', () => {
    expect(reseatReason(five, true, false)).toBe('Wait for the import to finish.');
  });

  it('points at Retry while a starter is unread', () => {
    const rows = [...five.slice(0, 4), row({ name: 'E', seat: 'Support', state: 'failed', reason: 'No games' })];
    expect(reseatReason(rows, false, false)).toBe('Every starter has to be read from Riot first; Retry is on the row.');
  });

  it('says the five must all come from this import when two were already here', () => {
    const rows = [...five.slice(0, 3), row({ name: 'D', seat: 'ADC', state: 'skipped', playerId: undefined }), row({ name: 'E', seat: 'Support', state: 'skipped', playerId: undefined })];
    expect(reseatReason(rows, false, false)).toBe('Only when all five starters came from this import and were read from Riot.');
  });

  it('blames a shared seat when five were read and it is still off', () => {
    expect(reseatReason(five, false, false)).toBe('Riot sees two of them in the same seat, so there is no seating to copy.');
  });

  it('ignores the bench: a failed sub does not hold the starters up', () => {
    const rows = [...five, row({ name: 'F', seat: 'Top', sub: true, state: 'failed' })];
    expect(reseatReason(rows, false, false)).toBe('Riot sees two of them in the same seat, so there is no seating to copy.');
  });
});
