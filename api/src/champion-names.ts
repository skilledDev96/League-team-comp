/**
 * Riot's internal championName (the Data Dragon id) does not always match the
 * display name the app stores and the champion list carries: "MonkeyKing" is
 * Wukong, "Nunu" is Nunu & Willump. One table, so the match reader and the
 * review's validator normalise the same way (10 Sep 2026, moved out of
 * index.ts so `game-review.ts` can read it without a cycle).
 */
export const DDRAGON_TO_DISPLAY: Record<string, string> = {
  Belveth: "Bel'Veth",
  Velkoz: "Vel'Koz",
  DrMundo: 'Dr. Mundo',
  MissFortune: 'Miss Fortune',
  JarvanIV: 'Jarvan IV',
  Kaisa: "Kai'Sa",
  Khazix: "Kha'Zix",
  KogMaw: "Kog'Maw",
  Leblanc: 'LeBlanc',
  Nunu: 'Nunu & Willump',
  RekSai: "Rek'Sai",
  Renata: 'Renata Glasc',
  TahmKench: 'Tahm Kench',
  TwistedFate: 'Twisted Fate',
  XinZhao: 'Xin Zhao',
  AurelionSol: 'Aurelion Sol',
  Chogath: "Cho'Gath",
  MonkeyKing: 'Wukong'
};

/** The display name for a Riot championName; a name the table does not carry is already the display name. */
export function displayChampionName(riotChampionName: string): string {
  return DDRAGON_TO_DISPLAY[riotChampionName] ?? riotChampionName;
}
