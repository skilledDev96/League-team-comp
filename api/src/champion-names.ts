/**
 * Riot's internal championName (the Data Dragon id) does not always match the
 * display name the app stores and the champion list carries: "MonkeyKing" is
 * Wukong, "Nunu" is Nunu & Willump. One table, so the match reader and the
 * review's validator normalise the same way (10 Sep 2026, moved out of
 * index.ts so `game-review.ts` can read it without a cycle).
 *
 * The whole table was checked against Data Dragon 16.18.1 on 14 Sep 2026, every id whose name
 * differs, after an audit found "MasterYi" printed on a review: KSante, LeeSin and MasterYi were
 * missing. FiddleSticks is not a Data Dragon id (that is "Fiddlesticks") but it is what Riot's
 * match payload sends as championName, so it is here too and `riotChampionId` maps back to it,
 * which is the key the crawler files it under.
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
  MonkeyKing: 'Wukong',
  KSante: "K'Sante",
  LeeSin: 'Lee Sin',
  MasterYi: 'Master Yi',
  FiddleSticks: 'Fiddlesticks'
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
