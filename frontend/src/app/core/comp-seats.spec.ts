import { describe, expect, it } from 'vitest';
import { CompFallbacks, CompPicks, Role, ROLES } from '../models/team.models';
import {
  addOption,
  allChampions,
  championOf,
  compSeatOptions,
  CompSeats,
  MAX_SEAT_OPTIONS,
  noteOf,
  priorityChampions,
  promoteOption,
  removeOption,
  seatOf,
  seatOptions,
  setChampionInLine,
  setNote,
  setPriority,
  swapSeats
} from './comp-seats';

const empty: CompPicks = { Top: '', Jungle: '', Mid: '', ADC: '', Support: '' };

const comp = (picks: Partial<CompPicks>, fallbacks?: CompFallbacks): CompSeats => ({
  picks: { ...empty, ...picks },
  fallbacks
});

/** The dive comp the feature was asked for: Nautilus first, Leona behind him. */
const dive = () =>
  comp(
    { Support: 'Nautilus - hook engage', Top: 'Maokai - frontline' },
    { Support: ['Leona - same engage, longer lockdown', 'Rell'] }
  );

const names = (options: { champion: string }[]) => options.map((o) => o.champion);

describe('seatOptions', () => {
  it('reads a seat with no fallbacks exactly as it always did', () => {
    const options = seatOptions(comp({ Mid: 'Ahri - roams' }), 'Mid');
    expect(options).toEqual([{ champion: 'Ahri', note: 'roams', rank: 0 }]);
  });

  it('puts the priority first and the fallbacks behind it, in order', () => {
    expect(names(seatOptions(dive(), 'Support'))).toEqual(['Nautilus', 'Leona', 'Rell']);
    expect(seatOptions(dive(), 'Support').map((o) => o.rank)).toEqual([0, 1, 2]);
  });

  it('gives each entry its own note, so nothing is stacked on the separator', () => {
    const options = seatOptions(dive(), 'Support');
    expect(options[0].note).toBe('hook engage');
    expect(options[1].note).toBe('same engage, longer lockdown');
    expect(options[2].note).toBe('');
  });

  it('returns nothing for a seat with fallbacks and no priority', () => {
    // The invariant, enforced on read: a hand-edited document or an Admin paste
    // must never make a seat read as filled because something sits behind it.
    expect(seatOptions(comp({}, { Top: ['Sion', 'Ornn'] }), 'Top')).toEqual([]);
  });

  it('drops an empty fallback entry rather than counting it', () => {
    expect(names(seatOptions(comp({ Top: 'Maokai' }, { Top: ['', ' - orphan note', 'Sion'] }), 'Top'))).toEqual([
      'Maokai',
      'Sion'
    ]);
  });

  it('drops a duplicate of the priority, however it is spelled', () => {
    const seats = comp({ Jungle: 'MonkeyKing - split' }, { Jungle: ['Wukong - the same champion', 'Vi'] });
    expect(names(seatOptions(seats, 'Jungle'))).toEqual(['MonkeyKing', 'Vi']);
  });

  it('caps a seat at four however many the document holds', () => {
    const seats = comp({ Top: 'Maokai' }, { Top: ['Sion', 'Ornn', 'Gragas', 'Sett', 'Renekton'] });
    expect(seatOptions(seats, 'Top')).toHaveLength(MAX_SEAT_OPTIONS);
    expect(names(seatOptions(seats, 'Top'))).toEqual(['Maokai', 'Sion', 'Ornn', 'Gragas']);
  });
});

describe('compSeatOptions', () => {
  it('answers for all five seats, empty ones included', () => {
    const all = compSeatOptions(dive());
    expect(Object.keys(all).sort()).toEqual(['ADC', 'Jungle', 'Mid', 'Support', 'Top']);
    expect(all.Mid).toEqual([]);
    expect(names(all.Support)).toEqual(['Nautilus', 'Leona', 'Rell']);
  });
});

describe('priorityChampions', () => {
  it('is the five as today: one champion a seat, no notes and no fallbacks', () => {
    expect(priorityChampions(dive())).toEqual({
      Top: 'Maokai',
      Jungle: '',
      Mid: '',
      ADC: '',
      Support: 'Nautilus'
    });
  });
});

describe('allChampions', () => {
  it('is every option of every seat, in seat then rank order', () => {
    expect(allChampions(dive())).toEqual(['Maokai', 'Nautilus', 'Leona', 'Rell']);
  });

  it('is what "does this comp use Leona" asks', () => {
    expect(allChampions(dive())).toContain('Leona');
    expect(allChampions(comp({ Support: 'Nautilus' }))).not.toContain('Leona');
  });

  it('names a champion once even when a document put it in two seats', () => {
    const seats = comp({ Top: 'MonkeyKing', Jungle: 'Wukong' });
    expect(allChampions(seats)).toEqual(['MonkeyKing']);
  });
});

