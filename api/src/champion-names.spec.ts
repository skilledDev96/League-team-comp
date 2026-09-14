import { describe, expect, it } from 'vitest';
import { DDRAGON_TO_DISPLAY, displayChampionName, riotChampionId } from './champion-names';

/**
 * Every Data Dragon id whose display name differs, read off champion.json for 16.18.1 on
 * 14 Sep 2026. A champion released later with a spelled name belongs here as well.
 */
const DDRAGON_16_18_DIFFERENCES: Record<string, string> = {
  AurelionSol: 'Aurelion Sol',
  Belveth: "Bel'Veth",
  Chogath: "Cho'Gath",
  DrMundo: 'Dr. Mundo',
  JarvanIV: 'Jarvan IV',
  Kaisa: "Kai'Sa",
  Khazix: "Kha'Zix",
  KogMaw: "Kog'Maw",
  KSante: "K'Sante",
  Leblanc: 'LeBlanc',
  LeeSin: 'Lee Sin',
  MasterYi: 'Master Yi',
  MissFortune: 'Miss Fortune',
  MonkeyKing: 'Wukong',
  Nunu: 'Nunu & Willump',
  RekSai: "Rek'Sai",
  Renata: 'Renata Glasc',
  TahmKench: 'Tahm Kench',
  TwistedFate: 'Twisted Fate',
  Velkoz: "Vel'Koz",
  XinZhao: 'Xin Zhao'
};

describe('displayChampionName', () => {
  it('knows every Data Dragon id whose display name differs', () => {
    for (const [id, name] of Object.entries(DDRAGON_16_18_DIFFERENCES)) expect(displayChampionName(id)).toBe(name);
  });

  it('names the three an audit found printed raw on reviews and profiles (14 Sep 2026)', () => {
    // Riot's match payload sends "FiddleSticks", which is not the Data Dragon id "Fiddlesticks".
    expect(['MasterYi', 'LeeSin', 'FiddleSticks'].map(displayChampionName)).toEqual(['Master Yi', 'Lee Sin', 'Fiddlesticks']);
  });

  it('passes a name the table does not carry through as it is', () => {
    expect(displayChampionName('Akali')).toBe('Akali');
    expect(displayChampionName('Fiddlesticks')).toBe('Fiddlesticks');
  });

  it('carries no entry that maps a champion to itself', () => {
    for (const [id, name] of Object.entries(DDRAGON_TO_DISPLAY)) expect(name).not.toBe(id);
  });
});

describe('riotChampionId', () => {
  it("turns every display name back into Riot's championName, the key the crawler files under", () => {
    for (const id of Object.keys(DDRAGON_TO_DISPLAY)) expect(riotChampionId(displayChampionName(id))).toBe(id);
    expect(riotChampionId('Master Yi')).toBe('MasterYi');
    expect(riotChampionId('Lee Sin')).toBe('LeeSin');
    expect(riotChampionId("K'Sante")).toBe('KSante');
    expect(riotChampionId('Fiddlesticks')).toBe('FiddleSticks');
  });
});
