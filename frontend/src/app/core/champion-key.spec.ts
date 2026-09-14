import { describe, expect, it } from 'vitest';
import { canonicalChampion, championKey, displaySpelling, sameChampion } from './champion-key';

describe('champion keys', () => {
  it('gives one key to a champion however a replay or Riot spelled it', () => {
    // The pairs the audit of 14 Sep 2026 found counted as two champions in the pools and "Beats us most".
    const pairs: [string, string][] = [
      ['TahmKench', 'Tahm Kench'],
      ['MonkeyKing', 'Wukong'],
      ['JarvanIV', 'Jarvan IV'],
      ['MasterYi', 'Master Yi'],
      ['FiddleSticks', 'Fiddlesticks'],
      ['Kaisa', "Kai'Sa"],
      ['DrMundo', 'Dr. Mundo'],
      ['XinZhao', 'Xin Zhao'],
      ['MissFortune', 'Miss Fortune'],
      ['Chogath', "Cho'Gath"],
      ['Leblanc', 'LeBlanc'],
      ['TwistedFate', 'Twisted Fate'],
      ['Nunu', 'Nunu & Willump'],
      ['Renata', 'Renata Glasc']
    ];
    for (const [id, name] of pairs) {
      expect(canonicalChampion(id), id).toBe(canonicalChampion(name));
      expect(sameChampion(id, name), id).toBe(true);
    }
    expect(canonicalChampion('MonkeyKing')).toBe('wukong');
    expect(championKey('MonkeyKing')).toBe('monkeyking');
    expect(canonicalChampion('Jinx')).not.toBe(canonicalChampion('Jhin'));
  });

  it('shows the display name of the two spellings it was handed, whichever came first', () => {
    const cases: [string, string, string][] = [
      ['TahmKench', 'Tahm Kench', 'Tahm Kench'],
      ['MonkeyKing', 'Wukong', 'Wukong'],
      ['JarvanIV', 'Jarvan IV', 'Jarvan IV'],
      ['Kaisa', "Kai'Sa", "Kai'Sa"],
      ['DrMundo', 'Dr. Mundo', 'Dr. Mundo'],
      ['Leblanc', 'LeBlanc', 'LeBlanc'],
      ['FiddleSticks', 'Fiddlesticks', 'Fiddlesticks'],
      ['Nunu', 'Nunu & Willump', 'Nunu & Willump']
    ];
    for (const [id, name, shown] of cases) {
      expect(displaySpelling(id, name), `${id} then ${name}`).toBe(shown);
      expect(displaySpelling(name, id), `${name} then ${id}`).toBe(shown);
    }
    // One spelling, or a tie: the first stays.
    expect(displaySpelling('Jinx', 'Jinx')).toBe('Jinx');
    expect(displaySpelling('jinx', 'Jinx')).toBe('jinx');
  });
});
