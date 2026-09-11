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

const DISPLAY_TO_DDRAGON: Record<string, string> = Object.fromEntries(Object.entries(DDRAGON_TO_DISPLAY).map(([id, display]) => [display, id]));

/**
 * The other direction: Riot's championName for a display name (12 Sep 2026).
 *
 * Needed because an analysis game stores champions as DISPLAY names — `enemies[].champion` and
 * `players[].champion` both come through `displayChampionName` — while everything the crawler
 * collects is keyed on the id. Reading a lane matchup off "Wukong" finds nothing, because the
 * counters are under "MonkeyKing"; and stripping punctuation does not rescue it either, since
 * "Kai'Sa" strips to "KaiSa" where the id is "Kaisa". The app has been bitten by exactly this once
 * already — three champions had no solo queue rate for weeks — and a missing rate looks identical
 * to a rate below the sample floor, which is what hid it.
 */
export function riotChampionId(displayName: string): string {
  return DISPLAY_TO_DDRAGON[displayName] ?? displayName;
}
