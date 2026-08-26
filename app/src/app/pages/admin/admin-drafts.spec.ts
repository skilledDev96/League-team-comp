import { describe, expect, it } from 'vitest';
import { FillIn, Player, Tournament } from '../../models/team.models';
import {
  emptyPicks,
  newUid,
  normalizeEmailValue,
  slugifyName,
  splitList,
  toFillInDraft,
  toPlayerDraft,
  toTournamentDraft
} from './admin-drafts';

const player: Player = {
  id: 'p1',
  name: 'Go10x',
  role: 'Jungle',
  secondaryRoles: ['Jungle', 'Top'],
  strengths: ['Route efficiency', 'Objective tracking'],
  weaknesses: ['Overextends'],
  top3: ['Vi', 'Sejuani'],
  bans: ['Nidalee'],
  order: 0
};

describe('toPlayerDraft', () => {
  it('flattens lists into the comma-separated text the inputs bind to', () => {
    const draft = toPlayerDraft(player);
    expect(draft.strengths).toBe('Route efficiency, Objective tracking');
    expect(draft.top3).toBe('Vi, Sejuani');
    expect(draft.bans).toBe('Nidalee');
  });

  it('drops the main role from the secondary list', () => {
    // A player flexing into their own role is not a flex.
    expect(toPlayerDraft(player).secondaryRoles).toEqual(['Top']);
  });

  it('turns absent optional fields into empty strings, not undefined', () => {
    const draft = toPlayerDraft(player);
    expect(draft.icon).toBe('');
    expect(draft.playstyle).toBe('');
    expect(draft.opggSlug).toBe('');
    expect(draft.riotTag).toBe('');
  });

  it('defaults the region rather than leaving it blank', () => {
    expect(toPlayerDraft(player).region).toBe('euw');
  });

  it('reads the profile when there is one', () => {
    const draft = toPlayerDraft({
      ...player,
      profile: { region: 'na', opggSlug: 'go10x', riotTag: 'EUW', mobalyticsSlug: 'g10' }
    });
    expect(draft.region).toBe('na');
    expect(draft.opggSlug).toBe('go10x');
    expect(draft.riotTag).toBe('EUW');
  });

  it('gives every draft its own uid, so unsaved rows stay distinguishable', () => {
    expect(toPlayerDraft(player).uid).not.toBe(toPlayerDraft(player).uid);
  });
});

describe('toFillInDraft', () => {
  const fillIn: FillIn = {
    id: 'f1',
    summoner: 'Stand In',
    status: 'Available',
    preferredRoles: ['Top', 'Mid'],
    order: 0
  };

  it('flattens the preferred roles', () => {
    expect(toFillInDraft(fillIn).preferredRoles).toBe('Top, Mid');
  });

  it('fills absent fields with empty strings and a default region', () => {
    const draft = toFillInDraft(fillIn);
    expect(draft.note).toBe('');
    expect(draft.icon).toBe('');
    expect(draft.region).toBe('euw');
  });
});

describe('toTournamentDraft', () => {
  const tournament: Tournament = { id: 't1', name: 'Oryx', order: 0 };

  it('turns every absent optional into an empty string', () => {
    const draft = toTournamentDraft(tournament);
    expect(draft.organiser).toBe('');
    expect(draft.division).toBe('');
    expect(draft.format).toBe('');
    expect(draft.startDate).toBe('');
    expect(draft.notes).toBe('');
  });

  it('treats an absent active flag as false, not undefined', () => {
    // The checkbox binds to this; undefined would render indeterminate.
    expect(toTournamentDraft(tournament).active).toBe(false);
  });

  it('keeps the values that are set', () => {
    const draft = toTournamentDraft({ ...tournament, division: 'Second', active: true });
    expect(draft.division).toBe('Second');
    expect(draft.active).toBe(true);
  });
});

describe('splitList', () => {
  it('splits, trims, and drops the gaps', () => {
    expect(splitList('Vi,  Sejuani ,, Nidalee ')).toEqual(['Vi', 'Sejuani', 'Nidalee']);
  });

  it('returns nothing for an empty or comma-only string', () => {
    expect(splitList('')).toEqual([]);
    expect(splitList(' , , ')).toEqual([]);
  });

  it('round-trips with the join the converters use', () => {
    const champs = ['Vi', 'Sejuani', 'Nidalee'];
    expect(splitList(champs.join(', '))).toEqual(champs);
  });
});

describe('slugifyName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyName('Miss Fortune')).toBe('miss-fortune');
  });

  it('strips punctuation and collapses runs', () => {
    expect(slugifyName("  Kai'Sa   Main!! ")).toBe('kai-sa-main');
  });

  it('leaves no leading or trailing hyphen', () => {
    expect(slugifyName('!!hello!!')).toBe('hello');
  });
});

describe('normalizeEmailValue', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmailValue('  Someone@Example.COM ')).toBe('someone@example.com');
  });
});

describe('emptyPicks', () => {
  it('gives every role a blank rather than leaving one out', () => {
    expect(emptyPicks()).toEqual({ Top: '', Jungle: '', Mid: '', ADC: '', Support: '' });
  });

  it('returns a fresh object each time, so two comps cannot share picks', () => {
    const a = emptyPicks();
    a.Top = 'Sion';
    expect(emptyPicks().Top).toBe('');
  });
});

describe('newUid', () => {
  it('does not repeat', () => {
    expect(new Set([newUid(), newUid(), newUid()]).size).toBe(3);
  });
});