describe('seatOf', () => {
  it('finds a priority and a fallback alike', () => {
    expect(seatOf(dive(), 'Nautilus')).toBe('Support');
    expect(seatOf(dive(), 'Leona')).toBe('Support');
    expect(seatOf(dive(), 'Maokai')).toBe('Top');
  });

  it('compares canonically, so MonkeyKing finds Wukong', () => {
    expect(seatOf(comp({ Jungle: 'MonkeyKing' }), 'Wukong')).toBe('Jungle');
  });

  it('is null for a champion the comp has not got, and for nothing at all', () => {
    expect(seatOf(dive(), 'Thresh')).toBeNull();
    expect(seatOf(dive(), '')).toBeNull();
  });
});

describe('setPriority', () => {
  it('sets the seat and keeps the note written against it', () => {
    const { picks } = setPriority(comp({ Jungle: 'Vi - guaranteed lockdown' }), 'Jungle', 'Sejuani');
    expect(picks.Jungle).toBe('Sejuani - guaranteed lockdown');
  });

  it('behaves exactly as setChampionInLine does on a comp with no fallbacks', () => {
    const before = comp({ Jungle: 'Vi - guaranteed lockdown' });
    const { picks, fallbacks } = setPriority(before, 'Jungle', 'Sejuani');
    expect(picks.Jungle).toBe(setChampionInLine(before.picks.Jungle, 'Sejuani'));
    expect(fallbacks).toEqual({});
  });

  it('leaves the seat’s fallbacks where they are', () => {
    const { picks, fallbacks } = setPriority(dive(), 'Support', 'Thresh');
    expect(picks.Support).toBe('Thresh - hook engage');
    expect(fallbacks.Support).toEqual(['Leona - same engage, longer lockdown', 'Rell']);
  });

  it('promotes rather than duplicating a champion already behind this seat', () => {
    const { picks, fallbacks } = setPriority(dive(), 'Support', 'Leona');
    expect(picks.Support).toBe('Leona - same engage, longer lockdown');
    expect(fallbacks.Support).toEqual(['Nautilus - hook engage', 'Rell']);
  });

  it('refuses a champion sitting in another seat, because one champion is one seat', () => {
    const { picks } = setPriority(dive(), 'Jungle', 'Leona');
    expect(picks.Jungle).toBe('');
    expect(picks.Support).toBe('Nautilus - hook engage');
  });

  it('does nothing with a blank champion', () => {
    expect(setPriority(dive(), 'Mid', '  ').picks.Mid).toBe('');
  });
});

describe('addOption', () => {
  it('appends behind the priority', () => {
    const { fallbacks } = addOption(comp({ Support: 'Nautilus' }), 'Support', 'Leona');
    expect(fallbacks.Support).toEqual(['Leona']);
  });

  it('becomes the priority on an empty seat, keeping the note already written there', () => {
    const { picks, fallbacks } = addOption(comp({ Mid: ' - needs to roam' }), 'Mid', 'Ahri');
    expect(picks.Mid).toBe('Ahri - needs to roam');
    expect(fallbacks.Mid).toBeUndefined();
  });

  it('refuses a champion already anywhere in the comp', () => {
    expect(addOption(dive(), 'Top', 'Leona').fallbacks.Top).toBeUndefined();
    expect(addOption(dive(), 'Support', 'Leona').fallbacks.Support).toEqual([
      'Leona - same engage, longer lockdown',
      'Rell'
    ]);
  });

  it('refuses a champion spelled the other way, too', () => {
    const seats = comp({ Jungle: 'MonkeyKing' }, { Jungle: ['Vi'] });
    expect(addOption(seats, 'Jungle', 'Wukong').fallbacks.Jungle).toEqual(['Vi']);
  });

  it('refuses past the cap of four a seat', () => {
    const full = comp({ Top: 'Maokai' }, { Top: ['Sion', 'Ornn', 'Gragas'] });
    expect(seatOptions(full, 'Top')).toHaveLength(MAX_SEAT_OPTIONS);
    expect(addOption(full, 'Top', 'Sett').fallbacks.Top).toEqual(['Sion', 'Ornn', 'Gragas']);
  });

  it('three fallbacks are three calls', () => {
    let seats: CompSeats = comp({ Support: 'Nautilus' });
    for (const champ of ['Leona', 'Rell', 'Alistar']) seats = addOption(seats, 'Support', champ);
    expect(names(seatOptions(seats, 'Support'))).toEqual(['Nautilus', 'Leona', 'Rell', 'Alistar']);
  });

  it('leaves every other role off the fallbacks object entirely', () => {
    // Firestore rejects undefined and an empty array stored for every role is noise.
    const { fallbacks } = addOption(comp({ Support: 'Nautilus' }), 'Support', 'Leona');
    expect(Object.keys(fallbacks)).toEqual(['Support']);
  });
});

