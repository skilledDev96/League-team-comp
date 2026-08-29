import { describe, expect, it } from 'vitest';
import { ChampionInfo } from '../services/champion-data.service';
import { ChampionTraits, CompPicks } from '../models/team.models';
import {
  championOf,
  championsInComp,
  filterChampions,
  indexTraits,
  nextEmptySlot,
  noteOf,
  setChampionInLine,
  traitsFor
} from './comp-board.util';

const empty: CompPicks = { Top: '', Jungle: '', Mid: '', ADC: '', Support: '' };

const champ = (name: string, tags: string[] = ['Fighter']): ChampionInfo => ({
  id: name.replace(/[^A-Za-z]/g, ''),
  key: '1',
  name,
  title: '',
  tags
});

describe('setChampionInLine', () => {
  it('writes a champion into an empty slot', () => {
    expect(setChampionInLine('', 'Maokai')).toBe('Maokai');
  });

  it('keeps a note that was written against the slot', () => {
    // The note is the reason the pick is there; swapping the champion should
    // not silently delete someone's reasoning.
    expect(setChampionInLine('Vi - guaranteed lockdown', 'Sejuani')).toBe(
      'Sejuani - guaranteed lockdown'
    );
  });

  it('survives a note that itself contains a dash', () => {
    expect(setChampionInLine('Vi - dive, then peel - late', 'Vi')).toBe(
      'Vi - dive, then peel - late'
    );
  });
});

describe('championOf / noteOf', () => {
  it('splits a line into its champion and its note', () => {
    expect(championOf('Miss Fortune - AoE wombo finisher')).toBe('Miss Fortune');
    expect(noteOf('Miss Fortune - AoE wombo finisher')).toBe('AoE wombo finisher');
  });

  it('handles a bare champion with no note', () => {
    expect(championOf('Ahri')).toBe('Ahri');
    expect(noteOf('Ahri')).toBe('');
  });

  it('treats an empty slot as empty rather than throwing', () => {
    expect(championOf(undefined)).toBe('');
    expect(noteOf(undefined)).toBe('');
  });
});

describe('nextEmptySlot', () => {
  it('moves to the following role so five picks are five clicks', () => {
    expect(nextEmptySlot({ ...empty, Top: 'Maokai' }, 'Top')).toBe('Jungle');
  });

  it('skips slots that are already filled', () => {
    const picks = { ...empty, Top: 'Maokai', Jungle: 'Vi', Mid: 'Ahri' };
    expect(nextEmptySlot(picks, 'Top')).toBe('ADC');
  });

  it('wraps round, so starting mid-comp still fills in five clicks', () => {
    const picks = { ...empty, Mid: 'Ahri', ADC: 'Jinx', Support: 'Thresh' };
    expect(nextEmptySlot(picks, 'Support')).toBe('Top');
  });

  it('reports nothing left once the comp is full', () => {
    const full: CompPicks = {
      Top: 'Maokai',
      Jungle: 'Vi',
      Mid: 'Ahri',
      ADC: 'Jinx',
      Support: 'Thresh'
    };
    expect(nextEmptySlot(full, 'Top')).toBeNull();
  });
});

describe('championsInComp', () => {
  it('lists what is already picked, case-insensitively', () => {
    const picks = { ...empty, Top: 'Maokai - frontline', Mid: 'Ahri' };
    const taken = championsInComp(picks);
    expect(taken.has('maokai')).toBe(true);
    expect(taken.has('ahri')).toBe(true);
    expect(taken.has('vi')).toBe(false);
  });
});

describe('filterChampions', () => {
  const list = [
    champ('Miss Fortune', ['Marksman']),
    champ("Kai'Sa", ['Marksman']),
    champ('Maokai', ['Tank']),
    champ('Ahri', ['Mage'])
  ];

  it('matches anywhere in the name, not just the start', () => {
    // People type "fortune", not "miss f".
    expect(filterChampions(list, 'fortune', null).map((c) => c.name)).toEqual(['Miss Fortune']);
  });

  it('ignores punctuation on both sides', () => {
    expect(filterChampions(list, 'kaisa', null).map((c) => c.name)).toEqual(["Kai'Sa"]);
  });

  it('filters by class chip', () => {
    expect(filterChampions(list, '', 'Marksman').map((c) => c.name)).toEqual([
      'Miss Fortune',
      "Kai'Sa"
    ]);
  });

  it('applies the chip and the search together', () => {
    expect(filterChampions(list, 'mao', 'Marksman')).toEqual([]);
  });

  it('returns everything when nothing is asked of it', () => {
    expect(filterChampions(list, '', null)).toHaveLength(4);
  });
});

describe('indexTraits / traitsFor', () => {
  const traits = (id: string): ChampionTraits => ({
    id,
    name: id,
    damage: 'magic',
    attack: 'ranged',
    roles: ['mage'],
    cc: 2,
    mobility: 1,
    durability: 1,
    utility: 1
  });

  it('reads a champion whose two sources disagree only on case', () => {
    // CommunityDragon stores the alias "FiddleSticks"; every lookup arrives as
    // the Data Dragon id "Fiddlesticks". This is the whole reason the index
    // exists — a direct read returns undefined and the comp loses its label.
    const index = indexTraits({ FiddleSticks: traits('FiddleSticks') });
    expect(traitsFor(index, 'Fiddlesticks')?.id).toBe('FiddleSticks');
  });

  it('still reads the champions that already agreed', () => {
    const index = indexTraits({ MonkeyKing: traits('MonkeyKing') });
    expect(traitsFor(index, 'MonkeyKing')?.id).toBe('MonkeyKing');
  });

  it('returns nothing for an unresolved champion rather than throwing', () => {
    expect(traitsFor(indexTraits({}), undefined)).toBeUndefined();
    expect(traitsFor(indexTraits({}), 'Ahri')).toBeUndefined();
  });
});