describe('removeOption', () => {
  it('takes one fallback out and leaves the rest in order', () => {
    const { picks, fallbacks } = removeOption(dive(), 'Support', 'Leona');
    expect(picks.Support).toBe('Nautilus - hook engage');
    expect(fallbacks.Support).toEqual(['Rell']);
  });

  it('promotes the first fallback when the priority goes, note and all', () => {
    // A seat must never read Empty with chips sitting under it.
    const { picks, fallbacks } = removeOption(dive(), 'Support', 'Nautilus');
    expect(picks.Support).toBe('Leona - same engage, longer lockdown');
    expect(fallbacks.Support).toEqual(['Rell']);
  });

  it('keeps the seat’s note when the last option goes, the way clearing a pick always has', () => {
    const { picks, fallbacks } = removeOption(comp({ Top: 'Maokai - frontline' }), 'Top', 'Maokai');
    expect(picks.Top).toBe(' - frontline');
    expect(fallbacks.Top).toBeUndefined();
  });

  it('clears to nothing when there was no note', () => {
    expect(removeOption(comp({ Top: 'Maokai' }), 'Top', 'Maokai').picks.Top).toBe('');
  });

  it('finds the entry by canonical name', () => {
    const seats = comp({ Jungle: 'Vi' }, { Jungle: ['MonkeyKing'] });
    expect(removeOption(seats, 'Jungle', 'Wukong').fallbacks.Jungle).toBeUndefined();
  });

  it('does nothing for a champion that is not in the seat', () => {
    const { picks, fallbacks } = removeOption(dive(), 'Support', 'Thresh');
    expect(picks.Support).toBe('Nautilus - hook engage');
    expect(fallbacks.Support).toEqual(['Leona - same engage, longer lockdown', 'Rell']);
  });
});

describe('promoteOption', () => {
  it('makes a fallback the priority and drops the old priority in behind it', () => {
    const { picks, fallbacks } = promoteOption(dive(), 'Support', 'Rell');
    expect(picks.Support).toBe('Rell');
    expect(fallbacks.Support).toEqual(['Nautilus - hook engage', 'Leona - same engage, longer lockdown']);
  });

  it('is the only reordering the board needs: promoting twice puts it back', () => {
    const once = promoteOption(dive(), 'Support', 'Leona');
    const twice = promoteOption(once, 'Support', 'Nautilus');
    expect(twice.picks.Support).toBe('Nautilus - hook engage');
    expect(twice.fallbacks.Support).toEqual(['Leona - same engage, longer lockdown', 'Rell']);
  });

  it('does nothing when the champion is already the priority, or is not in the seat', () => {
    expect(promoteOption(dive(), 'Support', 'Nautilus').fallbacks.Support).toEqual([
      'Leona - same engage, longer lockdown',
      'Rell'
    ]);
    expect(promoteOption(dive(), 'Support', 'Thresh').picks.Support).toBe('Nautilus - hook engage');
  });
});

describe('setNote', () => {
  it('writes the priority’s note', () => {
    expect(setNote(dive(), 'Top', 'Maokai', 'holds the side').picks.Top).toBe('Maokai - holds the side');
  });

  it('writes one fallback’s note and leaves the others alone', () => {
    const { picks, fallbacks } = setNote(dive(), 'Support', 'Rell', 'when they have no dash');
    expect(picks.Support).toBe('Nautilus - hook engage');
    expect(fallbacks.Support).toEqual([
      'Leona - same engage, longer lockdown',
      'Rell - when they have no dash'
    ]);
  });

  it('clearing a note leaves the champion alone', () => {
    expect(setNote(dive(), 'Top', 'Maokai', '   ').picks.Top).toBe('Maokai');
  });

  it('an empty seat still takes a note, which is often written before the pick', () => {
    expect(setNote(comp({}), 'Mid', '', 'needs to roam').picks.Mid).toBe(' - needs to roam');
    expect(setNote(comp({ Mid: ' - needs to roam' }), 'Mid', '', '').picks.Mid).toBe('');
  });

  it('does nothing for an entry the seat has not got', () => {
    expect(setNote(dive(), 'Support', 'Thresh', 'nope').fallbacks.Support).toEqual([
      'Leona - same engage, longer lockdown',
      'Rell'
    ]);
  });
});

describe('swapSeats', () => {
  it('moves the whole seat: priority, fallbacks and every note', () => {
    const { picks, fallbacks } = swapSeats(dive(), 'Support', 'Top');
    expect(picks.Top).toBe('Nautilus - hook engage');
    expect(fallbacks.Top).toEqual(['Leona - same engage, longer lockdown', 'Rell']);
    expect(picks.Support).toBe('Maokai - frontline');
    expect(fallbacks.Support).toBeUndefined();
  });

  it('carries an empty seat’s own note with it', () => {
    const seats = comp({ Top: 'Maokai', Mid: ' - needs to roam' });
    const { picks } = swapSeats(seats, 'Top', 'Mid');
    expect(picks.Mid).toBe('Maokai');
    expect(picks.Top).toBe(' - needs to roam');
  });

  it('does nothing swapping a seat with itself', () => {
    expect(swapSeats(dive(), 'Support', 'Support').picks.Support).toBe('Nautilus - hook engage');
  });

  it('does nothing with a key that is not a seat, which is what a stray drop carries', () => {
    // The board's slots accept any drop and hand over `dataTransfer.getData('text/plain')`: a drag
    // that began on a champion's picture in the wall carries its icon URL, and an empty drag nothing
    // at all. Neither may write a junk key into the seat map or leave a real seat undefined.
    const icon = 'https://ddragon.leagueoflegends.com/cdn/img/champion/Leona.png' as Role;
    const { picks, fallbacks } = swapSeats(dive(), icon, 'Top');
    expect(Object.keys(picks).sort()).toEqual([...ROLES].sort());
    expect(picks.Top).toBe('Maokai - frontline');
    expect(picks.Support).toBe('Nautilus - hook engage');
    expect(fallbacks.Support).toEqual(['Leona - same engage, longer lockdown', 'Rell']);
    expect(swapSeats(dive(), '' as Role, 'Top').picks.Top).toBe('Maokai - frontline');
    expect(swapSeats(dive(), undefined as unknown as Role, 'Top').picks.Top).toBe('Maokai - frontline');
  });
});

describe('the invariant on write', () => {
  it('drops fallbacks a document left behind on a seat with no priority', () => {
    const seats = comp({ Support: 'Nautilus' }, { Support: ['Leona'], Top: ['Sion', 'Ornn'] });
    const { picks, fallbacks } = addOption(seats, 'Support', 'Rell');
    expect(picks.Top).toBe('');
    expect(fallbacks.Top).toBeUndefined();
    expect(fallbacks.Support).toEqual(['Leona', 'Rell']);
  });

  it('cleans a duplicate and a seat past the cap as it writes', () => {
    const seats = comp(
      { Top: 'Maokai' },
      { Top: ['Maokai - the same pick twice', 'Sion', 'Ornn', 'Gragas', 'Sett'] }
    );
    const { fallbacks } = setNote(seats, 'Top', 'Maokai', 'frontline');
    expect(fallbacks.Top).toEqual(['Sion', 'Ornn', 'Gragas']);
  });

  it('never returns a role holding an empty array', () => {
    const { fallbacks } = removeOption(comp({ Support: 'Nautilus' }, { Support: ['Leona'] }), 'Support', 'Leona');
    expect(Object.keys(fallbacks)).toEqual([]);
  });
});

describe('a comp with no fallbacks', () => {
  const plain = comp({ Top: 'Maokai', Jungle: 'Vi', Mid: 'Ahri', ADC: 'Jinx', Support: 'Thresh - hook' });

  it('reads as five seats of one champion each', () => {
    for (const role of ['Top', 'Jungle', 'Mid', 'ADC', 'Support'] as Role[]) {
      expect(seatOptions(plain, role)).toHaveLength(1);
    }
    expect(allChampions(plain)).toEqual(['Maokai', 'Vi', 'Ahri', 'Jinx', 'Thresh']);
  });

  it('writes back the same picks it was given, and no fallbacks at all', () => {
    const { picks, fallbacks } = setPriority(plain, 'Mid', 'Orianna');
    expect(picks).toEqual({ ...plain.picks, Mid: 'Orianna' });
    expect(fallbacks).toEqual({});
  });
});

describe('the line primitives, which a fallback entry uses unchanged', () => {
  it('reads one fallback entry exactly as it reads a pick', () => {
    const entry = 'Leona - same engage, longer lockdown';
    expect(championOf(entry)).toBe('Leona');
    expect(noteOf(entry)).toBe('same engage, longer lockdown');
  });

  it('survives a note that itself contains the separator', () => {
    expect(noteOf('Vi - dive, then peel - late')).toBe('dive, then peel - late');
    expect(setChampionInLine('Vi - dive, then peel - late', 'Vi')).toBe('Vi - dive, then peel - late');
  });
});
